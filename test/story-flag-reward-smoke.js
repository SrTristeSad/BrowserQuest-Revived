'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    MissionCompletion = require('../server/story/mission-completion'),
    StoryProgress = require('../server/story/progress-store'),
    StateRewards = require('../server/story/state-reward-service');

async function main() {
    var root = path.join(__dirname, '..'),
        serviceSource = fs.readFileSync(path.join(root, 'server', 'story', 'state-reward-service.js'), 'utf8'),
        completionSource = fs.readFileSync(path.join(root, 'server', 'story', 'mission-completion.js'), 'utf8'),
        rewardStoreSource = fs.readFileSync(path.join(root, 'server', 'story', 'item-reward-store.js'), 'utf8'),
        baseState = {
            storyId: 'story-flags',
            activeMissionId: '',
            objectiveProgress: 0,
            completedMissionIds: ['mission-one'],
            flags: {door_open: false, old_flag: 'legacy'},
            startedAt: '2026-10-17T00:00:00.000Z'
        },
        applied,
        limitFlags = {},
        limitState,
        runtime,
        guestCompletion,
        atomicSeen = null,
        progressSaves = 0,
        authCompletion;

    assert.strictEqual(StoryProgress.strictId('door_open', 120), 'door_open');
    assert.strictEqual(StoryProgress.strictId('Flag-20', 120), 'Flag-20');
    assert.strictEqual(StoryProgress.strictId('door.open', 120), '', 'object paths must be rejected, never sanitized into another key');
    assert.strictEqual(StoryProgress.strictId('{"door":true}', 120), '', 'JSON-like keys must be rejected');
    assert.strictEqual(StoryProgress.strictId('__proto__', 120), '', 'prototype pollution key must be rejected');
    assert.strictEqual(StoryProgress.strictId('constructor', 120), '', 'constructor key must be rejected');
    assert.strictEqual(StoryProgress.strictId('prototype', 120), '', 'prototype key must be rejected');

    assert.deepStrictEqual(StateRewards.resolveStoryFlagReward({type: 'story_flag', value: 'gate_open', amount: 999}, 2), {
        valid: true,
        rewardIndex: 2,
        key: 'gate_open',
        status: 'granted',
        reason: null
    });
    assert.strictEqual(StateRewards.resolveStoryFlagReward({type: 'item', value: 'gate_open'}, 0), null);
    assert.strictEqual(StateRewards.resolveStoryFlagReward({type: 'story_flag', value: 'gate.open'}, 0).valid, false);

    applied = StateRewards.applyStateRewards(baseState, [
        {type: 'story_flag', value: 'door_open', amount: 500},
        {type: 'story_flag', value: 'new_flag', amount: 999},
        {type: 'story_flag', value: 'new_flag', amount: 2},
        {type: 'story_flag', value: '__proto__', amount: 1},
        {type: 'achievement', value: '17', amount: 1}
    ]);
    assert.strictEqual(applied.state.flags.door_open, true, 'existing false flag must become true');
    assert.strictEqual(applied.state.flags.new_flag, true, 'valid new flag must be persisted as boolean true');
    assert.strictEqual(applied.state.flags.old_flag, 'legacy', 'unrelated historical flags must be preserved');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(applied.state.flags, '__proto__'), false);
    assert.strictEqual(applied.storyFlagRewards.length, 4, 'only story_flag rewards belong to the state flag pipeline');
    assert.strictEqual(applied.storyFlagRewards[0].changed, true);
    assert.strictEqual(applied.storyFlagRewards[1].changed, true);
    assert.strictEqual(applied.storyFlagRewards[2].alreadySet, true, 'duplicate flag in one mission must be idempotent');
    assert.strictEqual(applied.storyFlagRewards[3].status, 'invalid');
    assert.strictEqual(applied.state.flags.new_flag, true, 'reward.amount must never become the flag value');

    for(var i = 0; i < StoryProgress.MAX_FLAGS; i += 1) {
        limitFlags['f' + i] = true;
    }
    limitState = {storyId: 'limit-story', flags: limitFlags};
    assert.strictEqual(StateRewards.applyStateRewards(limitState, [{type: 'story_flag', value: 'f0'}]).state.flags.f0, true, 'an existing flag may be reaffirmed at the limit');
    assert.throws(function() {
        StateRewards.applyStateRewards(limitState, [{type: 'story_flag', value: 'overflow'}]);
    }, function(error) {
        return error && error.code === 'STORY_FLAG_LIMIT';
    }, 'the 201st distinct flag must block completion instead of being silently lost');
    assert.strictEqual(Object.keys(StoryProgress.normalizeStoryProgress({storyId: 'limit-story', flags: Object.assign({}, limitFlags, {overflow: true})}).flags).length, StoryProgress.MAX_FLAGS);

    runtime = {
        getMission: function(storyId, missionId) {
            if(storyId !== 'quest-story' || missionId !== 'open-gate') { return null; }
            return {
                storyId: storyId,
                mission: {
                    id: missionId,
                    giverNpc: 'captain',
                    objective: {type: 'talk', target: 'captain', amount: 1},
                    rewards: [
                        {type: 'story_flag', value: 'gate_open', amount: 900},
                        {type: 'achievement', value: '17', amount: 1}
                    ]
                }
            };
        }
    };

    guestCompletion = await MissionCompletion.completeMission({
        runtime: runtime,
        storyId: 'quest-story',
        missionId: 'open-gate',
        giverProfileId: 'captain',
        states: [{storyId: 'quest-story', activeMissionId: 'open-gate', objectiveProgress: 1, completedMissionIds: [], flags: {}}]
    });
    assert.strictEqual(guestCompletion.changed, true);
    assert.strictEqual(guestCompletion.state.flags.gate_open, true, 'guest Story Runtime must keep story flags in memory even without permanent persistence');

    authCompletion = await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: {
            save: async function() {
                progressSaves += 1;
                throw new Error('atomic reward store must own the authenticated story write');
            }
        },
        itemRewardStore: {
            saveCompletionWithRewards: async function(characterId, storyId, missionId, state, rewards) {
                atomicSeen = {
                    characterId: characterId,
                    storyId: storyId,
                    missionId: missionId,
                    state: JSON.parse(JSON.stringify(state)),
                    rewards: rewards
                };
                return {state: StoryProgress.normalizeStoryProgress(state, storyId), itemRewards: [], inventory: null};
            }
        },
        characterId: 77,
        storyId: 'quest-story',
        missionId: 'open-gate',
        giverProfileId: 'captain',
        states: [{storyId: 'quest-story', activeMissionId: 'open-gate', objectiveProgress: 1, completedMissionIds: [], flags: {existing: true}}]
    });
    assert.strictEqual(progressSaves, 0);
    assert.ok(atomicSeen, 'authenticated completion must use the existing atomic reward persistence path');
    assert.strictEqual(atomicSeen.state.flags.gate_open, true, 'story flag must be applied before entering the atomic persistence path');
    assert.strictEqual(atomicSeen.state.flags.existing, true);
    assert.strictEqual(authCompletion.state.flags.gate_open, true);

    assert.ok(completionSource.indexOf('StateRewardService.applyStateRewards') < completionSource.indexOf('saveCompletionWithRewards'), 'state rewards must be applied before the final atomic persistence call');
    assert.ok(rewardStoreSource.indexOf("await client.query('BEGIN')") !== -1);
    assert.ok(rewardStoreSource.indexOf("VALUES($1,'story',$2,$3::jsonb)") !== -1, 'the state containing flags must be written in the same reward transaction');
    assert.strictEqual(serviceSource.indexOf('eval('), -1);
    assert.strictEqual(serviceSource.indexOf('JSON.parse'), -1, 'story flag values must never be interpreted as JSON');
    assert.strictEqual(serviceSource.indexOf('reward.amount'), -1, 'story_flag amount must be ignored entirely');

    console.log('Story flag reward validation, idempotence and completion integration smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
