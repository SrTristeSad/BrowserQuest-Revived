'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let Renderer;
const source = fs.readFileSync(path.join(__dirname, '../client/js/renderer.js'), 'utf8');
const fakeCamera = function(renderer) {
    this.renderer = renderer;
    this.gridW = 30;
    this.gridH = 14;
    this.rescale = function() {};
};
const fakeClass = {extend(methods) {
    function Thing() { if(this.init) { this.init.apply(this, arguments); } }
    Thing.prototype = methods;
    return Thing;
}};
const ctx = () => ({imageSmoothingEnabled:true, mozImageSmoothingEnabled:true,
    webkitImageSmoothingEnabled:true, msImageSmoothingEnabled:true});
const makeCanvas = () => {
    const context = ctx();
    return {width:0, height:0, style:{}, getContext(){return context;}, context};
};
vm.runInNewContext(source, {
    Class:fakeClass, Camera:fakeCamera,
    Timer:function(){},
    Detect:{isWindows(){return true;}, isTablet(){return false;}},
    window:{innerWidth:1280,innerHeight:800},
    log:{debug(){},info(){}},
    define(dependencies, factory) { Renderer = factory(fakeCamera,{}, {}, {}, function(){}); }
});
const game = {};
const front=makeCanvas(), background=makeCanvas(), foreground=makeCanvas();
const renderer = new Renderer(game,front,background,foreground);
assert.equal(front.width,960);
assert.equal(front.height,448);
for(const canvas of [front,background,foreground]){
    for(const key of ['imageSmoothingEnabled','mozImageSmoothingEnabled',
        'webkitImageSmoothingEnabled','msImageSmoothingEnabled']){
        assert.equal(canvas.context[key],false,key+' must be disabled on every layer');
    }
    assert.equal(canvas.style.imageRendering,'pixelated');
}
assert.equal(fs.readFileSync(path.join(__dirname,'../client/js/main.js'),'utf8')
    .includes("window.addEventListener('resize'"),true);
console.log('Modern crisp Canvas2D layer and browser resize smoke passed.');
