'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../client/js/renderer.js'), 'utf8');
const browser = {innerWidth: 1280, innerHeight: 800};
const fakeCamera = function(renderer) {
    this.renderer = renderer;
    this.gridW = 30;
    this.gridH = 14;
    this.x = 0;
    this.y = 0;
    this.rescale = function() {};
};
const fakeClass = {extend(methods) {
    function Thing() { if(this.init) { this.init.apply(this, arguments); } }
    Thing.prototype = methods;
    return Thing;
}};
let Renderer;
vm.runInNewContext(source, {
    Class: fakeClass, Camera: fakeCamera,
    Timer: function(){},
    Detect: {isWindows(){return true;}, isTablet(width){return width > 700 && width <= 1000;}},
    window: browser,
    log: {debug(){}, info(){}, error(message){throw Error(message);}},
    _: {
        each(items, callback){Array.from(items).forEach(callback);},
        isUndefined(value){return value === undefined;},
        isNaN(value){return typeof value === 'number' && Number.isNaN(value);},
        isNull(value){return value === null;}
    },
    define(dependencies, factory) { Renderer = factory(fakeCamera,{}, {}, {}, function(){}); }
});

function makeCanvas(smoothingFlags) {
    const context = {
        calls: [],
        save(){this.calls.push('save');},
        restore(){this.calls.push('restore');},
        translate(){this.calls.push('translate');},
        clearRect(){this.calls.push('clear');},
        drawImage(...args){this.lastImage = args;}
    };
    Object.assign(context, smoothingFlags);
    // Assigning width/height resets the state of a real CanvasRenderingContext2D.
    const canvas = {style:{}, context, getContext(){return context;}};
    for(const dimension of ['width', 'height']) {
        let value = 0;
        Object.defineProperty(canvas, dimension, {
            get(){return value;},
            set(next){
                value = next;
                for(const flag of Object.keys(smoothingFlags)){context[flag] = true;}
            }
        });
    }
    return canvas;
}

function createRenderer(flags) {
    const front = makeCanvas(flags), background = makeCanvas(flags),
        foreground = makeCanvas(flags);
    const renderer = new Renderer({}, front, background, foreground);
    return {renderer, canvases: [front, background, foreground]};
}

function assertCrisp(canvases, flags) {
    for(const canvas of canvases) {
        for(const flag of Object.keys(flags)) {
            assert.equal(canvas.context[flag], false, flag + ' must be disabled');
        }
        assert.equal(canvas.style.imageRendering, 'pixelated');
    }
}

// Chromium, Safari and modern Firefox expose the standardized 2D property.
const modern = createRenderer({imageSmoothingEnabled:true});
assert.equal(modern.renderer.upscaledRendering, true);
assert.equal(modern.renderer.supportsSilhouettes, true);
assert.equal(modern.canvases[0].width, 960);
assert.equal(modern.canvases[0].height, 448);
assertCrisp(modern.canvases, {imageSmoothingEnabled:true});

// Earlier BrowserQuest browsers expose vendor-prefixed properties.
const legacy = createRenderer({mozImageSmoothingEnabled:true});
assert.equal(legacy.renderer.upscaledRendering, true);
assertCrisp(legacy.canvases, {mozImageSmoothingEnabled:true});

// An engine without a smoothing switch retains the pre-existing scaled-asset fallback.
const fallback = createRenderer({});
assert.equal(fallback.renderer.upscaledRendering, false);

// 1x source sprites must be scaled to the destination, not read as 2x sprites.
const sourceImage = {};
modern.renderer.drawScaledImage(modern.canvases[0].context,
    sourceImage, 1, 2, 16, 16, 5, 6);
assert.deepEqual(modern.canvases[0].context.lastImage,
    [sourceImage, 1, 2, 16, 16, 10, 12, 32, 32]);

fallback.renderer.drawScaledImage(fallback.canvases[0].context,
    sourceImage, 1, 2, 16, 16, 5, 6);
