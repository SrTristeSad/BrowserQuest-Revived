'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
let Camera;
vm.runInNewContext(read('client/js/camera.js'),{
 Class:{extend(methods){function C(){} C.prototype=methods; return C}},
 log:{debug(){}},
 define(factory){Camera=factory()}
},{filename:'client/js/camera.js'});
const camera=Object.create(Camera.prototype);
camera.renderer={tilesize:16};
camera.gridW=30;camera.gridH=14;
camera.setPosition(0,0);
assert.deepEqual({...camera.getVisibleTileBounds()},{
 left:0,top:0,right:30,bottom:14
},'tile-aligned camera draws exactly the configured field');
assert.equal(camera.isVisiblePosition(30,14),false);
camera.setPosition(1,3);
const bounds={...camera.getVisibleTileBounds()};
assert.deepEqual(bounds,{left:0,top:0,right:31,bottom:15},
 'sub-tile scrolling reveals one extra column and row');
assert.equal(camera.isVisiblePosition(30,14),true,'visible edge mob must not disappear');
assert.equal(camera.isVisiblePosition(31,14),false);
assert.equal(camera.isVisiblePosition(0,15),false);
const positions=[];
camera.forEachVisiblePosition((x,y)=>positions.push(x+','+y));
assert.equal(positions.length,31*15);
assert(positions.includes('30,14'),'right-bottom edge entity must be rendered');
let extra=0;
camera.forEachVisiblePosition(()=>extra++,2);
assert.equal(extra,(31+4)*(15+4),'drawing margins are symmetric, not triple-counted');
camera.setPosition(-7,-13);
const negative={...camera.getVisibleTileBounds()};
assert.deepEqual(negative,{left:-1,top:-1,right:30,bottom:14},
 'map-edge overscroll remains centered and renders intersecting tiles');
assert.equal(camera.isVisiblePosition(-1,-1),true,
 'out-of-map visible positions are safe for existing map boundary filters');

const game=read('client/js/game.js');
const updater=read('client/js/updater.js');
const renderer=read('client/js/renderer.js');
const tick=game.slice(game.indexOf('        tick: function() {'),game.indexOf('        start: function() {'));
const update=updater.slice(updater.indexOf('        update: function() {'),updater.indexOf('        updateCharacters: function() {'));
assert(!tick.includes('this.updater.updateCameraFollow()'),
 'camera must not be recentered redundantly by Game.tick');
assert(!update.includes('this.updateZoning()'),
 'deprecated page-by-page camera must not fight the follow camera');
assert(renderer.includes('this.syncCameraToPlayer();'),
 'renderer must own exactly one pre-paint camera synchronization');
const src=read('client/js/game.js');
assert(!src.includes('this.client.sendHurt(character);'),
 'client-side mob animations must not send authoritative damage claims');
const server=read('server/js/player.js');
const handler=server.slice(server.indexOf('else if(action === Types.Messages.HURT)'),server.indexOf('else if(action === Types.Messages.LOOT)'));
assert(handler.includes('return;')&&!handler.includes('applyMobHit'),
 'legacy HURT packets must never apply or accelerate damage');
console.log('Audit camera: fractional visibility, balanced draw margins, edge overscroll and one canonical render-time follow passed.');
