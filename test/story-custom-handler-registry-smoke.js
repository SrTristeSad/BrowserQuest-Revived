'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    RegistryModule = require('../server/story/custom-handler-registry'),
    CustomHandlerRegistry = RegistryModule.CustomHandlerRegistry,
    StoryRuntime = require('../server/story/runtime').StoryRuntime;

function publishedStore() {
    return {
        getPublishedStories: function() {
            return [{
                id: 'custom-story',
                title: 'Custom seguro',
                status: 'published',
                entryMissionId: 'registered',
                chapters: [{
                    id: 'chapter',
                    order: 1,
                    missions: [
                        {
                            id: 'registered',
                            order: 1,
                            title: 'Registrados',
                            objective: {type: 'custom', target: 'server_objective'},
                            rewards: [{type: 'custom', value: 'server_reward', amount: 1}]
                        },
                        {
                            id: 'missing',
                            order: 2,
                            title: 'Ausentes',
                            objective: {type: 'custom', target: 'missing_objective'},
                            rewards: [{type: 'custom', value: 'missing_reward', amount: 1}]
                        },
                        {
                            id: 'invalid',
                            order: 3,
                            title: 'Inválidos',
                            objective: {type: 'custom', target: '../../escape'},
                            rewards: [{type: 'custom', value: 'handler();', amount: 1}]
                        }
                    ]
                }]
            }];
        }
    };
}

