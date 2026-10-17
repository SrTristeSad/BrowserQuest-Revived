'use strict';

var assert = require('assert'),
    MissionCompletion = require('../server/story/mission-completion'),
    StoryRuntime = require('../server/story/runtime').StoryRuntime;

function mission(id, giverNpc, nextMissionId) {
    return {
        storyId: 'linear-story',
        chapterId: 'chapter-one',
        mission: {
            id: id,
            giverNpc: giverNpc,
            objective: {type: 'talk', target: giverNpc, amount: 1},
            rewards: [],
            nextMissionId: nextMissionId || ''
        }
    };
}

function state(activeMissionId, completedMissionIds) {
    return {
        version: 1,
        storyId: 'linear-story',
        activeMissionId: activeMissionId,
        objectiveProgress: 1,
        completedMissionIds: completedMissionIds || [],
        flags: {ready: true},
        startedAt: '2026-10-17T10:00:00.000Z',
        updatedAt: '2026-10-17T10:00:00.000Z'
    };
}

function runtimeFor(entries) {
    return {
        getMission: function(storyId, missionId) {
            if(storyId !== 'linear-story') { return null; }
            return entries[missionId] || null;
        }
    };
}

async function expectCode(factory, code) {
    await assert.rejects(factory, function(error) {
        return error && error.code === code;
    });
}

