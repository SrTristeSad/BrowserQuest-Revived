'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    WorldStoreModule = require('../server/admin/world-store'),
    WorldStore = WorldStoreModule.WorldStore;

function fakePng(width, height) {
    var buffer = Buffer.alloc(24);
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(buffer, 0);
    buffer.write('IHDR', 12, 4, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-world-tiles-')),
    baseServerPath = path.join(dir, 'base-server.json'),
    baseClientPath = path.join(dir, 'base-client.json'),
    tilesetPath = path.join(dir, 'tilesheet.png'),
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
    fs.writeFileSync(tilesetPath, fakePng(64, 48)); // 4 x 3 tiles = IDs 0..11.
    fs.writeFileSync(storiesPath, JSON.stringify({stories: []}));

    assert.deepStrictEqual(WorldStoreModule.readPngDimensions(tilesetPath), {width:64,height:48});

    store = new WorldStore({
        baseMapPath: baseServerPath,
        baseClientMapPath: baseClientPath,
        tilesetPath: tilesetPath,
        tilesetUrl: '/img/1/tilesheet.png',
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
    assert.deepStrictEqual(state.catalogs.tiles, {
        url:'/img/1/tilesheet.png',tileSize:16,width:64,height:48,columns:4,rows:3,count:12,measured:true
    });

    state.map.data[0] = 11;
    state.map.data[1] = 12;
    state.map.data[2] = -1;
    state.map.data[3] = 'not-a-tile';
    state.map.data.length = 14;
    state.map.data[12] = 500;
    state.map.data[13] = 501;

    saved = store.save(state);
    assert.strictEqual(saved.map.data.length, 12, 'tile data must match map dimensions exactly');
    assert.strictEqual(saved.map.data[0], 11, 'highest real tilesheet ID should survive normalization');
    assert.strictEqual(saved.map.data[1], 1, 'ID outside the real tilesheet should fall back to the original client tile');
    assert.strictEqual(saved.map.data[2], -1, 'empty tile marker should remain valid');
    assert.strictEqual(saved.map.data[3], 3, 'nonnumeric tile should fall back to the original client tile');

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

    console.log('World Editor measured tilesheet and visual tile data smoke test passed.');
} finally {
    fs.rmSync(dir, {recursive: true, force: true});
}
