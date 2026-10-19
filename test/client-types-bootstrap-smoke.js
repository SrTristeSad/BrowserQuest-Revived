'use strict';
// The home AMD dependency list must load global Types before storyui imports
// gameclient -> entityfactory, which constructs builders using Types immediately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const seen = [];
let authScript;
const sandbox = {
    window: {BQAuthReady: Promise.resolve()},
    Promise,
    document: {
        createElement: () => ({}),
        head: {appendChild(node) {
            if(node.src === 'js/auth-ui.js') authScript = node;
        }}
    },
    log: {error(message) {throw new Error(message);}}
};
sandbox.define = function(dependencies, factory) {
    assert(dependencies.includes('../../shared/js/gametypes'),
        'home must load shared gametypes before starting the client');
    vm.runInNewContext(read('shared/js/gametypes.js'), sandbox, {filename:'gametypes.js'});
    assert.equal(sandbox.Types.Entities.WARRIOR, 1);
    factory();
};
sandbox.require = function(modules, callback) {
    seen.push(modules[0]);
    if(modules[0] === 'storyui') {
        sandbox.define = function(deps, construct) {
            const stub = {Rat:function(){}, Skeleton:function(){}};
            const value = construct(stub, {}, {}, function(){}, function(){});
            assert.equal(typeof value.builders[sandbox.Types.Entities.WARRIOR], 'function');
        };
        vm.runInNewContext(read('client/js/entityfactory.js'), sandbox,
            {filename:'entityfactory.js'});
    }
    if(callback) callback();
};
vm.runInNewContext(read('client/js/home.js'), sandbox, {filename:'home.js'});
assert(authScript && typeof authScript.onload === 'function');
(async () => {
    authScript.onload();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, ['storyui', 'main']);
    console.log('Client Types bootstrap smoke passed: entityfactory initializes before PLAY.');
})().catch(error => {console.error(error);process.exitCode = 1;});
