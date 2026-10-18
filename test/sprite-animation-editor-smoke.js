'use strict';
const assert=require('assert'),crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib'),vm=require('vm'),
  Sprite=require('../server/admin/sprite-import-store');
function crc(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1}return(crc^0xffffffff)>>>0}
function chunk(name,data){const label=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([label,data])));return Buffer.concat([size,label,data,sum])}
function png(w,h){const header=Buffer.alloc(13);header.writeUInt32BE(w,0);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc(h*(w*4+1)))),chunk('IEND',Buffer.alloc(0))])}
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bq-sprite-animation-'));
try {
  const store=new Sprite.SpriteImportStore(folder),initial=store.import({pngBase64:png(32,24).toString('base64'),frameWidth:8,frameHeight:8,label:'Teste'});
  assert.strictEqual(initial.columns,4);assert.strictEqual(initial.rows,3);
  assert.throws(()=>store.configure(initial.id,{animations:{}}),/idle_down/);
  assert.throws(()=>store.configure(initial.id,{animations:{idle_down:{row:3,start:0,length:1,fps:8}}}),/inválidos/);
  assert.throws(()=>store.configure(initial.id,{animations:{idle_down:{row:0,start:2,length:3,fps:8}}}),/inválidos/);
  assert.throws(()=>store.configure(initial.id,{animations:{idle_down:{row:0,start:0,length:1,fps:0}}}),/inválidos/);
  assert.throws(()=>store.configure(initial.id,{animations:{idle_down:{row:0,start:0,length:1,fps:8},evil:{row:0,start:0,length:1,fps:8}}}),/inválidos/);
  let mapping={idle_down:{row:0,start:0,length:2,fps:6},walk_right:{row:1,start:1,length:3,fps:10,flipX:false},
    atk_left:{row:2,start:0,length:3,fps:12,flipX:true},death:{row:2,start:0,length:4,fps:4}};
  const configured=store.configure(initial.id,{animations:mapping,offsetX:-2,offsetY:-5});
  assert.strictEqual(configured.published,false,'Animation editing must not publish PNG');
  assert.strictEqual(configured.draftOnly,true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(configured.animations)),Object.fromEntries(Object.entries(mapping).map(([k,v])=>[k,{...v,flipX:v.flipX===true}])));
  assert.strictEqual(configured.offsetX,-2);assert.strictEqual(configured.offsetY,-5);
  assert.deepStrictEqual(store.get(initial.id).animations,configured.animations);
  assert.strictEqual(store.list()[0].animations.atk_left.flipX,true);
  const before=fs.readFileSync(path.join(folder,initial.id+'.json'),'utf8');
  assert.throws(()=>store.configure(initial.id,{animations:{idle_down:{row:0,start:0,length:1,fps:10}},offsetX:9999}),/Offsets/);
  assert.strictEqual(fs.readFileSync(path.join(folder,initial.id+'.json'),'utf8'),before,'Failed edits must not replace stored metadata');
  const html=fs.readFileSync(path.join(__dirname,'../server/admin/public/sprite-importer.html'),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/);
  assert(script);new vm.Script(script[1],{filename:'sprite-importer.html'});
  for(const marker of ['id="animAction"','id="animDirection"','id="animRow"','id="animStart"',
     'id="animFps"','id="animFlip"','id="animSave"','id="animPlay"',
     'function animateStep(','function assignAnimation(','/admin/api/sprites/animations',
     'function selectImportedSprite('])assert(html.includes(marker),'UI missing '+marker);
  assert(!fs.existsSync(path.join(folder,initial.id+'.published.json')),'Configuration remains private');
  console.log('Sprite animation map bounds, directions, offsets, preview hooks and persistence passed.');
}finally{fs.rmSync(folder,{recursive:true,force:true})}
