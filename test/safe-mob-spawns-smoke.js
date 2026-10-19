'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const SpawnSafety = require('../server/js/spawn-safety');
const GameMap = require('../server/js/map');
const World = require('../server/js/worldserver');
const MobArea = require('../server/js/mobarea');
const Brain = require('../server/js/brain').Brain;
const WorldStore = require('../server/admin/world-store').WorldStore;

const initial = [{id:1,x:10,y:10,w:3,h:3,s:1},{id:2,x:27,y:27,w:2,h:2,s:0}];
assert.equal(SpawnSafety.normalizeRadius(undefined),8);
assert.equal(SpawnSafety.normalizeRadius(21),8);
assert.equal(SpawnSafety.normalizeRadius(0),0);
assert.equal(SpawnSafety.isSafeStartingTile(initial,10,10,8),true);
assert.equal(SpawnSafety.isSafeStartingTile(initial,2,10,8),true);
assert.equal(SpawnSafety.isSafeStartingTile(initial,1,10,8),false);
assert.equal(SpawnSafety.isSafeStartingTile(initial,27,27,8),false,
  'normal checkpoints are not permanently protected');
assert.equal(SpawnSafety.isSafeStartingTile(initial,10,10,0),false,
  'zero disables permanent safe zone');

const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../server/maps/world_server.json')));
const serverMap=Object.create(GameMap.prototype);
serverMap.initMap(original);
serverMap.generateCollisionGrid();
assert.equal(serverMap.spawnSafeRadius,8,'legacy original map gets safe default');
assert(serverMap.startingAreas.length>0,'original map must have starting checkpoints');
const start=original.checkpoints.find(cp=>cp.s===1);
assert(serverMap.isProtectedSpawnTile(start.x,start.y),'player entry tiles must be safe');
const firstRats=original.roamingAreas[0];
assert(serverMap.isProtectedSpawnTile(firstRats.x, firstRats.y+1),
  'original roaming rat area overlaps the beginner-safe zone');
assert(!serverMap.isProtectedSpawnTile(50,260),'other areas must remain available');

const registered=[];
const stubWorld={
  map:serverMap,
  isValidPosition(x,y){return !serverMap.isOutOfBounds(x,y) && !serverMap.isColliding(x,y);},
  onMobMoveCallback(){},
  addMob(mob){registered.push(mob);}
};
const allSafe=new MobArea(1,3,'rat',start.x,start.y,3,2,stubWorld);
allSafe.spawnMobs();
assert.equal(allSafe.entities.length,0,'no mob may be born over initial checkpoint');
assert.equal(allSafe.nbEntities,3,'protected areas retain their population target for future safe respawns');
const wild=new MobArea(2,2,'rat',95,100,3,3,stubWorld);
wild.spawnMobs();
assert.equal(wild.entities.length,2,'regular mob spawns remain enabled outside protected zone');
assert(wild.entities.every(mob=>!serverMap.isProtectedSpawnTile(mob.x,mob.y)));

const world=Object.create(World.prototype);
world.map=serverMap;
world.isValidPosition=stubWorld.isValidPosition;
let moves=0;
const intruder={type:'mob',move(){moves++;}};
assert.equal(world.moveBrainEntity(intruder,start.x,start.y),false);
assert.equal(moves,0);
assert.equal(world.moveBrainEntity(intruder,95,100),true);
assert.equal(moves,1);

const entities=[];
const protectedPlayer={id:'p',type:'player',x:start.x,y:start.y,isDead:false};
const creature={id:'m',type:'mob',kind:4,x:start.x+10,y:start.y,
  isDead:false,hitPoints:100,maxHitPoints:100,target:null,hatelist:[],
  hasTarget(){return this.target!==null;},setTarget(p){this.target=p.id;},
  clearTarget(){this.target=null;},hates(){return false;},forgetEveryone(){}};
entities.push(protectedPlayer,creature);
const aiWorld={
 map:serverMap,
 forEachEntity(fn){entities.forEach(fn);},
 isValidPosition:stubWorld.isValidPosition,
 isPositionOccupied(){return false;},
 moveBrainEntity(){},
 getEntityById(id){return entities.find(e=>e.id===id)||null;},
 handleMobHate(){throw Error('Mob must never acquire a protected character');},
 clearMobAggroLink(){},
 clearMobHateLinks(){}
};
const brain=new Brain(creature,aiWorld,{preset:'aggressive',aggressive:true,vision:25,moveChance:0});
assert.equal(brain.findNearest('player',25),null);
brain.tick();
assert.equal(creature.target,null,'safe player cannot become mob target');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-safestart-'));
try{
 const base={width:40,height:40,collisions:[],doors:[],checkpoints:initial,
   chestAreas:[],staticChests:[],roamingAreas:[],staticEntities:{}};
 const fixture={width:40,height:40,data:Array(1600).fill(0),collisions:[],doors:[],checkpoints:initial,
   blocking:[],plateau:[],high:[],animated:{}};
 const put=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data));
 put('base.json',base);put('client.json',fixture);
 const store=new WorldStore({baseMapPath:path.join(dir,'base.json'),baseClientMapPath:path.join(dir,'client.json'),
   statePath:path.join(dir,'draft.json'),publishedMapPath:path.join(dir,'public.json'),
   publishedClientJsonPath:path.join(dir,'client-pub.json'),publishedClientJsPath:path.join(dir,'client-pub.js'),
   versionsDir:path.join(dir,'versions')});
 let state=store.load();
 assert.equal(state.map.spawnSafeRadius,8);
 state.map.spawnSafeRadius=14;
 store.save(state);
 assert.equal(store.load().map.spawnSafeRadius,14);
 assert.equal(store.buildServerMap(store.load()).spawnSafeRadius,14);
 state=store.load();
 state.map.spawnSafeRadius=30;
 assert.throws(()=>store.save(state),/spawnSafeRadius|distância segura|Distância segura/i);
}finally{fs.rmSync(dir,{recursive:true,force:true});}

const html=fs.readFileSync(path.join(__dirname,'../server/admin/public/world-editor.html'),'utf8');
assert(html.includes('id="spawnSafeRadius"'));
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length,2);
scripts.forEach(s=>new vm.Script(s[1],{filename:'world-editor.js'}));
console.log('Safe spawn checkpoints, mob areas, anti-aggro, editor setting and publish configuration passed.');
