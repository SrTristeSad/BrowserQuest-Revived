'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const MapClass = require('../server/js/map');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
let Renderer, Camera;
const browser = {innerWidth:1920,innerHeight:1080};
const Class = {extend(methods){function C(){} C.prototype=methods;return C;}};
vm.runInNewContext(read('client/js/renderer.js'), {
 Class, window:browser, define(deps,factory){Renderer=factory();}
});
vm.runInNewContext(read('client/js/camera.js'), {
 Class,log:{debug(){}}, define(factory){Camera=factory();}
});
const map = Object.create(MapClass.prototype);
map.zoneWidth=28;map.zoneHeight=12;map.groupWidth=100;map.groupHeight=100;map.connectedGroups={};
for(const [w,h] of [[1920,1080],[1280,800],[844,390],[390,844],[320,568],[2560,1080]]) {
 browser.innerWidth=w;browser.innerHeight=h;
 const renderer={mobile:w<=1000,getCameraGrid:Renderer.prototype.getCameraGrid};
 const camera=Object.create(Camera.prototype);camera.renderer=renderer;camera.rescale();
 assert(camera.gridW>=14&&camera.gridW<=30);
 assert(camera.gridH>=10&&camera.gridH<=22);
 if(w<h)assert(camera.gridH>camera.gridW,'portrait should show a tall field, not a landscape strip');
 if(w>h)assert(camera.gridW>=28,'landscape mobile must see more than the old 15-tile field');
 // At any relative place within a screen, every visible tile must be in
 // the bounded server interest neighborhood of the player.
 for(let py=240;py<264;py++)for(let px=280;px<308;px++) {
  const group=map.getGroupIdFromPosition(px,py);
  const subscribed=new Set(map.getAdjacentGroupPositions(group).map(p=>p.x+'-'+p.y));
  assert(subscribed.size<=25);
  for(const dx of [-camera.gridW+1,camera.gridW-1])for(const dy of [-camera.gridH+1,camera.gridH-1]) {
   assert(subscribed.has(map.getGroupIdFromPosition(px+dx,py+dy)), 'edge of adaptive field must remain subscribed');
  }
 }
}
let requests=0;
const game={started:true,player:{gridX:50,gridY:57},camera:{x:0,y:0},
 renderer:{scale:2,getScaleFactor(){return 2;},rescale(){this.camera=Object.create(Camera.prototype);this.camera.gridW=18;this.camera.gridH=22;},renderStaticCanvases(){}},
 client:{sendZone(){requests++;}},zoningQueue:[{}],currentZoning:{inProgress:true}};
let Game;
vm.runInNewContext(read('client/js/game.js'),{Class,define(deps,factory){Game=factory();}});
Game.prototype.resize.call(game);
assert.equal(requests,1);
assert.equal(game.currentZoning,null);
assert.equal(game.zoningQueue.length,0);
assert(game.player.gridX>game.camera.gridX&&game.player.gridX<game.camera.gridX+game.camera.gridW-1);
assert(game.player.gridY>game.camera.gridY&&game.player.gridY<game.camera.gridY+game.camera.gridH-1);
console.log('Adaptive desktop/landscape/portrait field, bounded server coverage and resize re-focus passed.');
