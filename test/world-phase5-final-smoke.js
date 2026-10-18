'use strict';

const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),
      World=require('../server/admin/world-store'),
      html=fs.readFileSync(path.join(__dirname,'../server/admin/public/world-editor.html'),'utf8'),
      match=html.match(/<script id="terrainTools">([\s\S]*?)<\/script>/),
      scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert(match);assert.strictEqual(scripts.length,2,'World Editor inline scripts must parse');
scripts.forEach(s=>new vm.Script(s[1],{filename:'world-editor.js'}));
const sandbox={window:{}};vm.runInNewContext(match[1],sandbox);
const tools=sandbox.window.WorldTerrainTools;
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.normalizeNativeLayer([2,1,1,-1,99,3],5,0))),[1,2,3]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.toggleNativeLayer([1,2],2,10,0).values)),[1]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.toggleNativeLayer([1,2],3,10,0).values)),[1,2,3]);
assert.strictEqual(tools.toggleNativeLayer([1],99,10,0).ok,false);
for(const needle of ['value="blocking">Bloqueio do cliente','value="plateau">Platô do cliente',
 'id="toggleHighTile"','id="highTileStatus"','normalizeDraftLayers()',
 'function toggleLayerCell(','function toggleHighSelected(',
 'function previewWorld()','function exitPreview()','id="previewNotice"',
 'function updateVersionList()','function restoreVersion(versionId)',
 '/admin/api/world/preview','/admin/api/world/versions','/admin/api/world/restore',
 'function saveDraft()','previewMode=true','if(!previewMode)drawOverlays()']) {
    assert(html.includes(needle),'Missing final phase-5 interface: '+needle);
}

function png(w,h){const b=Buffer.alloc(24);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.write('IHDR',12,4,'ascii');b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-phase5-final-'));
try {
    const file=n=>path.join(dir,n),
          base={width:10,height:10,collisions:[],doors:[],checkpoints:[{id:1,x:1,y:1,w:2,h:2,s:1}],
            chestAreas:[],staticChests:[],roamingAreas:[],staticEntities:{}},
          client={width:10,height:10,tilesize:16,data:Array(100).fill(0),
             collisions:[],doors:[],checkpoints:base.checkpoints,blocking:[1,1,2],
             plateau:[30],high:[1],animated:{}};
    fs.writeFileSync(file('base-server.json'),JSON.stringify(base));
    fs.writeFileSync(file('base-client.json'),JSON.stringify(client));
    fs.writeFileSync(file('tiles.png'),png(32,16));
    fs.writeFileSync(file('stories.json'),JSON.stringify({stories:[]}));
    const options={baseMapPath:file('base-server.json'),baseClientMapPath:file('base-client.json'),
         tilesetPath:file('tiles.png'),statePath:file('draft.json'),storiesPath:file('stories.json'),
         publishedMapPath:file('published-server.json'),publishedClientJsonPath:file('published-client.json'),
         publishedClientJsPath:file('published-client.js'),versionsDir:file('versions')};
    let store=new World.WorldStore(options),state=store.load();
    assert.deepStrictEqual(state.map.blocking,[1,2],'Legacy blocking should be normalized');
    assert.deepStrictEqual(state.map.plateau,[30]);
    assert.deepStrictEqual(state.map.high,[1]);
    state.map.data[0]=1;
    state.map.collisions=[12];
    state.map.blocking=[3,4,4];
    state.map.plateau=[22,21];
    state.map.high=[2,1,2];
    state.map.doors=[{x:2,y:3,to:'d',p:0,tx:3,ty:3}];
    state.map.roamingAreas=[{id:0,x:2,y:4,width:2,height:2,nb:2,type:'rat',profileId:''}];
    state.map.staticChests=[{x:7,y:7,i:[61,23]}];
    state.map.entities.push({id:'static_item_1',x:4,y:4,kind:'flask',profileType:'item',profileId:'',source:'editor'});
    const saved=store.save(state);
    assert.deepStrictEqual(saved.map.blocking,[3,4]);
    assert.deepStrictEqual(saved.map.plateau,[21,22]);
    assert.deepStrictEqual(saved.map.high,[1,2]);
    const report=store.preview();
    assert.strictEqual(report.ok,true,'Preview validation must succeed without publishing');
    assert.strictEqual(report.liveUnchanged,true);
    assert.strictEqual(report.gameplaySimulation,false,'Preview must not claim to simulate game server');
    assert.strictEqual(fs.existsSync(file('published-server.json')),false,'Preview may not publish');
    const first=store.publish();
    assert.strictEqual(first.ok,true);
    const firstServer=fs.readFileSync(file('published-server.json'),'utf8'),
          firstClient=fs.readFileSync(file('published-client.json'),'utf8'),
          firstDraft=fs.readFileSync(file('draft.json'),'utf8');
    const parsed=JSON.parse(firstClient);
    assert.deepStrictEqual(parsed.blocking,[3,4]);
    assert.deepStrictEqual(parsed.plateau,[21,22]);
    assert.deepStrictEqual(parsed.high,[1,2]);
    assert.strictEqual(parsed.data[0],1);
    assert.strictEqual(JSON.parse(firstServer).staticEntities[String(4*10+4)],'flask');
    assert.strictEqual(JSON.parse(firstServer).editorRevision,parsed.editorRevision);
    assert(store.listVersions().some(v=>v.id===first.versionId && v.restorable));
    state=store.load();state.map.data[0]=0;
    state.map.blocking=[9];state.map.plateau=[];state.map.high=[];
    store.save(state);
    const second=store.publish();
    assert.strictEqual(second.ok,true);
    assert.notStrictEqual(fs.readFileSync(file('published-client.json'),'utf8'),firstClient);
    const restored=store.restoreVersion(first.versionId);
    assert.strictEqual(restored.ok,true);
    assert.strictEqual(restored.restoredFrom,first.versionId);
    assert.strictEqual(fs.readFileSync(file('published-server.json'),'utf8'),firstServer);
    assert.strictEqual(fs.readFileSync(file('published-client.json'),'utf8'),firstClient);
    assert.strictEqual(fs.readFileSync(file('draft.json'),'utf8'),firstDraft);
    assert(store.listVersions().some(v=>v.id===restored.newVersionId && v.restorable),
      'Restoring a version must itself create a new restorable version');
    store=new World.WorldStore(options);
    assert.deepStrictEqual(store.load().map.blocking,[3,4],'Restored layer must survive restart');
    assert.throws(()=>store.restoreVersion('../escape'),/Versão do mundo inválida/);
    const before=fs.readFileSync(file('draft.json'),'utf8');
    state=store.load();state.map.blocking=[1000];
    assert.throws(()=>store.save(state),/map.blocking/);
    state=store.load();state.map.plateau=[-1];
    assert.throws(()=>store.save(state),/map.plateau/);
    state=store.load();state.map.high=[999];
    assert.throws(()=>store.save(state),/map.high/);
    assert.strictEqual(fs.readFileSync(file('draft.json'),'utf8'),before,
      'Native invalid layers cannot overwrite saved draft');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
console.log('Phase 5 full editor: native layers, draft preview, safe publish and version restore passed.');
