'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    StoryProgressStore = require('../server/story/progress-store').StoryProgressStore,
    normalizeStoryProgress = require('../server/story/progress-store').normalizeStoryProgress;

async function main() {
    var rows = new Map(), tx = [], released = 0,
        client = {
            query: async function(sql, params) {
                tx.push({sql: String(sql), params: params || []});
                if(String(sql).indexOf("INSERT INTO character_progress") === 0) {
                    rows.set(String(params[1]), JSON.parse(params[2]));
                }
                return {rowCount: 1, rows: []};
            },
            release: function() { released += 1; }
        },
        postgres = {
            connect: async function() { return client; },
            query: async function(sql, params) {
                sql = String(sql);
                if(sql.indexOf("SELECT value FROM character_progress") === 0) {
                    var one = rows.get(String(params[1]));
                    return one ? {rowCount: 1, rows: [{value: one}]} : {rowCount: 0, rows: []};
                }
                if(sql.indexOf("SELECT key, value FROM character_progress") === 0) {
                    var result = [];
                    rows.forEach(function(value, key) { result.push({key: key, value: value}); });
                    result.sort(function(a, b) { return a.key.localeCompare(b.key); });
                    return {rowCount: result.length, rows: result};
                }
                throw new Error('Unexpected SQL in story progress smoke test: ' + sql);
            }
        },
        store = new StoryProgressStore({postgres: postgres});

    var normalized = normalizeStoryProgress({
        storyId: ' bad story! ',
        activeMissionId: ' mission 1! ',
        objectiveProgress: -10,
        completedMissionIds: ['m1', 'm1', 'm@2', '', null],
        flags: {good_flag: true, 'bad key!': 'ok', nested: {no: true}, long: 'x'.repeat(400)}
    });
    assert.strictEqual(normalized.storyId, 'badstory');
    assert.strictEqual(normalized.activeMissionId, 'mission1');
    assert.strictEqual(normalized.objectiveProgress, 0);
    assert.deepStrictEqual(normalized.completedMissionIds, ['m1', 'm2']);
    assert.strictEqual(normalized.flags.good_flag, true);
    assert.strictEqual(normalized.flags.badkey, 'ok');
    assert.strictEqual(normalized.flags.nested, undefined);
    assert.strictEqual(normalized.flags.long.length, 250);

    assert.strictEqual(await store.get(7, 'story-one'), null);
    assert.deepStrictEqual(await store.list(0), []);

    var saved = await store.save(7, 'story-one', {
        activeMissionId: 'mission-a',
        objectiveProgress: 3,
        completedMissionIds: ['intro'],
        flags: {met_guard: true},
        startedAt: '2026-10-17T08:00:00.000Z'
    });
    assert.strictEqual(saved.storyId, 'story-one');
    assert.strictEqual(saved.activeMissionId, 'mission-a');
    assert.strictEqual(saved.objectiveProgress, 3);
    assert.deepStrictEqual(saved.completedMissionIds, ['intro']);
    assert.strictEqual(saved.flags.met_guard, true);
    assert.strictEqual(saved.startedAt, '2026-10-17T08:00:00.000Z');
    assert.ok(saved.updatedAt);
    assert.ok(tx.some(function(row) { return row.sql === 'BEGIN'; }));
    assert.ok(tx.some(function(row) { return row.sql.indexOf('pg_advisory_xact_lock') !== -1 && row.params[0] === 7; }));
    assert.ok(tx.some(function(row) { return row.sql.indexOf("namespace, key, value") !== -1 && row.params[0] === 7 && row.params[1] === 'story-one'; }));
    assert.ok(tx.some(function(row) { return row.sql === 'COMMIT'; }));
    assert.strictEqual(released, 1);

    var loaded = await store.get(7, 'story-one');
    assert.strictEqual(loaded.storyId, 'story-one');
    assert.strictEqual(loaded.activeMissionId, 'mission-a');
    assert.strictEqual(loaded.objectiveProgress, 3);

    await store.save(7, 'another-story', {activeMissionId: 'm2', objectiveProgress: 1});
    var listed = await store.list(7);
    assert.strictEqual(listed.length, 2);
    assert.deepStrictEqual(listed.map(function(item) { return item.storyId; }), ['another-story', 'story-one']);

    await assert.rejects(function() { return store.save(0, 'story', {}); }, /Personagem inválido/);
    await assert.rejects(function() { return store.save(7, '!!!', {}); }, /História inválida/);

    var root = path.join(__dirname, '..'),
        bootstrap = fs.readFileSync(path.join(root, 'server', 'bootstrap.js'), 'utf8'),
        mainServer = fs.readFileSync(path.join(root, 'server', 'js', 'main.js'), 'utf8'),
        player = fs.readFileSync(path.join(root, 'server', 'js', 'player.js'), 'utf8');

    assert.ok(bootstrap.indexOf("StoryProgressStore = require('./story/progress-store').StoryProgressStore") !== -1, 'bootstrap must require StoryProgressStore');
    assert.ok(bootstrap.indexOf('storyProgressStore = new StoryProgressStore({postgres: services.postgres})') !== -1, 'bootstrap must instantiate StoryProgressStore');
    assert.ok(bootstrap.indexOf('story_progress: storyProgressStore') !== -1, 'bootstrap must inject story progress into game config');
    assert.ok(mainServer.indexOf("connection.storyProgress = context.type === 'account' ? (config.story_progress || null) : null") !== -1, 'authenticated account connection must receive story progress store');
    assert.ok(mainServer.indexOf('connection.storyProgress = null;') !== -1, 'guest connection must not receive persistent story progress');
    assert.ok(player.indexOf('this.storyProgress = connection.storyProgress || null;') !== -1, 'Player must retain story progress store reference');

    console.log('Story progress store smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
