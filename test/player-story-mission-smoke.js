'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    MissionService = require('../server/story/mission-service');

async function main() {
    var original = [
            {storyId: 'one', activeMissionId: 'old', objectiveProgress: 3},
            {storyId: 'two', activeMissionId: 'm2', objectiveProgress: 1}
        ],
        replaced = MissionService.upsertStoryState(original, {
            storyId: 'one',
            activeMissionId: 'new',
            objectiveProgress: 0,
            completedMissionIds: ['old'],
            flags: {ready: true}
        }),
        appended = MissionService.upsertStoryState(replaced, {
            storyId: 'three',
            activeMissionId: 'm3',
            objectiveProgress: 0
        }),
        root = path.join(__dirname, '..'),
        playerSource = fs.readFileSync(path.join(root, 'server', 'js', 'player.js'), 'utf8'),
        serviceSource = fs.readFileSync(path.join(root, 'server', 'story', 'mission-service.js'), 'utf8'),
        saved = [],
        runtime = {
            getMission: function(storyId, missionId) {
                if(storyId === 'story-talk' && missionId === 'talk-guard') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-one',
                        mission: {
                            id: missionId,
                            objective: {type: 'talk', target: 'npc-guard', amount: 2}
                        }
                    };
                }
                if(storyId === 'story-kill' && missionId === 'kill-rats') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-two',
                        mission: {
                            id: missionId,
                            objective: {type: 'kill', target: 'rat', amount: 3}
                        }
                    };
                }
                return null;
            }
        },
        progressStore = {
            save: async function(characterId, storyId, state) {
                saved.push({characterId: characterId, storyId: storyId, state: state});
                return state;
            }
        },
        states = [
            {
                version: 1,
                storyId: 'story-talk',
                activeMissionId: 'talk-guard',
                objectiveProgress: 0,
                completedMissionIds: ['intro'],
                flags: {trusted: true},
                startedAt: '2026-10-17T00:00:00.000Z',
                updatedAt: '2026-10-17T00:00:00.000Z'
            },
            {
                version: 1,
                storyId: 'story-kill',
                activeMissionId: 'kill-rats',
                objectiveProgress: 0
            }
        ],
        wrongTarget,
        firstTalk,
        secondTalk,
        cappedTalk;

    assert.strictEqual(original[0].activeMissionId, 'old', 'upsert must not mutate the input list');
    assert.strictEqual(replaced.length, 2);
    assert.strictEqual(replaced[0].activeMissionId, 'new');
    assert.strictEqual(replaced[0].objectiveProgress, 0);
    assert.deepStrictEqual(replaced[0].completedMissionIds, ['old']);
    assert.strictEqual(replaced[0].flags.ready, true);
    assert.strictEqual(replaced[1].storyId, 'two');
    assert.strictEqual(appended.length, 3);
    assert.strictEqual(appended[2].storyId, 'three');

    wrongTarget = await MissionService.progressTalkObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetProfileId: 'npc-wrong',
        states: states
    });
    assert.strictEqual(wrongTarget.changed, false, 'wrong NPC profile must not advance talk objectives');
    assert.strictEqual(wrongTarget.updates.length, 0);
    assert.strictEqual(saved.length, 0, 'wrong NPC profile must not write story progress');

    firstTalk = await MissionService.progressTalkObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetProfileId: 'npc-guard',
        states: states
    });
    assert.strictEqual(firstTalk.changed, true);
    assert.strictEqual(firstTalk.updates.length, 1, 'only matching talk missions may advance');
    assert.strictEqual(firstTalk.updates[0].state.storyId, 'story-talk');
    assert.strictEqual(firstTalk.updates[0].state.activeMissionId, 'talk-guard', 'talk progress must not complete the mission yet');
    assert.strictEqual(firstTalk.updates[0].state.objectiveProgress, 1);
    assert.strictEqual(firstTalk.updates[0].objectiveAmount, 2);
    assert.strictEqual(firstTalk.updates[0].objectiveComplete, false);
    assert.deepStrictEqual(firstTalk.updates[0].state.completedMissionIds, ['intro']);
    assert.strictEqual(firstTalk.updates[0].state.flags.trusted, true);
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].characterId, 77);
    assert.strictEqual(saved[0].storyId, 'story-talk');

    states = MissionService.upsertStoryState(states, firstTalk.updates[0].state);
    secondTalk = await MissionService.progressTalkObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetProfileId: 'npc-guard',
        states: states
    });
    assert.strictEqual(secondTalk.updates[0].state.objectiveProgress, 2);
    assert.strictEqual(secondTalk.updates[0].objectiveComplete, true, 'reaching amount may be reported without concluding the mission');
    assert.strictEqual(secondTalk.updates[0].state.activeMissionId, 'talk-guard');

    states = MissionService.upsertStoryState(states, secondTalk.updates[0].state);
    cappedTalk = await MissionService.progressTalkObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetProfileId: 'npc-guard',
        states: states
    });
    assert.strictEqual(cappedTalk.changed, false, 'talk progress must stop at the published objective amount');
    assert.strictEqual(cappedTalk.updates.length, 0);
    assert.strictEqual(saved.length, 2, 'capped talk objective must not perform extra writes');

    assert.ok(serviceSource.indexOf("objective.type !== 'talk'") !== -1, 'service must ignore non-talk objectives');
    assert.ok(serviceSource.indexOf('objectiveTarget !== targetProfileId') !== -1, 'service must match the published target to the stable NPC profile id');
    assert.ok(serviceSource.indexOf('Math.min(amount, currentProgress + 1)') !== -1, 'talk progress must increment by one and clamp to amount');

    assert.ok(playerSource.indexOf('MissionService = require("../story/mission-service")') !== -1, 'Player must load MissionService');
    assert.ok(playerSource.indexOf('this.storyOperationChain = Promise.resolve()') !== -1, 'Player must serialize Story Runtime mutations');
    assert.ok(playerSource.indexOf('queueStoryOperation: function(operation)') !== -1, 'Player must expose an internal Story Runtime operation queue');
    assert.ok(playerSource.indexOf('progressStoryTalk: function(npc)') !== -1, 'Player must expose internal talk objective progress');
    assert.ok(playerSource.indexOf("String(npc.editorData.id || '').trim()") !== -1, 'talk objectives must use the server-side stable World Editor NPC profile id');
    assert.ok(playerSource.indexOf('MissionService.progressTalkObjectives({') !== -1, 'Player must delegate talk progress to MissionService');
    assert.ok(playerSource.indexOf('self.progressStoryTalk(npc).catch(function(error)') !== -1, 'validated NPC interactions must attempt talk objective progress');
    assert.ok(playerSource.indexOf('startStoryMission: function(storyId, missionId)') !== -1, 'Player must expose internal startStoryMission');
    assert.ok(playerSource.indexOf('runtime: self.storyRuntime') !== -1, 'queued Story Runtime operations must use the live runtime');
    assert.ok(playerSource.indexOf('progressStore: self.storyProgress') !== -1, 'queued Story Runtime operations must use account persistence when present');
    assert.ok(playerSource.indexOf('states: self.storyState') !== -1, 'queued Story Runtime operations must read the latest in-memory story state');
    assert.ok(playerSource.indexOf('self.storyState = MissionService.upsertStoryState(self.storyState, result.state)') !== -1, 'Player must update in-memory story state after start');
    assert.ok(
        playerSource.indexOf('self.progressStoryTalk(npc).catch(function(error)') < playerSource.indexOf('self.npcinteract_callback(npc);'),
        'talk progress must be queued before the same interaction can enqueue a linked mission start'
    );

    console.log('Player story mission and talk objective smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
