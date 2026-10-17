'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    StorySync = require('../server/story/story-sync'),
    StoryProtocol = require('../shared/js/storyprotocol'),
    FormatChecker = require('../server/js/format').FormatChecker;

function runtime() {
    var missions = {
        hunt: {
            storyId: 's1', chapterId: 'c1', mission: {
                id: 'hunt', title: 'Caça aos ratos', summary: 'Proteja a vila.',
                giverNpc: 'guard', objective: {type: 'kill', target: 'rat-alpha', amount: 3, text: 'Derrote três ratos.'}, choices: []
            }
        },
        fork: {
            storyId: 's2', chapterId: 'c2', mission: {
                id: 'fork', title: 'Qual caminho?', giverNpc: 'guide', objective: {type: 'talk', target: 'guide', amount: 1},
                choices: [
                    {text: 'Ponte', nextMissionId: 'bridge', condition: 'flag:open'},
                    {text: 'Floresta', nextMissionId: 'forest', condition: '!flag:open'}
                ]
            }
        },
        bridge: {storyId: 's2', chapterId: 'c2', mission: {id: 'bridge', title: 'Ponte', giverNpc: 'captain', objective: {type: 'talk', target: 'captain', amount: 1}, choices: []}},
        forest: {storyId: 's2', chapterId: 'c2', mission: {id: 'forest', title: 'Floresta', giverNpc: 'ranger', objective: {type: 'talk', target: 'ranger', amount: 1}, choices: []}}
    };
    return {
        getMission: function(storyId, missionId) {
            var entry = missions[missionId];
            return entry && entry.storyId === storyId ? entry : null;
        },
        getStory: function(storyId) {
            return storyId === 's1' ? {id: storyId, title: 'Defesa da Vila'} : {id: storyId, title: 'Caminhos'};
        }
    };
}

async function main() {
    var player = {
            id: 10,
            type: 'player',
            hasEnteredGame: true,
            storyRuntime: runtime(),
            storyState: [
                {storyId: 's1', activeMissionId: 'hunt', objectiveProgress: 2, completedMissionIds: [], flags: {secret: 'never-send'}},
                {storyId: 's2', activeMissionId: '', pendingChoiceMissionId: 'fork', objectiveProgress: 0, completedMissionIds: ['fork'], flags: {open: true, privateFlag: 9}}
            ],
            sent: [],
            send: function(message) { this.sent.push(message); },
            queueStoryOperation: function(operation) { return Promise.resolve().then(operation); },
            onMessage: function(callback) { this.message_callback = callback; }
        },
        payload = StorySync.buildClientState(player),
        checker = new FormatChecker(),
        clientSource = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'storyui.js'), 'utf8'),
        homeSource = fs.readFileSync(path.join(__dirname, '..', 'client', 'js', 'home.js'), 'utf8');

    assert.strictEqual(payload.missions.length, 1);
    assert.strictEqual(payload.missions[0].missionId, 'hunt');
    assert.strictEqual(payload.missions[0].progress, 2);
    assert.strictEqual(payload.missions[0].amount, 3);
    assert.strictEqual(payload.choices.length, 1);
    assert.strictEqual(payload.choices[0].choices.length, 1, 'client must only receive currently eligible choices');
    assert.strictEqual(payload.choices[0].choices[0].text, 'Ponte');
    assert.strictEqual(JSON.stringify(payload).indexOf('secret'), -1, 'server-only story flags must not leak into tracker payload');
    assert.strictEqual(JSON.stringify(payload).indexOf('condition'), -1, 'branch conditions must stay server-side');

    assert.strictEqual(checker.check([StoryProtocol.STORY_CHOICE_SELECT, 's2', 'fork', 0]), true);
    assert.strictEqual(checker.check([StoryProtocol.STORY_CHOICE_SELECT, 's2', 'fork', '0']), false);
    assert.strictEqual(checker.check([StoryProtocol.STORY_CHOICE_SELECT, 's2', 'fork']), false);

    StorySync.sendPlayerState(player);
    assert.strictEqual(player.sent.length, 1);
    assert.strictEqual(player.sent[0][0], StoryProtocol.STORY_STATE);

    assert.strictEqual(StorySync.attachPlayer(player), true);
    player.storyState[0].objectiveProgress = 3;
    await player.queueStoryOperation(function() { return {changed: true}; });
    assert.strictEqual(player.sent[player.sent.length - 1][0], StoryProtocol.STORY_STATE, 'changed story operations must push realtime tracker state');
    assert.strictEqual(player.sent[player.sent.length - 1][1].missions[0].progress, 3);

    assert.ok(clientSource.indexOf('StoryProtocol.STORY_STATE') >= 0);
    assert.ok(clientSource.indexOf('StoryProtocol.STORY_CHOICE_SELECT') >= 0);
    assert.ok(clientSource.indexOf('textContent') >= 0, 'tracker must render server text without HTML injection');
    assert.strictEqual(clientSource.indexOf('innerHTML'), -1, 'story UI must not render story data through innerHTML');
    assert.ok(homeSource.indexOf("require(['storyui'], function()") >= 0, 'story UI must load before the classic main client');

    console.log('Realtime story tracker and client sync smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
