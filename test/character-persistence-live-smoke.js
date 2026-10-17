'use strict';

var assert = require('assert'),
    pg = require('pg'),
    Infrastructure = require('../server/storage/infrastructure'),
    Migrations = require('../server/storage/migrations'),
    CharacterStore = require('../server/persistence/character-store').CharacterStore,
    Types = require('../shared/js/gametypes');

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function main() {
    var postgres = {
        host: process.env.TEST_PG_HOST || '127.0.0.1',
        port: Number(process.env.TEST_PG_PORT || 5432),
        database: process.env.TEST_PG_DATABASE || 'browserquest',
        user: process.env.TEST_PG_USER || 'browserquest',
        password: process.env.TEST_PG_PASSWORD || 'browserquest_test',
        ssl: false
    }, suffix = Date.now().toString(36),
        username = 'persist_' + suffix.slice(-10),
        characterName = 'Persist' + suffix.slice(-7),
        pool,
        store,
        userId,
        characterId;

    await Migrations.runMigrations(postgres);
    pool = new pg.Pool(Infrastructure.postgresPoolOptions(postgres));
    store = new CharacterStore({postgres: pool, debounceMs: 50});

    try {
        userId = (await pool.query(
            "INSERT INTO users(username, display_name, password_hash, role, status) VALUES($1,$2,'test-hash','player','active') RETURNING id",
            [username, username]
        )).rows[0].id;
        characterId = (await pool.query(
            'INSERT INTO characters(user_id, name, weapon_kind, armor_kind) VALUES($1,$2,$3,$4) RETURNING id',
            [userId, characterName, Types.Entities.SWORD1, Types.Entities.CLOTHARMOR]
        )).rows[0].id;

        var initial = await store.load(characterId);
        assert.strictEqual(initial.weaponKind, Types.Entities.SWORD1);
        assert.strictEqual(initial.armorKind, Types.Entities.CLOTHARMOR);
        assert.strictEqual(initial.checkpointId, null);

        store.schedule(characterId, {weaponKind: Types.Entities.SWORD2});
        store.schedule(characterId, {armorKind: Types.Entities.LEATHERARMOR});
        store.schedule(characterId, {checkpointId: 7});
        await sleep(120);

        var saved = await store.load(characterId);
        assert.strictEqual(saved.weaponKind, Types.Entities.SWORD2);
        assert.strictEqual(saved.armorKind, Types.Entities.LEATHERARMOR);
        assert.strictEqual(saved.checkpointId, 7);

        store.schedule(characterId, {weaponKind: Types.Entities.AXE});
        assert.strictEqual(await store.flush(characterId), true);
        saved = await store.load(characterId);
        assert.strictEqual(saved.weaponKind, Types.Entities.AXE);

        await store.setProgress(characterId, 'story', 'flag.test', {enabled: true, counter: 3});
        var progress = await store.getProgress(characterId, 'story', 'flag.test');
        assert.deepStrictEqual(progress, {enabled: true, counter: 3});

        var migration = await pool.query("SELECT 1 FROM schema_migrations WHERE id='003_character_persistence'");
        assert.strictEqual(migration.rowCount, 1);
        var table = await pool.query("SELECT to_regclass('public.character_progress') AS table_name");
        assert.strictEqual(table.rows[0].table_name, 'character_progress');

        console.log('Character persistence live smoke tests passed.');
    } finally {
        try { await store.flushAll(); } catch(ignoreFlush) {}
        if(userId) {
            try { await pool.query('DELETE FROM users WHERE id=$1', [userId]); } catch(ignoreDelete) {}
        }
        await pool.end();
    }
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
