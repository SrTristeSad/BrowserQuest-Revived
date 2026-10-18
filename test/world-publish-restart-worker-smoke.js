'use strict';

const assert=require('assert'), fs=require('fs'),os=require('os'),path=require('path'),
      cp=require('child_process'),World=require('../server/admin/world-store');
const workerPath=path.join(__dirname,'../client/js/mapworker.js'),
      mapModulePath=path.join(__dirname,'../server/js/map.js');
function png(w,h){const b=Buffer.alloc(24);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.write('IHDR',12,4,'ascii');b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b}
function restartedRuntime(){
  const assert=require('assert'),fs=require('fs'),vm=require('vm');
  global.log={error:function(message){throw new Error(message)},info:function(){}};
  const Map=require(process.argv[1]),serverPath=process.argv[2],workerPath=process.argv[3],clientPath=process.argv[4];
  const map=new Map(serverPath);
  map.ready(function(){
    const ctx={
      importScripts:function(...files){
        files.forEach(function(file){
          if(file.includes('world_client.js'))vm.runInContext(fs.readFileSync(clientPath,'utf8'),ctx);
          else ctx._={each:(arr,fn)=>arr.forEach(fn),include:(arr,val)=>arr.includes(val)};
        });
      },
      postMessage:function(result){ctx.received=result}
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(workerPath,'utf8'),ctx);
    ctx.onmessage({data:1});
    const c=ctx.received;
    assert(c&&Array.isArray(c.grid)&&Array.isArray(c.plateauGrid));
    console.log(JSON.stringify({
      serverRevision:map.editorRevision,clientRevision:c.editorRevision,
      serverDimensions:[map.width,map.height],clientDimensions:[c.width,c.height],
      clientCollision:c.grid[2][4],clientBlocking:c.grid[2][3],plateau:c.plateauGrid[3][4],
      foreground:c.high.includes(2),checkpoint:map.startingAreas.length,
      door:Object.keys(map.connectedGroups).length,data:c.data[11]
    }));
  });
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-world-restart-'));
try {
  const f=name=>path.join(dir,name),width=32,height=32,
        server={width,height,collisions:[],doors:[],checkpoints:[{id:1,x:1,y:1,w:2,h:2,s:1}],
          roamingAreas:[],chestAreas:[],staticChests:[],staticEntities:{}},
        client={width,height,tilesize:16,data:new Array(width*height).fill(0),
          collisions:[],doors:[],checkpoints:server.checkpoints,blocking:[],plateau:[],high:[],animated:{}},
        options={baseMapPath:f('base-server.json'),baseClientMapPath:f('base-client.json'),tilesetPath:f('tiles.png'),
          statePath:f('draft.json'),publishedMapPath:f('published-server.json'),
          publishedClientJsonPath:f('published-client.json'),publishedClientJsPath:f('published-client.js'),
          versionsDir:f('versions'),storiesPath:f('stories.json')};
  fs.writeFileSync(options.baseMapPath,JSON.stringify(server));
  fs.writeFileSync(options.baseClientMapPath,JSON.stringify(client));
  fs.writeFileSync(options.tilesetPath,png(32,16));
  fs.writeFileSync(options.storiesPath,JSON.stringify({stories:[]}));
  const store=new World.WorldStore(options);
  let state=store.load();
  state.map.data[11]=1;state.map.collisions=[2*width+4];
  state.map.blocking=[2*width+3];state.map.plateau=[3*width+4];state.map.high=[2];
  state.map.doors=[{x:2,y:3,to:'d',p:0,tx:3,ty:3}];
  store.save(state);
  assert.strictEqual(store.preview().ok,true);
  const first=store.publish();
  function restart(){
    const output=cp.execFileSync(process.execPath,['-e','('+restartedRuntime.toString()+')()',
      mapModulePath,options.publishedMapPath,workerPath,options.publishedClientJsPath],
      {cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:15000});
    return JSON.parse(output.trim());
  }
  let current=restart();
  assert.strictEqual(current.serverRevision,current.clientRevision,'Fresh Node and worker load same revision');
  assert.deepStrictEqual(current.serverDimensions,[width,height]);
  assert.deepStrictEqual(current.clientDimensions,[width,height]);
  assert.strictEqual(current.clientCollision,1);assert.strictEqual(current.clientBlocking,1);
  assert.strictEqual(current.plateau,1);assert.strictEqual(current.foreground,true);
  assert.strictEqual(current.checkpoint,1);assert.strictEqual(current.door,1);assert.strictEqual(current.data,1);
  state=store.load();state.map.data[11]=0;state.map.blocking=[];state.map.high=[];
  store.save(state);store.publish();
  current=restart();
  assert.strictEqual(current.data,0);assert.strictEqual(current.clientBlocking,0);
  const restored=store.restoreVersion(first.versionId);
  assert(restored.ok);
  current=restart();
  assert.strictEqual(current.serverRevision,current.clientRevision);
  assert.strictEqual(current.data,1);assert.strictEqual(current.clientBlocking,1);
  assert.strictEqual(current.foreground,true);
  console.log('Fresh Node server Map and real client mapworker load published and restored worlds.');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