async function main() {
    var entries = {
            'mission-one': mission('mission-one', 'guide', 'mission-two'),
            'mission-two': mission('mission-two', 'captain', '')
        },
        runtime = runtimeFor(entries),
        persisted = [],
        rewardStoreCalls = 0,
        progressSaveCalls = 0,
        rewardStore = {
            saveCompletionWithRewards: async function(characterId, storyId, missionId, nextState, rewards) {
                rewardStoreCalls += 1;
                persisted.push({
                    characterId: characterId,
                    storyId: storyId,
                    missionId: missionId,
                    state: nextState,
                    rewards: rewards
                });
                return {state: nextState, itemRewards: [], inventory: null};
            }
        },
        progressStore = {
            save: async function() {
                progressSaveCalls += 1;
                throw new Error('atomic reward store should own this save');
            }
        },
        first = await MissionCompletion.completeMission({
            runtime: runtime,
            progressStore: progressStore,
            itemRewardStore: rewardStore,
            characterId: 77,
            storyId: 'linear-story',
            missionId: 'mission-one',
            giverProfileId: 'guide',
            states: [state('mission-one')]
        });

    assert.strictEqual(first.changed, true);
    assert.strictEqual(first.completedMissionId, 'mission-one');
    assert.strictEqual(first.nextMissionId, 'mission-two');
    assert.strictEqual(first.nextMission.mission.id, 'mission-two');
    assert.deepStrictEqual(first.state.completedMissionIds, ['mission-one']);
    assert.strictEqual(first.state.activeMissionId, 'mission-two', 'next mission must be active in the same completed state');
    assert.strictEqual(first.state.objectiveProgress, 0, 'next mission must start with zero objective progress');
    assert.notStrictEqual(first.state.startedAt, '2026-10-17T10:00:00.000Z', 'linear transition must start a fresh mission timer');
    assert.strictEqual(rewardStoreCalls, 1);
    assert.strictEqual(progressSaveCalls, 0, 'there must not be a second StoryProgressStore save window');
    assert.strictEqual(persisted[0].state.activeMissionId, 'mission-two', 'atomic reward store must receive the transitioned state');
    assert.deepStrictEqual(persisted[0].state.completedMissionIds, ['mission-one']);

    var retry = await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: progressStore,
        itemRewardStore: rewardStore,
        characterId: 77,
        storyId: 'linear-story',
        missionId: 'mission-one',
        giverProfileId: 'guide',
        states: [first.state]
    });
    assert.strictEqual(retry.changed, false, 'retry of the old completed mission must not transition again');
    assert.strictEqual(retry.alreadyCompleted, true);
    assert.strictEqual(retry.state.activeMissionId, 'mission-two');
    assert.strictEqual(rewardStoreCalls, 1, 'retry must not re-enter the reward store');

    var fallbackSaves = [],
        terminal = await MissionCompletion.completeMission({
            runtime: runtime,
            progressStore: {
                save: async function(characterId, storyId, nextState) {
                    fallbackSaves.push({characterId: characterId, storyId: storyId, state: nextState});
                    return nextState;
                }
            },
            characterId: 77,
            storyId: 'linear-story',
            missionId: 'mission-two',
            giverProfileId: 'captain',
            states: [{
                storyId: 'linear-story',
                activeMissionId: 'mission-two',
                objectiveProgress: 1,
                completedMissionIds: ['mission-one'],
                flags: {ready: true},
                startedAt: first.state.startedAt
            }]
        });
    assert.strictEqual(terminal.changed, true);
    assert.strictEqual(terminal.nextMissionId, '');
    assert.strictEqual(terminal.nextMission, null);
    assert.strictEqual(terminal.state.activeMissionId, '');
    assert.deepStrictEqual(terminal.state.completedMissionIds, ['mission-one', 'mission-two']);
    assert.strictEqual(fallbackSaves.length, 1, 'terminal completion must still use exactly one fallback save');

    var guest = await MissionCompletion.completeMission({
        runtime: runtime,
        storyId: 'linear-story',
        missionId: 'mission-one',
        giverProfileId: 'guide',
        states: [state('mission-one')]
    });
    assert.strictEqual(guest.state.activeMissionId, 'mission-two', 'guest transition may exist in memory for the session');
    assert.strictEqual(guest.state.objectiveProgress, 0);

    var invalidPersistenceCalls = 0,
        invalidProgressStore = {
            save: async function() {
                invalidPersistenceCalls += 1;
            }
        };

    await expectCode(function() {
        return MissionCompletion.completeMission({
            runtime: runtimeFor({'mission-one': mission('mission-one', 'guide', 'missing-mission')}),
            progressStore: invalidProgressStore,
            characterId: 77,
            storyId: 'linear-story',
            missionId: 'mission-one',
            giverProfileId: 'guide',
            states: [state('mission-one')]
        });
    }, 'NEXT_MISSION_NOT_FOUND');

    await expectCode(function() {
        return MissionCompletion.completeMission({
            runtime: runtimeFor({'mission-one': mission('mission-one', 'guide', 'mission-one')}),
            progressStore: invalidProgressStore,
            characterId: 77,
            storyId: 'linear-story',
            missionId: 'mission-one',
            giverProfileId: 'guide',
            states: [state('mission-one')]
        });
    }, 'NEXT_MISSION_SELF_REFERENCE');

    await expectCode(function() {
        return MissionCompletion.completeMission({
            runtime: runtime,
            progressStore: invalidProgressStore,
            characterId: 77,
            storyId: 'linear-story',
            missionId: 'mission-one',
            giverProfileId: 'guide',
            states: [state('mission-one', ['mission-two'])]
        });
    }, 'NEXT_MISSION_ALREADY_COMPLETED');

    await expectCode(function() {
        var wrongStoryRuntime = runtimeFor({'mission-one': mission('mission-one', 'guide', 'mission-two')});
        wrongStoryRuntime.getMission = function(storyId, missionId) {
            if(missionId === 'mission-one') { return mission('mission-one', 'guide', 'mission-two'); }
            if(missionId === 'mission-two') {
                var cross = mission('mission-two', 'captain', '');
                cross.storyId = 'other-story';
                return cross;
            }
            return null;
        };
        return MissionCompletion.completeMission({
            runtime: wrongStoryRuntime,
            progressStore: invalidProgressStore,
            characterId: 77,
            storyId: 'linear-story',
            missionId: 'mission-one',
            giverProfileId: 'guide',
            states: [state('mission-one')]
        });
    }, 'NEXT_MISSION_WRONG_STORY');

    assert.strictEqual(invalidPersistenceCalls, 0, 'invalid linear transition must abort before persistence');

    var diagnosticRuntime = new StoryRuntime({
        getPublishedStories: function() {
            return [{
                id: 'diag-story',
                status: 'published',
                entryMissionId: 'loop',
                chapters: [{
                    id: 'chapter',
                    missions: [{
                        id: 'loop',
                        giverNpc: 'npc',
                        objective: {type: 'talk', target: 'npc', amount: 1},
                        rewards: [],
                        nextMissionId: 'loop',
                        choices: []
                    }]
                }]
            }];
        }
    });
    assert.ok(diagnosticRuntime.getDiagnostics().some(function(entry) {
        return entry.code === 'self_next_mission' && entry.missionId === 'loop';
    }), 'runtime loader must diagnose direct self-loop before gameplay');

    var direct = MissionCompletion.resolveLinearNextMission(runtime, 'linear-story', 'mission-one', entries['mission-one'].mission, ['mission-one']);
    assert.strictEqual(direct.nextMissionId, 'mission-two');
    assert.strictEqual(direct.nextMission.storyId, 'linear-story');

    console.log('Linear next mission transition smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
