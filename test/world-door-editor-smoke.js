'use strict';

var assert=require('assert'),
    fs=require('fs'),
    os=require('os'),
    path=require('path'),
    vm=require('vm'),
    World=require('../server/admin/world-store');

var html=fs.readFileSync(path.join(__dirname,'..','server','admin','public','world-editor.html'),'utf8'),
    script=html.match(/<script id="terrainTools">([\s\S]*?)<\/script>/),
    scripts=Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)),
    context={window:{}},tools;
assert(script,'World Editor must retain its pure algorithm script');
assert.strictEqual(scripts.length,2,'World Editor has two inline scripts');
scripts.forEach(function(s){new vm.Script(s[1],{filename:'world-editor.js'});});
vm.runInNewContext(script[1],context);
tools=context.window.WorldTerrainTools;

var doors=[
    {x:1,y:1,p:0,to:'u',tx:5,ty:3},
    {x:4,y:2,p:1,to:'l',tx:2,ty:3,tcx:2,tcy:2}
], invalid=[
    {x:1,y:1,p:1,to:'d',tx:4,ty:3}, // duplicate origin
    {x:0,y:0,p:0,to:'u',tx:0,ty:0}, // self
    {x:3,y:2,p:0,to:'q',tx:4,ty:2}, // invalid orientation
    {x:5,y:4,p:0,to:'u',tx:2,ty:1}, // out of bounds
    {x:2,y:1,p:0,to:'d',tx:4,ty:2,tcx:2}, // partial camera
    {x:2,y:1,p:9,to:'u',tx:4,ty:2},
    {x:2,y:1,p:0,to:'u',tx:4.5,ty:2}
];
var records=doors.concat(invalid);
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.normalizeDoors(records,6,4))),doors,
    'Client editor must discard invalid door links and duplicate origins');
assert.deepStrictEqual(World.normalizeDoorLinks(records,6,4),doors,
    'Server must normalize doors identically to the editor');
assert.throws(function(){World.requireValidDoorLinks(records,6,4);},/Portas\/teleportes inválidos/);
assert.strictEqual(tools.doorAt(doors,6,4,{x:1,y:1}).to,'u');
assert.strictEqual(tools.doorAt(doors,6,4,{x:0,y:1}),null);
var result=tools.applyDoor(doors,6,4,{x:1,y:1},{...doors[0],to:'d',tx:5,ty:2});
assert.strictEqual(result.ok,true,'Existing source should not collide with itself');
assert.strictEqual(result.changed,1);
assert.strictEqual(result.doors.length,2,'Edit must replace, not add, a door');
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.doors[1])),doors[1],'Unrelated door preserved');
result=tools.applyDoor(doors,6,4,{x:1,y:1},{...doors[0],x:2,y:1});
assert.strictEqual(result.ok,true,'Door source can move without changing the count');
assert.strictEqual(result.doors[0].x,2);
assert.strictEqual(result.doors.length,2);
assert.strictEqual(tools.applyDoor(doors,6,4,{x:1,y:1},{...doors[0],x:4,y:2}).reason,'occupied',
    'Two doors cannot use the same origin');
assert.strictEqual(tools.applyDoor(doors,6,4,{x:1,y:1},{...doors[0],tx:1,ty:1}).reason,'invalid_door',
    'Teleporting onto itself must be rejected');
assert.strictEqual(tools.applyDoor(doors,6,4,{x:1,y:1},{...doors[0],tx:9}).ok,false,
    'Outside destinations must be rejected');
assert.strictEqual(tools.applyDoor(doors,6,4,{x:1,y:1},{...doors[0],tcx:1}).ok,false,
    'Camera coordinates must come in pairs');
assert.strictEqual(tools.applyDoor(doors,6,4,{x:1,y:1},{...doors[0]}).changed,0,
    'Repeating same values must not change the draft');
result=tools.createDoor(doors,6,4,{x:0,y:0});
assert.strictEqual(result.ok,true);
assert.strictEqual(result.door.tx,1);
assert.strictEqual(result.door.p,0);
assert.strictEqual(tools.createDoor(doors,6,4,{x:1,y:1}).reason,'occupied');
assert.strictEqual(tools.createDoor(doors,6,4,{x:-1,y:2}).ok,false);
result=tools.removeDoor(doors,6,4,{x:1,y:1});
assert.strictEqual(result.ok,true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.doors)),[doors[1]],
    'Remove must use the origin key, not object identity');

