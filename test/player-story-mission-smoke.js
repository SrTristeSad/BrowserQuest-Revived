'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    MissionService = require('../server/story/mission-service');

function main() {
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
        playerSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'js', 'player.js'), 'utf8');

    assert.strictEqual(original[0].activeMissionId, 'old', 'upsert must not mutate the input list');
    assert.strictEqual(replaced.length, 2);
    assert.strictEqual(replaced[0].activeMissionId, 'new');
    assert.strictEqual(replaced[0].objectiveProgress, 0);
    assert.deepStrictEqual(replaced[0].completedMissionIds, ['old']);
    assert.strictEqual(replaced[0].flags.ready, true);
    assert.strictEqual(replaced[1].storyId, 'two');
    assert.strictEqual(appended.length, 3);
    assert.strictEqual(appended[2].storyId, 'three');

    assert.ok(playerSource.indexOf('MissionService = require("../story/mission-service")') !== -1, 'Player must load MissionService');
    assert.ok(playerSource.indexOf('startStoryMission: function(storyId, missionId)') !== -1, 'Player must expose internal startStoryMission');
    assert.ok(playerSource.indexOf('runtime: this.storyRuntime') !== -1, 'Player must use its live Story Runtime');
    assert.ok(playerSource.indexOf('progressStore: this.storyProgress') !== -1, 'Player must use account StoryProgressStore when present');
    assert.ok(playerSource.indexOf('states: this.storyState') !== -1, 'Player must use current story state as input');
    assert.ok(playerSource.indexOf('self.storyState = MissionService.upsertStoryState(self.storyState, result.state)') !== -1, 'Player must update in-memory story state after start');

    console.log('Player story mission smoke test passed.');
}

try { main(); }
catch(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
}
