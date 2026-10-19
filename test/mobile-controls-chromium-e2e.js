'use strict';

/* Real Chromium mobile pointer/layout acceptance for the existing controls
 * adapter. A local-only fixture is used; no production game server or user
 * credentials are contacted. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require('playwright-core');
const root = path.resolve(__dirname, '..');
const out = process.env.SPRITE_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'bq-mobile-controls-'));
fs.mkdirSync(out, {recursive:true});

const fixture = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/client/css/controls.css">
<style>
*{box-sizing:border-box}
body{margin:0;background:#192a2a;color:white;font:14px sans-serif}
#playfield{position:fixed;inset:0;width:100%;height:100%;touch-action:manipulation;background:#233b32}
#mock-hud{position:fixed;left:0;top:0;right:0;height:34px;background:#1b1a15;pointer-events:none}
#mock-enemy{position:fixed;left:calc(50% - 12px);top:calc(50% - 12px);width:24px;height:24px;background:#aa4242;pointer-events:none}
#chatbox{position:fixed;bottom:0;left:40%;width:20%;height:30px;pointer-events:none}
</style></head>
<body class="game started">
<div id="playfield"></div><div id="mock-enemy"></div><div id="mock-hud"></div>
<div id="chatbox"></div><div id="instructions"></div><div id="achievements"></div>
<script>
window.__events={taps:0,moves:[],errors:[]};
window.Class={extend(methods){function Klass(){if(this.init)this.init.apply(this,arguments)}
Klass.prototype=methods;return Klass;}};
window.define=factory=>window.Controls=factory();
</script>
<script src="/client/js/controls.js"></script>
<script>
const player={gridX:5,gridY:5,nextGridX:5,nextGridY:5,isDead:false,isOnPlateau:false,
moving:false,isMoving(){return this.moving},stop(){this.moving=false}};
const game={started:true,ready:true,playerId:1,player,pathfinder:{},
map:{isOutOfBounds(x,y){return x<0||y<0||x>=50||y>=50},
isColliding(){return false},isPlateau(){return false}},
isZoning(){return false},isZoningTile(){return false},
findPath(p,x,y){return [[p.gridX,p.gridY],[x,y]]},
makePlayerGoTo(x,y){window.__events.moves.push([x,y]);player.moving=true;}};
window.__game=game;
window.__controls=new Controls(game);
setInterval(()=>window.__controls.update(),30);
const field=document.getElementById('playfield');
field.addEventListener('touchstart',()=>window.__events.taps++,{passive:true});
field.addEventListener('click',()=>window.__events.taps++);
window.__ready=true;
</script></body></html>`;

const server=http.createServer((req,res)=>{
    if(req.url==='/mobile-controls'){
        res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(fixture);return;
    }
    if(['/client/js/controls.js','/client/css/controls.css'].includes(req.url)){
        const target=path.join(root,req.url);
        res.writeHead(200,{'content-type':req.url.endsWith('.css')?'text/css':'application/javascript'});
        res.end(fs.readFileSync(target));return;
    }
    res.writeHead(404);res.end();
});
function chromeBinary(){
    if(process.env.CHROME_BIN) return process.env.CHROME_BIN;
    const binaries=['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
    const found=binaries.find(p=>fs.existsSync(p));
    if(!found)throw Error('Chromium not found: set CHROME_BIN');
    return found;
}
let browser;
async function main(){
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({executablePath:chromeBinary(),headless:true,
        args:['--no-sandbox','--disable-dev-shm-usage']});
    const url='http://127.0.0.1:'+server.address().port+'/mobile-controls';
    const errors=[];
    const configurations=[
        {name:'phone-landscape',viewport:{width:844,height:390},mobile:true,visible:true},
        {name:'small-landscape',viewport:{width:667,height:375},mobile:true,visible:true},
        {name:'phone-portrait',viewport:{width:390,height:844},mobile:true,visible:true},
        {name:'desktop',viewport:{width:1280,height:800},mobile:false,visible:false}
    ];
    for(const config of configurations){
        const page=await browser.newPage({viewport:config.viewport,isMobile:config.mobile,
            hasTouch:config.mobile});
        page.on('pageerror',error=>errors.push(config.name+': '+error.message));
        await page.goto(url);
        await page.waitForFunction(()=>window.__ready);
        const layout=await page.evaluate(()=>{
            const element=document.getElementById('bq-joystick'),
                r=element.getBoundingClientRect(),style=getComputedStyle(element);
            return {display:style.display,opacity:Number(style.opacity),
                left:r.left,right:r.right,top:r.top,bottom:r.bottom,
                width:r.width,height:r.height,
                centerObscured:document.elementFromPoint(innerWidth/2,innerHeight/2)?.id==='bq-joystick',
                coarse:matchMedia('(pointer: coarse)').matches};
        });
        assert.equal(layout.display==='block',config.visible,config.name+' visibility');
        if(config.visible){
            assert(layout.coarse,'touchscreen must identify as coarse input');
            assert(layout.width>=78 && layout.width<=108,'joystick bounds for touch');
            assert(layout.height>=78 && layout.height<=108,'joystick height for touch');
            assert(layout.right<=Math.max(122,config.viewport.width*.3),
                'joystick must remain near left edge and leave central scene visible');
            assert(layout.bottom<=config.viewport.height,
                'bottom joystick must remain inside safe viewport');
            assert.equal(layout.centerObscured,false,'enemy at game center stays unobscured');
            assert(layout.opacity<0.6,'idle joystick should be translucent');
            const center={x:layout.left+layout.width/2,y:layout.top+layout.height/2};
            const cdp=await page.context().newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',
                touchPoints:[{id:1,x:center.x,y:center.y}]});
            await page.waitForFunction(()=>window.__controls.pointerId!==null);
            assert.equal(await page.locator('#bq-joystick').evaluate(
                el=>el.classList.contains('is-active')),true);
            const activeOpacity=await page.locator('#bq-joystick').evaluate(
                el=>Number(getComputedStyle(el).opacity));
            // Transition might not have reached its final value at the first frame.
            await page.waitForFunction(()=>Number(getComputedStyle(
                document.querySelector('#bq-joystick')).opacity)>.85);
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',
                touchPoints:[{id:1,x:center.x+30,y:center.y}]});
            await page.waitForFunction(()=>window.__events.moves.length>0);
            assert.deepEqual(await page.evaluate(()=>window.__events.moves[0]),[6,5]);
            await page.screenshot({path:path.join(out,'mobile-controls-'+config.name+'.png')});
            await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
            await page.waitForFunction(()=>window.__controls.pointerId===null);
            assert.equal(await page.evaluate(()=>window.__controls.currentDirection()),null,
                'releasing a touch must clear joystick direction');
            assert.equal(await page.evaluate(()=>window.__events.taps),0,
                'moving joystick must not accidentally tap a mob/item on world');
            await page.touchscreen.tap(config.viewport.width/2,config.viewport.height/2);
            await page.waitForFunction(()=>window.__events.taps>0);
            await page.locator('#chatbox').evaluate(el=>el.classList.add('active'));
            assert.equal(await page.evaluate(()=>window.__controls.canMove()),false,
                'chat overlay must disable directional movement, not only hide joystick');
            await page.waitForFunction(()=>getComputedStyle(document.querySelector('#bq-joystick')).opacity==='0');
            assert.equal(await page.locator('#bq-joystick').evaluate(
                el=>getComputedStyle(el).pointerEvents),'none',
                'chat must not be covered by joystick overlay');
            await cdp.detach();
        }
        await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('Chromium mobile controls passed: 2 landscape sizes, portrait/desktop visibility, hit testing, joystick gesture, native touch and chat.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
});
