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
console.log('Canvas2D standard/legacy/fallback, crisp resize and static redraw smoke passed.');
