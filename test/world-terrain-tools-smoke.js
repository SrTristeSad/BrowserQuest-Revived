'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    vm = require('vm');

var source = fs.readFileSync(path.join(__dirname, '..', 'server', 'admin', 'public', 'world-editor.html'), 'utf8'),
    match = source.match(/<script id="terrainTools">([\s\S]*?)<\/script>/),
    context = {window: {}},
    tools,
    data,
    result,
    before,
    large;

assert(match, 'World Editor should expose the terrain algorithm block');
vm.runInNewContext(match[1], context, {filename: 'world-editor-terrain-tools.js'});
tools = context.window.WorldTerrainTools;
assert(tools, 'terrain tools should initialize');

assert.strictEqual(tools.validGrid([1, 2, 3, 4], 2, 2), true);
assert.strictEqual(tools.validGrid([1, 2, 3], 2, 2), false, 'grid length must equal width * height');
assert.strictEqual(tools.validGrid([1, -2, 3, 4], 2, 2), false, 'terrain values below -1 are inconsistent');

result = tools.rectangleBounds({x: 4, y: 3}, {x: 1, y: 1}, 5, 4);
assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {x: 1, y: 1, x2: 4, y2: 3, width: 4, height: 3});
result = tools.rectangleBounds({x: -9, y: -2}, {x: 99, y: 99}, 5, 4);
assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {x: 0, y: 0, x2: 4, y2: 3, width: 5, height: 4}, 'selection should clamp to map bounds');

data = [0,0,0,0,0,0,0,0,0,0,0,0];
result = tools.paintRectangle(data, 4, 3, {x: 1, y: 1}, {x: 3, y: 2}, 7);
assert.strictEqual(result.ok, true);
assert.strictEqual(result.changed, 6);
assert.deepStrictEqual(data, [0,0,0,0,0,7,7,7,0,7,7,7]);
result = tools.paintRectangle(data, 4, 3, {x: 1, y: 1}, {x: 3, y: 2}, -1);
assert.strictEqual(result.changed, 6, 'rectangle eraser should use the legacy empty marker');
assert.deepStrictEqual(data, [0,0,0,0,0,-1,-1,-1,0,-1,-1,-1]);

data = [1,1,9,1,9,9,2,2,9];
result = tools.floodFill(data, 3, 3, {x: 0, y: 0}, 5);
assert.strictEqual(result.ok, true);
assert.strictEqual(result.changed, 3);
assert.deepStrictEqual(data, [5,5,9,5,9,9,2,2,9], 'fill must replace only the 4-neighbour contiguous region');
result = tools.floodFill(data, 3, 3, {x: 0, y: 0}, 5);
assert.strictEqual(result.changed, 0, 'repeating the same fill should be a no-op');

before = [1,1,1];
data = before.slice();
result = tools.floodFill(data, 2, 2, {x: 0, y: 0}, 8);
assert.strictEqual(result.ok, false);
assert.strictEqual(result.reason, 'invalid_grid');
assert.deepStrictEqual(data, before, 'invalid grids must not be partially mutated');

large = new Array(10000).fill(3);
result = tools.floodFill(large, 100, 100, {x: 50, y: 50}, 4);
assert.strictEqual(result.ok, true);
assert.strictEqual(result.changed, 10000, 'fill should safely handle the entire bounded grid');
assert(large.every(function(value) { return value === 4; }));

var algorithmSource = match[1],
    floodStart = algorithmSource.indexOf('function floodFill('),
    floodEnd = algorithmSource.indexOf('return{validGrid', floodStart),
    floodSource = algorithmSource.slice(floodStart, floodEnd);
assert(floodStart >= 0, 'floodFill should exist');
assert(floodSource.includes('new Int32Array(total)'), 'fill should use a bounded iterative queue');
assert(floodSource.includes('new Uint8Array(total)'), 'fill should bound visited cells to map size');
assert.strictEqual((floodSource.match(/floodFill\s*\(/g) || []).length, 1, 'flood fill must not recurse');

console.log('World Editor terrain selection and iterative flood-fill algorithm tests passed.');
