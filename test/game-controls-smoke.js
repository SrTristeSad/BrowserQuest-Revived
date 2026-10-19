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
assert.equal(document.body.children.length,1);
assert.equal(document.body.children[0].id,'bq-joystick');
assert.equal(controls.thumb.className,'bq-joystick-thumb');
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

// Touch joystick has a dead zone, pointer capture and native event isolation.
const base=controls.joystick;
function pointer(id,x,y,type='touch'){
    return {pointerId:id,clientX:x,clientY:y,pointerType:type,
        prevented:false,stopped:false,
        preventDefault(){this.prevented=true;},
        stopPropagation(){this.stopped=true;}
    };
}
assert.equal(base.events.pointerdown(pointer(1,68,78,'mouse')),undefined);
assert.equal(controls.pointerId,null);
const center=pointer(7,68,78);
base.events.pointerdown(center);
assert.equal(base.capture,7);
assert.equal(center.stopped,true);
assert.equal(controls.currentDirection(),null);
const right=pointer(7,108,78);
base.events.pointermove(right);
assert.equal(right.prevented,true);
assert.equal(controls.currentDirection()[0],1);
controls.update();assert.deepEqual(moves[4],[6,5]);
player.moving=false;
base.events.pointerup(pointer(7,108,78));
assert.equal(controls.pointerId,null);
assert.equal(controls.currentDirection(),null);
assert.equal(controls.thumb.style.transform,'translate(0px, 0px)');
const click=event('click');
base.events.click(click);
assert.equal(click.stopped,true);

// Cancel and window blur prevent stuck controls.
base.events.pointerdown(pointer(9,15,78));
assert.equal(controls.currentDirection()[0],-1);
base.events.pointercancel(pointer(9,15,78));
assert.equal(controls.currentDirection(),null);
keydown('KeyD');
listeners.window.blur();
assert.equal(controls.currentDirection(),null);
keydown('KeyS');
document.hidden=true;
listeners.document.visibilitychange();
assert.equal(controls.currentDirection(),null);

// Verify controls remain connected to the original game loop and click path.
const main=read('client/js/main.js'),gameSrc=read('client/js/game.js');
assert(main.includes("new Controls(game)"));
assert(gameSrc.includes("this.controls.update()"));
assert(gameSrc.includes("this.controls.reset()"));
assert(read('client/index.html').includes('css/controls.css'));
assert(read('client/css/controls.css').includes('(pointer: coarse)'));

console.log('WASD, arrows, collision, chat focus and touch joystick smoke passed.');
