'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const listeners = {document:{},window:{}};
const on = (owner,type,cb) => {listeners[owner][type] = cb;};
function node(tag) {
    const events = {};
    return {
        tagName:tag.toUpperCase(),style:{},events,children:[],
        classes:new Set(),
        get classList(){
            return {add:(name)=>this.classes.add(name),remove:(name)=>this.classes.delete(name),
                contains:(name)=>this.classes.has(name)};
        },
        setAttribute(name,value){this[name]=value;},
        appendChild(child){this.children.push(child);},
        addEventListener(type,cb){events[type]=cb;},
        setPointerCapture(id){this.capture=id;},
        getBoundingClientRect(){return {left:10,top:20,width:116,height:116};}
    };
}
const document = {
    body:{children:[],appendChild(item){this.children.push(item);}},
    createElement:node,
    activeElement:{tagName:'BODY'},
    hidden:false,
    addEventListener(type,cb){on('document',type,cb);}
};
const window = {addEventListener(type,cb){on('window',type,cb);}};
const Class = {extend(methods){
    function Base(...args){if(this.init)this.init(...args);}
    Object.assign(Base.prototype,methods);
    return Base;
}};
let Controls;
vm.runInNewContext(read('client/js/controls.js'), {
    Class,window,document,define(factory){Controls=factory();}
});
assert.equal(typeof Controls,'function');
const blocked = new Set();
const map = {
    isOutOfBounds(x,y){return x<0||y<0||x>=10||y>=10;},
    isColliding(x,y){return blocked.has(x+','+y);},
    isPlateau(){return false;}
};
const player = {
    gridX:5,gridY:5,nextGridX:5,nextGridY:5,
    isDead:false,isOnPlateau:false,moving:false,stopCalls:0,
    isMoving(){return this.moving;},stop(){this.stopCalls++;}
};
const moves = [];
const game = {
    started:true,ready:true,playerId:1,player,map,pathfinder:{},
    isZoning(){return false;},isZoningTile(){return false;},
    findPath(p,x,y){return [[p.gridX,p.gridY],[x,y]];},
    makePlayerGoTo(x,y){moves.push([x,y]);player.moving=true;}
};
const controls = new Controls(game);
assert.equal(document.body.children.length,2);
assert.equal(document.body.children[0].id,'bq-joystick');
assert.equal(controls.thumb.className,'bq-joystick-thumb');
assert.equal(document.body.children[1].id,'bq-attack-button');
assert.equal(controls.attackButton.type,'button');
let attackAttempts=0;
game.attackNearestAdjacentMob=()=>{attackAttempts++;return true;};
const attackEvent={prevented:false,stopped:false,
 preventDefault(){this.prevented=true;},
 stopPropagation(){this.stopped=true;}};
controls.attackButton.events.click(attackEvent);
assert.equal(attackAttempts,1,'separate button performs an attack');
assert.equal(attackEvent.stopped,true,'attack button cannot trigger a canvas/body click');
assert.equal(attackEvent.prevented,true);

// Keyboard takeover interrupts a long click-to-move route once, at the next
// safe movement boundary, rather than redirecting every animation frame.
player.moving=true;
const takeover=()=>listeners.document.keydown({
    code:'KeyW',target:{tagName:'BODY'},preventDefault(){}
});
takeover();
takeover();
assert.equal(player.stopCalls,1,'auto-repeat must not interrupt the same route twice');
listeners.document.keyup({code:'KeyW',preventDefault(){}});
player.moving=false;

function event(code,target={tagName:'BODY'}){
    return {code,target,prevented:false,stopped:false,
        preventDefault(){this.prevented=true;},
        stopPropagation(){this.stopped=true;}};
}
function keydown(code,target){const e=event(code,target);listeners.document.keydown(e);return e;}
function keyup(code){const e=event(code);listeners.document.keyup(e);return e;}

// Movement sends one adjacent command through the existing Game path system,
// and never issues repeated commands while that tile step remains underway.
assert.equal(keydown('KeyD').prevented,true);
controls.update();
assert.deepEqual(moves,[[6,5]]);
controls.update();
assert.equal(moves.length,1);
player.moving=false;
controls.update();
assert.deepEqual(moves,[[6,5],[6,5]]);
player.moving=false;
assert.equal(keyup('KeyD').prevented,true);
controls.update();
assert.equal(moves.length,2);

// Latest held key selects the direction; releasing restores the earlier key.
keydown('KeyW');
keydown('KeyA');
assert.equal(controls.currentDirection()[0],-1);
keyup('KeyA');
assert.equal(controls.currentDirection()[1],-1);
controls.update();
assert.deepEqual(moves[2],[5,4]);
player.moving=false;
keyup('KeyW');

