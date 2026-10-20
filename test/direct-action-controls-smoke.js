'use strict';
// Direct-input contract: joystick/WASD alone move; attacks never pathfind.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
function Mob(){}
function Npc(){}
function Chest(){}
function Dummy(){}
let Game;
vm.runInNewContext(read('client/js/game.js'),{
 Class:{extend(methods){function K(){} K.prototype=methods;return K;}},
 define(deps,factory){Game=factory(...deps.map(name=>
  name==='mob'?Mob:name==='npc'?Npc:name==='chest'?Chest:Dummy));}
},{filename:'game.js'});
const game=Object.create(Game.prototype),sent=[],movements=[];
const player={
 gridX:5,gridY:5,orientation:1,isDead:false,attackingMode:false,
 target:null,moving:false,isMoving(){return this.moving;},
 isAttacking(){return this.attackingMode;},hasTarget(){return !!this.target;},
 setTarget(m){this.target=m;},
 disengage(){this.attackingMode=false;this.target=null;},
 lookAtTarget(){this.orientation=this.getOrientationTo(this.target);this.looks=(this.looks||0)+1;},
 getOrientationTo(m){return m.gridX>this.gridX?1:
  m.gridX<this.gridX?2:m.gridY>this.gridY?3:4;}
};
game.player=player;game.started=true;game.client={
 sendAttack(m){sent.push(['attack',m.id]);},sendOpen(chest){sent.push(['open',chest.id]);}
};
game.audioManager={playSound(n){sent.push(['sound',n]);}};
game.makePlayerGoTo=(x,y)=>movements.push([x,y]);
const front=new Mob();front.id=20;front.gridX=6;front.gridY=5;front.isDead=false;
const back=new Mob();back.id=21;back.gridX=4;back.gridY=5;back.isDead=false;
const distant=new Mob();distant.id=22;distant.gridX=9;distant.gridY=5;distant.isDead=false;
game.forEachMob=fn=>[back,distant,front].forEach(fn);
assert.equal(game.attackMobInRange(distant),false,'out-of-range attack cannot chase or select');
assert.deepEqual(sent,[]);
assert.equal(game.attackNearestAdjacentMob(),true);
assert.equal(player.target,front,'mobile ATQ prefers enemy in facing direction');
assert.equal(player.followingMode,false,'attack never follows target');
assert.equal(player.attackingMode,true,'combat tick stays connected to original HIT loop');
assert.deepEqual(sent,[['attack',20]]);
assert.deepEqual(movements,[],'attack never invokes pathfinding');
assert.equal(game.attackNearestAdjacentMob(),true);
assert.equal(sent.length,1,'same target does not repeatedly spam ATTACK');
player.moving=true;
assert.equal(game.attackMobInRange(back),false,'cannot begin an attack during a movement step');
player.moving=false;player.disengage();
front.isDead=true;
assert.equal(game.attackNearestAdjacentMob(),true,'fallback to another cardinal mob');
assert.equal(player.target,back);
back.gridY=6;back.gridX=4;
assert.equal(game.attackMobInRange(back),false,'diagonal melee is rejected');
back.gridY=5;
player.disengage();
distant.gridX=5;distant.gridY=6;
distant.isDead=true;
assert.equal(game.attackMobInRange(distant),false,'dead enemies cannot be selected');
distant.isDead=false;

game.renderer={camera:{x:9,y:11},scale:2,tilesize:16};
game.mouse={x:16,y:11};
game.getMobAt=(x,y)=>x===1&&y===1?back:null;
assert.equal(game.attackAtCursor(),true,'right click uses fractional camera projection');
assert.equal(player.target,back);
assert.deepEqual(movements,[],'right-click attack never walks toward an enemy');

game.getEntityAt=()=>null;
const before=sent.length;
game.click();
assert.equal(sent.length,before,'left click on ground does nothing');
assert.deepEqual(movements,[],'left-click walk is disabled');
const npc=new Npc();npc.id=31;
const chest=new Chest();chest.id=33;
let talked=0;
game.makeNpcTalk=entity=>{assert.equal(entity,npc);talked++};
game.getEntityAt=()=>npc;
player.gridX=1;player.gridY=0;
assert.equal(game.click(),true,'left click can still talk to a nearby NPC');
assert.equal(talked,1);
player.gridX=5;player.gridY=5;
assert.equal(game.click(),false,'far NPC never triggers auto-follow');
game.getEntityAt=()=>chest;
assert.equal(game.click(),false,'far chest cannot be opened by click');
player.gridX=1;player.gridY=0;
assert.equal(game.click(),true,'adjacent chest opens without walking');
assert(sent.some(item=>item[0]==='open'&&item[1]===33));
assert.deepEqual(movements,[]);

const main=read('client/js/main.js'),controls=read('client/js/controls.js');
assert(main.includes("game.attackAtCursor()"));
assert(main.includes("attachTouchSurface(foreground, interactAtPointer)"));
assert(!main.includes("hasClosedParchment && !isTouchClick"),'global body click no longer walks');
assert(!main.includes("if(key === 65)"),'legacy A hotkey no longer swallows movement');
assert(controls.includes("self.attack()")&&controls.includes("this.game.attackNearestAdjacentMob()"));
assert(read('client/index.html').includes('20261020-direct-actions'));
console.log('Direct actions: adjacent attack, mouse targeting, mobile ATQ, no click-to-move/chase, nearby NPC/chest passed.');
