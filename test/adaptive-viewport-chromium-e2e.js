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
  console.log('Opening viewport:',config.name);
  await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('foreground').width>300); 
  await page.locator('#nameinput').fill('View'+config.name);
  await page.waitForSelector('#createcharacter .play:not(.disabled)');
  await page.locator('#createcharacter .play div').click();
  await page.waitForSelector('body.game.started',{timeout:30000});
  // First-entry tutorial deliberately pauses controls.
  await page.evaluate(()=>document.getElementById('instructions').classList.remove('active'));
  await page.waitForFunction(()=>/^Vida: [1-9]/.test(document.getElementById('healthbar').title));
  await page.waitForTimeout(11000);
  assert.equal(await page.locator('body.death').count(),0,'must survive the end of spawn grace');
  const view=await page.evaluate(()=>{
   const canvas=document.getElementById('foreground');const r=canvas.getBoundingClientRect();
   const f=document.getElementById('container').getBoundingClientRect();
   return {width:canvas.width/32,height:canvas.height/32,left:f.left,right:f.right,top:f.top,bottom:f.bottom,
    stageWidth:r.width,stageHeight:r.height,windowWidth:innerWidth,windowHeight:innerHeight,
    joystick:getComputedStyle(document.getElementById('bq-joystick')).display,
    joystickHit:(function(){const j=document.getElementById('bq-joystick'),q=j.getBoundingClientRect();return j.contains(document.elementFromPoint(q.left+q.width/2,q.top+q.height/2));})()};
  });
  assert(view.stageWidth>0&&view.stageHeight>0);
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
