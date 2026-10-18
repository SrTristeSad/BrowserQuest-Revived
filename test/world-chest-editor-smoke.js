'use strict';

const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),
      World=require('../server/admin/world-store'),
      html=fs.readFileSync(path.join(__dirname,'../server/admin/public/world-editor.html'),'utf8'),
      match=html.match(/<script id="terrainTools">([\s\S]*?)<\/script>/),
      scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert(match,'Pure editing helpers must exist');
assert.strictEqual(scripts.length,2);
scripts.forEach(s=>new vm.Script(s[1],{filename:'world-editor.js'}));
let context={window:{}};vm.runInNewContext(match[1],context);
const tools=context.window.WorldTerrainTools,catalog=World.chestItemCatalog();
assert(catalog.length>10 && catalog.every(x=>Number.isSafeInteger(x.id)&&x.name));
assert(catalog.some(x=>x.id===23)&&catalog.some(x=>x.id===66),'Legacy item IDs must be included');
assert(!catalog.some(x=>x.id===37),'Chest cannot contain a recursive chest item');
const staticOriginal=[{x:5,y:5,i:[23,23,61]},{x:8,y:8,i:[66]}],
      areaOriginal=[{x:2,y:3,w:4,h:4,tx:5,ty:2,i:[24,66]}];
assert.deepStrictEqual(World.normalizeStaticChests(staticOriginal,20,20),staticOriginal);
assert.deepStrictEqual(World.normalizeChestAreas(areaOriginal,20,20),areaOriginal);
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.normalizeStaticChests(staticOriginal,20,20,catalog))),staticOriginal);
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.normalizeChestAreas(areaOriginal,20,20,catalog))),areaOriginal);
assert.deepStrictEqual(World.normalizeChestAreas([{...areaOriginal[0],x:0}],20,20),[]);
assert.deepStrictEqual(World.normalizeStaticChests([{x:5,y:5,i:[37]}],20,20),[]);
assert.deepStrictEqual(World.normalizeStaticChests(staticOriginal.concat(staticOriginal[0]),20,20),staticOriginal);
assert.throws(()=>World.requireValidChests({staticChests:[{x:5,y:5,i:[1]}]},20,20),/Baús inválidos/);
assert.throws(()=>World.requireValidChests({chestAreas:[{...areaOriginal[0],tx:20}]},20,20),/Baús inválidos/);
assert.deepStrictEqual(JSON.parse(JSON.stringify(tools.parseLoot('23, 23, 61',catalog))),[23,23,61]);
assert.strictEqual(tools.parseLoot('37',catalog),null);
assert.strictEqual(tools.parseLoot('23, nope',catalog),null);

let result=tools.applyStaticChest(staticOriginal,20,20,catalog,0,{x:6,y:5,i:[22,66]});
assert.strictEqual(result.ok,true);assert.strictEqual(result.chests.length,2);assert.strictEqual(result.chests[0].x,6);
assert.strictEqual(tools.applyStaticChest(staticOriginal,20,20,catalog,0,{x:8,y:8,i:[22]}).reason,'occupied');
result=tools.applyStaticChest(staticOriginal,20,20,catalog,-1,{x:11,y:11,i:[23]});
assert.strictEqual(result.ok,true);assert.strictEqual(result.chests.length,3);
assert.strictEqual(tools.staticChestAt(result.chests,{x:11,y:11}),2);
result=tools.applyChestArea(areaOriginal,20,20,catalog,0,{x:4,y:4,w:3,h:2,tx:6,ty:6,i:[25,62]});
assert.strictEqual(result.ok,true);assert.strictEqual(result.area.x,4);assert.strictEqual(result.areas.length,1);
assert.strictEqual(tools.applyChestArea(areaOriginal,20,20,catalog,0,{...areaOriginal[0],tx:20}).ok,false);
assert.strictEqual(tools.chestAreaAt(areaOriginal,{x:3,y:4}),0);

