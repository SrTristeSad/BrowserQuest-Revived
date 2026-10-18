'use strict';

// Phase 6 import quarantine. Imported artwork is private until a later
// explicit publication step connects it to the BrowserQuest sprite registry.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');

const MAX_UPLOAD=2*1024*1024,MAX_PIXELS=4*1024*1024,MAX_DIM=4096,
      SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]),
      SAFE_CHUNKS=new Set(['IHDR','PLTE','IDAT','IEND','tRNS','gAMA','sRGB','pHYs']);
function invalid(message) {const error=new Error(message);error.statusCode=422;error.code='SPRITE_IMPORT_INVALID';return error;}
function crc32(buffer,start,end) {
    let crc=0xffffffff;
    for(let i=start;i<end;i++){
        crc^=buffer[i];
        for(let j=0;j<8;j++)crc=(crc&1)?(0xedb88320^(crc>>>1)):(crc>>>1);
    }
    return (crc^0xffffffff)>>>0;
}
function readPng(buffer) {
    if(!Buffer.isBuffer(buffer)||buffer.length<57||buffer.length>MAX_UPLOAD||
       !buffer.subarray(0,8).equals(SIGNATURE))throw invalid('Arquivo PNG inválido ou maior que 2 MiB.');
    let offset=8,width=0,height=0,bitDepth=0,colorType=0,
        sawIdat=false,sawEnd=false,sawPalette=false,afterIdat=false,
        idat=[],expectedBytes=0,chunks=0;
    while(offset<buffer.length) {
        if(buffer.length-offset<12||++chunks>256)throw invalid('Estrutura do PNG inválida.');
        const length=buffer.readUInt32BE(offset),start=offset+8,end=start+length,
              type=buffer.toString('ascii',offset+4,offset+8);
        if(length>MAX_UPLOAD||end+4>buffer.length||!SAFE_CHUNKS.has(type))throw invalid('Chunk PNG inválido ou não suportado.');
        if(crc32(buffer,offset+4,end)!==buffer.readUInt32BE(end))throw invalid('Integridade CRC do PNG inválida.');
        if(chunks===1&&type!=='IHDR')throw invalid('PNG sem cabeçalho IHDR.');
        if(type==='IHDR'){
            if(chunks!==1||length!==13)throw invalid('Cabeçalho PNG inválido.');
            width=buffer.readUInt32BE(start);height=buffer.readUInt32BE(start+4);
            bitDepth=buffer[start+8];colorType=buffer[start+9];
            if(!width||!height||width>MAX_DIM||height>MAX_DIM||width*height>MAX_PIXELS)
                throw invalid('Dimensões da imagem excedem o limite de 4 megapixels.');
            if(buffer[start+10]!==0||buffer[start+11]!==0||buffer[start+12]!==0)
                throw invalid('Apenas PNG progressivo não entrelaçado é permitido.');
            if(!((colorType===2||colorType===6||colorType===0||colorType===4)&&bitDepth===8||
                  colorType===3&&[1,2,4,8].includes(bitDepth)))
                throw invalid('Formato de pixels não suportado: use PNG 8-bit RGB/RGBA ou indexado.');
        }else if(type==='PLTE'){
            if(sawIdat||sawPalette||length<3||length>768||length%3!==0)throw invalid('Paleta PNG inválida.');
            sawPalette=true;
        }else if(type==='IDAT'){
            if(afterIdat||sawEnd||!width)throw invalid('Dados de imagem PNG fora de ordem.');
            sawIdat=true;idat.push(buffer.subarray(start,end));
        }else if(type==='IEND'){
            if(length!==0||!sawIdat||end+4!==buffer.length)throw invalid('Encerramento PNG inválido.');
            sawEnd=true;
        }else{
            if(sawIdat)afterIdat=true;
            if(type==='tRNS'&&!sawPalette&&colorType===3)throw invalid('Transparência indexada sem paleta.');
        }
        offset=end+4;
        if(sawEnd)break;
    }
    if(!sawEnd||(colorType===3&&!sawPalette))throw invalid('PNG incompleto ou sem paleta indexada.');
    const bitsPerPixel=colorType===6?32:colorType===2?24:colorType===4?16:colorType===0?8:bitDepth;
    const stride=Math.ceil(width*bitsPerPixel/8);
    expectedBytes=(stride+1)*height;
    if(expectedBytes>24*1024*1024)throw invalid('PNG descompactado grande demais.');
    let pixels;
    try {pixels=zlib.inflateSync(Buffer.concat(idat),{maxOutputLength:expectedBytes+1});}
    catch(ignore) {throw invalid('Dados comprimidos do PNG inválidos ou excessivos.');}
    if(pixels.length!==expectedBytes)throw invalid('Tamanho dos pixels PNG inconsistente.');
    for(let row=0;row<height;row++)if(pixels[row*(stride+1)]>4)throw invalid('Filtro de linha PNG inválido.');
    return {width,height,bitDepth,colorType};
}
function parseUploadBase64(input) {
    if(typeof input!=='string'||input.length>Math.ceil(MAX_UPLOAD*4/3)+16||
       input.length<32||input.length%4!==0||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(input))throw invalid('Envie um PNG codificado em base64 válido.');
    const bytes=Buffer.from(input,'base64');
    if(bytes.length>MAX_UPLOAD||bytes.toString('base64')!==input)throw invalid('Payload base64 inválido ou muito grande.');
    return bytes;
}
function validateFrames(image,frameWidth,frameHeight) {
    if(!Number.isSafeInteger(frameWidth)||!Number.isSafeInteger(frameHeight)||
       frameWidth<1||frameHeight<1||frameWidth>1024||frameHeight>1024||
       frameWidth>image.width||frameHeight>image.height||
       image.width%frameWidth!==0||image.height%frameHeight!==0)
        throw invalid('Os frames precisam dividir exatamente a largura e altura do PNG.');
    const columns=image.width/frameWidth,rows=image.height/frameHeight;
    if(columns*rows>4096)throw invalid('A spritesheet excede 4096 frames.');
    return {frameWidth,frameHeight,columns,rows,frames:columns*rows};
}

