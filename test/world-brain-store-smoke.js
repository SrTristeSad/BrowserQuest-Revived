'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    WorldStore = require('../server/admin/world-store').WorldStore;

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-brain-store-')),
    baseServerPath = path.join(dir, 'base-server.json'),
    baseClientPath = path.join(dir, 'base-client.json'),
    statePath = path.join(dir, 'state.json'),
    publishedServerPath = path.join(dir, 'published-server.json'),
    publishedClientPath = path.join(dir, 'published-client.json'),
    publishedClientJsPath = path.join(dir, 'published-client.js'),
    versionsDir = path.join(dir, 'versions'),
    base = {
        width: 32,
        height: 32,
        collisions: [],
        doors: [],
        checkpoints: [],
        chestAreas: [],
        staticChests: [],
        staticEntities: {},
        roamingAreas: []
    },
    store, state, published;

try {
    fs.writeFileSync(baseServerPath, JSON.stringify(base));
    fs.writeFileSync(baseClientPath, JSON.stringify({
        width: 32,
        height: 32,
        collisions: [],
        doors: [],
        checkpoints: [],
        data: []
    }));

    store = new WorldStore({
        baseMapPath: baseServerPath,
        baseClientMapPath: baseClientPath,
        statePath: statePath,
        publishedMapPath: publishedServerPath,
        publishedClientJsonPath: publishedClientPath,
        publishedClientJsPath: publishedClientJsPath,
        versionsDir: versionsDir
    });

    state = store.load();
    state.npcs.push({
        id: 'npc_guard_test',
        name: 'Guarda Vivo',
        baseKind: 'guard',
        enabled: true,
        dialogue: ['Tudo tranquilo por aqui.'],
        brain: {
            preset: 'guard',
            mode: 'patrol',
            vision: 9,
            wanderRadius: 6,
            thinkMs: 1100,
            fleeFromMobs: false,
            patrol: [{x: 5, y: 5}, {x: 10, y: 5}]
        }
    });
    state.mobs.push({
        id: 'mob_rat_test',
        name: 'Rato Covarde',
        baseKind: 'rat',
        enabled: true,
        hitPoints: 80,
        armorLevel: 1,
        weaponLevel: 1,
        respawnMs: 5000,
        aggroDistance: 8,
        drops: [],
        brain: {
            preset: 'coward',
            mode: 'wander',
            vision: 8,
            wanderRadius: 7,
            thinkMs: 950,
            leash: 10,
            fleeBelowHp: 0.4,
            aggressive: true
        }
    });
    state.map.entities.push({
        id: 'placed_guard', x: 5, y: 5, kind: 'guard',
        profileType: 'npc', profileId: 'npc_guard_test', source: 'editor'
    });
    state.map.entities.push({
        id: 'placed_rat', x: 12, y: 5, kind: 'rat',
        profileType: 'mob', profileId: 'mob_rat_test', source: 'editor'
    });

    store.save(state);
    store.publish();
    published = JSON.parse(fs.readFileSync(publishedServerPath, 'utf8'));

    assert.strictEqual(published.editorProfiles.npcs.npc_guard_test.brain.preset, 'guard');
    assert.strictEqual(published.editorProfiles.npcs.npc_guard_test.brain.mode, 'patrol');
    assert.strictEqual(published.editorProfiles.npcs.npc_guard_test.brain.patrol.length, 2);
    assert.strictEqual(published.editorProfiles.mobs.mob_rat_test.brain.preset, 'coward');
    assert.strictEqual(published.editorProfiles.mobs.mob_rat_test.brain.fleeBelowHp, 0.4);
    assert.strictEqual(published.editorProfiles.mobs.mob_rat_test.brain.aggressive, true);
    assert.ok(fs.existsSync(publishedClientPath), 'client map should also be published');

    console.log('World Brain profile persistence tests passed.');
} finally {
    fs.rmSync(dir, {recursive: true, force: true});
}
