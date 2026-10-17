'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    StoryStore = require('../server/admin/story-store').StoryStore,
    StoryRuntime = require('../server/story/runtime').StoryRuntime,
    CustomHandlerRegistry = require('../server/story/custom-handler-registry').CustomHandlerRegistry,
    CustomObjective = require('../server/story/custom-objective-service');

function stateFor(missionId, progress) {
    return {
        version: 1,
        storyId: 'custom-story',
        activeMissionId: missionId,
        objectiveProgress: progress || 0,
        completedMissionIds: [],
        flags: {met_guard: true},
        startedAt: '2026-10-17T12:00:00.000Z',
        updatedAt: '2026-10-17T12:00:00.000Z'
    };
}

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-custom-objective-')),
        store = new StoryStore(path.join(dir, 'stories.json')),
        safeCalls = 0,
        capturedContext = null,
        registry,
        runtime;

    try {
        registry = new CustomHandlerRegistry({
            objective: {
                safe_counter: function(context) {
                    safeCalls += 1;
                    capturedContext = context;
                    return {progress: context.event.data.total};
                },
                throws: function() {
                    throw new Error('handler failure must be isolated');
                },
                bad_result: function() {
                    return {progress: '2'};
                },
                async_result: function() {
                    return Promise.resolve({progress: 1});
                }
            }
        });

        store.save({
            id: 'custom-story',
            title: 'Custom objectives',
            status: 'published',
            entryMissionId: 'm-safe',
            chapters: [{
                id: 'chapter',
                missions: [
                    {id: 'm-safe', objective: {type: 'custom', target: 'safe_counter', amount: 3}},
                    {id: 'm-throws', objective: {type: 'custom', target: 'throws', amount: 2}},
                    {id: 'm-bad', objective: {type: 'custom', target: 'bad_result', amount: 2}},
                    {id: 'm-async', objective: {type: 'custom', target: 'async_result', amount: 2}},
                    {id: 'm-missing', objective: {type: 'custom', target: 'not_registered', amount: 2}},
                    {id: 'm-talk', objective: {type: 'talk', target: 'npc-1', amount: 1}}
                ]
            }]
        });

        runtime = new StoryRuntime(store, {customHandlers: registry});

        var originalData = {total: 2, source: 'server'},
            event = CustomObjective.buildEvent('quest_signal', originalData);
        assert.ok(event, 'valid data-only server event must be accepted');
        assert.strictEqual(Object.isFrozen(event), true);
        assert.strictEqual(Object.isFrozen(event.data), true);
        assert.notStrictEqual(event.data, originalData, 'handler event data must be copied');
        assert.strictEqual(CustomObjective.buildEvent('bad.event', {}), null, 'event type must be a safe id');
        assert.strictEqual(CustomObjective.buildEvent('quest_signal', {bad: function() {}}), null, 'functions must never enter handler context');
        assert.strictEqual(CustomObjective.buildEvent('quest_signal', new Date()), null, 'non-plain objects must be rejected');
        assert.strictEqual(CustomObjective.buildEvent('quest_signal', {'bad.key': 1}), null, 'unsafe data keys must be rejected');

        assert.deepStrictEqual(CustomObjective.normalizeHandlerResult({progress: 2}), {valid: true, progress: 2});
        assert.strictEqual(CustomObjective.normalizeHandlerResult({progress: -1}).valid, false);
        assert.strictEqual(CustomObjective.normalizeHandlerResult({progress: 1, extra: true}).valid, false);
        assert.strictEqual(CustomObjective.normalizeHandlerResult(Promise.resolve({progress: 1})).reason, 'async_result');

        var savedCalls = [],
            progressStore = {
                save: async function(characterId, storyId, state) {
                    savedCalls.push({characterId: characterId, storyId: storyId, state: state});
                    return state;
                }
            },
            result = await CustomObjective.progressCustomObjectives({
                runtime: runtime,
                progressStore: progressStore,
                characterId: 41,
                states: [stateFor('m-safe', 0)],
                eventType: 'quest_signal',
                eventData: originalData
            });

        assert.strictEqual(result.changed, true);
        assert.strictEqual(result.updates.length, 1);
        assert.strictEqual(result.updates[0].state.objectiveProgress, 2);
        assert.strictEqual(result.updates[0].objectiveComplete, false);
        assert.strictEqual(savedCalls.length, 1);
        assert.strictEqual(savedCalls[0].characterId, 41);
        assert.strictEqual(savedCalls[0].storyId, 'custom-story');
        assert.strictEqual(safeCalls, 1);

        assert.ok(capturedContext, 'registered handler must receive a context');
        assert.deepStrictEqual(Object.keys(capturedContext).sort(), ['event', 'flags', 'mission', 'objective', 'progress', 'story', 'version']);
        assert.strictEqual(Object.isFrozen(capturedContext), true);
        assert.strictEqual(Object.isFrozen(capturedContext.event), true);
        assert.strictEqual(Object.isFrozen(capturedContext.event.data), true);
        assert.strictEqual(Object.isFrozen(capturedContext.flags), true);
        assert.strictEqual(capturedContext.story.id, 'custom-story');
        assert.strictEqual(capturedContext.mission.id, 'm-safe');
        assert.strictEqual(capturedContext.objective.handlerId, 'safe_counter');
        assert.strictEqual(capturedContext.objective.amount, 3);
        assert.strictEqual(capturedContext.progress.current, 0);
        assert.strictEqual(capturedContext.progress.required, 3);
        assert.strictEqual(capturedContext.flags.met_guard, true);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedContext, 'player'), false);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedContext, 'connection'), false);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedContext, 'postgres'), false);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedContext, 'server'), false);

        originalData.total = 99;
        assert.strictEqual(capturedContext.event.data.total, 2, 'handler context must not share mutable event input');

        var replay = await CustomObjective.progressCustomObjectives({
            runtime: runtime,
            progressStore: progressStore,
            characterId: 41,
            states: [result.updates[0].state],
            eventType: 'quest_signal',
            eventData: {total: 2, source: 'server'}
        });
        assert.strictEqual(replay.changed, false, 'same absolute progress must be idempotent');
        assert.strictEqual(savedCalls.length, 1, 'idempotent replay must not persist again');

        var completed = await CustomObjective.progressCustomObjectives({
            runtime: runtime,
            progressStore: progressStore,
            characterId: 41,
            states: [result.updates[0].state],
            eventType: 'quest_signal',
            eventData: {total: 100}
        });
        assert.strictEqual(completed.changed, true);
        assert.strictEqual(completed.updates[0].state.objectiveProgress, 3, 'progress must be capped by objective amount');
        assert.strictEqual(completed.updates[0].objectiveComplete, true);
        assert.strictEqual(savedCalls.length, 2);

        var guest = await CustomObjective.progressCustomObjectives({
            runtime: runtime,
            states: [stateFor('m-safe', 0)],
            eventType: 'quest_signal',
            eventData: {total: 1}
        });
        assert.strictEqual(guest.changed, true, 'guest custom objective may progress in memory');
        assert.strictEqual(guest.updates[0].state.objectiveProgress, 1);

        await assert.rejects(function() {
            return CustomObjective.progressCustomObjectives({
                runtime: runtime,
                progressStore: progressStore,
                states: [stateFor('m-safe', 0)],
                eventType: 'quest_signal',
                eventData: {total: 1}
            });
        }, function(error) {
            return error && error.code === 'CHARACTER_REQUIRED';
        });

        var beforeFailures = savedCalls.length,
            thrown = await CustomObjective.progressCustomObjectives({
                runtime: runtime,
                progressStore: progressStore,
                characterId: 41,
                states: [stateFor('m-throws', 0)],
                eventType: 'quest_signal',
                eventData: {total: 1}
            }),
            bad = await CustomObjective.progressCustomObjectives({
                runtime: runtime,
                progressStore: progressStore,
                characterId: 41,
                states: [stateFor('m-bad', 0)],
                eventType: 'quest_signal',
                eventData: {total: 1}
            }),
            asyncResult = await CustomObjective.progressCustomObjectives({
                runtime: runtime,
                progressStore: progressStore,
                characterId: 41,
                states: [stateFor('m-async', 0)],
                eventType: 'quest_signal',
                eventData: {total: 1}
            }),
            missing = await CustomObjective.progressCustomObjectives({
                runtime: runtime,
                progressStore: progressStore,
                characterId: 41,
                states: [stateFor('m-missing', 0)],
                eventType: 'quest_signal',
                eventData: {total: 1}
            });

        assert.strictEqual(thrown.changed, false);
        assert.strictEqual(thrown.failures[0].reason, 'handler_error');
        assert.strictEqual(bad.changed, false);
        assert.strictEqual(bad.failures[0].reason, 'invalid_progress');
        assert.strictEqual(asyncResult.changed, false);
        assert.strictEqual(asyncResult.failures[0].reason, 'async_result');
        assert.strictEqual(missing.changed, false);
        assert.strictEqual(missing.failures[0].reason, 'missing_handler');
        assert.strictEqual(savedCalls.length, beforeFailures, 'failed custom handlers must never persist progress');

        var safeCallsBeforeInvalidEvent = safeCalls,
            invalidEvent = await CustomObjective.progressCustomObjectives({
                runtime: runtime,
                states: [stateFor('m-safe', 0)],
                eventType: 'quest_signal',
                eventData: {bad: function() {}}
            });
        assert.strictEqual(invalidEvent.changed, false);
        assert.strictEqual(invalidEvent.failures[0].reason, 'invalid_event');
        assert.strictEqual(safeCalls, safeCallsBeforeInvalidEvent, 'invalid event must be rejected before handler execution');

        var nonCustom = await CustomObjective.progressCustomObjectives({
            runtime: runtime,
            states: [stateFor('m-talk', 0)],
            eventType: 'quest_signal',
            eventData: {total: 1}
        });
        assert.strictEqual(nonCustom.changed, false, 'executor must ignore non-custom objectives');

        var queueCalls = 0,
            fakePlayer = {
                storyRuntime: runtime,
                storyProgress: null,
                characterId: null,
                storyState: [stateFor('m-safe', 0)],
                queueStoryOperation: function(operation) {
                    queueCalls += 1;
                    return Promise.resolve().then(operation);
                }
            },
            queued = await CustomObjective.queuePlayerCustomObjective(fakePlayer, 'quest_signal', {total: 2});
        assert.strictEqual(queueCalls, 1, 'player adapter must use the existing story operation queue');
        assert.strictEqual(queued.changed, true);
        assert.strictEqual(fakePlayer.storyState[0].objectiveProgress, 2, 'player adapter must update live story state only after execution');

        await assert.rejects(function() {
            return CustomObjective.queuePlayerCustomObjective({}, 'quest_signal', {total: 1});
        }, function(error) {
            return error && error.code === 'PLAYER_STORY_QUEUE_UNAVAILABLE';
        });

        var source = fs.readFileSync(path.join(__dirname, '..', 'server', 'story', 'custom-objective-service.js'), 'utf8');
        assert.strictEqual(source.indexOf('eval('), -1, 'custom executor must never eval story data');
        assert.strictEqual(source.indexOf('new Function'), -1, 'custom executor must never compile story data');
        assert.strictEqual(source.indexOf("require('fs')"), -1, 'custom executor must not receive filesystem capability');
        assert.strictEqual(source.indexOf('child_process'), -1, 'custom executor must not spawn processes');
        assert.strictEqual(source.indexOf('.connection'), -1, 'custom executor must not expose player connection to handlers');
        assert.strictEqual(source.indexOf('.server'), -1, 'custom executor must not expose mutable world server to handlers');
        assert.strictEqual(source.indexOf('process.'), -1, 'custom executor must not expose process capability');

        console.log('Safe custom objective executor smoke test passed.');
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