assert.deepEqual(fallback.canvases[0].context.lastImage,
    [sourceImage, 2, 4, 32, 32, 10, 12, 32, 32]);

// Camera moves must clear the previous static terrain before drawing the new view.
modern.renderer.drawTerrain = function(){
    modern.canvases[1].context.calls.push('terrain');
};
modern.renderer.renderStaticCanvases();
assert.deepEqual(modern.canvases[1].context.calls.slice(0, 4),
    ['clear', 'save', 'translate', 'terrain']);

// Resizing clears Canvas context state. Smoothing must be reapplied on every layer.
browser.innerWidth = 900;
modern.renderer.rescale(modern.renderer.getScaleFactor());
assert.equal(modern.renderer.mobile, true);
assert.equal(modern.renderer.tablet, true);
assertCrisp(modern.canvases, {imageSmoothingEnabled:true});
browser.innerWidth = 1280;
modern.renderer.rescale(modern.renderer.getScaleFactor());
assert.equal(modern.renderer.tablet, false);
assertCrisp(modern.canvases, {imageSmoothingEnabled:true});

assert.equal(fs.readFileSync(path.join(__dirname, '../client/js/main.js'), 'utf8')
    .includes("window.addEventListener('resize'"), true);


// Chunked static terrain must preserve tile order while drawing only regions
// visible around the camera. Simulated Canvas2D operations are deterministic.
const terrainContexts = [];
function terrainCanvas() {
    const context = {
        imageSmoothingEnabled: true,
        draws: [],
        clearCount: 0,
        save(){}, restore(){}, translate(){},
        clearRect(){this.clearCount += 1;},
        drawImage(...args){this.draws.push(args);}
    };
    return {width:0, height:0, style:{}, context, getContext(){return context;}};
}
let offscreenCreated = 0;
const terrainDocument = {
    createElement(tag) {
        assert.equal(tag, 'canvas');
        offscreenCreated += 1;
        const canvas = terrainCanvas();
        terrainContexts.push(canvas.context);
        return canvas;
    }
};
const terrainBrowser = {innerWidth:1280, innerHeight:800};
const terrainCamera = function(renderer) {
    this.renderer = renderer;
    this.gridW = 10;
    this.gridH = 8;
    this.gridX = 0;
    this.gridY = 0;
    this.x = 0;
    this.y = 0;
    this.rescale = function() {};
};
let TerrainRenderer;
vm.runInNewContext(source, {
    Class:fakeClass, Camera:terrainCamera, Timer:function(){},
    Detect:{isWindows(){return true;}, isTablet(width){return width <= 1000;}},
    window:terrainBrowser, document:terrainDocument,
    log:{debug(){},info(){},error(message){throw Error(message);}},
    _: {
        each(values,callback){Array.from(values).forEach(callback);},
        isUndefined(value){return value === undefined;},
        isNaN(value){return typeof value === 'number' && Number.isNaN(value);},
        isNull(value){return value === null;}
    },
    define(dependencies,factory){TerrainRenderer = factory(terrainCamera,{}, {}, {}, function(){});}
});
const terrainMap = {
    width:160, height:160, tilesize:16, isLoaded:true,
    data:new Array(160 * 160).fill(1),
    isHighTile(id){return id === 1;},
    isAnimatedTile(id){return id === 2;}
};
terrainMap.data[1] = [1, 2, 3, 0]; // regular, high, animated and empty
const terrainGame = {
    map:terrainMap,
    forEachVisibleTile(callback) {
        const c = terrainRenderer.camera;
        for(let y = Math.max(0,c.gridY-1); y <= c.gridY+c.gridH; y++) {
            for(let x = Math.max(0,c.gridX-1); x <= c.gridX+c.gridW; x++) {
                const index = y * terrainMap.width + x;
                const values = terrainMap.data[index];
                for(const id of (Array.isArray(values) ? values : [values])) {
                    callback(Number(id)-1, index);
                }
            }
        }
    }
};
const terrainFront=terrainCanvas(), terrainBack=terrainCanvas(), terrainTop=terrainCanvas();
const terrainRenderer = new TerrainRenderer(terrainGame,terrainFront,terrainBack,terrainTop);
terrainRenderer.setTileset({width:256});
terrainRenderer.renderStaticCanvases();
assert.equal(offscreenCreated, 4, 'first viewport creates only four 8x8 regions');
assert.equal(terrainBack.context.draws.length, 4, 'four cached regions composited');
assert.equal(terrainContexts.reduce((sum,ctx)=>sum+ctx.draws.length,0), 256,
    'stacked high/animated/empty tiles do not become static terrain');
