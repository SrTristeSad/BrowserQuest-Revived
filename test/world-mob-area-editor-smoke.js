'use strict';

var assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),
    World=require('../server/admin/world-store');
var html=fs.readFileSync(path.join(__dirname,'../server/admin/public/world-editor.html'),'utf8'),
    script=html.match(/<script id="terrainTools">([\s\S]*?)<\/script>/),
    all=Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g));
assert(script,'Pure terrain/mob-area algorithms must be present');
assert.strictEqual(all.length,2);
all.forEach(s=>new vm.Script(s[1],{filename:'world-editor.js'}));
var context={window:{}};vm.runInNewContext(script[1],context);
var tools=context.window.WorldTerrainTools, kinds=['rat','goblin','skeleton'],
    profiles=[{id:'fast_rat',baseKind:'rat'}],
    legacy=[
      {id:0,x:1,y:1,width:3,height:3,nb:3,type:'rat'},
      {id:22,x:6,y:5,width:3,height:2,nb:2,type:'rat',profileId:'fast_rat'}
    ],
    normalized=World.normalizeMobAreas(legacy,12,10,profiles);
assert.deepStrictEqual(normalized, [
    {id:0,x:1,y:1,width:3,height:3,nb:3,type:'rat',profileId:''},
    {id:22,x:6,y:5,width:3,height:2,nb:2,type:'rat',profileId:'fast_rat'}
], 'Legacy ID 0, existing kinds and profile reference must survive');
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.normalizeMobAreas(legacy,12,10,profiles,kinds))), normalized);

var invalid=[
    {id:0,x:4,y:4,width:2,height:2,nb:1,type:'rat'}, // duplicate
    {id:99,x:11,y:5,width:1,height:1,nb:1,type:'rat'}, // touches invalid map edge
    {id:25,x:2,y:4,width:2,height:2,nb:0,type:'rat'},
    {id:26,x:2,y:4,width:2,height:2,nb:1,type:'rat',profileId:'unknown'},
    {id:27,x:2,y:4,width:2,height:2,nb:1,type:'rat',profileId:'__proto__'},
    {id:28,x:2,y:4,width:2,height:2,nb:1,type:'ghost'},
    {id:29,x:2,y:4,width:2,height:2,nb:1,type:'goblin',profileId:'fast_rat'},
    {id:30,x:0,y:1,width:2,height:2,nb:1,type:'rat'},
    {id:31,x:2,y:4,width:2,height:2,nb:501,type:'rat'},
    {id:32,x:2.4,y:4,width:2,height:2,nb:1,type:'rat'}
];
assert.deepStrictEqual(World.normalizeMobAreas(legacy.concat(invalid),12,10,profiles),normalized);
assert.throws(()=>World.requireValidMobAreas(legacy.concat(invalid),12,10,profiles),/Áreas de mobs inválidas/);

var out=tools.createMobArea(legacy,12,10,profiles,kinds,{x:3,y:4,width:2,height:2});
assert.strictEqual(out.ok,true);
assert.strictEqual(out.area.id,23,'ID allocation must be deterministic and not based on Date.now/random');
assert.strictEqual(out.area.nb,3);
assert.strictEqual(out.areas.length,3);
assert.strictEqual(tools.mobAreaAt(out.areas,{x:3,y:4}).id,23);
assert.strictEqual(tools.createMobArea(legacy,12,10,profiles,kinds,{x:0,y:0,width:2,height:2}).ok,false);

var moved=tools.applyMobArea(legacy,12,10,profiles,kinds,0,{...normalized[0],x:4,y:2,width:2,height:3});
assert.strictEqual(moved.ok,true,'Existing area must be editable');
assert.strictEqual(moved.changed,1);
assert.strictEqual(moved.areas.length,2,'Editing must not add a new area');
assert.strictEqual(moved.area.id,0,'Stable area IDs must survive moving');
assert.strictEqual(moved.areas[1].profileId,'fast_rat','Unrelated custom mob profile preserved');
assert.strictEqual(tools.applyMobArea(legacy,12,10,profiles,kinds,0,{...normalized[0],x:11}).ok,false);
assert.strictEqual(tools.applyMobArea(legacy,12,10,profiles,kinds,22,{...normalized[1],type:'goblin'}).ok,false,
    'Profile kind mismatch must fail instead of silently changing mob identity');
