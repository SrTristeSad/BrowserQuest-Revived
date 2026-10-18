'use strict';

// Headless canvas contract test: runs actual BrowserQuest AMD Sprite, Animation,
// Character, Entity and Renderer classes. This is not a real-browser visual test.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),
  Brain=require('../server/js/brain'),
  World=require('../server/admin/world-store'),
  SpriteImports=require('../server/admin/sprite-import-store');

function makeClass(){
  function Base(){}
  Base.extend=function(def){
    const Parent=this;
    function Sub(){if(this.init)this.init.apply(this,arguments)}
    Sub.prototype=Object.create(Parent.prototype);
    Object.keys(def).forEach(key=>{
      const fn=def[key],superFn=Parent.prototype[key];
      Sub.prototype[key]=typeof fn==='function'&&typeof superFn==='function'?function(){
        const old=this._super;this._super=superFn.bind(this);
        try{return fn.apply(this,arguments)}
        finally{this._super=old}
      }:fn;
    });
    Sub.prototype.constructor=Sub;
    Sub.extend=Parent.extend;
    return Sub;
  };
  return Base;
}

const ids=['a'.repeat(32),'b'.repeat(32)];
const customName='custom_'+ids[0];
const imageOperations=[],drawCalls=[];
const Types={
  Orientations:{DOWN:1,UP:2,LEFT:3,RIGHT:4},
  Entities:{CAKE:9999},
  isMob:k=>k===21,
  isNpc:k=>k===22,
  isPlayer:()=>false,
  getKindAsString:k=>k===21?'rat':'villager',
  getOrientationAsString:dir=>({1:'down',2:'up',3:'left',4:'right'})[dir]
};
function FakeImage(){this.width=40;this.height=24}
Object.defineProperty(FakeImage.prototype,'src',{
  set:function(value){
    this._src=value;
    if(value.includes('missing')){if(this.onerror)this.onerror()}
    else if(this.onload)this.onload()
  },get:function(){return this._src}
});
const canvasFactory=()=>({width:0,height:0,getContext:()=>({
  imageSmoothingEnabled:true,
  drawImage:function(){imageOperations.push(Array.from(arguments))}
})});
const context=vm.createContext({
  Class:makeClass(),Types,Image:FakeImage,
  window:{BrowserQuestPublishedSprites:{}},
  document:{createElement:function(type){assert.strictEqual(type,'canvas');return canvasFactory()}},
  log:{error:function(){}},
  _: {indexOf:(a,v)=>a.indexOf(v),keys:Object.keys},
  define:null
});
function loadAMD(filepath,deps){
  let result;
  context.define=function(keys,factory){
    if(typeof keys==='function'){factory=keys;keys=[]}
    result=factory.apply(null,(keys||[]).map(key=>deps[key]));
  };
  const code=fs.readFileSync(path.join(__dirname,'..',filepath),'utf8');
  new vm.Script(code,{filename:filepath}).runInContext(context);
  return result;
}
const Animation=loadAMD('client/js/animation.js',{});
const Entity=loadAMD('client/js/entity.js',{});
const Character=loadAMD('client/js/character.js',{
  entity:Entity,transition:function(){},timer:function(){}
});
const record={
  id:customName,custom:true,width:8,height:8,path:'/game/sprites/'+ids[0]+'.png',
  animations:{
    idle_down:{row:0,start:1,length:3,fps:8,flipX:false},
    idle_right:{row:1,start:0,length:2,fps:7,flipX:false},
    idle_left:{row:2,start:2,length:2,fps:6,flipX:true},
    walk_right:{row:0,start:0,length:4,fps:10,flipX:false},
    atk_right:{row:1,start:2,length:2,fps:11,flipX:false},
    death:{row:2,start:1,length:2,fps:4,flipX:false}
  }
};
const sprites={
  [customName]:record,
  ['custom_'+ids[1]]:{...record,id:'custom_'+ids[1],path:'/game/sprites/missing.png'},
  rat:{id:'rat',width:8,height:8,animations:{idle_down:{length:2,row:0}}}
};
context.window.BrowserQuestPublishedSprites[customName]=record;
const Sprite=loadAMD('client/js/sprite.js',{jquery:{},animation:Animation,sprites});
for(const scale of [1,2,3]){
  const asset=new Sprite(customName,scale);
  assert.strictEqual(asset.isLoaded,true);
  assert.strictEqual(asset.loadFailed,undefined);
  assert.strictEqual(asset.filepath,record.path,'Custom sprites use the same approved URL at every scale');
  assert.strictEqual(asset.image.width,40*scale);
  assert.strictEqual(asset.image.height,24*scale);
  if(scale>1)assert(imageOperations.some(call=>call[3]===40*scale&&call[4]===24*scale),'Image scaled using canvas');
  const animation=asset.createAnimations().idle_left;
  assert.strictEqual(animation.currentFrame.x,16,'Frame begins at configured column');
  assert.strictEqual(animation.currentFrame.y,16,'Frame begins on authored row');
  animation.tick();assert.strictEqual(animation.currentFrame.x,24);
  animation.tick();assert.strictEqual(animation.currentFrame.x,16,'Frames loop within segment');
}
const missing=new Sprite('custom_'+ids[1],2);
assert.strictEqual(missing.loadFailed,true);
assert.strictEqual(missing.isLoaded,true,'Missing approved image does not deadlock loading');
const native=new Sprite('rat',2);
assert.strictEqual(native.filepath,'img/2/rat.png','Native PNG path is unchanged');

