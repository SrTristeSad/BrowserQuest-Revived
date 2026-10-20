'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
let App;
const elements={
  '#healthbar': {width:0,css:{},attributes:{}},
  '#hitpoints': {width:0,css:{},attributes:{}}
};
function jquery(selector){
  assert(elements[selector],'unknown UI element '+selector);
  const e=elements[selector];
  return {
    width(){return e.width},
    css(name,value){e.css[name]=value;return this},
    attr(name,value){e.attributes[name]=value;return this},
    addClass(){return this},
    removeClass(){return this}
  };
}
vm.runInNewContext(read('client/js/app.js'),{
  Class:{extend(methods){function AppCtor(){}AppCtor.prototype=methods;return AppCtor}},
  define(deps,factory){App=factory(jquery,function Storage(){})},
  window:{}
},{filename:'app.js'});
assert.equal(typeof App.prototype.initHealthBar,'function');
let healthUpdate;
const game={
  renderer:{scale:2,getScaleFactor(){return 2}},
  onPlayerHealthChange(callback){healthUpdate=callback},
  onPlayerHurt(callback){this.onHurt=callback}
};
App.prototype.initHealthBar.call({game,blinkHealthBar(){}});
assert.equal(typeof healthUpdate,'function');
healthUpdate(80,80);
assert.equal(elements['#hitpoints'].css.width,'180px',
  'full HP must render even if bar is initially hidden and measured as zero');
assert.equal(elements['#healthbar'].attributes.title,'Vida: 80/80');
elements['#healthbar'].width=204;
healthUpdate(40,80);
assert.equal(elements['#hitpoints'].css.width,'90px','half HP after unhide');
healthUpdate(0,80);
assert.equal(elements['#hitpoints'].css.width,'0px','actual death shows zero HP');
assert.equal(elements['#healthbar'].attributes.title,'Vida: 0/80');
healthUpdate(250,80);
assert.equal(elements['#hitpoints'].css.width,'180px','server HP clamped to 100%');
healthUpdate(0,0);
assert.equal(elements['#hitpoints'].css.width,'0px','avoid NaN when HP is not initialized');
assert.equal(elements['#healthbar'].attributes.title,'Vida: aguardando servidor');
const client=read('client/js/game.js');
assert(!client.includes('this.client.sendHurt(character)'),
  'mob attack animation must never control real HP: world server owns all damage');
assert(client.includes('isHurt = points < player.hitPoints;'),
  'HP decreases received from the server must still animate as real damage');
assert(!client.includes('self.player.die();\n                    }\n                    if(self.disconnect_callback)'),
  'disconnected sessions must not be classified as deaths');
console.log('HP bar: initial hidden layout, real current/max HP, damage and no-connection-death checks passed.');
