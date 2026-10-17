'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    vm = require('vm'),
    World = require('../server/admin/world-store');

var html = fs.readFileSync(path.join(__dirname, '..', 'server/admin/public/world-editor.html'), 'utf8'),
    terrainScript = html.match(/<script id="terrainTools">([\s\S]*?)<\/script>/),
    scripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)),
    context = {window: {}},
    tools,
    result;

assert(terrainScript, 'Checkpoint algorithms must stay in the pure editor tools');
assert.strictEqual(scripts.length, 2, 'Both World Editor scripts should remain available');
scripts.forEach(function(match) { new vm.Script(match[1], {filename: 'world-editor-inline.js'}); });
vm.runInNewContext(terrainScript[1], context, {filename: 'checkpoint-tools.js'});
tools = context.window.WorldTerrainTools;

var valid = [{id:7,x:0,y:0,w:2,h:2,s:1}, {id:13,x:3,y:2,w:2,h:2,s:0}],
    malformed = valid.concat([
        {id:7,x:2,y:2,w:1,h:1,s:0},
        {id:14,x:4,y:3,w:2,h:2,s:0},
        {id:-1,x:1,y:1,w:1,h:1,s:0},
        {id:22,x:1.5,y:1,w:1,h:1,s:0},
        {id:23,x:0,y:0,w:1,h:1,s:5}
    ]);

assert.deepStrictEqual(World.normalizeCheckpointAreas(malformed, 5, 4), valid,
    'Server normalization must reject duplicate IDs and invalid bounds/types');
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.normalizeCheckpoints(malformed,5,4))), valid,
    'Editor and server checkpoint normalization must agree');
assert.strictEqual(tools.checkpointAt(valid, 5, 4, {x:1,y:1}).id, 7);
assert.strictEqual(tools.checkpointAt(valid, 5, 4, {x:2,y:0}), null);
assert.strictEqual(tools.checkpointAt(valid, 5, 4, {x:-1,y:1}), null);

result = tools.createCheckpoint(valid, 5, 4, {x:2,y:0});
assert.strictEqual(result.ok, true);
assert.strictEqual(result.checkpoint.id, 14, 'New ID must be stable and unique');
assert.strictEqual(result.checkpoint.s, 0, 'New areas must not silently become spawn points');
assert(result.checkpoint.x + result.checkpoint.w <= 5);
assert(result.checkpoint.y + result.checkpoint.h <= 4);
assert.strictEqual(tools.createCheckpoint(valid, 5, 4, {x:0,y:0}).reason, 'occupied');
assert.strictEqual(tools.createCheckpoint(valid, 5, 4, {x:9,y:9}).reason, 'invalid_point');

result = tools.editCheckpoint(valid, 5, 4, 7, {x:1,y:1,w:3,h:2,s:1});
assert.strictEqual(result.ok, true);
assert.strictEqual(result.changed, 1);
assert.strictEqual(result.checkpoint.id, 7, 'Moving/resizing preserves ID');
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.checkpoints[1])), valid[1], 'Other checkpoints stay untouched');
var changed = result.checkpoints;
result = tools.editCheckpoint(valid,5,4,7,{x:3,y:3,w:3,h:2,s:1});
assert.strictEqual(result.ok, false);
assert.strictEqual(result.reason, 'invalid_bounds');
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.checkpoints)), valid, 'Out-of-map move must not mutate state');

result = tools.removeCheckpoint(valid,5,4,13);
assert.strictEqual(result.ok, true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(result.checkpoints)), [valid[0]]);
assert.strictEqual(tools.removeCheckpoint(valid,5,4,999).ok, false);