for(const key of ['value="chest">Baú fixo','value="chestarea">Área de baú',
 'data-quick="chest">Baú','data-quick="chestarea">Área de baú','function updateStaticChest(',
 'function updateChestArea(','function removeSelectedChest(','id="chestLoot"','id="chestAddItem"',
 'id="chestInsertItem"','id="applyChest"','id="deleteChest"',
 'state.map.chestAreas.forEach(','state.map.staticChests.forEach(',
 'terrainTools.parseLoot','normalizeDraftChests()'])assert(html.includes(key),'UI missing '+key);
const operations=html.slice(html.indexOf('function lootCatalog(){'),html.indexOf('function applyAreaChange('));
assert(!operations.includes('api(')&&!operations.includes('fetch('),'Chest editing must stay local');

function png(w,h){const b=Buffer.alloc(24);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.write('IHDR',12,4,'ascii');b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-chests-'));
try{
  const p=x=>path.join(dir,x),base={width:20,height:20,collisions:[],doors:[],checkpoints:[],
       roamingAreas:[],chestAreas:areaOriginal,staticChests:staticOriginal,staticEntities:{}},
       client={width:20,height:20,tilesize:16,data:Array(400).fill(0),collisions:[],doors:[],checkpoints:[],blocking:[],plateau:[],high:[],animated:{}};
  fs.writeFileSync(p('base-server.json'),JSON.stringify(base));
  fs.writeFileSync(p('base-client.json'),JSON.stringify(client));
  fs.writeFileSync(p('tiles.png'),png(16,16));
  fs.writeFileSync(p('stories.json'),JSON.stringify({stories:[]}));
  const store=new World.WorldStore({baseMapPath:p('base-server.json'),baseClientMapPath:p('base-client.json'),
       tilesetPath:p('tiles.png'),statePath:p('draft.json'),publishedMapPath:p('server.json'),
       publishedClientJsonPath:p('client.json'),publishedClientJsPath:p('client.js'),
       versionsDir:p('versions'),storiesPath:p('stories.json')});
  let state=store.load();
  assert.deepStrictEqual(state.map.staticChests,staticOriginal,'Legacy static chests preserved');
  assert.deepStrictEqual(state.map.chestAreas,areaOriginal,'Legacy chest area preserved');
  assert(state.catalogs.chestItems.some(x=>x.id===23),'Server exposes safe item list');
  state.map.staticChests=[{x:9,y:9,i:[23,23,61]}];
  state.map.chestAreas=[{x:3,y:3,w:4,h:3,tx:8,ty:8,i:[66,24]}];
  const saved=store.save(state);
  assert.deepStrictEqual(store.load().map.chestAreas,saved.map.chestAreas,'Chest areas survive reload');
  assert.strictEqual(store.publish().ok,true);
  const published=JSON.parse(fs.readFileSync(p('server.json'),'utf8'));
  assert.deepStrictEqual(published.staticChests,saved.map.staticChests);
  assert.deepStrictEqual(published.chestAreas,saved.map.chestAreas);
  assert(!Object.hasOwn(JSON.parse(fs.readFileSync(p('client.json'),'utf8')),'staticChests'),
    'Static chest map remains server-authoritative');

  const before=fs.readFileSync(p('draft.json'),'utf8'),live=fs.readFileSync(p('server.json'),'utf8');
  state=store.load();state.map.staticChests[0].i=[37];
  assert.throws(()=>store.save(state),/Baús inválidos/);
  assert.strictEqual(fs.readFileSync(p('draft.json'),'utf8'),before,'Invalid save does not overwrite valid draft');
  const corrupted=JSON.parse(before);corrupted.map.chestAreas[0].tx=1000;
  fs.writeFileSync(p('draft.json'),JSON.stringify(corrupted));
  assert.throws(()=>store.publish(),/Baús inválidos/);
  assert.strictEqual(fs.readFileSync(p('server.json'),'utf8'),live,'Invalid publication retains live map');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
console.log('World Editor static chests, loot and chest areas passed.');
