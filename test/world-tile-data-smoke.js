'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    WorldStore = require('../server/admin/world-store').WorldStore;

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-world-tiles-')),
    baseServerPath = path.join(dir, 'base-server.json'),
    baseClientPath = path.join(dir, 'base-client.json'),
    statePath = path.join(dir, 'state.json'),
    publishedServerPath = path.join(dir, 'published-server.json'),
    publishedClientPath = path.join(dir, 'published-client.json'),
    publishedClientJsPath = path.join(dir, 'published-client.js'),
    versionsDir = path.join(dir, 'versions'),
    storiesPath = path.join(dir, 'stories.json'),
    baseServer = {
        width: 4,
        height: 3,
        collisions: [],
        doors: [],
        checkpoints: [],
        chestAreas: [],
        staticChests: [],
        staticEntities: {},
        roamingAreas: []
    },
    baseTiles = [0,1,2,3,4,5,6,7,8,9,10,11],
    baseClient = {
        width: 4,
        height: 3,
        tilesize: 16,
        data: baseTiles.slice(),
        collisions: [],
        doors: [],
        checkpoints: [],
        blocking: [1],
        plateau: [2],
        high: [3],
        animated: {}
    },
    store,
    state,
    saved,
    reloaded,
    publishedClient,
    publishedServer,
    legacy;

try {
    fs.writeFileSync(baseServerPath, JSON.stringify(baseServer));
    fs.writeFileSync(baseClientPath, JSON.stringify(baseClient));
    fs.writeFileSync(storiesPath, JSON.stringify({stories: []}));

    store = new WorldStore({
        baseMapPath: baseServerPath,
        baseClientMapPath: baseClientPath,
        statePath: statePath,
        publishedMapPath: publishedServerPath,
        publishedClientJsonPath: publishedClientPath,
        publishedClientJsPath: publishedClientJsPath,
        versionsDir: versionsDir,
        storiesPath: storiesPath
    });

    state = store.load();
    assert.deepStrictEqual(state.map.data, baseTiles, 'initial editor state should import the visual client tiles');
    assert.strictEqual(state.map.data.length, baseServer.width * baseServer.height);

    state.map.data[0] = 42;
    state.map.data[1] = 'not-a-tile';
    state.map.data[2] = -1;
    state.map.data.length = 14;
    state.map.data[12] = 500;
    state.map.data[13] = 501;

    saved = store.save(state);
    assert.strictEqual(saved.map.data.length, 12, 'tile data must match map dimensions exactly');
    assert.strictEqual(saved.map.data[0], 42, 'valid edited tile should survive normalization');
    assert.strictEqual(saved.map.data[1], 1, 'invalid tile should fall back to the original client tile');
    assert.strictEqual(saved.map.data[2], -1, 'empty tile marker should remain valid');

    reloaded = store.load();
    assert.deepStrictEqual(reloaded.map.data, saved.map.data, 'tile edits should survive draft reload');

    store.publish();
    publishedClient = JSON.parse(fs.readFileSync(publishedClientPath, 'utf8'));
    publishedServer = JSON.parse(fs.readFileSync(publishedServerPath, 'utf8'));

    assert.deepStrictEqual(publishedClient.data, saved.map.data, 'published client map should receive edited tile data');
    assert.strictEqual(publishedClient.tilesize, 16, 'unrelated client map metadata must be preserved');
    assert.deepStrictEqual(publishedClient.blocking, [1]);
    assert.strictEqual(publishedServer.data, undefined, 'visual tile data should not be copied into the server map');
    assert.match(fs.readFileSync(publishedClientJsPath, 'utf8'), /^var mapData = /);

    legacy = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    delete legacy.map.data;
    fs.writeFileSync(statePath, JSON.stringify(legacy));
    assert.deepStrictEqual(store.load().map.data, baseTiles, 'legacy drafts without tile data should migrate from the base client map');

    console.log('World Editor visual tile data round-trip smoke test passed.');
} finally {
    fs.rmSync(dir, {recursive: true, force: true});
}
