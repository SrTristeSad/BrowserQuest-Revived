'use strict';

const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),
      Tx=require('../server/admin/world-publish-transaction'),
      World=require('../server/admin/world-store'),
      temp=fs.mkdtempSync(path.join(os.tmpdir(),'bq-world-publish-'));
function file(name){return path.join(temp,name)}
function png(w,h){const b=Buffer.alloc(24);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.write('IHDR',12,4,'ascii');b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b}
try {
  fs.writeFileSync(file('server-base.json'),JSON.stringify({width:10,height:10,collisions:[],doors:[],checkpoints:[],chestAreas:[],staticChests:[],roamingAreas:[],staticEntities:{}}));
  fs.writeFileSync(file('client-base.json'),JSON.stringify({width:10,height:10,tilesize:16,data:Array(100).fill(0),collisions:[],blocking:[],high:[],plateau:[],doors:[],checkpoints:[],animated:{}}));
  fs.writeFileSync(file('tiles.png'),png(16,16));
  fs.writeFileSync(file('stories.json'),JSON.stringify({stories:[]}));
  const options={baseMapPath:file('server-base.json'),baseClientMapPath:file('client-base.json'),tilesetPath:file('tiles.png'),storiesPath:file('stories.json'),statePath:file('draft.json'),publishedMapPath:file('server.json'),publishedClientJsonPath:file('client.json'),publishedClientJsPath:file('client.js'),versionsDir:file('versions')};
  let store=new World.WorldStore(options),draft=store.load(),result=store.publish();
  assert.strictEqual(result.ok,true);
  const previous=[file('server.json'),file('client.json'),file('client.js'),file('draft.json')].map(p=>fs.readFileSync(p,'utf8'));
  draft=store.load();draft.map.data[2]=-1;draft.map.collisions=[4,3];
  store.save(draft);
  const valid=fs.readFileSync(file('draft.json'),'utf8');
  assert.throws(()=>Tx.publish([
    {dest:file('server.json'),content:'{"rev":"bad-server"}'},
    {dest:file('client.json'),content:'{"rev":"bad-client"}'},
    {dest:file('client.js'),content:'bad-js'}
  ],file('versions'),{afterReplace:i=>{if(i===1)throw new Error('simulated-mid-publish-failure')}}),/simulated-mid-publish-failure/);
  assert.strictEqual(fs.readFileSync(file('server.json'),'utf8'),previous[0],'Rollback server file');
  assert.strictEqual(fs.readFileSync(file('client.json'),'utf8'),previous[1],'Rollback client file');
  assert.strictEqual(fs.readFileSync(file('client.js'),'utf8'),previous[2],'Rollback worker script');
  assert.strictEqual(fs.readFileSync(file('draft.json'),'utf8'),valid,'Draft unaffected by failed release');

  // Simulate unclean process termination after the first replace, before journal deletion.
  let failed=0;
  const originals=[file('server.json'),file('client.json')].map(p=>fs.readFileSync(p,'utf8'));
  try {
    Tx.publish([{dest:file('server.json'),content:'crash-server'},{dest:file('client.json'),content:'crash-client'}],
      file('versions'),{afterReplace:(i,dest)=>{
        if(i===0) {
          const original=fs.readFileSync(file('versions/publish-recovery.json'),'utf8');
          fs.writeFileSync(file('crash-journal.json'),original);
          const payload=JSON.parse(original);
          const orig=fs.readFileSync(path.join(file('versions/releases'),payload.releaseId,'0.backup'));
          fs.writeFileSync(file('crash-backup'),orig);
        }
        if(i===1)throw new Error('forced failure');
      }});
  } catch(e){failed++;}
  assert.strictEqual(failed,1);
  assert.strictEqual(fs.readFileSync(file('server.json'),'utf8'),originals[0]);
  assert.strictEqual(fs.readFileSync(file('client.json'),'utf8'),originals[1]);

  // A synthetic pending journal exercises automatic recovery on store construction.
  const pending='pending-test',pendingDir=file('versions/releases/'+pending);
  fs.mkdirSync(pendingDir,{recursive:true});
  fs.copyFileSync(file('server.json'),path.join(pendingDir,'0.backup'));
  fs.writeFileSync(file('versions/publish-recovery.json'),JSON.stringify({releaseId:pending,files:[{dest:file('server.json'),backup:'0.backup',existed:true}]}));
  fs.writeFileSync(file('server.json'),'half-published');
  store=new World.WorldStore(options);
  assert.strictEqual(fs.readFileSync(file('server.json'),'utf8'),originals[0],
    'Constructor must undo interrupted publication');
  assert(!fs.existsSync(file('versions/publish-recovery.json')));
  let invalid=JSON.parse(valid);
  invalid.map.data[1]=9999;
  assert.throws(()=>store.save(invalid),/map\.data/);
  invalid=JSON.parse(valid);invalid.map.checkpoints=[{id:1,x:999,y:1,w:2,h:2,s:0}];
  assert.throws(()=>store.save(invalid),/map\.checkpoints/);
  invalid=JSON.parse(valid);invalid.map.collisions=[-1];
  assert.throws(()=>store.save(invalid),/map\.collisions/);
  assert.strictEqual(fs.readFileSync(file('draft.json'),'utf8'),valid,
    'Invalid editor inputs cannot overwrite a saved draft');
  const published=store.publish();
  assert.strictEqual(published.ok,true);
  assert.strictEqual(JSON.parse(fs.readFileSync(file('server.json'),'utf8')).editorRevision,store.load().revision);
  assert.strictEqual(JSON.parse(fs.readFileSync(file('client.json'),'utf8')).editorRevision,store.load().revision);
  assert(store.listVersions().some(v=>v.id===published.versionId),'Published release appears in version history');
  assert.strictEqual(World.validateRawWorld({map:{width:12,height:10}},10,10,0).ok,false);
  console.log('World publish validation, prepared release, rollback and crash recovery passed.');
} finally {fs.rmSync(temp,{recursive:true,force:true})}