assert.equal(keydown('ArrowDown').prevented,true);
controls.update();
assert.deepEqual(moves[3],[5,6]);
player.moving=false;
keyup('ArrowDown');

// Chat/username editing never captures input; keyboard focus releases motion.
const edit = {tagName:'INPUT'};
const count=moves.length;
assert.equal(keydown('KeyA',edit).prevented,false);
controls.update();
assert.equal(moves.length,count);
keydown('KeyS');
document.activeElement={tagName:'TEXTAREA'};
controls.update();
assert.equal(controls.currentDirection(),null);
document.activeElement={tagName:'BODY'};

// Collisions, plateau transitions, and pathfinding detours must not be bypassed.
blocked.add('4,5');
keydown('KeyA');controls.update();
assert.equal(moves.length,count);
blocked.clear();
map.isPlateau=()=>true;
controls.update();assert.equal(moves.length,count);
map.isPlateau=()=>false;
const originalFind=game.findPath;
game.findPath=()=>[[5,5],[5,4],[4,5]];
controls.update();assert.equal(moves.length,count);
game.findPath=originalFind;
keyup('KeyA');

// Don't move while game is inactive or player is zoning/dead.
keydown('KeyD');
game.started=false;controls.update();
assert.equal(moves.length,count);
assert.equal(controls.currentDirection(),null);
game.started=true;
game.isZoning=()=>true;
assert.equal(keydown('KeyD').prevented,false);
game.isZoning=()=>false;
player.isDead=true;
assert.equal(keydown('KeyD').prevented,false);
player.isDead=false;
document.querySelector=selector=>{
    assert(selector.includes('#chatbox.active'));
    return {className:'active'};
};
assert.equal(keydown('KeyD').prevented,false,
    'movement must be blocked while chat, tutorial or achievements is open');
document.querySelector=()=>null;

// Floating joystick lives under the finger, never in a fixed map corner.
// Short taps preserve world actions; dragging moves without firing a tap.
const base=controls.joystick;
const surface=node('canvas');
const taps=[];
controls.attachTouchSurface(surface,e=>taps.push([e.clientX,e.clientY]));
function pointer(id,x,y,type='touch'){
    return {pointerId:id,clientX:x,clientY:y,pointerType:type,
        prevented:false,stopped:false,
        preventDefault(){this.prevented=true;},
        stopPropagation(){this.stopped=true;}
    };
}
surface.events.pointerdown(pointer(1,250,350,'mouse'));
assert.equal(controls.pointerId,null,'desktop mouse input is untouched');
const center=pointer(7,250,350);
surface.events.pointerdown(center);
assert.equal(surface.capture,7,'canvas captures the active finger');
assert.equal(center.stopped,true);
assert.equal(center.prevented,true);
assert.equal(base.classList.contains('is-active'),true);
assert.equal(base.style.left,'250px');
assert.equal(base.style.top,'350px');
assert.equal(controls.currentDirection(),null);
surface.events.pointermove(pointer(7,257,358));
assert.equal(controls.currentDirection(),null,'micro movements remain in the dead zone');
const right=pointer(7,290,350);
surface.events.pointermove(right);
assert.equal(right.prevented,true);
assert.equal(controls.currentDirection()[0],1);
assert.notEqual(controls.thumb.style.transform,'translate(0px, 0px)');
controls.update();assert.deepEqual(moves[4],[6,5]);

// A second finger can tap an enemy or item while the first keeps moving.
const another=pointer(8,450,390);
surface.events.pointerdown(another);
assert.equal(controls.pointerId,7,'secondary touch never steals the joystick');
assert.equal(controls.actionPointerId,8);
surface.events.pointerup(pointer(8,453,391));
assert.deepEqual(taps,[[453,391]],'second-finger tap dispatches world interaction');
assert.equal(controls.currentDirection()[0],1,'first finger keeps its direction');
const stopsBeforeSteer=player.stopCalls;
surface.events.pointermove(pointer(7,250,310));
assert.equal(controls.currentDirection()[1],-1,'direction changes as finger steers upward');
assert.equal(player.stopCalls,stopsBeforeSteer+1,
    'steering interrupts an old four-tile run at the next safe tile');
player.moving=false;
surface.events.pointerup(pointer(7,250,310));
assert.equal(controls.pointerId,null);
assert.equal(controls.currentDirection(),null);
assert.equal(base.classList.contains('is-active'),false);
assert.equal(controls.thumb.style.transform,'translate(0px, 0px)');
assert.equal(taps.length,1,'drag release never triggers click-to-move or attack');

// A brief tap triggers exactly one click action after the pointer is released.
surface.events.pointerdown(pointer(10,130,480));
assert.equal(base.style.left,'130px');
assert.equal(base.style.top,'480px');
surface.events.pointerup(pointer(10,133,482));
assert.deepEqual(taps[1],[133,482]);
assert.equal(base.classList.contains('is-active'),false);
assert.equal(taps.length,2);

