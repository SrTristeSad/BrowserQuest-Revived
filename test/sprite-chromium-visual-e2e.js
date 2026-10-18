'use strict';

// Real Chromium canvas and UI acceptance smoke with a TEMPORARY, LOCAL server.
// Production and aaPanel are not contacted; no real-world credentials are used.
const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os');
const path=require('node:path'),zlib=require('node:zlib');
const {chromium}=require('playwright-core');
const {SpriteImportStore}=require('../server/admin/sprite-import-store');

const root=path.join(__dirname,'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bq-chromium-sprites-'));
const screenshotDir=process.env.SPRITE_SCREENSHOT_DIR || temporary;
fs.mkdirSync(screenshotDir,{recursive:true});
const store=new SpriteImportStore(path.join(temporary,'imports'));
const colors=(column,row)=>[(column+1)*40,(row+1)*60,column*30+row*5];
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1}return(n^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,sum])}
function testPng(){
  const width=32,height=24,header=Buffer.alloc(13),pixel=Buffer.alloc(height*(width*4+1));
  header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const dst=y*(1+width*4)+1+x*4,color=colors(Math.floor(x/8),Math.floor(y/8));
    color.forEach((v,i)=>pixel[dst+i]=v);pixel[dst+3]=255;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixel)),chunk('IEND',Buffer.alloc(0))]);
}
const png=testPng();
const native={};
for(const file of fs.readdirSync(path.join(root,'client','sprites')).filter(x=>x.endsWith('.json'))){
  native[file]=fs.readFileSync(path.join(root,'client','sprites',file),'utf8');
}
function body(req){return new Promise((resolve,reject)=>{
  const parts=[];let length=0;
  req.on('data',x=>{length+=x.length;if(length>3*1024*1024){reject(new Error('Request too large'));req.destroy()}else parts.push(x)});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch(e){reject(e)}});
  req.on('error',reject);
})}
function send(res,status,value,contentType){
  res.writeHead(status,{'content-type':contentType||(Buffer.isBuffer(value)?'image/png':'application/json; charset=utf-8'),
    'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value));
}
const fixture=fs.readFileSync(path.join(__dirname,'fixtures','sprite-browser-fixture.html'),'utf8');
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
    if(pathname==='/admin/sprite-importer')return send(res,200,fs.readFileSync(path.join(root,'server/admin/public/sprite-importer.html'),'utf8'),'text/html; charset=utf-8');
    if(pathname==='/sprite-visual-fixture')return send(res,200,fixture,'text/html; charset=utf-8');
    if(pathname==='/native-sprite-meta.js')return send(res,200,'window.__native='+JSON.stringify(native)+';','application/javascript; charset=utf-8');
    if(/^\/client\/js\/(sprites|animation|entity|character|sprite|renderer)\.js$/.test(pathname))
      return send(res,200,fs.readFileSync(path.join(root,'client','js',path.basename(pathname))),'application/javascript; charset=utf-8');
    if(pathname==='/admin/api/sprites'&&req.method==='GET')return send(res,200,{sprites:store.list()});
    if(pathname==='/admin/api/sprites'&&req.method==='POST')return send(res,200,store.import(await body(req)));
    if(pathname==='/admin/api/sprites/animations'&&req.method==='POST'){const data=await body(req);return send(res,200,store.configure(data.id,data))}
    if(pathname==='/admin/api/sprites/publish'&&req.method==='POST'){const data=await body(req);return send(res,200,store.publish(data.id))}
    if(pathname==='/admin/api/sprites/image'&&req.method==='GET')return send(res,200,store.image(url.searchParams.get('id')));
    if(pathname==='/game/sprites/catalog.js')return send(res,200,'window.BrowserQuestPublishedSprites='+JSON.stringify(store.publicCatalog())+';','application/javascript; charset=utf-8');
    if(/^\/game\/sprites\/[a-f0-9]{32}\.png$/.test(pathname))
      return send(res,200,store.publishedImage(pathname.split('/').pop().slice(0,-4)));
    if(/^\/img\/[123]\/rat\.png$/.test(pathname))return send(res,200,png);
    send(res,404,{error:'Not found'});
  }catch(e){send(res,e.statusCode||404,{error:e.message})}
});
function chromeBinary(){
  if(process.env.CHROME_BIN)return process.env.CHROME_BIN;
  const found=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>fs.existsSync(p));
  if(!found)throw new Error('Chromium/Chrome not installed; set CHROME_BIN');
  return found;
}
function checkPixel(actual,expected){
  assert.deepEqual(actual.slice(0,4),[...expected,255],'Canvas pixel must match authored sprite frame');
}
let browser;
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:chromeBinary(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const errors=[];
  const desktop=await browser.newPage({viewport:{width:1280,height:800}});
  desktop.on('pageerror',err=>errors.push(err.message));
  await desktop.goto(url+'/admin/sprite-importer');
  await desktop.locator('#spriteFile').setInputFiles({name:'sprite-chromium-test.png',mimeType:'image/png',buffer:png});
  await desktop.locator('#spriteLabel').fill('Sprite de teste visual');
  await desktop.locator('#frameWidth').fill('8');
  await desktop.locator('#frameHeight').fill('8');
  await desktop.waitForFunction(()=>!document.querySelector('#submit').disabled);
  await desktop.locator('#submit').click();
  await desktop.waitForFunction(()=>document.querySelector('#animStatus').textContent.includes('Editando'));
  const imported=store.list()[0];
  assert(imported,'Real browser upload must create a private PNG');
  assert.equal(imported.published,false);
  assert.equal((await desktop.request.get(url+'/game/sprites/'+imported.id+'.png')).status(),404,
    'Private art cannot be served publicly');
  async function animate(action,direction,row,start,length,fps){
    await desktop.locator('#animAction').selectOption(action);
    if(action!=='death')await desktop.locator('#animDirection').selectOption(direction);
    await desktop.locator('#animRow').fill(String(row));
    await desktop.locator('#animStart').fill(String(start));
    await desktop.locator('#animLength').fill(String(length));
    await desktop.locator('#animFps').fill(String(fps));
    await desktop.locator('#animAdd').click();
  }
  await animate('idle','down',0,1,2,8);
  await animate('idle','left',2,2,2,6);
  await animate('walk','right',1,0,3,12);
  await animate('atk','right',1,1,2,10);
  await desktop.locator('#animSave').click();
  await desktop.waitForFunction(()=>document.querySelector('#animStatus').textContent.includes('Animações salvas'));
  await desktop.locator('#animAction').selectOption('idle');
  await desktop.locator('#animDirection').selectOption('down');
  const first=await desktop.locator('#framePreview').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(4,4,1,1).data));
  checkPixel(first,colors(1,0));
  await desktop.locator('#animPlay').click();
  await desktop.waitForFunction(()=>{
    const p=document.querySelector('#framePreview').getContext('2d').getImageData(4,4,1,1).data;
    return p[0]===120 && p[1]===60;
  },null,{timeout:4000});
  await desktop.locator('#animPlay').click();
  desktop.once('dialog',dialog=>dialog.accept());
  await desktop.locator('#publishSprite').click();
  await desktop.waitForFunction(()=>document.querySelector('#animStatus').textContent.includes('Publicado'));
  assert.equal(store.get(imported.id).published,true);
  assert.equal((await desktop.request.get(url+'/game/sprites/'+imported.id+'.png')).status(),200);
  await desktop.screenshot({path:path.join(screenshotDir,'importer-desktop.png'),fullPage:true});
  assert(store.publicCatalog()['custom_'+imported.id]);
  for(const [name,viewport,isMobile] of [
    ['desktop',{width:1280,height:800},false],
    ['mobile',{width:390,height:844},true],
    ['mobile-landscape',{width:844,height:390},true]
  ]){
    const page=await browser.newPage({viewport,isMobile,hasTouch:isMobile});
    page.on('pageerror',err=>errors.push(name+': '+err.message));
    await page.goto(url+'/sprite-visual-fixture');
    await page.waitForFunction(()=>window.__ready===true);
    for(const scale of [1,2,3]){
      const result=await page.evaluate(async({id,scale})=>{
        const catalog=window.__modules.sprites,name='custom_'+id,Sprite=window.__modules.sprite;
        if(!catalog[name]||!catalog.rat)throw Error('Native and custom sprite manifests not merged');
        const sprite=new Sprite(name,scale);
        if(!sprite.isLoaded)await new Promise(resolve=>{sprite.onload_func=resolve});
        if(sprite.loadFailed)throw Error('Published PNG failed to load');
        const Character=window.__modules.character;
        const actor=Object.create(Character.prototype);
        actor.id='sprite-test';actor.kind=22;actor.sprite=null;actor.currentAnimation=null;
        actor.flipSpriteX=false;actor.flipSpriteY=false;actor.x=16;actor.y=16;
        actor.hasShadow=()=>false;actor.hasWeapon=()=>false;actor.isVisible=()=>true;
        actor.setSprite(sprite);
        const canvas=document.querySelector('#world'),ctx=canvas.getContext('2d');
        function render(orientation,action){
          ctx.clearRect(0,0,canvas.width,canvas.height);
          actor[action](orientation);
          const renderer={context:ctx,game:{shadows:{small:{image:{},width:8,height:8}}},
            upscaledRendering:false,scale,tilesize:16,mobile:true,tablet:true};
          window.__modules.renderer.prototype.drawEntity.call(renderer,actor);
          return {name:actor.currentAnimation.name,flip:actor.flipSpriteX,
            pixel:Array.from(ctx.getImageData(20*scale,20*scale,1,1).data)};
        }
        const idle=render(Types.Orientations.DOWN,'idle');
        const left=render(Types.Orientations.LEFT,'idle');
        const attack=render(Types.Orientations.RIGHT,'hit');
        const missing='b'.repeat(32),missingName='custom_'+missing;
        catalog[missingName]={...catalog[name],id:missingName,path:'/game/sprites/'+missing+'.png'};
        const failed=new Sprite(missingName,scale);
        if(!failed.isLoaded)await new Promise(resolve=>{failed.onload_func=resolve});
        const fallbackName=failed.loadFailed?'rat':missingName;
        const native=new Sprite(fallbackName,scale);
        if(!native.isLoaded)await new Promise(resolve=>{native.onload_func=resolve});
        return {idle,left,attack,ratio:sprite.image.width/32,
          failed:failed.loadFailed,fallbackName,nativePath:native.filepath};
      },{id:imported.id,scale});
      assert.equal(result.idle.name,'idle_down');
      assert.equal(result.left.name,'idle_left');
      assert.equal(result.attack.name,'atk_right');
      checkPixel(result.idle.pixel,colors(1,0));
      checkPixel(result.left.pixel,colors(2,2));
      checkPixel(result.attack.pixel,colors(1,1));
      assert.equal(result.ratio,scale);
      assert.equal(result.failed,true,'Missing network image must trigger native fallback');
      assert.equal(result.fallbackName,'rat');
      assert.equal(result.nativePath,'img/'+scale+'/rat.png');
      if(scale===2&&name==='desktop')await page.screenshot({path:path.join(screenshotDir,'game-desktop.png')});
      if(scale===2&&name==='mobile')await page.screenshot({path:path.join(screenshotDir,'game-mobile.png')});
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,
      name+' fixture must fit viewport');
    await page.close();
  }
  assert.deepEqual(errors,[],'No uncaught browser script errors');
  console.log('Chromium passed: UI upload, animation preview, explicit publication, actual renderer pixels, 1x/2x/3x, mobile/desktop, native fallback.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(temporary,{recursive:true,force:true});
});
