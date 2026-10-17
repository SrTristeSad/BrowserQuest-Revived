'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    Checkpoint = require('../server/js/checkpoint'),
    MapClass = require('../server/js/map'),
    MissionService = require('../server/story/mission-service'),
    StoryVisitProgress = require('../server/story/visit-progress');

async function main() {
    var root = path.join(__dirname, '..'),
        checkpointSource = fs.readFileSync(path.join(root, 'server', 'js', 'checkpoint.js'), 'utf8'),
        mapSource = fs.readFileSync(path.join(root, 'server', 'js', 'map.js'), 'utf8'),
        visitSource = fs.readFileSync(path.join(root, 'server', 'story', 'visit-progress.js'), 'utf8'),
        killSource = fs.readFileSync(path.join(root, 'server', 'story', 'kill-progress.js'), 'utf8'),
        worldStoreSource = fs.readFileSync(path.join(root, 'server', 'admin', 'world-store.js'), 'utf8'),
        checkpoint14 = new Checkpoint(14, 32, 81, 10, 2),
        checkpoint2 = new Checkpoint(2, 40, 81, 4, 3),
        map = Object.create(MapClass.prototype),
        saved = [],
        runtime = {
            getMission: function(storyId, missionId) {
                if(storyId === 'story-visit' && missionId === 'visit-graveyard') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-visit',
                        mission: {
                            id: missionId,
                            objective: {type: 'visit', locationId: 'checkpoint:14', amount: 2}
                        }
                    };
                }
                if(storyId === 'story-other' && missionId === 'talk-guard') {
                    return {
                        storyId: storyId,
                        chapterId: 'chapter-other',
                        mission: {
                            id: missionId,
                            objective: {type: 'talk', target: 'npc-guard', amount: 1}
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
                storyId: 'story-visit',
                activeMissionId: 'visit-graveyard',
                objectiveProgress: 0,
                completedMissionIds: ['intro'],
                flags: {mapGiven: true},
                startedAt: '2026-10-17T00:00:00.000Z',
                updatedAt: '2026-10-17T00:00:00.000Z'
            },
            {
                version: 1,
                storyId: 'story-other',
                activeMissionId: 'talk-guard',
                objectiveProgress: 0
            }
        ],
        states = baseStates,
        wrong,
        first,
        second,
        capped,
        fakePlayer,
        savedBeforeMovement;

    assert.strictEqual(checkpoint14.getVisitLocationId(), 'checkpoint:14', 'checkpoint visit IDs must be stable and namespaced');
    assert.strictEqual(checkpoint14.containsPosition(32, 81), true, 'checkpoint must include its top-left tile');
    assert.strictEqual(checkpoint14.containsPosition(41, 82), true, 'checkpoint must include the last tile inside its rectangle');
    assert.strictEqual(checkpoint14.containsPosition(42, 82), false, 'checkpoint width must use an exclusive upper bound');
    assert.strictEqual(checkpoint14.containsPosition(41, 83), false, 'checkpoint height must use an exclusive upper bound');

    map.checkpointList = [checkpoint14, checkpoint2];
    assert.deepStrictEqual(map.getVisitLocationIdsAt(33, 81), ['checkpoint:14']);
    assert.deepStrictEqual(map.getVisitLocationIdsAt(40, 81), ['checkpoint:14', 'checkpoint:2'], 'overlapping checkpoints must resolve deterministically');
    assert.deepStrictEqual(map.getVisitLocationIdsAt(10, 10), []);

    wrong = await StoryVisitProgress.progressVisitObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        locationId: 'checkpoint:13',
        states: states
    });
    assert.strictEqual(wrong.changed, false, 'wrong checkpoint must not advance visit objectives');
    assert.strictEqual(wrong.updates.length, 0);
    assert.strictEqual(saved.length, 0, 'wrong checkpoint must not persist progress');

    first = await StoryVisitProgress.progressVisitObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        locationId: 'checkpoint:14',
        states: states
    });
    assert.strictEqual(first.changed, true);
    assert.strictEqual(first.updates.length, 1, 'only the matching active visit mission may advance');
    assert.strictEqual(first.updates[0].state.storyId, 'story-visit');
    assert.strictEqual(first.updates[0].state.activeMissionId, 'visit-graveyard', 'visit progress must not complete the mission yet');
    assert.strictEqual(first.updates[0].state.objectiveProgress, 1);
    assert.strictEqual(first.updates[0].objectiveAmount, 2);
    assert.strictEqual(first.updates[0].objectiveComplete, false);
    assert.deepStrictEqual(first.updates[0].state.completedMissionIds, ['intro']);
    assert.strictEqual(first.updates[0].state.flags.mapGiven, true);
    assert.strictEqual(saved.length, 1);

    states = MissionService.upsertStoryState(states, first.updates[0].state);
    second = await StoryVisitProgress.progressVisitObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        locationId: 'checkpoint:14',
        states: states
    });
    assert.strictEqual(second.updates[0].state.objectiveProgress, 2);
    assert.strictEqual(second.updates[0].objectiveComplete, true, 'reaching visit amount may be reported without concluding the mission');
    assert.strictEqual(second.updates[0].state.activeMissionId, 'visit-graveyard');

    states = MissionService.upsertStoryState(states, second.updates[0].state);
    capped = await StoryVisitProgress.progressVisitObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        locationId: 'checkpoint:14',
        states: states
    });
    assert.strictEqual(capped.changed, false, 'visit progress must stop at objective.amount');
    assert.strictEqual(capped.updates.length, 0);
    assert.strictEqual(saved.length, 2, 'capped visit objective must not write again');

    saved.length = 0;
    fakePlayer = {
        id: 501,
        name: 'VisitTester',
        type: 'player',
        x: 10,
        y: 10,
        server: {map: map},
        characterId: 77,
        storyRuntime: runtime,
        storyProgress: progressStore,
        storyState: baseStates,
        storyOperationChain: Promise.resolve(),
        move_callback: function() {},
        setPosition: function(x, y) {
            this.x = x;
            this.y = y;
        },
        onMove: function(callback) {
            this.move_callback = callback;
        },
        queueStoryOperation: function(operation) {
            var previous = this.storyOperationChain || Promise.resolve(),
                run = previous.catch(function() { return null; }).then(operation);
            this.storyOperationChain = run.catch(function() { return null; });
            return run;
        }
    };

    assert.strictEqual(StoryVisitProgress.wrapPlayerMovement(fakePlayer, {map: map}), true);
    fakePlayer.setPosition(33, 81);
    fakePlayer.move_callback(33, 81);
    await fakePlayer.storyOperationChain;
    assert.strictEqual(MissionService.findStoryState(fakePlayer.storyState, 'story-visit').objectiveProgress, 1, 'accepted move from outside into checkpoint must advance visit');
    assert.strictEqual(saved.length, 1);

    fakePlayer.setPosition(34, 81);
    fakePlayer.move_callback(34, 81);
    await fakePlayer.storyOperationChain;
    assert.strictEqual(MissionService.findStoryState(fakePlayer.storyState, 'story-visit').objectiveProgress, 1, 'moving inside the same checkpoint must not repeat visit progress');
    assert.strictEqual(saved.length, 1);

    fakePlayer.setPosition(10, 10);
    fakePlayer.move_callback(10, 10);
    await fakePlayer.storyOperationChain;
    fakePlayer.setPosition(35, 81);
    fakePlayer.move_callback(35, 81);
    await fakePlayer.storyOperationChain;
    assert.strictEqual(MissionService.findStoryState(fakePlayer.storyState, 'story-visit').objectiveProgress, 2, 'leaving and re-entering may advance a multi-count visit objective');
    assert.strictEqual(saved.length, 2);

    fakePlayer.storyState = baseStates;
    saved.length = 0;
    fakePlayer.x = 10;
    fakePlayer.y = 10;
    fakePlayer.__storyVisitPreviousLocationIds = [];
    fakePlayer.setPosition(33, 81); // Simulate teleport/loot-move: no MOVE callback follows.
    savedBeforeMovement = saved.length;
    fakePlayer.setPosition(34, 81);
    fakePlayer.move_callback(34, 81);
    await fakePlayer.storyOperationChain;
    assert.strictEqual(MissionService.findStoryState(fakePlayer.storyState, 'story-visit').objectiveProgress, 0, 'a prior non-MOVE position change must not become a fake visit on the next move inside the checkpoint');
    assert.strictEqual(saved.length, savedBeforeMovement);

    assert.ok(checkpointSource.indexOf("'checkpoint:' + checkpointId") !== -1, 'checkpoint identity must be generated server-side');
    assert.ok(mapSource.indexOf('getVisitLocationIdsAt: function(x, y)') !== -1, 'map must resolve visit locations from coordinates');
    assert.ok(mapSource.indexOf('checkpoint.containsPosition(x, y)') !== -1, 'map must validate checkpoint geometry server-side');
    assert.ok(visitSource.indexOf("objective.type !== 'visit'") !== -1, 'visit progress must ignore non-visit objectives');
    assert.ok(visitSource.indexOf('objectiveLocationId !== locationId') !== -1, 'visit progress must require exact published locationId');
    assert.ok(visitSource.indexOf('previous.indexOf(locationId) < 0') !== -1, 'visit progress must require entering a location, not merely remaining inside');
    assert.ok(visitSource.indexOf('this.__storyVisitPreviousLocationIds = resolveLocationIds') !== -1, 'previous authoritative position areas must be captured before setPosition');
    assert.ok(visitSource.indexOf('player.onMove(function(x, y)') !== -1, 'only the validated MOVE callback path should trigger visit evaluation');
    assert.ok(killSource.indexOf('StoryVisitProgress.attach(WorldServer);') !== -1, 'game startup story hooks must attach visit progress before worlds are created');
    assert.ok(worldStoreSource.indexOf('published.checkpoints=clone(map.checkpoints);') !== -1, 'World Editor publication must preserve checkpoint identities');

    console.log('Story visit objective smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
