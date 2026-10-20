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
#foreground{position:fixed;inset:0;width:100%;height:100%;touch-action:manipulation;background:#233b32}
#mock-hud{position:fixed;left:0;top:0;right:0;height:34px;background:#1b1a15;pointer-events:none}
#mock-enemy{position:fixed;left:calc(50% - 12px);top:calc(50% - 12px);width:24px;height:24px;background:#aa4242;pointer-events:none}
#chatbox{position:fixed;bottom:0;left:40%;width:20%;height:30px;pointer-events:none}
</style></head>
<body class="game started">
<div id="foreground"></div><div id="mock-enemy"></div><div id="mock-hud"></div>
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
const field=document.getElementById('foreground');
window.__controls.attachTouchSurface(field,()=>window.__events.taps++);
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
        const idle=await page.evaluate(()=>{
            const el=document.getElementById('bq-joystick'),
                style=getComputedStyle(el);
            return {display:style.display,pointerEvents:style.pointerEvents,
                coarse:matchMedia('(pointer: coarse)').matches};
        });
        assert.equal(idle.display,'none',config.name+
            ' joystick must not obscure the map while no finger is touching');
        assert.equal(idle.pointerEvents,'none');
        if(config.visible){
            assert(idle.coarse,'touchscreen must identify as coarse input');
            const contact={x:Math.round(config.viewport.width*.24),
                y:Math.round(config.viewport.height*.64)};
            const cdp=await page.context().newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',
                touchPoints:[{id:1,x:contact.x,y:contact.y}]});
            await page.waitForFunction(()=>window.__controls.pointerId!==null);
            const active=await page.evaluate(()=>{
                const el=document.getElementById('bq-joystick'),
                    r=el.getBoundingClientRect(),
                    style=getComputedStyle(el);
                return {display:style.display,width:r.width,height:r.height,
                    x:r.left+r.width/2,y:r.top+r.height/2,
                    hitTarget:document.elementFromPoint(innerWidth/2,innerHeight/2)?.id,
                    pointerEvents:style.pointerEvents};
            });
            assert.equal(active.display,'block',config.name+' joystick visible on touch');
            assert(active.width>=78&&active.width<=112,'responsive joystick size');
            assert(active.height>=78&&active.height<=112,'responsive joystick height');
            assert(Math.abs(active.x-contact.x)<=1,
                'floating base must be centered exactly where the finger started');
            assert(Math.abs(active.y-contact.y)<=1,
                'floating joystick y must match finger contact');
            assert.equal(active.pointerEvents,'none',
                'overlay must never intercept taps intended for enemies');
            assert.notEqual(active.hitTarget,'bq-joystick');
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',
                touchPoints:[{id:1,x:contact.x+40,y:contact.y}]});
            await page.waitForFunction(()=>window.__events.moves.length>0);
            assert.deepEqual(await page.evaluate(()=>window.__events.moves[0]),[6,5]);
            await page.screenshot({path:path.join(out,'mobile-controls-'+config.name+'.png')});
            await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
            await page.waitForFunction(()=>window.__controls.pointerId===null);
            assert.equal(await page.evaluate(()=>window.__controls.currentDirection()),null);
            assert.equal(await page.evaluate(()=>window.__events.taps),0,
                'dragging cannot accidentally fire a world tap');
            assert.equal(await page.locator('#bq-joystick').evaluate(
                el=>getComputedStyle(el).display),'none',
                'floating base must disappear on finger release');
            await page.touchscreen.tap(config.viewport.width/2,config.viewport.height/2);
            await page.waitForFunction(()=>window.__events.taps===1);
            await page.locator('#chatbox').evaluate(el=>el.classList.add('active'));
            assert.equal(await page.evaluate(()=>window.__controls.canMove()),false,
                'chat overlay must block movement');
            assert.equal(await page.locator('#bq-joystick').evaluate(
                el=>getComputedStyle(el).display),'none',
                'chat must not be covered by joystick overlay');
            await cdp.detach();
        }
        await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('Chromium mobile controls passed: 2 landscape sizes, portrait/desktop idle hiding, touch-relative floating joystick, interaction taps and chat.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
});
