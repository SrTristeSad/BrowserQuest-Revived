'use strict';
// Regression: a pixel-follow camera must use the same world projection for
// mouse clicks, cursor highlights and mob targeting. Also exercise the live
// HIT listener: no attack on an unselected or diagonal target.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function Mob(){}
function Dummy(){}
let Game;
vm.runInNewContext(read('client/js/game.js'),{
  Class:{extend(methods){function Klass(){}Klass.prototype=methods;return Klass}},
  define(deps,factory){Game=factory(...deps.map(d=>d==='mob'?Mob:Dummy))}
},{filename:'game.js'});
const game=Object.create(Game.prototype);
game.renderer={camera:{x:9,y:11,gridX:0,gridY:0},scale:2,tilesize:16};
game.mouse={x:16,y:11};
assert.deepEqual({...game.getMouseGridPosition()},{x:1,y:1},
 'fractional camera offset must be applied before floor() in both axes');
game.renderer.camera.x=0;game.renderer.camera.y=0;
assert.deepEqual({...game.getMouseGridPosition()},{x:0,y:0},
 'integer aligned origin must still map pointer to correct tile');
game.renderer.camera.x=-17;game.renderer.camera.y=-17;
assert.deepEqual({...game.getMouseGridPosition()},{x:-1,y:-1},
 'negative overscroll must not truncate toward zero');
game.renderer.camera.x=9;game.renderer.camera.y=11;
const rat=new Mob();
game.started=true;
game.player={isDead:false,gridX:0,gridY:1};
let attacks=0;
game.getMobAt=(x,y)=>x===1&&y===1?rat:null;
game.attackMobInRange=mob=>{assert.equal(mob,rat);attacks++;return true;};
// Left-click projects through the fractional camera, without forcing the
// legacy screen zoning or walking-by-click.
game.isZoning=()=>true;
game.isZoningTile=()=>true;
assert.equal(game.attackAtCursor(),true);
assert.equal(attacks,1,'left-click selects mob under the correct fractional tile');


global.log={debug(){},info(){},error(){}};
require('../server/js/entity');
require('../server/js/character');
const ServerPlayer=require('../server/js/player');
const Types=require('../shared/js/gametypes');
let handler;
const connection={
 id:18,
 listen(fn){handler=fn},
 onClose(){},
 sendUTF8(){}
};
let hurt=0,announced=0;
const world={
 getEntityById(id){return id===ratServer.id?ratServer:null},
 broadcastAttacker(){announced++},
 handleMobHate(){},
 handleHurtEntity(){hurt++}
};
const player=new ServerPlayer(connection,world);
player.resetTimeout=()=>{};
player.hasEnteredGame=true;
player.isDead=false;
player.hitPoints=80;
player.weaponLevel=5;
player.x=10;player.y=10;
const ratServer={
 id:25,type:'mob',isDead:false,hitPoints:100,
 x:11,y:10,armorLevel:1,
 receiveDamage(points){this.hitPoints-=points;}
};
handler([Types.Messages.HIT,ratServer.id]);
assert.equal(ratServer.hitPoints,100,'HIT without selected target is rejected');
handler([Types.Messages.ATTACK,ratServer.id]);
assert.equal(announced,1);
ratServer.x=11;ratServer.y=11;
handler([Types.Messages.HIT,ratServer.id]);
assert.equal(ratServer.hitPoints,100,'diagonal spoofed HIT is rejected');
ratServer.x=11;ratServer.y=10;
handler([Types.Messages.HIT,ratServer.id]);
assert(ratServer.hitPoints<100,'selected cardinal target takes a real server hit');
assert.equal(hurt,1);
player.nextHitAt=0;
player.isDead=true;
const lastHp=ratServer.hitPoints;
handler([Types.Messages.HIT,ratServer.id]);
assert.equal(ratServer.hitPoints,lastHp,'dead player cannot issue new attacks');
console.log('Pixel-follow pointer and selected-target melee: sub-tile left-click, overscroll, server HIT guards passed.');
