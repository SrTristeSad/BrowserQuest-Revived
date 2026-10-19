'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CombatGuard = require('../server/js/combat-guard');
const root = path.join(__dirname,'..');
const read = relative => fs.readFileSync(path.join(root,relative),'utf8');
const now = 15000000;
const player = {
    id: '17', type:'player', x:15,y:15,hitPoints:60,isDead:false,
    spawnProtectedUntil:0,attackers:{},lastMobHurtTimes:Object.create(null)
};
const mob = {
    id:'711', type:'mob', x:16,y:15,isDead:false,hitPoints:40,target:player.id
};
const world = {
    entities: {[mob.id]:mob},mobs: {[mob.id]:mob},
    map:{isProtectedSpawnTile(){return false;}}
};
player.attackers[mob.id] = mob;
const valid = () => CombatGuard.canMobDamagePlayer(world,mob,player,now);
assert.equal(valid(),true,'server-authorized melee from a live nearby mob is valid');

const fails = (change,restore,message) => {
    change();
    assert.equal(valid(),false,message);
    restore();
};
fails(()=>{mob.x=70},()=>{mob.x=16},'reject hits from mobs outside player view');
fails(()=>{mob.y=18},()=>{mob.y=15},'reject out of range diagonal attack');
fails(()=>{mob.x=17},()=>{mob.x=16},'reject two tiles away even when rendered in the same camera zone');
fails(()=>{mob.isDead=true},()=>{mob.isDead=false},'reject dead mobs');
fails(()=>{mob.hitPoints=0},()=>{mob.hitPoints=40},'reject mobs already killed');
fails(()=>{mob.target='someone-else'},()=>{mob.target=player.id},'wrong attack target');
fails(()=>{delete player.attackers[mob.id]},()=>{player.attackers[mob.id]=mob},'attack link missing');
fails(()=>{world.entities[mob.id]={...mob}},()=>{world.entities[mob.id]=mob},'ghost entity in world registry');
fails(()=>{world.mobs[mob.id]={...mob}},()=>{world.mobs[mob.id]=mob},'stale mob ID from old world');
fails(()=>{world.map.isProtectedSpawnTile=()=>true},()=>{world.map.isProtectedSpawnTile=()=>false},'safe zone');
fails(()=>{player.spawnProtectedUntil=now+200},()=>{player.spawnProtectedUntil=0},'initial spawn protection');
fails(()=>{player.isDead=true},()=>{player.isDead=false},'dead player');
fails(()=>{player.hitPoints=0},()=>{player.hitPoints=60},'player out of HP');
player.lastMobHurtTimes[mob.id] = now - 200;
assert.equal(valid(),false,'no duplicate damage packets within attack rate');
player.lastMobHurtTimes[mob.id] = now - CombatGuard.MIN_HIT_INTERVAL_MS;
assert.equal(valid(),true,'legitimate later hit is permitted');
assert.equal(CombatGuard.MAX_HIT_DISTANCE,1);

const server = read('server/js/player.js'),
    worldSrc = read('server/js/worldserver.js'),
    game = read('client/js/game.js');
assert(server.includes('CombatGuard.canMobDamagePlayer(self.server, mob, self, hitTime)'),
    'socket handler must actually apply the server-side combat guard');
assert(server.includes('self.lastMobHurtTimes[mob.id] = hitTime'),
    'successful hit must be rate-limited');
assert(!server.includes('self.hitPoints -= Formulas.dmg(mob.weaponLevel, self.armorLevel)'),
    'legacy client-trusted damage branch must be removed');
assert(worldSrc.includes('self.brains[mob.id].stepToward(target.x, target.y)'),
    'mob chase after player movement must use visible AI movement');
assert(!worldSrc.includes('self.moveEntity(mob, pos.x, pos.y)'),
    'silent teleports of mobs after player movement are forbidden');
assert(!worldSrc.includes('self.moveEntity(attacker, pos.x, pos.y)'),
    'silent teleports when target acquired are forbidden');
assert(game.includes('isHurt = points < player.hitPoints;'),
    'equal health sync must not be treated as incoming damage');

console.log('Authoritative combat: ghost attack rejected, nearby live hits accepted, no silent mob jumps and no phantom hurt FX.');
