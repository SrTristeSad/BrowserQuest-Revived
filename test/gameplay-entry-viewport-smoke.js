'use strict';

// Regression checks for the public game client; no real credentials or deployment involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const World = require('../server/js/worldserver');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// Spawn position should avoid mobs and use only accessible tiles.
const world = {
    entities: {rat1: {id: 'rat1', type: 'mob', x: 15, y: 15}},
    mobs: {rat1: {id: 'rat1', type: 'mob', x: 15, y: 15}},
    isValidPosition(x, y) {
        return x > 0 && y > 0 && x < 30 && y < 30;
    }
};
const safe = World.prototype.findSafeSpawnPosition.call(world, {x: 15, y: 15}, 'player');
assert(world.isValidPosition(safe.x, safe.y), 'safe spawn must be walkable');
assert(Math.max(Math.abs(safe.x - 15), Math.abs(safe.y - 15)) >= 6,
    'safe spawn must not be in rat attack range');
assert(Math.abs(safe.x - 15) + Math.abs(safe.y - 15) <= 10,
    'safe spawn must remain near selected starting position');
world.mobs = {};
assert.deepEqual(World.prototype.findSafeSpawnPosition.call(world, {x: 15, y: 15}, 'player'),
    {x: 15, y: 15}, 'normal spawn should remain unchanged without nearby mobs');
world.mobs = {rat1: {id: 'rat1', type: 'mob', x: 15, y: 15}};
world.isValidPosition = (x, y) => x === 15 && y === 15;
assert.deepEqual(World.prototype.findSafeSpawnPosition.call(world, {x: 15, y: 15}, 'player'),
    {x: 15, y: 15}, 'blocked maps must not invent unreachable spawn positions');

// The shipped game must not depend on a local/secret config JSON to start.
let config;
vm.runInNewContext(read('client/js/config.js'), {
    window: {location: {hostname: 'example.test', protocol: 'https:', port: ''}},
    define(factory) { config = factory(); }
});
assert.equal(config.dev.host, 'example.test');
assert.equal(config.dev.port, 443);
assert.equal(config.build.dispatcher, false);

// Viewport scales the entire existing frame, keeping the aspect ratio intact.
const container = {
    offsetWidth: 980, offsetHeight: 504,
    style: {setProperty(name, value) { this[name] = value; }}
};
let onResize, onBodyMutation;
const browser = {
    innerWidth: 1600, innerHeight: 900,
    addEventListener(type, handler) { if(type === 'resize') { onResize = handler; } }
};
const document = {
    readyState: 'complete',
    body: {classList: {contains(name) { return name === 'game'; }}},
    getElementById(name) { return name === 'container' ? container : null; }
};
function MutationObserver(callback) {
    onBodyMutation = callback;
    this.observe = function() {};
}
vm.runInNewContext(read('client/js/viewport.js'), {
    document, window: browser, MutationObserver
});
assert(Math.abs(Number(container.style['--bq-viewport-scale']) - (1592 / 980)) < 0.001,
    'the game should grow to nearly fill the desktop width');
browser.innerWidth = 1000;
onResize();
assert(Math.abs(Number(container.style['--bq-viewport-scale']) - (992 / 980)) < 0.001,
    'frame must re-fit on browser resize');
assert.equal(typeof onBodyMutation, 'function');

// Mouse coordinates must follow the scaled foreground canvas instead of old offsets.
let App;
const foreground = {
    getBoundingClientRect() { return {left:100, top: 50, width:1440, height:672}; }
};
vm.runInNewContext(read('client/js/app.js'), {
    Class: {extend(methods) { function C() {} C.prototype = methods; return C; }},
    define(dependencies, factory) { App = factory(function() {}, function Storage() {}); },
    document: {getElementById() { return foreground; }},
    window: {pageXOffset:0, pageYOffset:0}
});
const game = {
    renderer: {getWidth(){return 960;}, getHeight(){return 448;}},
    mouse: {x:0, y:0}
};
App.prototype.setMouseCoordinates.call({game}, {clientX:820, clientY:386});
assert.equal(game.mouse.x, 480, 'pointer x must be mapped into canvas pixels');
assert.equal(game.mouse.y, 224, 'pointer y must be mapped into canvas pixels');

// Prevent regression to the reported instant-death and nonworking-revive flows.
const serverSource = read('server/js/player.js'),
      mainSource = read('client/js/main.js'),
      html = read('client/index.html');
assert(serverSource.includes('Date.now() >= self.spawnProtectedUntil'),
    'server must enforce spawn grace period while processing HURT');
assert(serverSource.includes('this.spawnProtectedUntil = Date.now() + 10000'),
    'new players and revives must receive a grace period');
assert(mainSource.includes("readyState !== WebSocket.OPEN"),
    'a closed websocket must reconnect rather than trying to revive on it');
assert(html.includes('css/viewport.css') && html.includes('js/viewport.js'),
    'viewport resources must be loaded on the real page');
console.log('Game entry, spawn, revive, and viewport smoke tests passed');
