'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    MissionCompletion = require('../server/story/mission-completion'),
    StoryCompletionDialogue = require('../server/story/completion-dialogue'),
    Types = require('../shared/js/gametypes');

function createPlayer(states, runtime, progressStore) {
    var sent = [];
    return {
        id: 501,
        name: 'CompletionTester',
        type: 'player',
        characterId: 77,
        storyRuntime: runtime,
        storyProgress: progressStore || null,
        storyState: states,
        storyOperationChain: Promise.resolve(),
        storyInteractionNpcId: null,
        npcinteract_callback: null,
        sentMessages: sent,
        send: function(message) {
            sent.push(message);
        },
        onNpcInteract: function(callback) {
            this.npcinteract_callback = callback;
        },
        queueStoryOperation: function(operation) {
            var previous = this.storyOperationChain || Promise.resolve(),
                run = previous.catch(function() { return null; }).then(operation);
            this.storyOperationChain = run.catch(function() { return null; });
            return run;
        }
    };
}

async function flushPlayerQueue(player) {
    await player.storyOperationChain;
    await new Promise(function(resolve) { setImmediate(resolve); });
    await player.storyOperationChain;
}

async function main() {
    var root = path.join(__dirname, '..'),
        completionSource = fs.readFileSync(path.join(root, 'server', 'story', 'completion-dialogue.js'), 'utf8'),
        completionServiceSource = fs.readFileSync(path.join(root, 'server', 'story', 'mission-completion.js'), 'utf8'),
        killSource = fs.readFileSync(path.join(root, 'server', 'story', 'kill-progress.js'), 'utf8'),
        saved = [],
        progressStore = {
            save: async function(characterId, storyId, state) {
                saved.push({characterId: characterId, storyId: storyId, state: state});
                return state;
            }
        },
        runtime = {
            getMission: function(storyId, missionId) {
                if(storyId === 'story-ready' && missionId === 'return-guard') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-one',
                        mission: {
                            id: missionId,
                            giverNpc: 'guard-captain',
                            objective: {type: 'kill', target: 'rat', amount: 2},
                            completionDialogue: [
                                {speaker: 'Guarda', text: '<script>alert(1)</script>Obrigado, viajante.'},
                                {speaker: 'Guarda', text: 'A estrada está segura.'}
                            ],
                            rewards: [{type: 'item', value: 'flask', amount: 1}],
                            nextMissionId: 'next-step'
                        }
                    };
                }
                if(storyId === 'story-incomplete' && missionId === 'return-guard') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-two',
                        mission: {
                            id: missionId,
                            giverNpc: 'guard-captain',
                            objective: {type: 'collect', target: 'flask', amount: 3},
                            completionDialogue: [{speaker: 'Guarda', text: 'Você conseguiu.'}]
                        }
                    };
                }
                if(storyId === 'story-wrong-giver' && missionId === 'return-mage') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-three',
                        mission: {
                            id: missionId,
                            giverNpc: 'mage',
                            objective: {type: 'visit', locationId: 'checkpoint:4', amount: 1},
                            completionDialogue: [{speaker: 'Mago', text: 'Excelente.'}]
                        }
                    };
                }
                if(storyId === 'story-empty-dialogue' && missionId === 'return-guard') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-four',
                        mission: {
                            id: missionId,
                            giverNpc: 'guard-captain',
                            objective: {type: 'talk', target: 'guard-captain', amount: 1},
                            completionDialogue: []
                        }
                    };
                }
                if(storyId === 'aaa-story' && missionId === 'mission-b') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-five',
                        mission: {
                            id: missionId,
                            giverNpc: 'guard-captain',
                            objective: {type: 'interact', target: 'npc:guard-captain', amount: 1},
                            completionDialogue: [{speaker: 'Guarda', text: 'Primeiro deterministicamente.'}]
                        }
                    };
                }
                return null;
            }
        },
        readyState = {
            version: 1,
            storyId: 'story-ready',
            activeMissionId: 'return-guard',
            objectiveProgress: 2,
            completedMissionIds: ['intro'],
            flags: {bridgeOpen: true},
            startedAt: '2026-10-17T00:00:00.000Z',
            updatedAt: '2026-10-17T00:00:00.000Z'
        },
        guard = {
            id: '8123',
            type: 'npc',
            editorData: {id: 'guard-captain', storyId: 'story-ready', missionId: 'return-guard'}
        },
        mage = {id: '8456', type: 'npc', editorData: {id: 'mage'}},
        ready,
        incomplete,
        wrongGiver,
        deterministic,
        bounded,
        direct,
        repeated,
        player,
        sent,
        beforeState,
        result,
        emptyPlayer,
        wrappedReady,
        wrappedIncomplete,
        wrappedCompleted,
        originalCalls,
        originalNpcId;

    assert.strictEqual(StoryCompletionDialogue.resolveGiverProfileId(guard), 'guard-captain');
    assert.strictEqual(StoryCompletionDialogue.resolveGiverProfileId({id: 'legacy', type: 'npc'}), '', 'legacy NPC without a stable World Editor profile must not receive completion flow');
    assert.strictEqual(StoryCompletionDialogue.normalizeObjectiveAmount({amount: 0}), 1);
    assert.strictEqual(StoryCompletionDialogue.normalizeObjectiveAmount({amount: 100001}), 100000);

    bounded = MissionCompletion.appendCompletedMission(Array.from({length: 500}, function(_, index) { return 'm' + index; }), 'latest');
    assert.strictEqual(bounded.length, 500, 'completion history must remain within the persisted normalization limit');
    assert.strictEqual(bounded[bounded.length - 1], 'latest', 'newest completion must never be dropped at the history cap');
    assert.strictEqual(bounded.indexOf('m0'), -1, 'oldest bounded history entry may be evicted to retain the newest completion');

    incomplete = StoryCompletionDialogue.findCompletableMission({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-incomplete', activeMissionId: 'return-guard', objectiveProgress: 2}]
    });
    assert.strictEqual(incomplete, null, 'mission must not be completable before objective.amount is reached');

    wrongGiver = StoryCompletionDialogue.findCompletableMission({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-wrong-giver', activeMissionId: 'return-mage', objectiveProgress: 1}]
    });
    assert.strictEqual(wrongGiver, null, 'mission completion must require the exact published giverNpc profile');

    assert.ok(StoryCompletionDialogue.findCompletableMission({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-empty-dialogue', activeMissionId: 'return-guard', objectiveProgress: 1}]
    }), 'a ready mission with empty completionDialogue must still be completable');
    assert.strictEqual(StoryCompletionDialogue.findCompletionDialogue({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-empty-dialogue', activeMissionId: 'return-guard', objectiveProgress: 1}]
    }), null, 'empty completionDialogue must still produce no story dialogue');

    ready = StoryCompletionDialogue.findCompletionDialogue({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [readyState]
    });
    assert.ok(ready, 'ready active mission at its giver NPC must expose completion dialogue');
    assert.strictEqual(ready.state.activeMissionId, 'return-guard');
    assert.strictEqual(ready.objectiveAmount, 2);

    deterministic = StoryCompletionDialogue.findCompletableMission({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [
            readyState,
            {storyId: 'aaa-story', activeMissionId: 'mission-b', objectiveProgress: 1}
        ]
    });
    assert.strictEqual(deterministic.state.storyId, 'aaa-story', 'multiple ready missions at one giver must resolve deterministically');

    direct = await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        storyId: 'story-ready',
        missionId: 'return-guard',
        giverProfileId: 'guard-captain',
        states: [readyState]
    });
    assert.strictEqual(direct.changed, true);
    assert.strictEqual(direct.state.activeMissionId, '', 'completion must clear activeMissionId');
    assert.strictEqual(direct.state.objectiveProgress, 0, 'completion must clear partial objective progress');
    assert.deepStrictEqual(direct.state.completedMissionIds, ['intro', 'return-guard'], 'completion must append mission history exactly once');
    assert.strictEqual(direct.state.flags.bridgeOpen, true, 'completion must preserve story flags');
    assert.strictEqual(saved.length, 1, 'completion must persist exactly once');
    assert.strictEqual(saved[0].characterId, 77);
    assert.strictEqual(saved[0].storyId, 'story-ready');

    repeated = await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        storyId: 'story-ready',
        missionId: 'return-guard',
        giverProfileId: 'guard-captain',
        states: [direct.state]
    });
    assert.strictEqual(repeated.changed, false, 'mission completion must be idempotent');
    assert.strictEqual(repeated.alreadyCompleted, true);
    assert.strictEqual(saved.length, 1, 'idempotent repeat must not persist another write');
    assert.deepStrictEqual(repeated.state.completedMissionIds, ['intro', 'return-guard']);

    assert.strictEqual((await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        storyId: 'story-incomplete',
        missionId: 'return-guard',
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-incomplete', activeMissionId: 'return-guard', objectiveProgress: 2}]
    })).changed, false, 'incomplete objective must not be persisted as complete');
    assert.strictEqual(saved.length, 1);

    assert.strictEqual((await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        storyId: 'story-wrong-giver',
        missionId: 'return-mage',
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-wrong-giver', activeMissionId: 'return-mage', objectiveProgress: 1}]
    })).changed, false, 'wrong giver must not complete the mission');
    assert.strictEqual(saved.length, 1);

    player = createPlayer([readyState], runtime, progressStore);
    beforeState = JSON.stringify(player.storyState);
    result = await StoryCompletionDialogue.queueCompletionDialogue(player, guard);
    assert.strictEqual(result.sent, true, 'dialogue-only helper must remain available');
    assert.strictEqual(JSON.stringify(player.storyState), beforeState, 'dialogue-only helper must remain read-only');

    player = createPlayer([readyState], runtime, progressStore);
    result = await StoryCompletionDialogue.queueMissionCompletion(player, guard);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.sent, true);
    assert.strictEqual(player.sentMessages.length, 1);
    sent = player.sentMessages[0];
    assert.strictEqual(sent[0], Types.Messages.STORY_DIALOGUE);
    assert.strictEqual(sent[1], guard.id);
    assert.strictEqual(sent[2].length, 2);
    assert.strictEqual(sent[2][0].indexOf('<script'), -1, 'completion dialogue must be sanitized before leaving the server');
    assert.strictEqual(player.storyState[0].activeMissionId, '');
    assert.ok(player.storyState[0].completedMissionIds.indexOf('return-guard') >= 0);

    emptyPlayer = createPlayer([{
        storyId: 'story-empty-dialogue',
        activeMissionId: 'return-guard',
        objectiveProgress: 1,
        completedMissionIds: []
    }], runtime, progressStore);
    result = await StoryCompletionDialogue.queueMissionCompletion(emptyPlayer, guard);
    assert.strictEqual(result.completed, true, 'empty dialogue must not block mission completion');
    assert.strictEqual(result.sent, false);
    assert.strictEqual(emptyPlayer.sentMessages.length, 0);
    assert.deepStrictEqual(emptyPlayer.storyState[0].completedMissionIds, ['return-guard']);

    result = await StoryCompletionDialogue.queueMissionCompletion(player, mage);
    assert.strictEqual(result.completed, false, 'wrong NPC must not complete another mission');

    originalCalls = 0;
    wrappedReady = createPlayer([readyState], runtime, progressStore);
    wrappedReady.npcinteract_callback = function() { originalCalls += 1; };
    assert.strictEqual(StoryCompletionDialogue.wrapNpcInteraction(wrappedReady), true);
    wrappedReady.npcinteract_callback(guard);
    await flushPlayerQueue(wrappedReady);
    assert.strictEqual(originalCalls, 0, 'successful completion must consume the interaction instead of restarting the linked mission');
    assert.strictEqual(wrappedReady.storyState[0].activeMissionId, '');
    assert.ok(wrappedReady.storyState[0].completedMissionIds.indexOf('return-guard') >= 0);

    wrappedCompleted = createPlayer([wrappedReady.storyState[0]], runtime, progressStore);
    wrappedCompleted.npcinteract_callback = function() { originalCalls += 1; };
    StoryCompletionDialogue.wrapNpcInteraction(wrappedCompleted);
    wrappedCompleted.npcinteract_callback(guard);
    await flushPlayerQueue(wrappedCompleted);
    assert.strictEqual(originalCalls, 0, 'a later interaction must not restart an already completed linked mission');
    assert.strictEqual(StoryCompletionDialogue.isNpcLinkedMissionCompleted(wrappedCompleted, guard), true);

    originalNpcId = null;
    wrappedIncomplete = createPlayer([{
        storyId: 'story-incomplete',
        activeMissionId: 'return-guard',
        objectiveProgress: 1,
        completedMissionIds: []
    }], runtime, progressStore);
    wrappedIncomplete.npcinteract_callback = function(npc) {
        originalCalls += 1;
        originalNpcId = wrappedIncomplete.storyInteractionNpcId;
        assert.strictEqual(npc, guard);
    };
    StoryCompletionDialogue.wrapNpcInteraction(wrappedIncomplete);
    wrappedIncomplete.npcinteract_callback(guard);
    await flushPlayerQueue(wrappedIncomplete);
    assert.strictEqual(originalCalls, 1, 'when no mission completes the existing NPC callback must still execute');
    assert.strictEqual(originalNpcId, guard.id, 'deferred original callback must preserve the source NPC id used by intro dialogue');
    assert.strictEqual(wrappedIncomplete.storyInteractionNpcId, null, 'temporary NPC id must be restored after the deferred callback');

    assert.ok(completionServiceSource.indexOf("activeMissionId: ''") !== -1, 'completion service must clear the active mission');
    assert.ok(completionServiceSource.indexOf('objectiveProgress: 0') !== -1, 'completion service must clear partial progress');
    assert.ok(completionServiceSource.indexOf('appendCompletedMission(current.completedMissionIds, missionId)') !== -1, 'completion service must append the completed mission id through the bounded history helper');
    assert.ok(completionServiceSource.indexOf('progressStore.save') !== -1, 'authenticated completion must persist story state');
    assert.strictEqual(completionServiceSource.indexOf('nextMissionId'), -1, 'completion must not start the next mission yet');
    assert.strictEqual(completionServiceSource.indexOf('rewards'), -1, 'completion must not grant rewards yet');
    assert.ok(completionSource.indexOf('queueMissionCompletion(player, npc)') !== -1, 'NPC interaction hook must use the queued persistent completion operation');
    assert.ok(completionSource.indexOf('isNpcLinkedMissionCompleted(player, npc)') !== -1, 'completed linked missions must not be restarted by the same NPC');
    assert.ok(completionSource.indexOf('player.storyInteractionNpcId = npc') !== -1, 'deferred normal NPC callback must restore the interaction NPC id');
    assert.ok(completionSource.indexOf('Utils.sanitize') !== -1, 'completion dialogue text must remain sanitized server-side');
    assert.ok(completionSource.indexOf('Types.Messages.STORY_DIALOGUE') !== -1, 'completion dialogue must reuse the established story dialogue protocol');
    assert.ok(killSource.indexOf('StoryInteractProgress.attach(WorldServer);') < killSource.indexOf('StoryCompletionDialogue.attach(WorldServer);'), 'completion hook must attach after interact progress so its queued operation sees the latest objective state');

    console.log('Story completion dialogue and persistent mission completion smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
