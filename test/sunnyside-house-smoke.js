'use strict';
/* Sunnyside 16x16 integration must never damage default maps or teleports. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const layout=require('../client/maps/sunnyside-layout');
const Map=require('../server/js/map');
const mapData=JSON.parse(read('server/maps/world_server.json'));
const clientMap=JSON.parse(read('client/maps/world_client.json'));
assert.equal(layout.active(mapData),true,'existing house must have reciprocal doors');
assert.equal(layout.active(clientMap),true,'client and server house entrances agree');
const inside=layout.house.inside,outside=layout.house.outside;
assert(mapData.doors.some(d=>d.x===outside.x&&d.y===outside.y&&
 d.tx===outside.tx&&d.ty===outside.ty));
assert(mapData.doors.some(d=>d.x===inside.x&&d.y===inside.y&&
 d.tx===inside.tx&&d.ty===inside.ty));
assert.deepEqual(layout.solidCells(mapData).map(v=>v.kind),['bed','cabinet']);
assert.equal(layout.solidCells({...mapData,doors:[]}).length,0,
 'unrelated map revisions do not inherit this house geometry');
const map=Object.create(Map.prototype);
map.initMap(mapData); map.generateCollisionGrid();
for(const cell of layout.solidCells(map)){
 assert.equal(map.isColliding(cell.x,cell.y),true,'server furniture is solid');
 const idx=cell.x+cell.y*map.width;
 assert.equal(clientMap.collisions.includes(idx),false,
   'furniture adds collision without mutating original published files');
}
assert.equal(map.canTeleportFrom(outside.x,outside.y,outside.tx,outside.ty),true);
assert.equal(map.canTeleportFrom(inside.x,inside.y,inside.tx,inside.ty),true);
assert.equal(map.isColliding(inside.x,inside.y),false,'exit is not blocked');

const terrain=fs.readFileSync(path.join(root,'client/img/sunnyside/terrain-interior.png'));
const furniture=fs.readFileSync(path.join(root,'client/img/sunnyside/house-furniture.png'));
function pngDimensions(buffer){assert.equal(buffer.subarray(1,4).toString(),'PNG');return [buffer.readUInt32BE(16),buffer.readUInt32BE(20)];}
assert.deepEqual(pngDimensions(terrain),[32,32],'Sunnyside terrain crops stay exact 16px grid');
assert.deepEqual(pngDimensions(furniture),[32,16],'furniture source uses exact 16px frames');

const draws=[];
const fakeWindow={BrowserQuestSunnysideLayout:layout, Image:class {
 set src(value){this.url=value;if(this.onload)this.onload();}
}};
vm.runInNewContext(read('client/js/sunnyside-art.js'),{window:fakeWindow});
const r={
 game:{map:{width:172,height:314,doors:mapData.doors,isLoaded:true}},
 tilesize:16,scale:2,background:{},
 invalidateTerrainCache(){this.invalidated=(this.invalidated||0)+1;},
 renderStaticCanvases(){this.redraws=(this.redraws||0)+1;}
};
fakeWindow.BrowserQuestSunnysideArt.attach(r);
assert.equal(r.invalidated,2,'each atlas load invalidates chunk cache');
const ctx={drawImage(...args){draws.push(args);}};
const paint=(tileId,x,y)=>fakeWindow.BrowserQuestSunnysideArt.paintTile(r,ctx,tileId-1,x+y*172,172);
assert.equal(paint(15,14,210),true,'grass is overlaid');
assert.equal(paint(179,3,209),true,'water is overlaid');
assert.equal(paint(1487,153,138),true,'interior floor within house');
assert.equal(paint(1487,130,138),false,'interior floor not painted across other maps');
assert.equal(paint(4,1,1),false,'unknown tiles preserve original pixels');
assert.equal(fakeWindow.BrowserQuestSunnysideArt.decorate(r,ctx,152+138*172,172),true,'bed drawn');
assert.equal(fakeWindow.BrowserQuestSunnysideArt.decorate(r,ctx,156+139*172,172),true,'cabinet drawn');
assert.equal(fakeWindow.BrowserQuestSunnysideArt.decorate(r,ctx,154+140*172,172),true,'walkable carpet drawn');
assert(draws.every(args=>args.length===9&&args[3]===16&&args[4]===16&&args[7]===32&&args[8]===32),
 'pixel art must remain crisp 16x16 scaled to 32x32 without blur');

let ClientMap;
const context={window:fakeWindow,Class:{extend(x){function K(){}K.prototype=x;return K;}},define(deps,cb){ClientMap=cb({},function(){})}};
vm.runInNewContext(read('client/js/map.js'),context);
const c=Object.create(ClientMap.prototype);
c.width=clientMap.width;c.height=clientMap.height;c.doors=clientMap.doors.reduce((result,d)=>{
 result[d.y*c.width+d.x+1]={x:d.tx,y:d.ty};return result;
},{});c.tilesetsLoaded=true;c.mapLoaded=true;c.grid=Array.from({length:c.height},()=>Array(c.width).fill(0));
c._checkReady();
for(const f of layout.solidCells(mapData)) assert.equal(c.grid[f.y][f.x],1,
 'mobile and worker client grid must block the same furniture');
assert.equal(c.grid[inside.y][inside.x],0,'client exit still walkable');
console.log('Sunnyside: correct 16px assets, grass/water, decorated interior, reciprocal doors and collision parity passed.');
