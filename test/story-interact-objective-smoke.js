'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    MissionService = require('../server/story/mission-service'),
    StoryInteractProgress = require('../server/story/interact-progress');

function createPlayer(states, runtime, progressStore) {
    return {
        id: 501,
        name: 'InteractTester',
        type: 'player',
        x: 10,
        y: 10,
        characterId: 77,
        storyRuntime: runtime,
        storyProgress: progressStore,
        storyState: states,
        storyOperationChain: Promise.resolve(),
        npcinteract_callback: null,
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
        interactSource = fs.readFileSync(path.join(root, 'server', 'story', 'interact-progress.js'), 'utf8'),
        playerSource = fs.readFileSync(path.join(root, 'server', 'js', 'player.js'), 'utf8'),
        killSource = fs.readFileSync(path.join(root, 'server', 'story', 'kill-progress.js'), 'utf8'),
        saved = [],
        runtime = {
            getMission: function(storyId, missionId) {
                if(storyId === 'story-interact' && missionId === 'inspect-guard') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-interact',
                        mission: {
                            id: missionId,
                            objective: {type: 'interact', target: 'npc:guard-captain', amount: 2}
                        }
                    };
                }
                if(storyId === 'story-chest' && missionId === 'open-cache') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-chest',
                        mission: {
                            id: missionId,
                            objective: {type: 'interact', target: 'chest:20:30', amount: 1}
                        }
                    };
                }
                if(storyId === 'story-talk' && missionId === 'talk-guard') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-talk',
                        mission: {
                            id: missionId,
                            objective: {type: 'talk', target: 'guard-captain', amount: 1}
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
        baseStates = [
            {
                version: 1,
                storyId: 'story-interact',
                activeMissionId: 'inspect-guard',
                objectiveProgress: 0,
                completedMissionIds: ['intro'],
                flags: {permissionGranted: true},
                startedAt: '2026-10-17T00:00:00.000Z',
                updatedAt: '2026-10-17T00:00:00.000Z'
            },
            {
                version: 1,
                storyId: 'story-talk',
                activeMissionId: 'talk-guard',
                objectiveProgress: 0
            }
        ],
        npc = {type: 'npc', x: 11, y: 10, editorData: {id: 'guard-captain'}},
        legacyNpc = {type: 'npc', x: 11, y: 10},
        first,
        wrong,
        capped,
        states = baseStates,
        player,
        originalNpcCallbackCount = 0,
        opened = 0,
        FakeWorldServer,
        world,
        remotePlayer,
        chestPlayer,
        chest;

    assert.strictEqual(StoryInteractProgress.resolveInteractionTarget(npc), 'npc:guard-captain');
    assert.strictEqual(StoryInteractProgress.resolveInteractionTarget(legacyNpc), '', 'legacy NPCs without a stable profile must not become interact targets');
    assert.strictEqual(StoryInteractProgress.canInteractWith({x: 10, y: 10}, {x: 11, y: 10}), true, 'orthogonal adjacency must be accepted');
    assert.strictEqual(StoryInteractProgress.canInteractWith({x: 10, y: 10}, {x: 11, y: 11}), false, 'diagonal interaction must be rejected');
    assert.strictEqual(StoryInteractProgress.canInteractWith({x: 10, y: 10}, {x: 10, y: 10}), false, 'same-tile spoofing must be rejected');
    assert.strictEqual(StoryInteractProgress.canInteractWith({x: 10, y: 10}, {x: 20, y: 20}), false, 'remote interaction must be rejected');

    wrong = await StoryInteractProgress.progressInteractObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetId: 'npc:someone-else',
        states: states
    });
    assert.strictEqual(wrong.changed, false);
    assert.strictEqual(wrong.updates.length, 0);
    assert.strictEqual(saved.length, 0, 'wrong interact target must not persist progress');

    first = await StoryInteractProgress.progressInteractObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetId: 'npc:guard-captain',
        states: states
    });
    assert.strictEqual(first.changed, true);
    assert.strictEqual(first.updates.length, 1, 'only the matching interact objective may advance');
    assert.strictEqual(first.updates[0].state.objectiveProgress, 1);
    assert.strictEqual(first.updates[0].objectiveAmount, 2);
    assert.strictEqual(first.updates[0].objectiveComplete, false);
    assert.strictEqual(first.updates[0].state.activeMissionId, 'inspect-guard', 'interact progress must not complete the mission yet');
    assert.deepStrictEqual(first.updates[0].state.completedMissionIds, ['intro']);
    assert.strictEqual(first.updates[0].state.flags.permissionGranted, true);
    assert.strictEqual(saved.length, 1);

    states = MissionService.upsertStoryState(states, first.updates[0].state);
    player = createPlayer(states, runtime, progressStore);
    player.npcinteract_callback = function() { originalNpcCallbackCount += 1; };
    assert.strictEqual(StoryInteractProgress.wrapNpcInteraction(player), true);
    player.npcinteract_callback(npc);
    await player.storyOperationChain;
    assert.strictEqual(originalNpcCallbackCount, 1, 'existing NPC interaction callback must still execute');
    assert.strictEqual(MissionService.findStoryState(player.storyState, 'story-interact').objectiveProgress, 2);

    capped = await StoryInteractProgress.progressInteractObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetId: 'npc:guard-captain',
        states: player.storyState
    });
    assert.strictEqual(capped.changed, false, 'interact progress must stop at objective.amount');
    assert.strictEqual(capped.updates.length, 0);

    FakeWorldServer = function() {
        this.enter_callback = null;
    };
    FakeWorldServer.prototype.createChest = function(x, y) {
        return {type: 'item', kind: 37, x: x, y: y};
    };
    FakeWorldServer.prototype.handleOpenedChest = function(targetChest) {
        opened += 1;
        targetChest.opened = true;
    };
    FakeWorldServer.prototype.onPlayerEnter = function(callback) {
        this.enter_callback = callback;
    };

    assert.strictEqual(StoryInteractProgress.attach(FakeWorldServer), true);
    assert.strictEqual(StoryInteractProgress.attach(FakeWorldServer), true, 'attach must be idempotent');
    world = new FakeWorldServer();
    chest = world.createChest(20, 30, []);
    assert.strictEqual(chest.storyInteractionId, 'chest:20:30', 'chests must receive a stable coordinate-based interaction identity server-side');
    assert.strictEqual(StoryInteractProgress.resolveInteractionTarget(chest), 'chest:20:30');

    remotePlayer = createPlayer([], runtime, progressStore);
    remotePlayer.x = 1;
    remotePlayer.y = 1;
    assert.strictEqual(world.handleOpenedChest(chest, remotePlayer), false, 'remote OPEN must be rejected before the original chest handler runs');
    assert.strictEqual(opened, 0);

    chestPlayer = createPlayer([{
        version: 1,
        storyId: 'story-chest',
        activeMissionId: 'open-cache',
        objectiveProgress: 0
    }], runtime, progressStore);
    chestPlayer.x = 19;
    chestPlayer.y = 30;
    assert.strictEqual(world.handleOpenedChest(chest, chestPlayer), true, 'adjacent OPEN must be accepted');
    await chestPlayer.storyOperationChain;
    assert.strictEqual(opened, 1, 'accepted OPEN must preserve the original chest behavior');
    assert.strictEqual(chest.opened, true);
    assert.strictEqual(MissionService.findStoryState(chestPlayer.storyState, 'story-chest').objectiveProgress, 1, 'accepted chest interaction must advance the matching objective');

    assert.ok(playerSource.indexOf('npcDistance === 1 && self.npcinteract_callback') !== -1, 'NPC interact hook must remain downstream of server-side distance validation');
    assert.ok(interactSource.indexOf("return profileId ? 'npc:' + profileId : ''") !== -1, 'NPC interact identity must come from the stable World Editor profile');
    assert.ok(interactSource.indexOf("chest.storyInteractionId = 'chest:'") !== -1, 'chest identity must be assigned server-side from its published position');
    assert.ok(interactSource.indexOf('(dx + dy === 1)') !== -1, 'chest OPEN hardening must require orthogonal adjacency');
    assert.ok(interactSource.indexOf("objective.type !== 'interact'") !== -1, 'interact progress must ignore other objective types');
    assert.ok(interactSource.indexOf('objectiveTarget !== targetId') !== -1, 'interact progress must require exact canonical target');
    assert.ok(killSource.indexOf('StoryInteractProgress.attach(WorldServer);') !== -1, 'Story Runtime startup hook must attach interact support before worlds are created');

    console.log('Story interact objective smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
