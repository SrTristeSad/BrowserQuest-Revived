'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'client/js/game.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'client/js/renderer.js'), 'utf8');
let Game;

function Mob() {}
function Player() {}
const context = {
    Class: {extend(methods) {
        function GameClass() {}
        GameClass.prototype = methods;
        return GameClass;
    }},
    _: {each(items, cb) {
        Object.keys(items).forEach(key => cb(items[key]));
    }},
    Types: {getKindAsString() {return 'rat';}},
    log: {error(message) {throw new Error(message);}},
    define(deps, factory) {
        const args = deps.map(name => {
            if(name === 'mob') return Mob;
            if(name === 'player') return Player;
            return function Stub() {};
        });
        Game = factory(...args);
    }
};
vm.runInNewContext(source, context, {filename:'client/js/game.js'});
assert.equal(typeof Game.prototype.setSpriteScale, 'function');
assert(renderer.includes('this.game.setSpriteScale(this.scale)'),
    'renderer must continue to rebind sprites after an actual resize');

function makeGame(upscaled) {
    const game = Object.create(Game.prototype);
    game.renderer = {upscaledRendering:upscaled};
    game.sprites = {};
    game.entities = {};
    game.cursorCalls = 0;
    game.initHurtSprites = function() {this.hurtCalls=(this.hurtCalls||0)+1};
    game.initShadows = function() {this.shadowCalls=(this.shadowCalls||0)+1};
    game.initCursors = function() {this.cursorCalls++};
    return game;
}

for(const upscaled of [false,true]) {
    const game=makeGame(upscaled);
    // Exactly the browser error: resize before Game.run -> loadSprites().
    assert.doesNotThrow(()=>game.setSpriteScale(2),
        'resize before sprite load must never access undefined spritesets[0]');
    assert.deepEqual(Object.keys(game.sprites),[],
        'preload resize must not invent or overwrite sprite data');
    assert.equal(game.cursorCalls,0,
        'no sprite-dependent initialization before sprites actually exist');

    const mob = new Mob();
    mob.id = 71;
    mob.kind = 4;
    mob.getSpriteName = () => 'rat';
    mob.setSprite = sprite => {mob.sprite=sprite};
    game.entities[mob.id]=mob;

    const sprite={name:'rat',isLoaded:true};
    game.spritesets = [{rat:sprite},{rat:sprite},{rat:sprite}];
    assert.doesNotThrow(()=>game.setSpriteScale(2),
        'once catalog exists resizing should continue to rebind visible mobs');
    assert.equal(game.sprites.rat,sprite);
    if(!upscaled) {
        assert.equal(mob.sprite,sprite,'existing mob must not disappear on rescale');
        assert.equal(game.cursorCalls,1);
        assert.equal(game.hurtCalls,1);
    }
    assert.doesNotThrow(()=>game.setSpriteScale(3));
    assert.equal(game.sprites.rat,sprite);
    if(!upscaled) {
        assert.equal(mob.sprite,sprite);
    }
}
console.log('Early browser resize before sprites are loaded and late sprite rebind smoke tests passed.');
