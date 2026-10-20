'use strict';
const assert=require('node:assert/strict');
global.log={debug(){},info(){},error(){}};
require('../server/js/entity');
require('../server/js/character');
const World=require('../server/js/worldserver');
const Player=require('../server/js/player');
const {Brain}=require('../server/js/brain');
const Guard=require('../server/js/combat-guard');

const world=Object.create(World.prototype);
world.entities={};world.players={};world.mobs={};
world.map={isProtectedSpawnTile(){return false;}};
world.broadcastAttacker=()=>{world.broadcasts++};
world.broadcasts=0;
world.handleHurtEntity=()=>{world.healthUpdates++};
world.healthUpdates=0;
world.isValidPosition=()=>false;
world.forEachEntity=function(cb){Object.values(this.entities).forEach(cb)};
world.clearMobHateLinks=()=>{};
world.clearMobAggroLink=function(mob){
 const current=this.players[mob.target];
 if(current)current.removeAttacker(mob);
};
const p=Object.create(Player.prototype);
p.id=17;p.type='player';p.x=11;p.y=10;p.armorLevel=1;
p.hitPoints=80;p.maxHitPoints=80;p.isDead=false;
p.spawnProtectedUntil=0;p.attackers={};
p.lastMobHurtTimes=Object.create(null);
p.server=world;p.lastDamagedAt=0;p.lastRegenAt=0;
p.haters={};p.addHater=function(m){this.haters[m.id]=m};
p.addAttacker=function(m){this.attackers[m.id]=m};
p.removeAttacker=function(m){delete this.attackers[m.id]};
const m={
 id:'rat-45',type:'mob',kind:2,x:10,y:10,hitPoints:35,maxHitPoints:35,isDead:false,
 target:null,hatelist:[{id:17,hate:5}],spawningX:10,spawningY:10,
 getHatedPlayerId(){return this.hatelist.length ? this.hatelist[0].id : null},
 increaseHateFor(id,amount){const match=this.hatelist.find(x=>x.id===id);if(match)match.hate+=amount;else this.hatelist.push({id,hate:amount})},
 hates(id){return this.hatelist.some(x=>x.id===id)},
 hasTarget(){return this.target!==null},
 setTarget(target){this.target=target.id},
 clearTarget(){this.target=null},
 forgetEveryone(){this.hatelist=[]},
 weaponLevel:1
};
world.players[p.id]=p;world.entities[p.id]=p;
world.mobs[m.id]=m;world.entities[m.id]=m;
const brain=new Brain(m,world,{preset:'aggressive',aggressive:true,moveChance:0,vision:8});
assert.equal(m.target,null);
assert.equal(p.attackers[m.id],undefined);
// Reproduce original bug: already hated player gets a target assigned without
// the reverse attacker link; CombatGuard rejects ALL otherwise valid hits.
brain.tickMob();
assert.equal(m.target,p.id,'AI acquires target through world authoritative API');
assert.equal(p.attackers[m.id],m,'AI must also register the reverse attacker link');
assert.equal(world.broadcasts,1,'one attack announcement for the new link');
assert.equal(Guard.canMobDamagePlayer(world,m,p,Date.now()+1000),true);
assert.equal(world.updateMobCombat(Date.now()+1000),1,'repaired target deals real damage');
assert(p.hitPoints<80);
assert.equal(world.healthUpdates,1);
brain.tickMob();
assert.equal(world.broadcasts,1,'no repeated broadcasts on stable linked target');
delete p.attackers[m.id]; // simulate dropped reverse link during client/server state changes
brain.tickMob();
assert.equal(p.attackers[m.id],m,'AI repairs dropped reverse link in chase state');
assert.equal(world.broadcasts,2);
m.target=null; // stale target but registered on player
world.chooseMobTarget(m);
assert.equal(m.target,p.id,'world restores lost target without duplicate links');
assert.equal(p.attackers[m.id],m);
assert.equal(world.broadcasts,3);
m.target=null;delete p.attackers[m.id];
p.spawnProtectedUntil=Date.now()+60000;
brain.tickMob();
assert.equal(p.attackers[m.id],undefined,'spawn-protected player must never be attacked');
p.spawnProtectedUntil=0;
m.isDead=true;
world.chooseMobTarget(m);
assert.equal(p.attackers[m.id],undefined,'dead mob must not acquire targets');
m.isDead=false;
world.mobs[m.id]={...m};
world.chooseMobTarget(m);
assert.equal(p.attackers[m.id],undefined,'stale mob object must not bind to player');
console.log('Combat link integration: hate re-acquire, bidirectional repair, single announce, real server damage, protection passed.');
