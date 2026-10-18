'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib'),vm=require('vm'),
      Sprite=require('../server/admin/sprite-import-store'),World=require('../server/admin/world-store');
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1}return(crc^0xffffffff)>>>0}
function chunk(name,data){const head=Buffer.alloc(4),tail=Buffer.alloc(4),tag=Buffer.from(name);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([head,tag,data,tail])}
function png(width,height){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc(height*(width*4+1)))),chunk('IEND',Buffer.alloc(0))])}
function tiles(w,h){let bytes=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes,0);bytes.write('IHDR',12);bytes.writeUInt32BE(w,16);bytes.writeUInt32BE(h,20);return bytes}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-sprite-gameplay-'));
try{
    const root=name=>path.join(dir,name),imports=new Sprite.SpriteImportStore(root('imports'));
    const first=imports.import({pngBase64:png(32,16).toString('base64'),frameWidth:8,frameHeight:8,label:'Nova criatura'});
    assert.throws(()=>imports.publishedImage(first.id),/não publicado/);
    assert.deepStrictEqual(Object.keys(imports.publicCatalog()),[]);
    assert.throws(()=>imports.publish(first.id),/Configure as animações/);
    imports.configure(first.id,{animations:{
        idle_down:{row:0,start:1,length:2,fps:8},
        walk_right:{row:1,start:0,length:3,fps:12,flipX:true},
        death:{row:0,start:0,length:4,fps:6}
    },offsetX:-3,offsetY:-7});
    const published=imports.publish(first.id);
    assert.strictEqual(published.published,true);assert.strictEqual(published.draftOnly,false);
    assert(imports.publishedImage(first.id).equals(imports.image(first.id)));
    assert.throws(()=>imports.configure(first.id,{animations:{idle_down:{row:0,start:0,length:1,fps:1}}}),/imutável/);
    const catalog=imports.publicCatalog(),key='custom_'+first.id;
    assert(catalog[key]);assert.strictEqual(catalog[key].id,key);
    assert.strictEqual(catalog[key].path,'/game/sprites/'+first.id+'.png');
    assert.strictEqual(catalog[key].animations.walk_right.start,0);
    assert.strictEqual(catalog[key].animations.idle_down.start,1);
    assert.strictEqual(catalog[key].animations.walk_up.fps,8,'Missing direction uses idle fallback');
    assert.strictEqual(catalog[key].width,8);

    const base={width:10,height:10,collisions:[],doors:[],checkpoints:[],
        chestAreas:[],staticChests:[],roamingAreas:[],staticEntities:{}};
    const client={width:10,height:10,tilesize:16,data:new Array(100).fill(0),
        collisions:[],doors:[],checkpoints:[],blocking:[],plateau:[],high:[],animated:{}};
    fs.writeFileSync(root('server.json'),JSON.stringify(base));
    fs.writeFileSync(root('client.json'),JSON.stringify(client));
    fs.writeFileSync(root('tiles.png'),tiles(16,16));
    fs.writeFileSync(root('stories.json'),JSON.stringify({stories:[]}));
    const store=new World.WorldStore({
        baseMapPath:root('server.json'),baseClientMapPath:root('client.json'),tilesetPath:root('tiles.png'),
        statePath:root('draft.json'),publishedMapPath:root('pub-server.json'),
        publishedClientJsonPath:root('pub-client.json'),publishedClientJsPath:root('pub-client.js'),
        storiesPath:root('stories.json'),versionsDir:root('versions'),spriteImportStore:imports
    });
    let draft=store.load();
    draft.npcs=[{id:'town_guard',name:'Guarda personalizado',baseKind:'villager',spriteId:first.id,enabled:true}];
    draft.mobs=[{id:'fast_rat',name:'Rato vermelho',baseKind:'rat',spriteId:first.id,enabled:true}];
    draft.map.entities=[{id:'npc1',x:2,y:2,kind:'villager',profileType:'npc',profileId:'town_guard',source:'editor'}];
    draft.map.roamingAreas=[{id:0,x:3,y:3,width:2,height:2,nb:1,type:'rat',profileId:'fast_rat'}];
    const saved=store.save(draft);
    assert.strictEqual(saved.npcs[0].spriteId,first.id);
    assert.strictEqual(saved.mobs[0].baseKind,'rat','Changing art cannot change mob type');
    assert.strictEqual(store.preview().ok,true);
    assert.strictEqual(store.publish().ok,true);
    let publishedMap=JSON.parse(fs.readFileSync(root('pub-server.json'),'utf8'));
    assert.strictEqual(publishedMap.staticEntities[22],'villager');
    assert.strictEqual(publishedMap.editorProfiles.npcs.town_guard.spriteId,first.id);
    assert.strictEqual(publishedMap.editorProfiles.mobs.fast_rat.spriteId,first.id);
    assert.strictEqual(publishedMap.editorProfiles.mobs.fast_rat.baseKind,'rat');

    draft=store.load();draft.npcs[0].spriteId='b'.repeat(32);store.save(draft);
    assert.strictEqual(store.preview().ok,false,'Missing sprite fails prepublication diagnostics');
    assert.throws(()=>store.publish(),/Sprite do perfil/);
    assert.strictEqual(JSON.parse(fs.readFileSync(root('pub-server.json'),'utf8')).editorRevision,publishedMap.editorRevision,
        'Invalid reference cannot replace published map');
    for(const filename of ['client/js/sprites.js','client/js/sprite.js','client/js/game.js',
        'client/js/animation.js','client/js/entity.js']){
        const source=fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
        new vm.Script(source,{filename});
    }
    const spritesJS=fs.readFileSync(path.join(__dirname,'../client/js/sprites.js'),'utf8');
    assert(spritesJS.includes('BrowserQuestPublishedSprites'),'Custom metadata must merge into native registry');
    const spriteJS=fs.readFileSync(path.join(__dirname,'../client/js/sprite.js'),'utf8');
    assert(spriteJS.includes('ctx.imageSmoothingEnabled=false'),'Scale must use nearest-neighbor');
    assert(spriteJS.includes('self.loadFailed=true'),'Missing assets must not halt initial loading');
    const importer=fs.readFileSync(path.join(__dirname,'../server/admin/public/sprite-importer.html'),'utf8');
    new vm.Script(importer.match(/<script>([\s\S]*?)<\/script>/)[1]);
    assert(importer.includes('id="publishSprite"'));
    const editor=fs.readFileSync(path.join(__dirname,'../server/admin/public/world-editor.html'),'utf8');
    const scripts=[...editor.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.strictEqual(scripts.length,2);scripts.forEach(s=>new vm.Script(s[1]));
    assert(editor.includes('id="npcSprite"')&&editor.includes('id="mobSprite"'));
    assert(fs.readFileSync(path.join(__dirname,'../client/index.html'),'utf8').includes('/game/sprites/catalog.js'));
    console.log('Sprite publication, client registry, native fallback, profile references and world publishing passed.');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