assert.strictEqual(tools.applyMobArea(legacy,12,10,profiles,kinds,0,{...normalized[0]}).changed,0);
var removed=tools.removeMobArea(legacy,12,10,profiles,kinds,0);
assert.strictEqual(removed.ok,true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(removed.areas)),[normalized[1]]);

for(const expected of ['function normalizeMobAreas','function applyMobArea','function createMobArea',
'function removeMobArea','function applyAreaChange','function createArea','function removeSelectedArea',
'areaDrag={id:existing.id','function areaAt(p){return terrainTools.mobAreaAt',
'selected={type:\'area\',id:result.area.id}','id="areaW"','id="areaH"','id="areaNb"',
'id="areaType"','normalizeDraftAreas()']) assert(html.includes(expected),'Missing visual area integration '+expected);
assert(!html.includes('Date.now()%999999'),'New areas must never use a time-based ID');
var areaOps=html.slice(html.indexOf('function applyAreaChange('),html.indexOf('function nearestEntity('));
assert(areaOps&&!areaOps.includes('api(')&&!areaOps.includes('fetch('),'Area edit must stay local until explicit draft save');

function fakePng(w,h){var b=Buffer.alloc(24);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.write('IHDR',12,4,'ascii');b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;}
var dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-mobarea-'));
try {
    var file=name=>path.join(dir,name),base={width:12,height:10,collisions:[],doors:[],checkpoints:[],
      chestAreas:[],staticChests:[],staticEntities:{},roamingAreas:legacy};
    var baseClient={width:12,height:10,tilesize:16,data:Array(120).fill(0),collisions:[],
      doors:[],checkpoints:[],blocking:[],plateau:[],high:[],animated:{}};
    fs.writeFileSync(file('base-server.json'),JSON.stringify(base));
    fs.writeFileSync(file('base-client.json'),JSON.stringify(baseClient));
    fs.writeFileSync(file('tiles.png'),fakePng(16,16));
    fs.writeFileSync(file('stories.json'),JSON.stringify({stories:[]}));
    var store=new World.WorldStore({
      baseMapPath:file('base-server.json'),baseClientMapPath:file('base-client.json'),
      tilesetPath:file('tiles.png'),statePath:file('draft.json'),publishedMapPath:file('published-server.json'),
      publishedClientJsonPath:file('published-client.json'),publishedClientJsPath:file('published-client.js'),
      versionsDir:file('versions'),storiesPath:file('stories.json')
    });
    var state=store.load();
    assert.strictEqual(state.map.roamingAreas[0].id,0,'Legacy area ID 0 must persist through load');
    assert.deepStrictEqual(store.load().map.roamingAreas,state.map.roamingAreas,'Repeated loads must be deterministic');
    state.mobs=profiles.map(p=>({id:p.id,name:'Rato rápido',baseKind:p.baseKind}));
    state.map.roamingAreas=moved.areas;
    var saved=store.save(state);
    assert.deepStrictEqual(store.load().map.roamingAreas,saved.map.roamingAreas,'Edited area must survive disk reload');
    assert.strictEqual(store.publish().ok,true);
    var published=JSON.parse(fs.readFileSync(file('published-server.json'),'utf8'));
    assert.deepStrictEqual(published.roamingAreas,saved.map.roamingAreas,'Published map must retain area geometry/profileId');
    assert.strictEqual(published.editorProfiles.mobs.fast_rat.baseKind,'rat','Brain v1 profile remains available');

    var before=fs.readFileSync(file('draft.json'),'utf8'),
        publishedBefore=fs.readFileSync(file('published-server.json'),'utf8');
    state=store.load();state.map.roamingAreas[0].width=999;
    assert.throws(()=>store.save(state),/Áreas de mobs inválidas/);
    assert.strictEqual(fs.readFileSync(file('draft.json'),'utf8'),before,'Invalid area must not overwrite saved draft');
    var broken=JSON.parse(before);broken.map.roamingAreas[1].profileId='missing-profile';
    fs.writeFileSync(file('draft.json'),JSON.stringify(broken));
    assert.throws(()=>store.publish(),/Áreas de mobs inválidas/);
    assert.strictEqual(fs.readFileSync(file('published-server.json'),'utf8'),publishedBefore,
      'Invalid draft must not replace working world server');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('World Editor mob areas, stable IDs, move/resize, profile validation and publish passed.');
