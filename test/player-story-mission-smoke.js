'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    MissionService = require('../server/story/mission-service'),
    StoryKillProgress = require('../server/story/kill-progress'),
    Types = require('../shared/js/gametypes');

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
        killSource = fs.readFileSync(path.join(root, 'server', 'story', 'kill-progress.js'), 'utf8'),
        mainSource = fs.readFileSync(path.join(root, 'server', 'js', 'main.js'), 'utf8'),
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
                if(storyId === 'story-custom-kill' && missionId === 'kill-elite-rat') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-three',
                        mission: {
                            id: missionId,
                            objective: {type: 'kill', target: 'mob-elite-rat', amount: 1}
                        }
                    };
                }
                if(storyId === 'story-collect' && missionId === 'collect-flasks') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-four',
                        mission: {
                            id: missionId,
                            objective: {type: 'collect', target: 'flask', amount: 2}
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
                objectiveProgress: 0,
                completedMissionIds: [],
                flags: {huntStarted: true},
                startedAt: '2026-10-17T00:00:00.000Z',
                updatedAt: '2026-10-17T00:00:00.000Z'
            },
            {
                version: 1,
                storyId: 'story-custom-kill',
                activeMissionId: 'kill-elite-rat',
                objectiveProgress: 0
            },
            {
                version: 1,
                storyId: 'story-collect',
                activeMissionId: 'collect-flasks',
                objectiveProgress: 0,
                completedMissionIds: ['meet-alchemist'],
                flags: {hasBottle: true},
                startedAt: '2026-10-17T00:00:00.000Z',
                updatedAt: '2026-10-17T00:00:00.000Z'
            }
        ],
        wrongTarget,
        firstTalk,
        secondTalk,
        cappedTalk,
        wrongKill,
        firstKill,
        customKill,
        fakePlayer,
        savedBeforeCollect,
        wrongCollect,
        firstCollect,
        secondCollect,
        cappedCollect;

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

    wrongKill = await MissionService.progressKillObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetId: 'goblin',
        states: states
    });
    assert.strictEqual(wrongKill.changed, false, 'wrong mob target must not advance kill objectives');
    assert.strictEqual(saved.length, 2, 'wrong mob target must not write story progress');

    firstKill = await MissionService.progressKillObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetId: 'rat',
        states: states
    });
    assert.strictEqual(firstKill.changed, true);
    assert.strictEqual(firstKill.updates.length, 1, 'classic rat target must advance only the classic rat mission');
    assert.strictEqual(firstKill.updates[0].state.storyId, 'story-kill');
    assert.strictEqual(firstKill.updates[0].state.activeMissionId, 'kill-rats', 'kill progress must not complete the mission yet');
    assert.strictEqual(firstKill.updates[0].state.objectiveProgress, 1);
    assert.strictEqual(firstKill.updates[0].objectiveAmount, 3);
    assert.strictEqual(firstKill.updates[0].objectiveComplete, false);
    assert.strictEqual(firstKill.updates[0].state.flags.huntStarted, true);

    states = MissionService.upsertStoryState(states, firstKill.updates[0].state);
    customKill = await MissionService.progressKillObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetId: 'mob-elite-rat',
        states: states
    });
    assert.strictEqual(customKill.changed, true);
    assert.strictEqual(customKill.updates.length, 1, 'custom profile id must match only its published mission target');
    assert.strictEqual(customKill.updates[0].state.storyId, 'story-custom-kill');
    assert.strictEqual(customKill.updates[0].state.objectiveProgress, 1);
    assert.strictEqual(customKill.updates[0].objectiveComplete, true);
    assert.strictEqual(customKill.updates[0].state.activeMissionId, 'kill-elite-rat', 'reaching kill amount must not conclude the mission yet');

    assert.strictEqual(StoryKillProgress.resolveMobTarget({kind: Types.Entities.RAT, editorData: null}), 'rat', 'classic mobs must use canonical kind fallback');
    assert.strictEqual(StoryKillProgress.resolveMobTarget({kind: Types.Entities.RAT, editorData: {id: 'mob-elite-rat'}}), 'mob-elite-rat', 'custom mobs must prefer stable profile id over base kind');

    fakePlayer = {
        type: 'player',
        characterId: 77,
        storyRuntime: runtime,
        storyProgress: progressStore,
        storyState: states,
        queueStoryOperation: function(operation) { return Promise.resolve().then(operation); }
    };
    await StoryKillProgress.progressKill(fakePlayer, {type: 'mob', kind: Types.Entities.RAT, editorData: null});
    assert.strictEqual(MissionService.findStoryState(fakePlayer.storyState, 'story-kill').objectiveProgress, 2, 'authoritative kill bridge must update the player story state');

    savedBeforeCollect = saved.length;
    wrongCollect = await MissionService.progressCollectObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetKind: 'burger',
        states: states
    });
    assert.strictEqual(wrongCollect.changed, false, 'wrong collected item kind must not advance collect objectives');
    assert.strictEqual(wrongCollect.updates.length, 0);
    assert.strictEqual(saved.length, savedBeforeCollect, 'wrong collected item must not write story progress');

    firstCollect = await MissionService.progressCollectObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetKind: 'flask',
        states: states
    });
    assert.strictEqual(firstCollect.changed, true);
    assert.strictEqual(firstCollect.updates.length, 1, 'matching canonical item kind must advance only its collect mission');
    assert.strictEqual(firstCollect.updates[0].state.storyId, 'story-collect');
    assert.strictEqual(firstCollect.updates[0].state.activeMissionId, 'collect-flasks', 'collect progress must not complete the mission yet');
    assert.strictEqual(firstCollect.updates[0].state.objectiveProgress, 1);
    assert.strictEqual(firstCollect.updates[0].objectiveAmount, 2);
    assert.strictEqual(firstCollect.updates[0].objectiveComplete, false);
    assert.deepStrictEqual(firstCollect.updates[0].state.completedMissionIds, ['meet-alchemist']);
    assert.strictEqual(firstCollect.updates[0].state.flags.hasBottle, true);
    assert.strictEqual(saved.length, savedBeforeCollect + 1);

    states = MissionService.upsertStoryState(states, firstCollect.updates[0].state);
    secondCollect = await MissionService.progressCollectObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetKind: 'flask',
        states: states
    });
    assert.strictEqual(secondCollect.updates[0].state.objectiveProgress, 2);
    assert.strictEqual(secondCollect.updates[0].objectiveComplete, true, 'reaching collect amount may be reported without concluding the mission');
    assert.strictEqual(secondCollect.updates[0].state.activeMissionId, 'collect-flasks');

    states = MissionService.upsertStoryState(states, secondCollect.updates[0].state);
    cappedCollect = await MissionService.progressCollectObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetKind: 'flask',
        states: states
    });
    assert.strictEqual(cappedCollect.changed, false, 'collect progress must stop at the published objective amount');
    assert.strictEqual(cappedCollect.updates.length, 0);
    assert.strictEqual(saved.length, savedBeforeCollect + 2, 'capped collect objective must not perform extra writes');

    assert.ok(serviceSource.indexOf("objective.type !== 'talk'") !== -1, 'service must ignore non-talk objectives for talk progress');
    assert.ok(serviceSource.indexOf('objectiveTarget !== targetProfileId') !== -1, 'talk service must match the published target to the stable NPC profile id');
    assert.ok(serviceSource.indexOf("objective.type !== 'kill'") !== -1, 'kill service must ignore non-kill objectives');
    assert.ok(serviceSource.indexOf('objectiveTarget !== targetId') !== -1, 'kill service must match only the authoritative mob target');
    assert.ok(serviceSource.indexOf("objective.type !== 'collect'") !== -1, 'collect service must ignore non-collect objectives');
    assert.ok(serviceSource.indexOf('objectiveTarget !== targetKind') !== -1, 'collect service must match only the authoritative canonical item kind');
    assert.ok(serviceSource.indexOf('Math.min(amount, currentProgress + 1)') !== -1, 'objective progress must increment by one and clamp to amount');

    assert.ok(killSource.indexOf("mob.editorData.id") !== -1, 'kill bridge must prefer the stable World Editor mob profile id');
    assert.ok(killSource.indexOf('Types.getKindAsString(mob.kind)') !== -1, 'kill bridge must provide a canonical fallback for classic mobs');
    assert.ok(killSource.indexOf("entity.type === 'mob' && entity.hitPoints <= 0") !== -1, 'kill bridge must run only after the server sees a dead mob');
    assert.ok(killSource.indexOf("attacker.type === 'player'") !== -1, 'kill bridge must credit only a player attacker');
    assert.ok(killSource.indexOf('attacker.queueStoryOperation(function()') !== -1, 'kill bridge must reuse serialized Story Runtime mutations');
    assert.ok(mainSource.indexOf("StoryKillProgress = require('../story/kill-progress')") !== -1, 'game startup must load the authoritative story kill bridge');
    assert.ok(mainSource.indexOf('StoryKillProgress.attach(WorldServer);') !== -1, 'game startup must attach kill progress before worlds are created');

    assert.ok(playerSource.indexOf('MissionService = require("../story/mission-service")') !== -1, 'Player must load MissionService');
    assert.ok(playerSource.indexOf('this.storyOperationChain = Promise.resolve()') !== -1, 'Player must serialize Story Runtime mutations');
    assert.ok(playerSource.indexOf('queueStoryOperation: function(operation)') !== -1, 'Player must expose an internal Story Runtime operation queue');
    assert.ok(playerSource.indexOf('progressStoryTalk: function(npc)') !== -1, 'Player must expose internal talk objective progress');
    assert.ok(playerSource.indexOf("String(npc.editorData.id || '').trim()") !== -1, 'talk objectives must use the server-side stable World Editor NPC profile id');
    assert.ok(playerSource.indexOf('MissionService.progressTalkObjectives({') !== -1, 'Player must delegate talk progress to MissionService');
    assert.ok(playerSource.indexOf('self.progressStoryTalk(npc).catch(function(error)') !== -1, 'validated NPC interactions must attempt talk objective progress');
    assert.ok(playerSource.indexOf('progressStoryCollect: function(kind)') !== -1, 'Player must expose internal collect objective progress');
    assert.ok(playerSource.indexOf("String(Types.getKindAsString(kind) || '').trim()") !== -1, 'collect objectives must derive the canonical item kind on the server');
    assert.ok(playerSource.indexOf('if(!Types.isItem(kind) || !targetKind)') !== -1, 'collect progress must reject non-item kinds');
    assert.ok(playerSource.indexOf('MissionService.progressCollectObjectives({') !== -1, 'Player must delegate collect progress to MissionService');
    assert.ok(playerSource.indexOf('self.progressStoryCollect(kind).catch(function(error)') !== -1, 'accepted loot must attempt collect objective progress');
    assert.ok(
        playerSource.indexOf('self.server.removeEntity(item);') < playerSource.indexOf('self.progressStoryCollect(kind).catch(function(error)'),
        'collect progress must be triggered only after accepted loot removes the item from the world'
    );
    assert.ok(playerSource.indexOf('startStoryMission: function(storyId, missionId)') !== -1, 'Player must expose internal startStoryMission');
    assert.ok(playerSource.indexOf('runtime: self.storyRuntime') !== -1, 'queued Story Runtime operations must use the live runtime');
    assert.ok(playerSource.indexOf('progressStore: self.storyProgress') !== -1, 'queued Story Runtime operations must use account persistence when present');
    assert.ok(playerSource.indexOf('states: self.storyState') !== -1, 'queued Story Runtime operations must read the latest in-memory story state');
    assert.ok(playerSource.indexOf('self.storyState = MissionService.upsertStoryState(self.storyState, result.state)') !== -1, 'Player must update in-memory story state after start');
    assert.ok(
        playerSource.indexOf('self.progressStoryTalk(npc).catch(function(error)') < playerSource.indexOf('self.npcinteract_callback(npc);'),
        'talk progress must be queued before the same interaction can enqueue a linked mission start'
    );

    console.log('Player story mission, talk, kill and collect objective smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