assert(terrainContexts.every(ctx => ctx.imageSmoothingEnabled === false),
    'all offscreen chunk contexts must use nearest-neighbor sampling');
assert.equal(terrainContexts[0].draws[0][5], 0);
assert.equal(terrainContexts[0].draws[0][7], 32,
    'each tile must retain its 16px geometry at 2x scale');
const firstFrame = offscreenCreated;
terrainRenderer.renderStaticCanvases();
assert.equal(offscreenCreated, firstFrame, 'revisit must reuse cached static chunks');
assert.equal(terrainBack.context.clearCount, 2, 'old terrain gets cleared on redraw');

terrainRenderer.camera.gridX = 16;
terrainRenderer.renderStaticCanvases();
assert.equal(offscreenCreated, firstFrame + 4,
    'moving camera generates only newly visible regions');
assert.equal(terrainBack.context.draws.length, 14,
    'camera draws the correct regions after scrolling');

// All 24 slots are recycled when traveling through a large map.
for(let x = 0; x <= 128; x += 8) {
    terrainRenderer.camera.gridX = x;
    terrainRenderer.renderStaticCanvases();
}
assert(terrainRenderer.terrainChunkOrder.length <= 24,
    'the terrain LRU must have bounded memory');
assert.equal(Object.keys(terrainRenderer.terrainChunks).length,
    terrainRenderer.terrainChunkOrder.length);

// Replacing the underlying tile data must invalidate cached renderings.
const beforeDataChange = offscreenCreated;
terrainMap.data = terrainMap.data.slice();
terrainRenderer.renderStaticCanvases();
assert(offscreenCreated > beforeDataChange);
assert(terrainRenderer.terrainChunkOrder.length <= 24);

// Changing viewport scale drops old textures and retains sharp pixels.
terrainBrowser.innerWidth = 900;
terrainRenderer.rescale(2);
assert.equal(terrainRenderer.terrainChunkOrder.length,0);
assert.equal(terrainRenderer.tablet,true);
assert.equal(terrainFront.context.imageSmoothingEnabled,false);
terrainBrowser.innerWidth = 1280;

// Replacing map content through its existing loader invalidates the cache.
let MapClass;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../client/js/map.js'),'utf8'), {
    Class:fakeClass,
    define(dependencies,factory){MapClass = factory({},function(){});}
});
terrainRenderer.terrainChunks.test = terrainCanvas();
terrainRenderer.terrainChunkOrder.push('test');
MapClass.prototype._initMap.call({
    game:{renderer:terrainRenderer},
    _getDoors(){return {};},_getCheckpoints(){return [];}
}, {width:1,height:1,tilesize:16,data:[1]});
assert.equal(terrainRenderer.terrainChunkOrder.length,0,
    'map loads must invalidate the terrain cache');

// Terrain may be requested before the first world has finished loading.
terrainRenderer.game.map = null;
assert.doesNotThrow(() => terrainRenderer.drawTerrain());
terrainRenderer.game.map = terrainMap;

// No offscreen Canvas2D support must preserve the original painter.
terrainDocument.createElement = function(){return null;};
terrainRenderer.camera.gridX = 0;
terrainRenderer.drawTerrain();
assert(terrainBack.context.draws.length > 14,
    'the original renderer remains available as a fallback');

console.log('Canvas2D browser compatibility, bounded terrain regions, layering and invalidation smoke passed.');
