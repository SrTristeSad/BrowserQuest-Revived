'use strict';

const assert=require('assert'),crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib'),vm=require('vm'),
      Sprite=require('../server/admin/sprite-import-store');
function crc32(bytes){
    let crc=0xffffffff;
    for(const byte of bytes){
        crc^=byte;
        for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;
    }
    return (crc^0xffffffff)>>>0;
}
function chunk(type,bytes){
    const t=Buffer.from(type,'ascii'),head=Buffer.alloc(4),crc=Buffer.alloc(4);
    head.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([t,bytes])));
    return Buffer.concat([head,t,bytes,crc]);
}
function png(width,height,opts={}){
    const colorType=opts.colorType===undefined?6:opts.colorType,
          bitDepth=opts.bitDepth||8,
          bytesPerRow=Math.ceil(width*(colorType===6?32:colorType===2?24:colorType===3?bitDepth:8)/8),
          ihdr=Buffer.alloc(13),pixels=Buffer.alloc(height*(bytesPerRow+1));
    ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=bitDepth;ihdr[9]=colorType;
    if(opts.filter!==undefined)for(let y=0;y<height;y++)pixels[y*(bytesPerRow+1)]=opts.filter;
    const parts=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr)];
    if(colorType===3)parts.push(chunk('PLTE',Buffer.from([255,0,0,0,255,0,0,0,255])));
    parts.push(chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0)));
    return Buffer.concat(parts);
}
assert.deepStrictEqual(
    [Sprite.readPng(png(8,4)).width,Sprite.readPng(png(8,4)).height],[8,4]);
assert.strictEqual(Sprite.readPng(png(8,4,{colorType:3})).colorType,3,'Indexed PNG support');
assert.strictEqual(Sprite.readPng(png(8,4,{colorType:2})).colorType,2,'RGB PNG support');
assert.deepStrictEqual(Sprite.validateFrames({width:100,height:48},20,12),
    {frameWidth:20,frameHeight:12,columns:5,rows:4,frames:20},
    'Frame sizes are independent from common 16/32/64 tiles');
assert.throws(()=>Sprite.validateFrames({width:100,height:48},32,12),/frames precisam dividir/);
assert.throws(()=>Sprite.validateFrames({width:100,height:48},0,12),/frames precisam dividir/);
const valid=png(16,8),badCrc=Buffer.from(valid);
badCrc[32]^=1;
assert.throws(()=>Sprite.readPng(badCrc),/CRC/,'Corrupted PNG chunk CRC');
assert.throws(()=>Sprite.readPng(png(8,4,{filter:5})),/Filtro/,'Invalid row filters');
assert.throws(()=>Sprite.readPng(Buffer.from('<script>','utf8')),/PNG/);
assert.throws(()=>Sprite.readPng(png(4097,1)),/dimensões/i);
assert.throws(()=>Sprite.readPng(png(4096,2048)),/dimensões/i);
assert.throws(()=>Sprite.readPng(Buffer.concat([valid,Buffer.from('trailer')])),/encerramento/i);
assert.throws(()=>Sprite.readPng(valid.subarray(0,valid.length-10)),/PNG/);
assert.throws(()=>Sprite.parseUploadBase64('*'.repeat(50)),/base64/);
assert.throws(()=>Sprite.parseUploadBase64(Buffer.from('invalid').toString('base64')),/base64|PNG/); // validator runs after base64 decoding
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-sprite-import-'));
try{
    const store=new Sprite.SpriteImportStore(dir),payload={pngBase64:valid.toString('base64'),
        frameWidth:4,frameHeight:2,label:'Explorador original'};
    const first=store.import(payload);
    assert(/^[0-9a-f]{32}$/.test(first.id));
    assert.strictEqual(first.width,16);assert.strictEqual(first.height,8);
    assert.strictEqual(first.columns,4);assert.strictEqual(first.rows,4);
    assert.strictEqual(first.frames,16);assert.strictEqual(first.draftOnly,true);
    assert.strictEqual(first.published,false);
    assert(fs.readFileSync(path.join(dir,first.id+'.png')).equals(valid));
    assert.deepStrictEqual(store.list().map(x=>x.id),[first.id]);
    const duplicate=store.import({...payload,label:'Different label'});
    assert.strictEqual(duplicate.id,first.id,'Same PNG+frames reuses import');
    assert.strictEqual(duplicate.label,'Explorador original','Dedup cannot overwrite existing asset');
    const second=store.import({...payload,frameWidth:8});
    assert.notStrictEqual(second.id,first.id,'Different frame geometry gets separate manifest');
    assert.strictEqual(store.list().length,2);
    assert(store.image(first.id).equals(valid));
    assert.throws(()=>store.get('../secrets'),/ID do sprite inválido/);
    assert.throws(()=>store.image('b'.repeat(32)),/ENOENT/);
    assert.throws(()=>store.import({...payload,frameWidth:3}),/frames precisam dividir/);
    assert.throws(()=>store.import({...payload,label:'<img onerror=alert(1)>'}),/Nome/);
    assert.throws(()=>store.import({...payload,pngBase64:badCrc.toString('base64')}),/CRC/);
    assert.throws(()=>store.import({...payload,pngBase64:'AAAA'}),/base64/);
}finally{fs.rmSync(dir,{recursive:true,force:true});}

const html=fs.readFileSync(path.join(__dirname,'../server/admin/public/sprite-importer.html'),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.strictEqual(scripts.length,1);
new vm.Script(scripts[0][1],{filename:'sprite-importer.html inline script'});
for(const key of ['type="file"','id="frameWidth"','id="frameHeight"','id="sheet"',
    'id="framePreview"','id="submit"','/admin/api/sprites','/admin/api/sprites/image',
    'Nenhum PNG importado']){
    assert(html.includes(key),'Missing sprite importer UI: '+key);
}
const http=fs.readFileSync(path.join(__dirname,'../server/admin/http.js'),'utf8');
for(const route of ['/admin/sprite-importer','/admin/api/sprites','/admin/api/sprites/image'])
    assert(http.includes(route),'Missing sprite admin route: '+route);
assert(http.includes("spriteImports = new SpriteImportStore(path.join(configDir,'sprite-imports'))"),
    'Imported sprite files must remain in private installation state');
assert(html.includes('não é publicado')||html.includes('não publicado'),
    'Importer must not suggest the file is active in gameplay');
console.log('Sprite importer validates PNG/CRC/inflate, geometry, quarantined storage and UI.');
