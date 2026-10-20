'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Regen = require('../server/js/regen-policy');
const source = name => fs.readFileSync(path.join(__dirname,'..',name),'utf8');
assert.equal(Regen.DAMAGE_RECOVERY_DELAY_MS,10000);
assert.equal(Regen.REGEN_INTERVAL_MS,6000);

function createCharacter(hp,maxHp) {
    return {
        type:'player',hitPoints:hp,maxHitPoints:maxHp,isDead:false,
        attackers:{},target:null,hasTarget(){return this.target!==null;},
        regenHealthBy(amount){this.hitPoints=Math.min(this.maxHitPoints,this.hitPoints+amount);}
    };
}
const player=createCharacter(57,80);
const t=200000;
Regen.noteDamage(player,t);
assert.equal(Regen.recover(player,t+6000),0,'regen cannot erase damage six seconds after a hit');
assert.equal(Regen.recover(player,t+9999),0,'recovery cannot start before ten seconds without damage');
player.attackers['mob-1']={id:'mob-1'};
assert.equal(Regen.recover(player,t+20000),0,'even old damage cannot heal under enemy attacks');
player.attackers={};
player.target={id:5};
assert.equal(Regen.recover(player,t+20000),0,'attacking must pause recovery');
player.target=null;
assert.equal(Regen.recover(player,t+20000),1,'80 max HP heals only one point out of combat');
assert.equal(player.hitPoints,58);
assert.equal(Regen.recover(player,t+21000),0,'no health increase every two seconds');
assert.equal(Regen.recover(player,t+26000),1,'one point once per six seconds');
assert.equal(player.hitPoints,59);
Regen.noteDamage(player,t+28000);
assert.equal(Regen.recover(player,t+36000),0,'new damage restarts the recovery cooldown');
assert.equal(Regen.recover(player,t+38000),1);

const mob=createCharacter(20,700);
mob.type='mob';
Regen.noteDamage(mob,t);
assert.equal(Regen.recover(mob,t+10000),3,'high HP monsters heal maximum three points per interval');
const dead=createCharacter(0,80);
assert.equal(Regen.recover(dead,t+100000),0,'dead characters cannot resurrect through passive heal');
const invalid=createCharacter(NaN,80);
assert.equal(Regen.recover(invalid,t+100000),0,'invalid HP is never regenerated');
const full=createCharacter(80,80);
assert.equal(Regen.recover(full,t+100000),0);

const world=source('server/js/worldserver.js');
assert(world.includes('RegenPolicy.recover(character, now)'),
    'world regeneration loop must use the slow policy');
assert(!world.includes('Math.floor(character.maxHitPoints / 25)'),
    'legacy four-percent-every-two-seconds regen is forbidden');
const playerSource=source('server/js/player.js');
assert(playerSource.includes('RegenPolicy.noteDamage(this, now)'),
    'server must delay healing after a real mob HURT');
const mobSource=source('server/js/mob.js');
assert(mobSource.includes('RegenPolicy.noteDamage(this)'),
    'server must delay mob healing after player HIT');
console.log('Regeneration: actual damage cooldown, out-of-combat only, 1-3 HP per six seconds, dead-safe passed.');