// Touch cancellation, capture loss, app blur and tab hiding never leave
// a character walking or a floating overlay stuck on screen.
surface.events.pointerdown(pointer(11,225,330));
surface.events.pointermove(pointer(11,270,330));
surface.events.pointercancel(pointer(11,270,330));
assert.equal(controls.currentDirection(),null);
assert.equal(taps.length,2,'cancelled drag cannot click an enemy');
surface.events.pointerdown(pointer(12,225,330));
surface.events.lostpointercapture(pointer(12,225,330));
assert.equal(base.classList.contains('is-active'),false);
assert.equal(taps.length,2);
surface.events.pointerdown(pointer(13,225,330));
listeners.window.blur();
assert.equal(controls.currentDirection(),null);
assert.equal(base.classList.contains('is-active'),false);
keydown('KeyS');
document.hidden=true;
listeners.document.visibilitychange();
assert.equal(controls.currentDirection(),null);
document.hidden=false;

// Dialogs and inactive/dead players cannot start a touch gesture.
game.started=false;
surface.events.pointerdown(pointer(14,250,350));
assert.equal(controls.pointerId,null);
game.started=true;
player.isDead=true;
surface.events.pointerdown(pointer(15,250,350));
assert.equal(controls.pointerId,null);
player.isDead=false;

// Retired screen zoning should not disable WASD/joystick when the player
// steps between camera tiles. Collision checks still occur in update().
game.isZoningTile=()=>true;
assert.equal(controls.canMove(),true);
game.isZoningTile=()=>false;

// Continuous keyboard movement: holding a direction should select the
// longest straight validated segment instead of stopping/restarting every tile.
// The actual character.onStep still sends every tile to the server.
document.hidden=false;
game.ready=true;
game.started=true;
player.isDead=false;
player.moving=false;
player.gridX=5;player.gridY=5;
game.findPath=(p,x,y)=>{
 if(y!==p.gridY || x<p.gridX || x>9)return [];
 const path=[];
 for(let v=p.gridX;v<=x;v++)path.push([v,p.gridY]);
 return path;
};
let previous=moves.length;
assert.equal(keydown('KeyD').prevented,true);
controls.update();
assert.deepEqual(moves[previous],[9,5],
 'holding D must run across four clear tiles with one uninterrupted path');
controls.update();
assert.equal(moves.length,previous+1,'while moving do not restart walk animation');
const stopsBeforeRelease=player.stopCalls;
keyup('KeyD');
assert.equal(player.stopCalls,stopsBeforeRelease+1,
 'releasing WASD interrupts a longer run at the next tile boundary');
player.moving=false;
map.isDoor=(x,y)=>x===7&&y===5;
previous=moves.length;
keydown('KeyD');controls.update();
assert.deepEqual(moves[previous],[7,5],
 'continuous run must stop when encountering a portal');
keyup('KeyD');player.moving=false;
map.isDoor=()=>false;
blocked.add('7,5');
previous=moves.length;
keydown('KeyD');controls.update();
assert.deepEqual(moves[previous],[6,5],
 'continuous run must stop before a blocked tile, never detour through it');
keyup('KeyD');player.moving=false;
blocked.clear();
game.findPath=originalFind;

// Verify controls remain connected to the original game loop and click path.
const main=read('client/js/main.js'),gameSrc=read('client/js/game.js');
assert(main.includes("new Controls(game)"));
assert(gameSrc.includes("this.controls.update()"));
assert(!gameSrc.includes("this.controls.reset()"),
 'non-movement interactions must not reset a held joystick/WASD gesture');
assert(read('client/index.html').includes('css/controls.css'));
const css=read('client/css/controls.css');
assert(css.includes('(pointer: coarse)'));
assert(css.includes('body.game #foreground { touch-action: none; }'));
assert(css.includes('pointer-events: none;'));
assert(css.includes('#bq-joystick.is-active'));
assert(css.includes('#bq-attack-button'));
assert(css.includes('bottom: max(60px'), 'attack stays above the original HUD');
assert(!css.includes('bottom: max(12px'), 'joystick is no longer anchored at a fixed corner');
assert(main.includes('game.controls.attachTouchSurface(foreground, interactAtPointer)'));
assert(main.includes('game.attackAtCursor()'));
assert(!main.includes('hasClosedParchment && !isTouchClick'));
assert(read('client/index.html').includes('20261020-direct-actions'));

assert(main.includes('game.click()'), 'left click still enables nearby NPC/chest interactions without movement');

console.log('WASD, arrows, collision, floating joystick, separate ATQ button, interactions and multitouch smoke passed.');
