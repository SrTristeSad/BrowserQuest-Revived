'use strict';

// Checks camera redraw work and tile animation continuity without launching
// a live server, modifying maps, or requiring browser-only game assets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extend(parent, methods) {
    function Klass() {
        if(this.init) { this.init.apply(this, arguments); }
    }
    Klass.prototype = parent ? Object.create(parent.prototype) : {};
    Object.assign(Klass.prototype, methods);
    Klass.extend = function(childMethods) { return extend(Klass, childMethods); };
    return Klass;
}
const Class = {extend(methods) { return extend(null, methods); }};
const Types = {Orientations:{LEFT:1,RIGHT:2,UP:3,DOWN:4}};
const ctx = {Class, Types, log:{debug(){}}, _:{
    each(values, fn) { (values || []).forEach(fn); }
}};
const load = file => fs.readFileSync(path.join(__dirname, '../client/js/', file), 'utf8');
let AnimatedTile, Game, Updater;
ctx.define = function(first, second) {
    const factory = second || first;
    if(!second) {
        AnimatedTile = factory();
    } else if(first[0] === 'character') {
        Updater = factory(function Character(){},function Timer(){});
    } else if(first[0] === 'infomanager') {
        const args = first.map(name => name === 'tile' ? AnimatedTile : function(){});
        Game = factory.apply(null, args);
    }
};
vm.runInNewContext(load('tile.js'), ctx);
vm.runInNewContext(load('game.js'), ctx);
vm.runInNewContext(load('updater.js'), ctx);
assert.equal(typeof Game.prototype.initAnimatedTiles, 'function');
assert.equal(typeof Updater.prototype.updateCameraView, 'function');

const map = {
    data:[1,2,3], width:100, height:100,
    isAnimatedTile(id){return id >= 5;},
    getTileAnimationLength(){return 3;},
    getTileAnimationDelay(){return 100;},
    tileIndexToGridPosition(index){return {x:index%100,y:Math.floor(index/100)};}
};
let visible = [[5, 101], [6, 103]];
let dirtyBounds = 0;
const game = {
    map, renderer:{
        mobile:true, tablet:false,
        getTileBoundingRect(tile){dirtyBounds++;return {x:tile.x*16,y:tile.y*16,w:16,h:16};}
    },
    forEachVisibleTile(cb){for(const entry of visible){cb(...entry);}}
};
const refresh = () => Game.prototype.initAnimatedTiles.call(game);
refresh();
assert.equal(game.animatedTiles.length,2);
assert.equal(dirtyBounds,2);
const first=game.animatedTiles[0],second=game.animatedTiles[1];
first.tick();
first.lastTime=500;
refresh();
assert.equal(game.animatedTiles[0],first,'visible animation object must be reused');
assert.equal(game.animatedTiles[0].id,6,'current animation frame survives camera movement');
assert.equal(game.animatedTiles[0].lastTime,500,'timer must not restart during scrolling');
assert.equal(game.animatedTiles[0].isDirty,true);
assert.equal(game.animatedTiles[0].dirtyRect.x,16);
assert.equal(game.animatedTiles[1],second);

visible=[[5,101],[7,105]];
refresh();
assert.equal(game.animatedTiles[0],first,'overlapping animated tile remains');
assert.notEqual(game.animatedTiles[1],second,'offscreen animation gets dropped');
assert.equal(game.animatedTiles[1].startId,7);
assert.equal(game.animatedTiles.length,2);

map.data=[9]; // published tile data was replaced
refresh();
assert.notEqual(game.animatedTiles[0],first,'fresh map data resets animation state');

// Stacked duplicate animations at one tile index must remain independent.
visible=[[5,101],[5,101]];
refresh();
assert.equal(game.animatedTiles.length,2);
assert.notEqual(game.animatedTiles[0],game.animatedTiles[1]);
const stacked = game.animatedTiles.slice();
refresh();
assert.equal(game.animatedTiles[0],stacked[0]);
assert.equal(game.animatedTiles[1],stacked[1]);

// An unchanged camera position must not repaint anything. Sub-tile motion
// redraws scenery but retains animated tiles until crossing a grid boundary.
let redraws=0,rebuilds=0;
const camera = {
    x:0,y:0,gridX:0,gridY:0,gridW:30,gridH:14,
    setPosition(x,y){this.x=x;this.y=y;this.gridX=Math.floor(x/16);this.gridY=Math.floor(y/16);}
};
const cameraGame = {
    camera, currentTime:100,
    renderer:{renderStaticCanvases(){redraws++;}},
    initAnimatedTiles(){rebuilds++;}
};
const controller = {game:cameraGame};
controller.updateCameraView = Updater.prototype.updateCameraView;
assert.equal(controller.updateCameraView(0,0),false);
assert.equal(redraws,0);
assert.equal(controller.updateCameraView(1,0),true);
assert.equal(redraws,1);
assert.equal(rebuilds,0);
assert.equal(controller.updateCameraView(1,0),false);
assert.equal(redraws,1);
assert.equal(controller.updateCameraView(15,0),true);
assert.equal(rebuilds,0);
assert.equal(controller.updateCameraView(16,0),true);
assert.equal(rebuilds,1);
assert.equal(controller.updateCameraView(16,16),true);
assert.equal(rebuilds,2);
assert.equal(controller.updateCameraView(16,16),false);

// Verify real horizontal and vertical zoning callbacks are wired through
// updateCameraView instead of unconditionally rebuilding animations.
cameraGame.currentZoning={
    inProgress:false,
    start(time,update,stop,start,end,duration){
        this.update=update;
        this.stop=stop;
        this.from=start;this.to=end;
        this.inProgress=true;
    }
};
cameraGame.zoningOrientation=Types.Orientations.RIGHT;
Updater.prototype.updateZoning.call(controller);
assert.equal(typeof cameraGame.currentZoning.update,'function');
const viewBefore = redraws;
cameraGame.currentZoning.update(16);
assert.equal(redraws,viewBefore,'duplicate zoning frame must not redraw');
cameraGame.currentZoning.update(17);
assert.equal(redraws,viewBefore+1);
assert.equal(rebuilds,2);
cameraGame.currentZoning.inProgress=false;
cameraGame.zoningOrientation=Types.Orientations.DOWN;
Updater.prototype.updateZoning.call(controller);
cameraGame.currentZoning.update(17);
assert.equal(camera.y,17);
assert.equal(rebuilds,2);
console.log('Camera zoning redraw and animated tile continuity smoke passed.');