assert(html.includes('value="checkpoint">Criar/mover checkpoint'), 'Tool must be selectable');
assert(html.includes('data-quick="checkpoint">Checkpoint'), 'Toolbar must expose checkpoint tool');
assert(html.includes('state.map.checkpoints.forEach(cp=>'), 'Existing areas must render on canvas');
assert(html.includes("if(tool==='checkpoint'"), 'Canvas must handle checkpoint placement/drag/selection');
assert(html.includes("selected={type:'checkpoint',id:cp.id}"), 'Checkpoint selection must retain stable ID');
assert(html.includes('id="cpStart"'), 'Spawn flag must remain editable');
assert(html.includes('id="applyCheckpoint"'), 'Coordinate/dimension editing must be offered');
assert(html.includes('id="deleteCheckpoint"'), 'Checkpoint deletion must be offered');
assert(html.includes('terrainTools.editCheckpoint'), 'Moving must use the validated checkpoint function');
assert(html.includes('terrainTools.removeCheckpoint'), 'Deletion must use the validated checkpoint function');
assert(html.includes('normalizeDraftCheckpoints()'), 'Draft data must be normalized');
assert(html.includes('Mantenha pelo menos um checkpoint inicial'), 'UI must protect last spawn checkpoint');
var localOperations = html.slice(html.indexOf('function applyCheckpointChange('),html.indexOf('function nearestEntity'));
assert(!localOperations.includes('api(') && !localOperations.includes('fetch('),
    'Checkpoint moves must stay local until save');

function fakePng(width,height) {
    var buffer=Buffer.alloc(24);
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(buffer,0);
    buffer.write('IHDR',12,4,'ascii');
    buffer.writeUInt32BE(width,16);
    buffer.writeUInt32BE(height,20);
    return buffer;
}

var dir = fs.mkdtempSync(path.join(os.tmpdir(),'bq-checkpoint-'));
try {
    function location(name) { return path.join(dir,name); }
    var base = {width:5,height:4,collisions:[],doors:[],checkpoints:valid,
                chestAreas:[],staticChests:[],staticEntities:{},roamingAreas:[]},
        baseClient = {width:5,height:4,tilesize:16,data:new Array(20).fill(0),
                      collisions:[],doors:[],checkpoints:valid,blocking:[],plateau:[],high:[],animated:{}};
    fs.writeFileSync(location('server.json'),JSON.stringify(base));
    fs.writeFileSync(location('client.json'),JSON.stringify(baseClient));
    fs.writeFileSync(location('tiles.png'),fakePng(16,16));
    fs.writeFileSync(location('stories.json'),JSON.stringify({stories:[]}));

    var store = new World.WorldStore({
        baseMapPath:location('server.json'),baseClientMapPath:location('client.json'),
        tilesetPath:location('tiles.png'),statePath:location('state.json'),
        publishedMapPath:location('published-server.json'),publishedClientJsonPath:location('published-client.json'),
        publishedClientJsPath:location('published-client.js'),versionsDir:location('versions'),
        storiesPath:location('stories.json')
    });
    var state=store.load();
    assert.deepStrictEqual(state.map.checkpoints,valid,'Existing checkpoints must survive initial load');
    state.map.checkpoints = malformed;
    state=store.save(state);
    assert.deepStrictEqual(state.map.checkpoints,valid,'Invalid checkpoint references must not reach persistent draft');

    state.map.checkpoints=changed;
    var saved=store.save(state);
    assert.deepStrictEqual(store.load().map.checkpoints,saved.map.checkpoints,
        'Moved/resized checkpoint areas must survive reload');
    var published=store.publish();
    assert.strictEqual(published.ok,true);
    var server=JSON.parse(fs.readFileSync(location('published-server.json'),'utf8')),
        client=JSON.parse(fs.readFileSync(location('published-client.json'),'utf8'));
    assert.deepStrictEqual(server.checkpoints,saved.map.checkpoints,'Game server receives edited checkpoint areas');
    assert.deepStrictEqual(client.checkpoints,saved.map.checkpoints,'Game client receives same checkpoint IDs and areas');

    state=store.load();
    state.map.checkpoints=[{id:13,x:3,y:2,w:2,h:2,s:0}];
    assert.throws(function(){store.save(state);},/checkpoint inicial/,
        'Editor may not remove the last starting area when original map has starting checkpoints');
    assert.deepStrictEqual(store.load().map.checkpoints,saved.map.checkpoints,
        'Rejected draft must leave previous state intact');
} finally {
    fs.rmSync(dir,{recursive:true,force:true});
}

console.log('World Editor visual checkpoints, area validation and publication round-trip passed.');