const character=Object.create(Character.prototype);
character.kind=21;character.id='npc-test';character.sprite=new Sprite(customName,2);
character.animations=character.sprite.createAnimations();
character.currentAnimation=null;character.isLoaded=true;
character.orientation=Types.Orientations.LEFT;character.flipSpriteX=false;
character.flipSpriteY=false;character.x=20;character.y=40;
character.isVisible=()=>true;character.hasShadow=()=>false;character.hasWeapon=()=>false;
character.idle();
assert.strictEqual(character.currentAnimation.name,'idle_left','Authored left-direction frames are preferred');
assert.strictEqual(character.flipSpriteX,true,'Author-provided flip is applied');
assert.strictEqual(character.currentAnimation.speed,1000/6);
character.idle();
assert.strictEqual(character.flipSpriteX,true,'Repeated idle does not oscillate flip');
character.walk(Types.Orientations.LEFT);
assert.strictEqual(character.currentAnimation.name,'walk_right','Walking falls back to mirrored right');
assert.strictEqual(character.flipSpriteX,true);
character.hit(Types.Orientations.RIGHT);
assert.strictEqual(character.currentAnimation.name,'atk_right');
assert.strictEqual(character.currentAnimation.speed,1000/11);
assert.strictEqual(character.flipSpriteX,false);
assert.strictEqual(character.currentAnimation.currentFrame.x,16,'Attack starts at correct column segment');
const Item=function(){};
const Renderer=loadAMD('client/js/renderer.js',{
  camera:function(){},item:Item,character:Character,player:function(){},timer:function(){}
});
const ctx={
  save(){drawCalls.push(['save'])},restore(){drawCalls.push(['restore'])},
  translate(x,y){drawCalls.push(['translate',x,y])},
  scale(x,y){drawCalls.push(['scale',x,y])},
  drawImage(){drawCalls.push(['drawImage',...arguments])}
};
const renderer={
  context:ctx,game:{shadows:{small:{image:{},width:16,height:16}}},
  upscaledRendering:false,scale:2,tilesize:16,mobile:true,tablet:true
};
Renderer.prototype.drawEntity.call(renderer,character);
const crop=drawCalls.find(call=>call[0]==='drawImage');
assert(crop,'Renderer must draw custom character on canvas');
assert.strictEqual(crop[2],32,'Source crop uses scaled animation starting column');
assert.strictEqual(crop[4],16,'Source frame width scales with sprite scale');

const raw=fs.readFileSync(path.join(__dirname,'../server/admin/public/world-editor.html'),'utf8');
for(const control of ['id="presetNpcStatic"','id="presetNpcAnimated"','id="presetMobAnimated"',
  'id="npcVisualMode"',"enabled:$('npcVisualMode').value!=='static'",
  "$('presetNpcStatic').onclick","$('presetNpcAnimated').onclick",
  "$('presetMobAnimated').onclick"])assert(raw.includes(control),'Missing world editor preset: '+control);
const cfg=fs.readFileSync(path.join(__dirname,'../client/js/character.js'),'utf8');
assert(cfg.includes('this.animations[animation + "_left"]'),'Custom left frames are selected before mirroring');
const staticNpc=Brain.normalizeConfig({type:'npc',kind:22},{enabled:false,preset:'villager',mode:'wander'});
assert.strictEqual(staticNpc.enabled,false);
const staticBrain=new Brain.Brain({type:'npc',kind:22,x:4,y:5},{map:{}},{enabled:false});
staticBrain.start();assert.strictEqual(staticBrain.timer,null,'Static NPC does not create movement AI timer');
const activeBrain=new Brain.Brain({type:'npc',kind:22,x:4,y:5},{map:{}},{enabled:true});
activeBrain.start();assert(activeBrain.timer,'Animated NPC keeps server-authoritative movement brain');
activeBrain.stop();

console.log('Sprite presets and headless renderer contract passed: 1x/2x/3x, frames, flips, fallbacks, AI states.');
