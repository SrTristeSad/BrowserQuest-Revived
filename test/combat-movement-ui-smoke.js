'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function Mob() {}
function Player() {}
function Dummy() {}
let Game;
const Class = {extend(methods) {
    function Klass() {}
    Klass.prototype = methods;
    return Klass;
}};
vm.runInNewContext(read('client/js/game.js'), {
    Class,
    define(deps, factory) {
        Game = factory(...deps.map(name =>
            name === 'mob' ? Mob : name === 'player' ? Player : Dummy));
    }
}, {filename:'client/js/game.js'});
assert.equal(typeof Game.prototype.moveRemoteCharacter, 'function');
const game = Object.create(Game.prototype);
const player = Object.create(Player.prototype);
player.id = 17;
player.gridX = 5;
player.gridY = 5;
player.isDead = false;
player.invincible = false;
player.attackers = {};
const mob = Object.create(Mob.prototype);
mob.id = 104;
mob.gridX = 5;
mob.gridY = 6;
mob.isDead = false;
mob.target = player;
mob.sprite = {isLoaded:true,loadFailed:false};
mob.isVisible = () => true;
mob.isAttacking = () => Boolean(mob.attacking);
mob.hasTarget = () => mob.target !== null;
mob.attacking = true;
mob.disengage = () => {mob.target = null;mob.attacking = false;delete player.attackers[mob.id]};
mob.idle = () => {mob.idleCount=(mob.idleCount||0)+1};
mob.canAttack = () => mob.attacking;
mob.hit = () => {mob.hitCount=(mob.hitCount||0)+1};
mob.getOrientationTo = () => 1;
mob.orientation = 1;
player.attackers[mob.id] = mob;
game.player = player;
game.playerId = player.id;
game.getEntityById = id => ({17:player,104:mob})[id] || null;
game.makeCharacterGoTo = (entity,x,y) => {entity.gridX=x;entity.gridY=y};
game.camera = {isVisible:()=>true};
game.tryMovingToADifferentTile = () => false;
game.audioManager = {playSound(){}};
let hurts = 0;
game.client = {sendHurt(){hurts++},sendHit(){}};
game.currentTime=1000;
assert.doesNotThrow(()=>game.moveRemoteCharacter(mob,5,6));
assert.equal(mob.attacking,true,'a server MOVE must not disengage a chasing mob');
assert.equal(player.attackers[mob.id],mob,'player attacker link must survive movement');
assert.equal(mob.target,player,'combat target must survive movement');
Game.prototype.onCharacterUpdate.call(game,mob);
assert.equal(hurts,1,'visible adjacent chasing mob can report a real HURT');
assert.equal(mob.hitCount,1,'mob hit animation continues while attacking');
mob.attacking=false;
game.moveRemoteCharacter(mob,7,6);
assert.equal(mob.target,null,'a normally moving, non-attacking mob still disengages');
assert.equal(player.attackers[mob.id],undefined,'stale noncombat link removed');

let App;
const elements = new Map();
function element(selector) {
    if(!elements.has(selector)) elements.set(selector, {
        attributes:{},properties: selector==='#bq-equipment-panel' ? {hidden:true}:{},
        styles:{},text:'',handlers:{},length:1
    });
    return elements.get(selector);
}
const documentStub = {};
const $ = selector => {
    const o=element(selector);
    return {
        length:o.length,
        css(k,v){o.styles[k]=v;return this},
        attr(k,v){if(v===undefined)return o.attributes[k];o.attributes[k]=v;return this},
        prop(k,v){if(v===undefined)return o.properties[k];o.properties[k]=v;return this},
        text(v){if(v===undefined)return o.text;o.text=v;return this},
        on(name,handler){o.handlers[name]=handler;return this}
    };
};
vm.runInNewContext(read('client/js/app.js'), {
    Class, document:documentStub, window:{},
    define(deps,factory){App=factory($,Dummy)},
    Types:{
        getKindFromString(name){return {sword1:60,clotharmor:21,firefox:20}[name]},
        getWeaponRank(id){return id===60?0:-1},
        getArmorRank(id){return id===21?0:-1}
    }
},{filename:'client/js/app.js'});
const app = Object.create(App.prototype);
app.game = {
    renderer:{getScaleFactor:()=>2},
    player:{getWeaponName:()=> 'sword1',getSpriteName:()=> 'clotharmor'}
};
app.initEquipmentPanel();
app.initEquipmentIcons();
assert.equal(element('#bq-equipment-panel').properties.hidden,true);
element('#weapon').handlers.click({stopPropagation(){}});
assert.equal(element('#bq-equipment-panel').properties.hidden,false);
assert.equal(element('#bq-equipment-name').text,'sword 1');
assert.equal(element('#bq-equipment-level').text,'Nível 1');
assert.equal(element('#weapon').attributes['aria-expanded'],'true');
element('#armor').handlers.click({stopPropagation(){}});
assert.equal(element('#bq-equipment-heading').text,'Armadura equipada');
assert.equal(element('#bq-equipment-name').text,'clotharmor');
assert.equal(element('#armor').attributes['aria-expanded'],'true');
element('#bq-equipment-close').handlers.click({stopPropagation(){}});
assert.equal(element('#bq-equipment-panel').properties.hidden,true);
element('#weapon').handlers.click({stopPropagation(){}});
element(documentStub).handlers.keydown({key:'Escape'});
assert.equal(element('#bq-equipment-panel').properties.hidden,true);

const html=read('client/index.html'),css=read('client/css/viewport.css'),main=read('client/js/main.js');
assert(html.includes('id="bq-equipment-panel"') && html.includes('id="bq-equipment-close"'));
assert(css.includes('#bq-equipment-panel[hidden]'));
assert(main.includes('app.initEquipmentPanel()'));
console.log('Mob attack preserved across movement; real HURT restored; sword/armor equipment panel accessible.');
