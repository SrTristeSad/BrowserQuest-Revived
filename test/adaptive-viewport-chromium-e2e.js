'use strict';
// Real public client + real guest game server; no production credentials/data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright-core');
const Types = require('../shared/js/gametypes');
const worldMap = JSON.parse(fs.readFileSync(path.join(__dirname,'../server/maps/world_server.json'),'utf8'));
const blocked = new Set(worldMap.collisions);
const root = path.resolve(__dirname,'..');
const out = process.env.SPRITE_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'bq-adaptive-'));
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
let browser,child,serverLog='';
async function main() {
 const listener=net.createServer();
 await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
 const port=listener.address().port;
 await new Promise(resolve=>listener.close(resolve));
 child=spawn(process.execPath,['-e',`const c=require('./server/config.json');c.port=${port};c.host='127.0.0.1';c.nb_worlds=1;c.debug_level='error';require('./server/js/main').start(c);`],{cwd:root,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>serverLog+=d);child.stderr.on('data',d=>serverLog+=d);
 const url='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<100&&!ready;i++) {
  ready=await new Promise(resolve=>{const r=http.get(url+'/status',res=>{res.resume();resolve(true);});r.on('error',()=>resolve(false));});
  if(!ready)await delay(100);
 }
 assert(ready,'local guest server must start: '+serverLog);
 const executablePath=process.env.CHROME_BIN;
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 fs.mkdirSync(out,{recursive:true});
 const errors=[];
 for(const config of [
  {name:'desktop',width:1440,height:900,mobile:false},
  {name:'landscape',width:844,height:390,mobile:true},
  {name:'portrait',width:390,height:844,mobile:true}
 ]) {
  const page=await browser.newPage({viewport:{width:config.width,height:config.height},isMobile:config.mobile,hasTouch:config.mobile});
  page.on('pageerror',e=>errors.push(config.name+': '+e.message));
  const sent=[], received=[];
  page.on('websocket',socket=>{
   socket.on('framesent',frame=>{try{sent.push(JSON.parse(frame.payload));}catch{}});
   socket.on('framereceived',frame=>{try{const data=JSON.parse(frame.payload);received.push(...(Array.isArray(data[0])?data:[data]));}catch{}});
  });
  console.log('Opening viewport:',config.name);
  await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('foreground').width>300); 
  await page.locator('#nameinput').fill('View'+config.name);
  await page.waitForSelector('#createcharacter .play:not(.disabled)');
  await page.locator('#createcharacter .play div').click();
  try {
   await page.waitForSelector('body.game.started',{timeout:30000});
  } catch(error) {
   const state=await page.evaluate(()=>({
    body:document.body.className,
    error:document.querySelector('#container')?.className,
    name:document.querySelector('#nameinput')?.value,
    play:document.querySelector('#createcharacter .play')?.className,
    visible:document.querySelector('#createcharacter')?.className
   }));
   console.error('Game startup diagnostic:', JSON.stringify({state,errors}));
   throw error;
  }
  // First-entry tutorial deliberately pauses controls.
  await page.evaluate(()=>document.getElementById('instructions').classList.remove('active'));
  await page.waitForFunction(()=>/^Vida: [1-9]/.test(document.getElementById('healthbar').title));
  // Observe the real running renderer, not only isolated camera math.
  // Position is measured in world pixels immediately before each paint.
  await page.evaluate(()=>new Promise((resolve,reject)=>{
   require(['renderer'],function(Renderer) {
    const original=Renderer.prototype.renderFrame;
    Renderer.prototype.renderFrame=function() {
     if(this.game && this.game.started && this.game.player && this.camera) {
      const player=this.game.player,camera=this.camera;
      window.__bqFollowCheck={
       dx:(player.x+8-camera.x)-camera.gridW*8,
       dy:(player.y+8-camera.y)-camera.gridH*8,
       playerX:player.x,playerY:player.y
      };
     }
     return original.apply(this,arguments);
    };
    resolve();
   },reject);
  }));
  await page.waitForFunction(()=>Boolean(window.__bqFollowCheck));
  const cameraPosition=await page.evaluate(()=>window.__bqFollowCheck);
  assert(Math.abs(cameraPosition.dx)<=1&&Math.abs(cameraPosition.dy)<=1,
    'actual rendered player must be at camera center: '+JSON.stringify(cameraPosition));
  // The sword/armor HUD slots are now actual buttons with an accessible
  // equipment readout. Verify the real browser can open and close both.
  await page.locator('#weapon').click();
  assert.equal(await page.locator('#bq-equipment-panel').isVisible(),true,
    'weapon button must open equipment information');
  assert((await page.locator('#bq-equipment-heading').innerText()).includes('Arma'));
  await page.locator('#armor').click();
  assert((await page.locator('#bq-equipment-heading').innerText()).includes('Armadura'));
  await page.locator('#bq-equipment-close').click();
  assert.equal(await page.locator('#bq-equipment-panel').isVisible(),false,
    'panel must close and release keyboard movement focus');
  await page.waitForTimeout(11000);
  assert.equal(await page.locator('body.death').count(),0,'must survive the end of spawn grace');
  if(config.name==='desktop') {
   const welcome=received.find(data=>data[0]===Types.Messages.WELCOME);
   assert(welcome,'real client must receive WELCOME');
   const choices=[['ArrowRight',1,0],['ArrowLeft',-1,0],['ArrowDown',0,1],['ArrowUp',0,-1]];
   const direction=choices.find(([,dx,dy])=>[1,2,3].every(step=>{
    const x=welcome[3]+dx*step,y=welcome[4]+dy*step;
    return x>0&&y>0&&x<worldMap.width&&y<worldMap.height&&!blocked.has(y*worldMap.width+x)&&
      !worldMap.doors.some(door=>door.x===x&&door.y===y);
   }));
   assert(direction,'spawn should have a walkable movement test direction');
   await page.keyboard.down(direction[0]);await page.waitForTimeout(180);await page.keyboard.up(direction[0]);
   await page.waitForTimeout(400);
   const moves=sent.filter(data=>data[0]===Types.Messages.MOVE);
   let x=welcome[3],y=welcome[4],count=0;
   for(const move of moves){const distance=Math.abs(move[1]-x)+Math.abs(move[2]-y);assert(distance<=1,'client must report steps, never a distant destination');if(distance)count++;x=move[1];y=move[2];}
   assert(count>0,'keyboard walking must produce completed steps');
   const following=await page.evaluate(()=>window.__bqFollowCheck);
   assert(Math.abs(following.dx)<=1&&Math.abs(following.dy)<=1,
    'after WASD walking the real rendered hero must remain centered: '+JSON.stringify(following));
   assert(!received.some(data=>data[0]===Types.Messages.TELEPORT&&data[1]===welcome[1]),'legitimate walking must not be rejected by server');
  }
  const view=await page.evaluate(()=>{
   const canvas=document.getElementById('foreground');const r=canvas.getBoundingClientRect();
   const f=document.getElementById('container').getBoundingClientRect();
   return {width:canvas.width/32,height:canvas.height/32,left:f.left,right:f.right,top:f.top,bottom:f.bottom,
    stageWidth:r.width,stageHeight:r.height,stageTop:r.top,stageBottom:r.bottom,stageLeft:r.left,stageRight:r.right,windowWidth:innerWidth,windowHeight:innerHeight,
    joystick:getComputedStyle(document.getElementById('bq-joystick')).display,
    joystickHit:(function(){const j=document.getElementById('bq-joystick'),q=j.getBoundingClientRect();return j.contains(document.elementFromPoint(q.left+q.width/2,q.top+q.height/2));})()};
  });
  assert(view.stageWidth>0&&view.stageHeight>0);
  assert(view.stageTop>=-2&&view.stageBottom<=view.windowHeight+2,'actual canvas must fit vertically: '+JSON.stringify(view));
  assert(view.stageLeft>=-2&&view.stageRight<=view.windowWidth+2,'actual canvas must fit horizontally: '+JSON.stringify(view));
  assert(view.left>=-2&&view.right<=view.windowWidth+2,'frame must fit horizontally: '+JSON.stringify(view));
  assert(view.top>=-2&&view.bottom<=view.windowHeight+2,'frame must fit vertically: '+JSON.stringify(view));
  if(config.mobile){assert.equal(view.joystick,'block');assert(view.joystickHit,'joystick must receive touches above the game frame');}
  if(config.name==='portrait')assert(view.height>view.width);
  if(config.name==='landscape')assert(view.width>=28);
  await page.screenshot({path:path.join(out,'adaptive-'+config.name+'.png')});
  if(config.name==='landscape') {
   await page.setViewportSize({width:390,height:844});
   await page.waitForTimeout(500);
   assert(await page.locator('#foreground').isVisible(),'rotation must keep gameplay visible');
   await page.screenshot({path:path.join(out,'adaptive-rotated.png')});
  }
  await page.close();
 }
 assert.deepEqual(errors,[],'no runtime browser errors');
 console.log('Real client: desktop, landscape, portrait, rotation, finite HP and 11-second survival passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(child)child.kill();});