const ANIMATION_NAMES=new Set(['idle_down','idle_up','idle_left','idle_right',
    'walk_down','walk_up','walk_left','walk_right',
    'atk_down','atk_up','atk_left','atk_right','death']);
function validateAnimations(record,config) {
    if(!config||typeof config!=='object'||Array.isArray(config)||
       !config.animations||typeof config.animations!=='object'||Array.isArray(config.animations))
        throw invalid('Configure pelo menos a animação idle_down.');
    const names=Object.keys(config.animations);
    if(!names.length||names.length>13||!names.includes('idle_down')||
       names.some(name=>!ANIMATION_NAMES.has(name)))
        throw invalid('Nomes de animação inválidos ou idle_down ausente.');
    const animations=Object.create(null);
    names.forEach(name=>{
        const entry=config.animations[name];
        if(!entry||typeof entry!=='object'||Array.isArray(entry)||
           ![entry.row,entry.start,entry.length,entry.fps].every(Number.isSafeInteger)||
           entry.row<0||entry.row>=record.rows||entry.start<0||
           entry.length<1||entry.length>record.columns||
           entry.start+entry.length>record.columns||
           entry.fps<1||entry.fps>60||
           (entry.flipX!==undefined&&typeof entry.flipX!=='boolean'))
            throw invalid('Frames, linha, duração ou direção inválidos: '+name);
        animations[name]={row:entry.row,start:entry.start,length:entry.length,
                          fps:entry.fps,flipX:entry.flipX===true};
    });
    const offsetX=config.offsetX==null?-Math.floor((record.frameWidth-16)/2):config.offsetX,
          offsetY=config.offsetY==null?-Math.floor((record.frameHeight-16)/2):config.offsetY;
    if(!Number.isSafeInteger(offsetX)||!Number.isSafeInteger(offsetY)||
       Math.abs(offsetX)>2048||Math.abs(offsetY)>2048)
        throw invalid('Offsets do sprite inválidos.');
    return {animations,offsetX,offsetY};
}

class SpriteImportStore {
    constructor(directory){if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('Diretório privado de sprites obrigatório.');this.directory=directory;}
    import(payload){
        if(!payload||typeof payload!=='object')throw invalid('Dados de importação ausentes.');
        const bytes=parseUploadBase64(payload.pngBase64),image=readPng(bytes),
              frames=validateFrames(image,payload.frameWidth,payload.frameHeight),
              label=String(payload.label||'Sprite importado').trim();
        if(!label||label.length>80||/[\u0000-\u001f<>]/.test(label))throw invalid('Nome do sprite inválido.');
        const id=crypto.createHash('sha256').update(bytes).update(':')
            .update(String(frames.frameWidth)).update('x').update(String(frames.frameHeight))
            .digest('hex').slice(0,32);
        const imageFile=path.join(this.directory,id+'.png'),
              metadataFile=path.join(this.directory,id+'.json');
        fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
        if(fs.existsSync(metadataFile))return this.get(id);
        try {
            fs.writeFileSync(imageFile,bytes,{flag:'wx',mode:0o600});
        }catch(error){if(error.code!=='EEXIST')throw error;}
        const record=Object.assign({
            id,label,width:image.width,height:image.height,bytes:bytes.length,
            createdAt:new Date().toISOString(),draftOnly:true,published:false
        },frames);
        try {fs.writeFileSync(metadataFile,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});}
        catch(error){if(error.code!=='EEXIST')throw error;}
        return this.get(id);
    }
    get(id){
        if(typeof id!=='string'||!/^[0-9a-f]{32}$/.test(id))throw invalid('ID do sprite inválido.');
        const record=JSON.parse(fs.readFileSync(path.join(this.directory,id+'.json'),'utf8'));
        if(!record||record.id!==id)throw invalid('Metadados de sprite inválidos.');
        return record;
    }
    configure(id,config){
        const original=this.get(id),validated=validateAnimations(original,config);
        // Always recheck the private PNG before accepting a new animation map.
        const bytes=this.image(id),dimensions=readPng(bytes);
        if(dimensions.width!==original.width||dimensions.height!==original.height)
            throw invalid('PNG diferente da geometria originalmente importada.');
        const record=Object.assign({},original,validated,{
            draftOnly:true,published:false,updatedAt:new Date().toISOString()
        });
        const dest=path.join(this.directory,id+'.json'),
              temporary=path.join(this.directory,id+'.stage-'+crypto.randomBytes(6).toString('hex'));
        try {
            fs.writeFileSync(temporary,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
            fs.renameSync(temporary,dest);
        }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
        return this.get(id);
    }
    image(id){
        this.get(id);
        const buffer=fs.readFileSync(path.join(this.directory,id+'.png'));
        readPng(buffer);
        return buffer;
    }
    list(){
        if(!fs.existsSync(this.directory))return [];
        return fs.readdirSync(this.directory).filter(name=>/^[0-9a-f]{32}\.json$/.test(name))
           .slice(0,200).flatMap(name=>{try{return [this.get(name.slice(0,32))]}catch(ignore){return []}})
           .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    }
}
module.exports={SpriteImportStore,readPng,validateFrames,parseUploadBase64,validateAnimations,MAX_UPLOAD};
