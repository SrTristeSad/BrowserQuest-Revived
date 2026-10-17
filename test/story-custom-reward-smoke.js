'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    CustomHandlerRegistry = require('../server/story/custom-handler-registry').CustomHandlerRegistry,
    CustomReward = require('../server/story/custom-reward-service'),
    ItemRewards = require('../server/story/item-reward-store'),
    MissionCompletion = require('../server/story/mission-completion');

function mission(id, rewards) {
    return {
        storyId: 'custom-reward-story',
        chapterId: 'chapter-one',
        mission: {
            id: id,
            giverNpc: 'captain',
            objective: {type: 'talk', target: 'captain', amount: 1},
            rewards: rewards
        }
    };
}

function activeState(missionId) {
    return {
        version: 1,
        storyId: 'custom-reward-story',
        activeMissionId: missionId,
        objectiveProgress: 1,
        completedMissionIds: ['older-mission'],
        flags: {ready: true},
        startedAt: '2026-10-17T12:00:00.000Z',
        updatedAt: '2026-10-17T12:00:00.000Z'
    };
}

async function main() {
    var root = path.join(__dirname, '..'),
        capturedContext = null,
        bundleCalls = 0,
        registry = new CustomHandlerRegistry({
            reward: {
                bundle: function(context) {
                    bundleCalls += 1;
                    capturedContext = context;
                    return {
                        effects: [
                            {type: 'item', value: 'FLASK', amount: 2},
                            {type: 'achievement', value: '17', amount: 99},
                            {type: 'story_flag', value: 'opened_gate', amount: 50}
                        ]
                    };
                },
                throws: function() {
                    throw new Error('custom reward failure');
                },
                async_reward: function() {
                    return Promise.reject(new Error('async handlers are invalid'));
                },
                bad_item: function() {
                    return {effects: [{type: 'item', value: 'chest', amount: 1}]};
                },
                too_many: function() {
                    return {effects: Array.from({length: 11}, function() {
                        return {type: 'story_flag', value: 'flag_ok'};
                    })};
                }
            }
        }),
        missionMap = {
            'reward-bundle': mission('reward-bundle', [
                {type: 'story_flag', value: 'base_flag', amount: 1},
                {type: 'custom', value: 'bundle', amount: 4},
                {type: 'achievement', value: '3', amount: 1}
            ]),
            'reward-bad': mission('reward-bad', [
                {type: 'custom', value: 'bad_item', amount: 1}
            ]),
            'reward-throws': mission('reward-throws', [
                {type: 'custom', value: 'throws', amount: 1}
            ]),
            'reward-async': mission('reward-async', [
                {type: 'custom', value: 'async_reward', amount: 1}
            ]),
            'reward-missing': mission('reward-missing', [
                {type: 'custom', value: 'not_registered', amount: 1}
            ])
        },
        runtime = {
            getMission: function(storyId, missionId) {
                if(storyId !== 'custom-reward-story') { return null; }
                return missionMap[missionId] || null;
            },
            resolveCustomHandler: function(kind, id) {
                return registry.resolve(kind, id);
            }
        },
        completionState = {
            storyId: 'custom-reward-story',
            activeMissionId: '',
            objectiveProgress: 0,
            completedMissionIds: ['older-mission', 'reward-bundle'],
            flags: {ready: true}
        };

    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: []}).valid, true);
    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: [], extra: true}).reason, 'invalid_result');
    assert.strictEqual(CustomReward.normalizeHandlerResult(Promise.resolve({effects: []})).reason, 'async_result');
    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: [{type: 'item', value: 'flask', extra: true}]}).reason, 'effect_unknown_field');
    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: [{type: 'custom', value: 'anything'}]}).reason, 'effect_unknown_type');
    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: [{type: 'item', value: 'flask', amount: 1.5}]}).reason, 'effect_invalid_amount');
    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: [{type: 'item', value: 'chest'}]}).reason, 'not_rewardable_item');
    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: [{type: 'achievement', value: '21'}]}).reason, 'unknown_achievement');
    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: [{type: 'story_flag', value: 'bad.flag'}]}).reason, 'invalid_story_flag');
    assert.strictEqual(CustomReward.normalizeHandlerResult({effects: Array.from({length: 11}, function() { return {type: 'story_flag', value: 'okay'}; })}).reason, 'too_many_effects');

    var expanded = CustomReward.expandCustomRewards({
        runtime: runtime,
        missionEntry: missionMap['reward-bundle'],
        state: completionState,
        rewards: missionMap['reward-bundle'].mission.rewards
    });

    assert.deepStrictEqual(expanded.rewards, [
        {type: 'story_flag', value: 'base_flag', amount: 1},
        {type: 'item', value: 'flask', amount: 2},
        {type: 'achievement', value: '17', amount: 1},
        {type: 'story_flag', value: 'opened_gate', amount: 1},
        {type: 'achievement', value: '3', amount: 1}
    ], 'custom effects must be expanded in deterministic source/effect order and canonicalized');
    assert.deepStrictEqual(expanded.executions, [{handlerId: 'bundle', rewardIndex: 1, effectCount: 3}]);
    assert.strictEqual(bundleCalls, 1);

    assert.ok(capturedContext, 'custom reward handler must receive a context');
    assert.strictEqual(Object.isFrozen(capturedContext), true);
    assert.strictEqual(Object.isFrozen(capturedContext.story), true);
    assert.strictEqual(Object.isFrozen(capturedContext.mission), true);
    assert.strictEqual(Object.isFrozen(capturedContext.reward), true);
    assert.strictEqual(Object.isFrozen(capturedContext.state), true);
    assert.strictEqual(Object.isFrozen(capturedContext.state.flags), true);
    assert.strictEqual(Object.isFrozen(capturedContext.state.completedMissionIds), true);
    assert.strictEqual(capturedContext.story.id, 'custom-reward-story');
    assert.strictEqual(capturedContext.mission.id, 'reward-bundle');
    assert.strictEqual(capturedContext.reward.handlerId, 'bundle');
    assert.strictEqual(capturedContext.reward.amount, 4);
    assert.strictEqual(capturedContext.reward.index, 1);
    assert.strictEqual(capturedContext.state.flags.ready, true);
    assert.ok(capturedContext.state.completedMissionIds.indexOf('reward-bundle') >= 0);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedContext, 'player'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedContext, 'connection'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedContext, 'postgres'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(capturedContext, 'server'), false);

    var expandedAgain = CustomReward.expandCustomRewards({
        runtime: runtime,
        missionEntry: missionMap['reward-bundle'],
        state: completionState,
        rewards: missionMap['reward-bundle'].mission.rewards
    });
    assert.deepStrictEqual(expandedAgain.rewards, expanded.rewards, 'same server handler result must expand deterministically');
    assert.strictEqual(
        ItemRewards.rewardKey('custom-reward-story', 'reward-bundle', expanded.rewards.findIndex(function(reward) { return reward.type === 'item'; })),
        ItemRewards.rewardKey('custom-reward-story', 'reward-bundle', expandedAgain.rewards.findIndex(function(reward) { return reward.type === 'item'; })),
        'custom item receipt identity must be deterministic for retry'
    );

    var noCustom = CustomReward.expandCustomRewards({
        runtime: {},
        missionEntry: mission('normal', []),
        state: completionState,
        rewards: [{type: 'item', value: 'sword2', amount: 1}]
    });
    assert.deepStrictEqual(noCustom.rewards, [{type: 'item', value: 'sword2', amount: 1}], 'normal rewards must not require a custom registry');

    assert.throws(function() {
        CustomReward.expandCustomRewards({runtime: runtime, missionEntry: missionMap['reward-bad'], state: completionState, rewards: missionMap['reward-bad'].mission.rewards});
    }, function(error) {
        return error && error.code === 'CUSTOM_REWARD_INVALID_RESULT' && error.details.reason === 'not_rewardable_item';
    });
    assert.throws(function() {
        CustomReward.expandCustomRewards({runtime: runtime, missionEntry: missionMap['reward-throws'], state: completionState, rewards: missionMap['reward-throws'].mission.rewards});
    }, function(error) { return error && error.code === 'CUSTOM_REWARD_HANDLER_ERROR'; });
    assert.throws(function() {
        CustomReward.expandCustomRewards({runtime: runtime, missionEntry: missionMap['reward-async'], state: completionState, rewards: missionMap['reward-async'].mission.rewards});
    }, function(error) {
        return error && error.code === 'CUSTOM_REWARD_INVALID_RESULT' && error.details.reason === 'async_result';
    });
    assert.throws(function() {
        CustomReward.expandCustomRewards({runtime: runtime, missionEntry: missionMap['reward-missing'], state: completionState, rewards: missionMap['reward-missing'].mission.rewards});
    }, function(error) { return error && error.code === 'CUSTOM_REWARD_HANDLER_MISSING'; });

    var manyNormal = Array.from({length: 21}, function(_, index) {
        return {type: 'story_flag', value: 'normal_' + index, amount: 1};
    });
    manyNormal.push({type: 'custom', value: 'too_many', amount: 1});
    assert.throws(function() {
        CustomReward.expandCustomRewards({
            runtime: runtime,
            missionEntry: mission('reward-limit', manyNormal),
            state: completionState,
            rewards: manyNormal
        });
    }, function(error) {
        return error && (error.code === 'CUSTOM_REWARD_INVALID_RESULT' || error.code === 'CUSTOM_REWARD_LIMIT');
    });

    var storeCalls = 0,
        progressSaveCalls = 0,
        storedRewards = null,
        storedState = null,
        fakeRewardStore = {
            saveCompletionWithRewards: async function(characterId, storyId, missionId, state, rewards) {
                storeCalls += 1;
                assert.strictEqual(characterId, 77);
                assert.strictEqual(storyId, 'custom-reward-story');
                assert.strictEqual(missionId, 'reward-bundle');
                storedRewards = rewards;
                storedState = state;
                return {
                    state: state,
                    itemRewards: [{changed: true, status: 'granted', delivery: 'inventory', category: 'object'}],
                    inventory: {version: 1, items: {flask: 2}}
                };
            }
        },
        completion = await MissionCompletion.completeMission({
            runtime: runtime,
            progressStore: {
                save: async function() {
                    progressSaveCalls += 1;
                    throw new Error('atomic reward store must own custom reward persistence');
                }
            },
            itemRewardStore: fakeRewardStore,
            characterId: 77,
            storyId: 'custom-reward-story',
            missionId: 'reward-bundle',
            giverProfileId: 'captain',
            states: [activeState('reward-bundle')]
        });

    assert.strictEqual(completion.changed, true);
    assert.strictEqual(storeCalls, 1, 'completion and expanded custom effects must enter one reward-store call');
    assert.strictEqual(progressSaveCalls, 0, 'atomic reward path must bypass separate StoryProgressStore.save');
    assert.deepStrictEqual(storedRewards, expanded.rewards, 'reward store must receive only canonical expanded effects');
    assert.strictEqual(storedState.flags.base_flag, true, 'normal story flag must be applied before persistence');
    assert.strictEqual(storedState.flags.opened_gate, true, 'custom-generated story flag must use the canonical state reward service');
    assert.ok(storedState.completedMissionIds.indexOf('reward-bundle') >= 0);
    assert.deepStrictEqual(completion.inventory.items, {flask: 2});

    var callsAfterCompletion = bundleCalls,
        replay = await MissionCompletion.completeMission({
            runtime: runtime,
            progressStore: {save: async function() { progressSaveCalls += 1; }},
            itemRewardStore: fakeRewardStore,
            characterId: 77,
            storyId: 'custom-reward-story',
            missionId: 'reward-bundle',
            giverProfileId: 'captain',
            states: [completion.state]
        });
    assert.strictEqual(replay.changed, false);
    assert.strictEqual(replay.alreadyCompleted, true);
    assert.strictEqual(bundleCalls, callsAfterCompletion, 'completed mission retry must not execute custom reward handler again');
    assert.strictEqual(storeCalls, 1, 'completed mission retry must not re-enter reward transaction');

    var storeCallsBeforeFailure = storeCalls;
    await assert.rejects(function() {
        return MissionCompletion.completeMission({
            runtime: runtime,
            progressStore: {save: async function() { progressSaveCalls += 1; }},
            itemRewardStore: fakeRewardStore,
            characterId: 77,
            storyId: 'custom-reward-story',
            missionId: 'reward-bad',
            giverProfileId: 'captain',
            states: [activeState('reward-bad')]
        });
    }, function(error) {
        return error && error.code === 'CUSTOM_REWARD_INVALID_RESULT';
    });
    assert.strictEqual(storeCalls, storeCallsBeforeFailure, 'invalid custom effect must abort before the atomic store is called');
    assert.strictEqual(progressSaveCalls, 0, 'invalid custom effect must not fall back to partial persistence');

    var source = fs.readFileSync(path.join(root, 'server', 'story', 'custom-reward-service.js'), 'utf8'),
        completionSource = fs.readFileSync(path.join(root, 'server', 'story', 'mission-completion.js'), 'utf8');
    assert.strictEqual(source.indexOf('eval('), -1);
    assert.strictEqual(source.indexOf('new Function'), -1);
    assert.strictEqual(source.indexOf("require('fs')"), -1);
    assert.strictEqual(source.indexOf('child_process'), -1);
    assert.strictEqual(source.indexOf('.connection'), -1);
    assert.strictEqual(source.indexOf('.server'), -1);
    assert.strictEqual(source.indexOf('process.'), -1);
    assert.ok(completionSource.indexOf('CustomRewardService.expandCustomRewards') !== -1, 'mission completion must expand custom rewards before persistence');
    assert.ok(completionSource.indexOf('StateRewardService.applyStateRewards(state, expandedRewards)') !== -1, 'custom story flags must reuse canonical state reward processing');
    assert.ok(completionSource.indexOf('saveCompletionWithRewards') > completionSource.indexOf('CustomRewardService.expandCustomRewards'), 'custom validation must happen before the atomic reward store');

    console.log('Safe custom reward executor smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
