'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    StoryCompletionDialogue = require('../server/story/completion-dialogue'),
    Types = require('../shared/js/gametypes');

function createPlayer(states, runtime) {
    var sent = [];
    return {
        id: 501,
        name: 'CompletionTester',
        type: 'player',
        storyRuntime: runtime,
        storyState: states,
        storyOperationChain: Promise.resolve(),
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

async function main() {
    var root = path.join(__dirname, '..'),
        completionSource = fs.readFileSync(path.join(root, 'server', 'story', 'completion-dialogue.js'), 'utf8'),
        killSource = fs.readFileSync(path.join(root, 'server', 'story', 'kill-progress.js'), 'utf8'),
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
        guard = {id: '8123', type: 'npc', editorData: {id: 'guard-captain'}},
        mage = {id: '8456', type: 'npc', editorData: {id: 'mage'}},
        ready,
        incomplete,
        wrongGiver,
        deterministic,
        player,
        sent,
        beforeState,
        result,
        wrappedPlayer,
        order = [];

    assert.strictEqual(StoryCompletionDialogue.resolveGiverProfileId(guard), 'guard-captain');
    assert.strictEqual(StoryCompletionDialogue.resolveGiverProfileId({id: 'legacy', type: 'npc'}), '', 'legacy NPC without a stable World Editor profile must not receive completion dialogue');
    assert.strictEqual(StoryCompletionDialogue.normalizeObjectiveAmount({amount: 0}), 1);
    assert.strictEqual(StoryCompletionDialogue.normalizeObjectiveAmount({amount: 100001}), 100000);

    incomplete = StoryCompletionDialogue.findCompletionDialogue({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-incomplete', activeMissionId: 'return-guard', objectiveProgress: 2}]
    });
    assert.strictEqual(incomplete, null, 'completion dialogue must not appear before objective.amount is reached');

    wrongGiver = StoryCompletionDialogue.findCompletionDialogue({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-wrong-giver', activeMissionId: 'return-mage', objectiveProgress: 1}]
    });
    assert.strictEqual(wrongGiver, null, 'completion dialogue must require the exact published giverNpc profile');

    assert.strictEqual(StoryCompletionDialogue.findCompletionDialogue({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [{storyId: 'story-empty-dialogue', activeMissionId: 'return-guard', objectiveProgress: 1}]
    }), null, 'empty completion dialogue must not generate a story response');

    ready = StoryCompletionDialogue.findCompletionDialogue({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [readyState]
    });
    assert.ok(ready, 'completed active mission at its giver NPC must expose completion dialogue');
    assert.strictEqual(ready.state.activeMissionId, 'return-guard');
    assert.strictEqual(ready.objectiveAmount, 2);
    assert.deepStrictEqual(ready.state.completedMissionIds, ['intro']);
    assert.strictEqual(ready.state.flags.bridgeOpen, true);

    deterministic = StoryCompletionDialogue.findCompletionDialogue({
        runtime: runtime,
        giverProfileId: 'guard-captain',
        states: [
            readyState,
            {storyId: 'aaa-story', activeMissionId: 'mission-b', objectiveProgress: 1}
        ]
    });
    assert.strictEqual(deterministic.state.storyId, 'aaa-story', 'multiple ready missions at one giver must resolve deterministically');

    player = createPlayer([readyState], runtime);
    beforeState = JSON.stringify(player.storyState);
    result = await StoryCompletionDialogue.queueCompletionDialogue(player, guard);
    assert.strictEqual(result.sent, true);
    assert.strictEqual(player.sentMessages.length, 1);
    sent = player.sentMessages[0];
    assert.strictEqual(sent[0], Types.Messages.STORY_DIALOGUE);
    assert.strictEqual(sent[1], guard.id);
    assert.strictEqual(sent[2].length, 2);
    assert.strictEqual(sent[2][0].indexOf('<script'), -1, 'completion dialogue must be sanitized before leaving the server');
    assert.strictEqual(JSON.stringify(player.storyState), beforeState, 'showing completion dialogue must not complete or mutate mission state');

    result = await StoryCompletionDialogue.queueCompletionDialogue(player, mage);
    assert.strictEqual(result.sent, false, 'wrong NPC must not receive another mission completion dialogue');
    assert.strictEqual(player.sentMessages.length, 1);

    wrappedPlayer = createPlayer([readyState], runtime);
    wrappedPlayer.send = function(message) {
        this.sentMessages.push(message);
        order.push('completion');
    };
    wrappedPlayer.npcinteract_callback = function() {
        wrappedPlayer.queueStoryOperation(function() {
            order.push('original');
        });
    };
    assert.strictEqual(StoryCompletionDialogue.wrapNpcInteraction(wrappedPlayer), true);
    wrappedPlayer.npcinteract_callback(guard);
    await wrappedPlayer.storyOperationChain;
    assert.deepStrictEqual(order, ['completion', 'original'], 'completion check must be queued before the wrapped world callback can enqueue a linked mission start');
    assert.strictEqual(StoryCompletionDialogue.wrapNpcInteraction(wrappedPlayer), false, 'player completion hook must not wrap twice');

    assert.ok(completionSource.indexOf("giverNpc !== giverProfileId") !== -1, 'giver NPC matching must use the exact stable published profile ID');
    assert.ok(completionSource.indexOf('currentProgress < amount') !== -1, 'completion dialogue must require full objective progress');
    assert.ok(completionSource.indexOf('Utils.sanitize') !== -1, 'completion dialogue text must be sanitized server-side');
    assert.ok(completionSource.indexOf('Types.Messages.STORY_DIALOGUE') !== -1, 'completion dialogue must reuse the established story dialogue protocol');
    assert.strictEqual(completionSource.indexOf('progressStore.save'), -1, 'completion dialogue must not persist or mutate story progress');
    assert.ok(killSource.indexOf('StoryInteractProgress.attach(WorldServer);') < killSource.indexOf('StoryCompletionDialogue.attach(WorldServer);'), 'completion dialogue hook must attach after interact progress so its queued check observes the latest objective state');

    console.log('Story completion dialogue smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