function main() {
    var executions = 0,
        objectiveHandler = function() { executions += 1; },
        rewardHandler = function() { executions += 1; },
        registry = new CustomHandlerRegistry({
            objective: {server_objective: objectiveHandler},
            reward: {server_reward: rewardHandler}
        }),
        runtime = new StoryRuntime(publishedStore(), {customHandlers: registry}),
        diagnostics = runtime.getDiagnostics(),
        root = path.join(__dirname, '..'),
        registrySource = fs.readFileSync(path.join(root, 'server', 'story', 'custom-handler-registry.js'), 'utf8'),
        runtimeSource = fs.readFileSync(path.join(root, 'server', 'story', 'runtime.js'), 'utf8');

    assert.deepStrictEqual(RegistryModule.HANDLER_KINDS, ['objective', 'reward']);
    assert.strictEqual(RegistryModule.parseHandlerId('safe-handler_2'), 'safe-handler_2');
    assert.strictEqual(RegistryModule.parseHandlerId(' safe-handler_2 '), 'safe-handler_2');
    assert.strictEqual(RegistryModule.parseHandlerId('../../module'), null);
    assert.strictEqual(RegistryModule.parseHandlerId('handler();'), null);
    assert.strictEqual(RegistryModule.parseHandlerId('{"handler":"x"}'), null);
    assert.strictEqual(RegistryModule.parseHandlerId('folder/file'), null);
    assert.strictEqual(RegistryModule.parseHandlerId('__proto__'), null);
    assert.strictEqual(RegistryModule.parseHandlerId('constructor'), null);
    assert.strictEqual(RegistryModule.parseHandlerId('prototype'), null);
    assert.strictEqual(RegistryModule.parseHandlerId('x'.repeat(121)), null);
    assert.strictEqual(RegistryModule.parseHandlerId(123), null);

    assert.strictEqual(Object.isFrozen(registry), true, 'registry instance must be immutable after construction');
    assert.strictEqual(typeof registry.register, 'undefined', 'runtime registry must expose no mutation/register API');
    assert.deepStrictEqual(registry.list('objective'), ['server_objective']);
    assert.deepStrictEqual(registry.list('reward'), ['server_reward']);
    assert.deepStrictEqual(registry.snapshot(), {objective: ['server_objective'], reward: ['server_reward']});
    assert.strictEqual(registry.resolve('objective', 'server_objective'), objectiveHandler);
    assert.strictEqual(registry.resolve('reward', 'server_reward'), rewardHandler);
    assert.strictEqual(registry.resolve('objective', 'server_reward'), null, 'objective/reward namespaces must remain distinct');
    assert.strictEqual(registry.resolve('reward', '../../escape'), null);
    assert.strictEqual(registry.resolve('script', 'server_reward'), null);
    assert.strictEqual(executions, 0, 'resolving handlers must never execute them');

    assert.throws(function() {
        return new CustomHandlerRegistry({script: {bad: function() {}}});
    }, /Unknown custom handler kind/);
    assert.throws(function() {
        return new CustomHandlerRegistry({objective: {'../bad': function() {}}});
    }, /Invalid custom handler id/);
    assert.throws(function() {
        return new CustomHandlerRegistry({reward: {constructor: function() {}}});
    }, /Invalid custom handler id/);
    assert.throws(function() {
        return new CustomHandlerRegistry({reward: {not_a_function: 'code()'}});
    }, /must be a function/);
    assert.throws(function() {
        return new StoryRuntime(publishedStore(), {customHandlers: {resolve: function() {}}});
    }, /CustomHandlerRegistry/);

    assert.strictEqual(runtime.hasCustomHandler('objective', 'server_objective'), true);
    assert.strictEqual(runtime.hasCustomHandler('reward', 'server_reward'), true);
    assert.strictEqual(runtime.resolveCustomHandler('objective', 'server_objective'), objectiveHandler);
    assert.deepStrictEqual(runtime.listCustomHandlers('reward'), ['server_reward']);
    assert.strictEqual(executions, 0, 'StoryRuntime construction and lookup must not execute custom handlers');

    assert.strictEqual(diagnostics.some(function(item) {
        return item.code.indexOf('custom_') >= 0 && item.target === 'server_objective';
    }), false, 'registered objective handler must not produce a diagnostic');
    assert.strictEqual(diagnostics.some(function(item) {
        return item.code.indexOf('custom_') >= 0 && item.target === 'server_reward';
    }), false, 'registered reward handler must not produce a diagnostic');
    assert.ok(diagnostics.some(function(item) {
        return item.code === 'missing_custom_objective_handler' && item.target === 'missing_objective' && item.missionId === 'missing';
    }), 'unknown custom objective handler must be diagnosed');
    assert.ok(diagnostics.some(function(item) {
        return item.code === 'missing_custom_reward_handler' && item.target === 'missing_reward' && item.missionId === 'missing';
    }), 'unknown custom reward handler must be diagnosed');
    assert.ok(diagnostics.some(function(item) {
        return item.code === 'invalid_custom_objective_handler' && item.target === '../../escape' && item.missionId === 'invalid';
    }), 'path-like custom objective id must be rejected');
    assert.ok(diagnostics.some(function(item) {
        return item.code === 'invalid_custom_reward_handler' && item.target === 'handler();' && item.missionId === 'invalid';
    }), 'code-like custom reward id must be rejected');

    runtime.reload();
    assert.strictEqual(executions, 0, 'runtime reload must validate references without executing handlers');

    var emptyRuntime = new StoryRuntime(publishedStore());
    assert.strictEqual(emptyRuntime.resolveCustomHandler('objective', 'server_objective'), null, 'default runtime must start with an empty trusted registry');
    assert.ok(emptyRuntime.getDiagnostics().some(function(item) {
        return item.code === 'missing_custom_objective_handler' && item.target === 'server_objective';
    }), 'default empty registry must diagnose unresolved custom references');

    assert.strictEqual(registrySource.indexOf('eval('), -1, 'custom registry must never use eval');
    assert.strictEqual(registrySource.indexOf('new Function'), -1, 'custom registry must never compile text as code');
    assert.strictEqual(registrySource.indexOf('require('), -1, 'custom registry must never dynamically load modules');
    assert.strictEqual(registrySource.indexOf('JSON.parse'), -1, 'custom registry must never interpret JSON payloads');
    assert.strictEqual(registrySource.indexOf('fs.'), -1, 'custom registry must not resolve filesystem paths');
    assert.ok(runtimeSource.indexOf('resolveCustomHandler') !== -1, 'StoryRuntime must expose only server-side registry resolution');
    assert.strictEqual(runtimeSource.indexOf('eval('), -1);
    assert.strictEqual(runtimeSource.indexOf('new Function'), -1);

    console.log('Story custom handler registry security smoke test passed.');
}

main();
