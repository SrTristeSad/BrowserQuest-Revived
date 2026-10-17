'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    StoryCompletionDialogue = require('../server/story/completion-dialogue'),
    Types = require('../shared/js/gametypes');

function entry(id, giver, nextId, completionDialogue, introDialogue) {
    return {
        storyId: 'story-linear',
        chapterId: 'chapter-one',
        mission: {
            id: id,
            giverNpc: giver,
            objective: {type: 'talk', target: giver, amount: 1},
            completionDialogue: completionDialogue || [],
            introDialogue: introDialogue || [],
            rewards: [],
            nextMissionId: nextId || '',
            choices: []
        }
    };
}

function playerFor(runtime, state) {
    return {
        id: 91,
        name: 'LinearTester',
        type: 'player',
        characterId: 44,
        storyRuntime: runtime,
        storyState: [state],
        storyProgress: {
            save: async function(characterId, storyId, nextState) {
                assert.strictEqual(characterId, 44);
                assert.strictEqual(storyId, 'story-linear');
                return nextState;
            }
        },
        storyOperationChain: Promise.resolve(),
        sentMessages: [],
        send: function(message) { this.sentMessages.push(message); },
        queueStoryOperation: function(operation) {
            var run = this.storyOperationChain.catch(function() { return null; }).then(operation);
            this.storyOperationChain = run.catch(function() { return null; });
            return run;
        }
    };
}

async function main() {
    var missions = {
            one: entry('one', 'guide', 'two', [
                {speaker: 'Guide', text: '<script>alert(1)</script>Concluído.'}
            ]),
            two: entry('two', 'captain', '', [], [
                {speaker: 'Captain', text: '<b>Agora fale com o capitão.</b>'}
            ])
        },
        runtime = {
            getMission: function(storyId, missionId) {
                return storyId === 'story-linear' ? (missions[missionId] || null) : null;
            }
        },
        state = {
            version: 1,
            storyId: 'story-linear',
            activeMissionId: 'one',
            objectiveProgress: 1,
            completedMissionIds: [],
            flags: {},
            startedAt: '2026-10-17T10:00:00.000Z',
            updatedAt: '2026-10-17T10:00:00.000Z'
        },
        npc = {id: 700, type: 'npc', editorData: {id: 'guide'}},
        player = playerFor(runtime, state),
        result = await StoryCompletionDialogue.queueMissionCompletion(player, npc),
        source = fs.readFileSync(path.join(__dirname, '..', 'server', 'story', 'completion-dialogue.js'), 'utf8'),
        upsertIndex,
        resolveIndex;

    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.result.nextMissionId, 'two');
    assert.strictEqual(player.storyState[0].activeMissionId, 'two');
    assert.strictEqual(player.sentMessages.length, 2, 'completion and next intro must be separate ordered dialogue messages');
    assert.strictEqual(player.sentMessages[0][0], Types.Messages.STORY_DIALOGUE);
    assert.strictEqual(player.sentMessages[1][0], Types.Messages.STORY_DIALOGUE);
    assert.strictEqual(player.sentMessages[0][1], 700);
    assert.strictEqual(player.sentMessages[1][1], 700);
    assert.strictEqual(player.sentMessages[0][2][0].indexOf('<script'), -1, 'completion dialogue must remain sanitized');
    assert.strictEqual(player.sentMessages[1][2][0].indexOf('<b>'), -1, 'next mission intro must use the same sanitization');
    assert.deepStrictEqual(result.nextLines, player.sentMessages[1][2]);

    var beforeRetry = player.sentMessages.length,
        retry = await StoryCompletionDialogue.queueMissionCompletion(player, npc);
    assert.strictEqual(retry.completed, false, 'old mission interaction must not complete again after transition');
    assert.strictEqual(player.sentMessages.length, beforeRetry, 'retry must not resend the next mission intro');

    missions.one = entry('one', 'guide', 'two', [{speaker: 'Guide', text: 'Fim da etapa.'}]);
    missions.two = entry('two', 'captain', '', [], []);
    player = playerFor(runtime, state);
    result = await StoryCompletionDialogue.queueMissionCompletion(player, npc);
    assert.strictEqual(result.completed, true);
    assert.strictEqual(result.nextLines.length, 0, 'missing next intro must not block transition');
    assert.strictEqual(player.storyState[0].activeMissionId, 'two');
    assert.strictEqual(player.sentMessages.length, 1, 'only completion dialogue is sent when next intro is empty');

    upsertIndex = source.indexOf('player.storyState = MissionService.upsertStoryState');
    resolveIndex = source.indexOf('nextLines = resolveNextMissionIntro(completion);');
    assert.ok(resolveIndex !== -1, 'completion flow must resolve the next mission intro');
    assert.ok(upsertIndex !== -1 && upsertIndex < resolveIndex, 'live story state must advance before next intro is emitted');
    assert.strictEqual(source.indexOf('startMission('), -1, 'automatic next intro must never start/save the mission a second time');

    console.log('Next mission intro dialogue smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
