'use strict';

var assert = require('assert'),
    pg = require('pg'),
    Infrastructure = require('../server/storage/infrastructure'),
    Migrations = require('../server/storage/migrations'),
    PlayerAuth = require('../server/auth/player-auth').PlayerAuth,
    AdminAuth = require('../server/admin/auth'),
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
    };
    var redis = {
        host: process.env.TEST_REDIS_HOST || '127.0.0.1',
        port: Number(process.env.TEST_REDIS_PORT || 6379),
        database: Number(process.env.TEST_REDIS_DATABASE || 0),
        username: process.env.TEST_REDIS_USERNAME || '',
        password: process.env.TEST_REDIS_PASSWORD || '',
        tls: false
    };

    var pgResult = await Infrastructure.testPostgres(postgres);
    var redisResult = await Infrastructure.testRedis(redis);
    assert.strictEqual(pgResult.ok, true);
    assert.strictEqual(redisResult.ok, true);

    await Migrations.runMigrations(postgres);
    var owner = await Migrations.upsertOwner(postgres, {
        username: 'owner_test',
        passwordHash: 'scrypt$00$00',
        accessMode: 'mixed'
    });
    assert.strictEqual(owner.username, 'owner_test');
    assert.strictEqual(owner.role, 'owner');

    var pool = new pg.Pool(Infrastructure.postgresPoolOptions(postgres));
    try {
        var tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','characters','settings','admin_audit_log','schema_migrations','character_progress') ORDER BY table_name");
        assert.strictEqual(tables.rowCount, 6);
        var setting = await pool.query("SELECT value FROM settings WHERE key='access_mode'");
        assert.strictEqual(setting.rows[0].value, 'mixed');
        var migration = await pool.query("SELECT 1 FROM schema_migrations WHERE id='003_character_persistence'");
        assert.strictEqual(migration.rowCount, 1);
    } finally {
        await pool.end();
    }

    var services = Infrastructure.createServices({postgres: postgres, redis: redis});
    await services.connect();
    var health = await services.health();
    assert.strictEqual(health.postgres, true);
    assert.strictEqual(health.redis, true);

    var auth = new PlayerAuth({services: services, accessMode: 'mixed'}),
        characterStore = new CharacterStore({postgres: services.postgres, debounceMs: 50}),
        registered, logged, session, context;
    try {
        await services.postgres.query("DELETE FROM users WHERE username='alice_auth_test'");
        await services.redis.flushDb();
        await services.postgres.query("INSERT INTO settings(key,value) VALUES('access_mode','\"mixed\"'::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
        await services.postgres.query("INSERT INTO settings(key,value) VALUES('registration_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");

        registered = await auth.register({username: 'Alice_Auth_Test', password: 'StrongPassword123!', characterName: 'Hero Alice'});
        assert.strictEqual(registered.user.username, 'alice_auth_test');
        assert.strictEqual(registered.character.name, 'Hero Alice');
        assert.strictEqual(await auth.isCharacterNameReserved('hero alice'), true);

        session = await auth.getSessionByToken(registered.token, false);
        assert.strictEqual(session.character.name, 'Hero Alice');
        await auth.destroySessionByToken(registered.token);
        assert.strictEqual(await auth.getSessionByToken(registered.token, false), null);

        // Character state is permanent PostgreSQL data and writes are coalesced/debounced.
        var initialCharacter = await characterStore.load(registered.character.id);
        assert.strictEqual(initialCharacter.weaponKind, Types.Entities.SWORD1);
        assert.strictEqual(initialCharacter.armorKind, Types.Entities.CLOTHARMOR);
        assert.strictEqual(initialCharacter.checkpointId, null);

        characterStore.schedule(registered.character.id, {weaponKind: Types.Entities.SWORD2});
        characterStore.schedule(registered.character.id, {armorKind: Types.Entities.LEATHERARMOR});
        characterStore.schedule(registered.character.id, {checkpointId: 7});
        await sleep(120);
        var savedCharacter = await characterStore.load(registered.character.id);
        assert.strictEqual(savedCharacter.weaponKind, Types.Entities.SWORD2);
        assert.strictEqual(savedCharacter.armorKind, Types.Entities.LEATHERARMOR);
        assert.strictEqual(savedCharacter.checkpointId, 7);

        characterStore.schedule(registered.character.id, {weaponKind: Types.Entities.AXE});
        assert.strictEqual(await characterStore.flush(registered.character.id), true);
        savedCharacter = await characterStore.load(registered.character.id);
        assert.strictEqual(savedCharacter.weaponKind, Types.Entities.AXE);

        await characterStore.setProgress(registered.character.id, 'story', 'flag.test', {enabled: true, counter: 3});
        assert.deepStrictEqual(
            await characterStore.getProgress(registered.character.id, 'story', 'flag.test'),
            {enabled: true, counter: 3}
        );

        logged = await auth.login({username: 'alice_auth_test', password: 'StrongPassword123!'});
        assert.strictEqual(logged.character.weaponKind, Types.Entities.AXE);
        assert.strictEqual(logged.character.armorKind, Types.Entities.LEATHERARMOR);
        context = await auth.authorizeConnection({headers: {cookie: 'bq_player_session=' + logged.token}});
        assert.strictEqual(context.allowed, true);
        assert.strictEqual(context.type, 'account');
        assert.strictEqual(context.character.name, 'Hero Alice');
        assert.strictEqual(context.character.weaponKind, Types.Entities.AXE);

        await services.postgres.query("UPDATE settings SET value='\"account_only\"'::jsonb WHERE key='access_mode'");
        context = await auth.authorizeConnection({headers: {}});
        assert.strictEqual(context.allowed, false);
        assert.strictEqual(context.code, 'ACCOUNT_REQUIRED');

        await services.postgres.query("UPDATE settings SET value='\"name_only\"'::jsonb WHERE key='access_mode'");
        context = await auth.authorizeConnection({headers: {}});
        assert.strictEqual(context.allowed, true);
        assert.strictEqual(context.type, 'guest');

        // Sessions are disposable: clearing Redis removes the login but never the account/character state.
        await services.postgres.query("UPDATE settings SET value='\"mixed\"'::jsonb WHERE key='access_mode'");
        logged = await auth.login({username: 'alice_auth_test', password: 'StrongPassword123!'});
        await services.redis.flushDb();
        assert.strictEqual(await auth.getSessionByToken(logged.token, false), null);
        var persisted = await services.postgres.query("SELECT u.username,c.name,c.weapon_kind,c.armor_kind,c.checkpoint_id FROM users u JOIN characters c ON c.user_id=u.id WHERE u.username='alice_auth_test'");
        assert.strictEqual(persisted.rowCount, 1);
        assert.strictEqual(persisted.rows[0].name, 'Hero Alice');
        assert.strictEqual(persisted.rows[0].weapon_kind, Types.Entities.AXE);
        assert.strictEqual(persisted.rows[0].armor_kind, Types.Entities.LEATHERARMOR);
        assert.strictEqual(persisted.rows[0].checkpoint_id, 7);
        logged = await auth.login({username: 'alice_auth_test', password: 'StrongPassword123!'});
        assert.ok(logged.token);

        // Explicit short TTL test for player sessions.
        var shortAuth = new PlayerAuth({services: services, accessMode: 'mixed', sessionTtlSeconds: 1});
        var shortSession = await shortAuth.login({username: 'alice_auth_test', password: 'StrongPassword123!'});
        await sleep(1200);
        assert.strictEqual(await shortAuth.getSessionByToken(shortSession.token, false), null);

        // Admin sessions use Redis too and honor TTL.
        var adminSessions = AdminAuth.createRedisSessionManager(services.redis, {ttlSeconds: 1});
        var adminToken = await adminSessions.create('owner_test', 'owner', owner.id);
        assert.strictEqual((await adminSessions.get(adminToken)).username, 'owner_test');
        await sleep(1200);
        assert.strictEqual(await adminSessions.get(adminToken), null);
    } finally {
        try { await characterStore.flushAll(); } catch(ignoreFlush) {}
        await services.postgres.query("UPDATE settings SET value='\"mixed\"'::jsonb WHERE key='access_mode'");
        await services.postgres.query("DELETE FROM users WHERE username='alice_auth_test'");
        await services.redis.flushDb();
    }

    await services.close();
    console.log('Live PostgreSQL/Redis/auth/character-persistence smoke tests passed.');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
