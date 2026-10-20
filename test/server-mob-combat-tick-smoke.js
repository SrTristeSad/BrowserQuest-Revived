'use strict';
const assert=require('node:assert/strict');
const World=require('../server/js/worldserver');
const Player=require('../server/js/player');
const Guard=require('../server/js/combat-guard');
const now=Date.now()+2000;
const world=Object.create(World.prototype);
world.players={};world.mobs={};world.entities={};
world.map={isProtectedSpawnTile(){return false;}};
let updates=0;
world.handleHurtEntity=function(){updates++};
const player=Object.create(Player.prototype);
player.id=17;player.type='player';player.x=10;player.y=10;
player.armorLevel=1;player.hitPoints=80;player.maxHitPoints=80;
player.attackers={};player.lastMobHurtTimes=Object.create(null);
player.spawnProtectedUntil=0;player.isDead=false;
player.server=world;player.lastDamagedAt=0;player.lastRegenAt=0;
const mob={id:'enemy-1',type:'mob',x:11,y:10,
 isDead:false,hitPoints:50,weaponLevel:4,target:17,
 hasTarget(){return this.target!==null;}};
world.players[17]=player;world.mobs[mob.id]=mob;world.entities[mob.id]=mob;
player.attackers[mob.id]=mob;
assert.equal(Guard.canMobDamagePlayer(world,mob,player,now),true);
assert.equal(World.prototype.updateMobCombat.call(world,now),1,
 'visible-adjacent registered mob must hit without any client HURT');
const firstHp=player.hitPoints;
assert(firstHp<80,'server computes positive damage');
assert.equal(updates,1,'server sends first real HP update');
assert.equal(Player.prototype.applyMobHit.call(player,mob,now+100),false,
 'legacy client packet cannot stack a second hit on server tick');
assert.equal(World.prototype.updateMobCombat.call(world,now+250),0,
 'server cannot double-count before cooldown');
assert.equal(World.prototype.updateMobCombat.call(world,now+Guard.MIN_HIT_INTERVAL_MS),1,
 'same mob resumes dealing damage at legitimate interval');
assert(player.hitPoints<firstHp);
mob.x=11; mob.y=11;
assert.equal(World.prototype.updateMobCombat.call(world,now+2000),0,
 'diagonal attacks must not deal invisible damage before the AI moves cardinally');
mob.y=10;
mob.x=12;
assert.equal(World.prototype.updateMobCombat.call(world,now+3000),0,
 'distant enemy must not deal damage');
mob.x=11;
world.map.isProtectedSpawnTile=()=>true;
assert.equal(World.prototype.updateMobCombat.call(world,now+4000),0,
 'checkpoint protection suppresses damage');
world.map.isProtectedSpawnTile=()=>false;
player.spawnProtectedUntil=now+9000;
assert.equal(World.prototype.updateMobCombat.call(world,now+8000),0,
 'spawn grace suppresses damage');
player.spawnProtectedUntil=0;
player.attackers={};
assert.equal(World.prototype.updateMobCombat.call(world,now+9000),0,
 'stale attacker links never generate ghost damage');
player.attackers[mob.id]=mob;
mob.target=12345;
assert.equal(World.prototype.updateMobCombat.call(world,now+10000),0,
 'wrong target cannot damage player');
mob.target=17;
mob.isDead=true;
assert.equal(World.prototype.updateMobCombat.call(world,now+11000),0,
 'dead mobs must not attack');
mob.isDead=false;
player.hitPoints=2;
assert.equal(World.prototype.updateMobCombat.call(world,now+12000),1);
assert.equal(player.hitPoints,0);
assert.equal(player.isDead,true,'server should mark lethal mob strike as death');
assert.equal(World.prototype.updateMobCombat.call(world,now+15000),0,
 'dead player must never receive additional hits');
const source=require('node:fs').readFileSync(
 require('node:path').join(__dirname,'../server/js/worldserver.js'),'utf8');
assert(source.includes('self.updateMobCombat(Date.now())'),
 'real server interval must drive autonomous mob combat');
console.log('Server mob combat: real damage, cooldown, HURT deduplication, safe zones, ranges and death passed.');
