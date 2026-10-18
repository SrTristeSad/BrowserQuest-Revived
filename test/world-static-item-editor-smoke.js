'use strict';

const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm'),
      World=require('../server/admin/world-store'),
      Types=require('../shared/js/gametypes'),
      html=fs.readFileSync(path.join(__dirname,'../server/admin/public/world-editor.html'),'utf8'),
      script=html.match(/<script id="terrainTools">([\s\S]*?)<\/script>/),
      scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert(script);
assert.strictEqual(scripts.length,2);
scripts.forEach(s=>new vm.Script(s[1],{filename:'world-editor.js'}));
const context={window:{}};vm.runInNewContext(script[1],context);
const tools=context.window.WorldTerrainTools,catalog=World.chestItemCatalog();
assert(catalog.some(c=>c.name==='flask'&&c.id===35));
assert(catalog.some(c=>c.name==='sword2'&&c.id===61));
assert(!catalog.some(c=>c.name==='chest'));

const npcs=[{id:'base_11',x:2,y:2,kind:'villager',profileType:'',profileId:'',source:'base'}],
      oldItems=[{id:'base_13',x:4,y:3,kind:'flask',profileType:'',profileId:'',source:'base'}],
      chests=[{x:8,y:8,i:[61]}],
      collisions=[5*12+5],base=npcs.concat(oldItems);
assert.strictEqual(tools.isStaticItem(oldItems[0],catalog),true,'Legacy static collectibles must be detected');
assert.strictEqual(tools.isStaticItem(npcs[0],catalog),false);
assert.strictEqual(tools.staticItemAt(base,{x:4,y:3},catalog).kind,'flask');
let result=tools.createStaticItem(base,12,12,catalog,chests,collisions,{x:6,y:6},'sword2');
assert(result.ok);
assert.strictEqual(result.item.id,'static_item_1');
assert.strictEqual(result.item.profileType,'item');
assert.strictEqual(result.entities.length,3);
assert.strictEqual(tools.createStaticItem(result.entities,12,12,catalog,chests,collisions,{x:6,y:6},'flask').reason,'occupied');
assert.strictEqual(tools.createStaticItem(base,12,12,catalog,chests,collisions,{x:8,y:8},'flask').reason,'occupied');
assert.strictEqual(tools.createStaticItem(base,12,12,catalog,chests,collisions,{x:5,y:5},'flask').reason,'occupied');
assert.strictEqual(tools.createStaticItem(base,12,12,catalog,chests,collisions,{x:0,y:0},'flask').reason,'invalid_item');
assert.strictEqual(tools.createStaticItem(base,12,12,catalog,chests,collisions,{x:4,y:4},'chest').reason,'invalid_item');
let updated=tools.applyStaticItem(result.entities,12,12,catalog,chests,collisions,'base_13',
   {...oldItems[0],x:7,y:7,kind:'sword2'});
assert(updated.ok);
assert.strictEqual(updated.item.id,'base_13','Legacy item ID remains stable');
assert.strictEqual(updated.entities.find(e=>e.id==='base_13').kind,'sword2');
assert.strictEqual(updated.entities.find(e=>e.id==='base_11').kind,'villager');
assert.strictEqual(tools.applyStaticItem(updated.entities,12,12,catalog,chests,collisions,'base_13',
   {...updated.item,x:2,y:2}).reason,'occupied');
assert.strictEqual(tools.applyStaticItem(updated.entities,12,12,catalog,chests,collisions,'base_13',
   {...updated.item,kind:'invalid'}).reason,'invalid_item');

for(const s of ['value="staticitem">Item estático','data-quick="staticitem">Item estático',
  'id="staticItemChoice"','id="staticItemKind"','id="staticItemX"','id="staticItemY"',
  'function createStaticItemAt(','function applyStaticItemChange(','function removeSelectedStaticItem(',
  'terrainTools.staticItemAt','terrainTools.isStaticItem','function staticItemOptions()'])
  assert(html.includes(s),'World Editor missing '+s);