for(var expected of ['value="door">Porta / teleporte','data-quick="door">Portas',
'state.map.doors.forEach(door=>','id="doorTx"','id="doorTy"','id="doorOrientation"',
'id="doorPortal"','id="doorCameraX"','id="doorCameraY"','id="pickDoorDestination"',
'id="applyDoor"','id="deleteDoor"','function applyDoorChange(','function removeSelectedDoor(',
'terrainTools.createDoor','terrainTools.applyDoor','terrainTools.removeDoor','normalizeDraftDoors()']){
    assert(html.includes(expected),'Missing World Editor UI capability: '+expected);
}
var ops=html.slice(html.indexOf('function applyDoorChange('),html.indexOf('function applyCheckpointChange('));
assert(ops.length>0&&!ops.includes('api(')&&!ops.includes('fetch('),
    'Door changes must stay local until explicit draft save');

function fakePng(w,h){var buffer=Buffer.alloc(24);
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(buffer);
    buffer.write('IHDR',12,4,'ascii');buffer.writeUInt32BE(w,16);buffer.writeUInt32BE(h,20);return buffer;}
var dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-doors-'));
try{
    function p(name){return path.join(dir,name);}
    var original={width:6,height:4,collisions:[],doors:doors,checkpoints:[],
       chestAreas:[],staticChests:[],staticEntities:{},roamingAreas:[]},
        client={width:6,height:4,tilesize:16,data:new Array(24).fill(0),collisions:[],
        doors:doors,checkpoints:[],blocking:[],plateau:[],high:[],animated:{}};
    fs.writeFileSync(p('server.json'),JSON.stringify(original));
    fs.writeFileSync(p('client.json'),JSON.stringify(client));
    fs.writeFileSync(p('tiles.png'),fakePng(16,16));
    fs.writeFileSync(p('stories.json'),JSON.stringify({stories:[]}));
    var store=new World.WorldStore({
       baseMapPath:p('server.json'),baseClientMapPath:p('client.json'),tilesetPath:p('tiles.png'),
       statePath:p('state.json'),publishedMapPath:p('published-server.json'),
       publishedClientJsonPath:p('published-client.json'),publishedClientJsPath:p('published-client.js'),
       versionsDir:p('versions'),storiesPath:p('stories.json')
    });
    var state=store.load();
    assert.deepStrictEqual(state.map.doors,doors,'Legacy doors must survive initial import');
    state.map.doors=tools.normalizeDoors(result.doors,6,4);
    var saved=store.save(state);
    assert.deepStrictEqual(store.load().map.doors,saved.map.doors,'Door edits survive draft reload');
    assert.strictEqual(store.publish().ok,true);
    var publishedServer=JSON.parse(fs.readFileSync(p('published-server.json'),'utf8')),
        publishedClient=JSON.parse(fs.readFileSync(p('published-client.json'),'utf8'));
    assert.deepStrictEqual(publishedServer.doors,saved.map.doors,'Server receives edited links');
    assert.deepStrictEqual(publishedClient.doors,saved.map.doors,'Client receives identical links');
    assert.match(fs.readFileSync(p('published-client.js'),'utf8'),/^var mapData = /);

    var existing=fs.readFileSync(p('state.json'),'utf8'),
        publishedBefore=fs.readFileSync(p('published-server.json'),'utf8');
    state=store.load();
    state.map.doors.push({x:5,y:1,p:0,to:'d',tx:99,ty:1});
    assert.throws(function(){store.save(state);},/Portas\/teleportes inválidos/);
    assert.strictEqual(fs.readFileSync(p('state.json'),'utf8'),existing,
        'Invalid save must not overwrite last valid draft');

    var corrupt=JSON.parse(existing);
    corrupt.map.doors.push({x:5,y:1,p:0,to:'d',tx:99,ty:1});
    fs.writeFileSync(p('state.json'),JSON.stringify(corrupt));
    assert.throws(function(){store.publish();},/Portas\/teleportes inválidos/);
    assert.strictEqual(fs.readFileSync(p('published-server.json'),'utf8'),publishedBefore,
        'Invalid published draft must not replace the live server map');
}finally{fs.rmSync(dir,{recursive:true,force:true});}

console.log('World Editor visual door algorithms and safe publication tests passed.');
