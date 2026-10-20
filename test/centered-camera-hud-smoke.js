'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const Class = {extend(methods) {
    function C() {}
    C.prototype = methods;
    return C;
}};
let Camera, Updater;
vm.runInNewContext(read('client/js/camera.js'), {
    Class,log:{debug(){}},define(factory){Camera=factory();}
},{filename:'camera.js'});
vm.runInNewContext(read('client/js/updater.js'), {
    Class,define(deps,factory){Updater=factory(function Timer(){});}
},{filename:'updater.js'});

const renderer = {tilesize:16, mobile:false, tablet:false, game:{map:{width:172,height:314}}};
const c = Object.create(Camera.prototype);
c.renderer=renderer;c.gridW=30;c.gridH=18;c.setPosition(0,0);
const player={x:500,y:900,gridX:31,gridY:56,isDead:false};
c.focusEntity(player);
assert.equal(player.x + 8 - c.x, 240, 'player center X must align with visible camera center');
assert.equal(player.y + 8 - c.y, 144, 'player center Y must align with visible camera center');

const redraw = {static:0,animations:0,zones:0};
const game = {
    started:true,player,camera:c,
    renderer:{
        mobile:false,tablet:false,
        renderStaticCanvases(){redraw.static++;}
    },
    initAnimatedTiles(){redraw.animations++;},
    client:{sendZone(){redraw.zones++;}},
    zoningQueue:[],currentZoning:null
};
const updater = {game,updateCameraView:Updater.prototype.updateCameraView};
const follow = Updater.prototype.updateCameraFollow;
assert.equal(follow.call(updater),false,'idle player never forces a redraw');
player.x+=1;
assert.equal(follow.call(updater),true,'one pixel of movement follows immediately');
assert.equal(player.x+8-c.x,240,'running player remains centered, not at viewport edge');
assert.equal(redraw.static,1);
assert.equal(redraw.animations,0,'fractional tile scrolling reuses animated tile state');
for(let n=0;n<16;n++) {player.x++;follow.call(updater);}
assert.equal(player.x+8-c.x,240,'pixel follow remains centered through full tile');
assert.equal(redraw.animations,1,'tile crossing invalidates animated tile region once');
assert.equal(redraw.zones,0,'camera scrolling never spams network ZONE messages');

// Traditional follow-camera never lets the character walk off-center,
// even when there is less than half a screen of terrain beyond the edge.
player.x=0;player.y=0;
follow.call(updater);
assert.equal(player.x+8-c.x,240);
assert.equal(player.y+8-c.y,144);
assert(c.x<0 && c.y<0,'edge positions must allow a centered overscroll');
player.x=171*16;player.y=313*16;
follow.call(updater);
assert.equal(player.x+8-c.x,240);
assert.equal(player.y+8-c.y,144);
assert(c.x>(172-30)*16 && c.y>(314-18)*16);

// Portrait/multiple canvas sizes retain the same follow algorithm.
c.gridW=14;c.gridH=22;
player.x=500;player.y=900;
follow.call(updater);
assert.equal(player.x+8-c.x,112);
assert.equal(player.y+8-c.y,176);

game.renderer.mobile=true;
player.x+=1;
follow.call(updater);
assert.equal(game.renderer.cameraMoved,true,'mobile viewport must fully repaint after scroll');

const source=read('client/js/game.js');
const onStep=source.slice(source.indexOf('self.player.onStep(function() {'),
    source.indexOf('self.player.onStopPathing(',source.indexOf('self.player.onStep(function() {')));
assert(onStep.includes('self.client.sendMove(self.player.gridX, self.player.gridY)'),
    'server still receives every completed movement tile');
assert(source.includes('this.updater.updateCameraFollow();') &&
       source.indexOf('this.updater.updateCameraFollow();') < source.indexOf('this.renderer.renderFrame();'),
       'camera must synchronize immediately before every painted frame');
assert(!onStep.includes('self.enqueueZoningFrom('),
    'original page transitions must never fire while a player walks');

// Render-boundary assertion catches stale renderer/game camera references
// even if the earlier update loop used the wrong Camera object.
let Renderer;
vm.runInNewContext(read('client/js/renderer.js'), {
 Class,window:{innerWidth:1440,innerHeight:900},
 define(deps,factory){Renderer=factory();}
},{filename:'renderer.js'});
const realRenderer=Object.create(Renderer.prototype);
realRenderer.camera=c;realRenderer.game=game;
let painted=0;
realRenderer.renderFrameDesktop=function(){painted++;};
realRenderer.renderFrameMobile=function(){painted++;};
game.camera={x:12345,y:54321};
player.x=600;player.y=700;
realRenderer.renderFrame();
assert.equal(game.camera,c,'real Canvas renderer and game must share one camera');
assert.equal(player.x+8-c.x,c.gridW*8,
 'real frame must position player at center X after stale camera reset');
assert.equal(player.y+8-c.y,c.gridH*8,
 'real frame must position player at center Y after stale camera reset');
assert.equal(painted,1,'rendered frame must still draw after re-centering');
assert.equal(realRenderer.syncCameraToPlayer(),false,
 'camera already centered should never redraw cached background');

const rendererSource=read('client/js/renderer.js');
assert(rendererSource.includes("this.drawBackground(this.background, '#263c30')"),
    'overscrolling off-map must paint a consistent backdrop instead of black strips');
assert(rendererSource.includes('if(this.cameraMoved)') &&
    rendererSource.includes('this.drawEntities();') &&
    rendererSource.includes('this.cameraMoved = false'),
    'mobile entities redraw when camera scrolls');

const html=read('client/index.html');
assert(html.includes('BROWSERQUEST_CLIENT_BUILD') &&
       html.includes('urlArgs:'),
       'the browser must download the same new AMD client version instead of stale cached scripts');
const hud=read('client/css/viewport.css');
assert(hud.includes("url('../img/2/barsheet.png')") &&
       hud.includes('background-position: 0 -96px') &&
       !hud.includes('height: 38px; top: 0; background: #29282b;'),
       'restore original richly-detailed 2x barsheet, not flat gray HUD');
assert(hud.includes('#bq-equipment-panel'),
    'retain recent interactive weapon/armor panel styles');
console.log('Centered follow camera: sub-tile motion, map edges, mobile redraw, zone-independent walking, classic HUD passed.');