const uiSection=html.slice(html.indexOf('function applyStaticItemChange('),html.indexOf('function placeEntity('));
assert(!uiSection.includes('api(')&&!uiSection.includes('fetch('),'Static item operations remain local until save');

function png(w,h){const b=Buffer.alloc(24);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.write('IHDR',12,4,'ascii');b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-static-items-'));
try{
  const p=n=>path.join(dir,n),baseMap={width:12,height:12,collisions:[],doors:[],checkpoints:[],
    roamingAreas:[],chestAreas:[],staticChests:chests,staticEntities:{[3*12+4]:'flask',[2*12+2]:'villager'}},
    baseClient={width:12,height:12,tilesize:16,data:Array(144).fill(0),collisions:[],doors:[],
      checkpoints:[],blocking:[],plateau:[],high:[],animated:{}};
  fs.writeFileSync(p('base-server.json'),JSON.stringify(baseMap));
  fs.writeFileSync(p('base-client.json'),JSON.stringify(baseClient));
  fs.writeFileSync(p('tiles.png'),png(16,16));
  fs.writeFileSync(p('stories.json'),JSON.stringify({stories:[]}));
  const store=new World.WorldStore({baseMapPath:p('base-server.json'),baseClientMapPath:p('base-client.json'),
    tilesetPath:p('tiles.png'),statePath:p('draft.json'),publishedMapPath:p('server.json'),
    publishedClientJsonPath:p('client.json'),publishedClientJsPath:p('client.js'),
    versionsDir:p('versions'),storiesPath:p('stories.json')});
  let state=store.load();
  let legacy=state.map.entities.find(e=>e.kind==='flask');
  assert(legacy,'Original collectible must load as flask, not villager');
  assert.strictEqual(legacy.x,4);assert.strictEqual(legacy.y,3);
  state.map.entities.push({id:'static_item_1',x:6,y:6,kind:'sword2',profileType:'item',
    profileId:'',source:'editor'});
  let saved=store.save(state);
  assert.deepStrictEqual(store.load().map.entities,saved.map.entities,
    'Item and unrelated NPC placements survive deterministic reload');
  assert.strictEqual(store.publish().ok,true);
  const pub=JSON.parse(fs.readFileSync(p('server.json'),'utf8'));
  assert.strictEqual(pub.staticEntities[String(3*12+4)],'flask','Legacy flask remains a collectible');
  assert.strictEqual(pub.staticEntities[String(6*12+6)],'sword2','New sword uses the unchanged staticEntities format');
  assert.strictEqual(pub.staticEntities[String(2*12+2)],'villager','NPC remains unchanged');
  assert(!Object.hasOwn(JSON.parse(fs.readFileSync(p('client.json'),'utf8')),'staticEntities'),
    'Static item spawning stays authoritative on the server');
  const live=fs.readFileSync(p('server.json'),'utf8'),previous=fs.readFileSync(p('draft.json'),'utf8');
  state=store.load();state.map.entities.find(e=>e.id==='static_item_1').kind='invalid';
  assert.throws(()=>store.save(state),/Item estático inválido/);
  assert.strictEqual(fs.readFileSync(p('draft.json'),'utf8'),previous);
  state=store.load();state.map.entities.find(e=>e.id==='static_item_1').x=8;
  state.map.entities.find(e=>e.id==='static_item_1').y=8;
  assert.throws(()=>store.save(state),/Item estático inválido/);
  assert.strictEqual(fs.readFileSync(p('draft.json'),'utf8'),previous);
  const corrupt=JSON.parse(previous);
  corrupt.map.entities.find(e=>e.id==='static_item_1').x=0;
  fs.writeFileSync(p('draft.json'),JSON.stringify(corrupt));
  assert.throws(()=>store.publish(),/Item estático inválido/);
  assert.strictEqual(fs.readFileSync(p('server.json'),'utf8'),live,'Invalid draft cannot replace valid published world');
  assert.strictEqual(Types.isItem(Types.getKindFromString('flask')),true);
}finally{fs.rmSync(dir,{recursive:true,force:true})}
console.log('World Editor legacy static collectibles, item placement and safe publication passed.');
