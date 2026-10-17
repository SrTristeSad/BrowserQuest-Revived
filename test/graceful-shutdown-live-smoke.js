'use strict';

var assert = require('assert'),
    childProcess = require('child_process'),
    path = require('path'),
    pg = require('pg'),
    Infrastructure = require('../server/storage/infrastructure'),
    Migrations = require('../server/storage/migrations'),
    CharacterStore = require('../server/persistence/character-store').CharacterStore,
    GracefulShutdown = require('../server/lifecycle/graceful-shutdown'),
    Types = require('../shared/js/gametypes');

function postgresConfig() {
    return {
        host: process.env.TEST_PG_HOST || '127.0.0.1',
        port: Number(process.env.TEST_PG_PORT || 5432),
        database: process.env.TEST_PG_DATABASE || 'browserquest',
        user: process.env.TEST_PG_USER || 'browserquest',
        password: process.env.TEST_PG_PASSWORD || 'browserquest_test',
        ssl: false
    };
}

function redisConfig() {
    return {
        host: process.env.TEST_REDIS_HOST || '127.0.0.1',
        port: Number(process.env.TEST_REDIS_PORT || 6379),
        database: Number(process.env.TEST_REDIS_DATABASE || 0),
        username: process.env.TEST_REDIS_USERNAME || '',
        password: process.env.TEST_REDIS_PASSWORD || '',
        tls: false
    };
}

async function child() {
    var services = Infrastructure.createServices({postgres: postgresConfig(), redis: redisConfig()}),
        characterId = Number(process.env.TEST_CHARACTER_ID);
    await services.connect();
    var store = new CharacterStore({postgres: services.postgres, debounceMs: 60000});
    store.schedule(characterId, {
        weaponKind: Types.Entities.AXE,
        armorKind: Types.Entities.PLATEARMOR,
        checkpointId: 7
    });

    GracefulShutdown.install({
        characterStore: store,
        services: services,
        logger: console,
        timeoutMs: 5000
    });

    // Keep the update pending in memory, then exercise the actual POSIX signal path.
    setTimeout(function() {
        process.kill(process.pid, 'SIGTERM');
    }, 50);
}

async function parent() {
    var postgres = postgresConfig(),
        pool,
        userId,
        characterId,
        suffix = Date.now().toString(36),
        username = 'shutdown_' + suffix.slice(-10);

    await Migrations.runMigrations(postgres);
    pool = new pg.Pool(Infrastructure.postgresPoolOptions(postgres));
    try {
        userId = (await pool.query(
            "INSERT INTO users(username, display_name, password_hash, role, status) VALUES($1,$2,'test-hash','player','active') RETURNING id",
            [username, username]
        )).rows[0].id;
        characterId = (await pool.query(
            'INSERT INTO characters(user_id, name, weapon_kind, armor_kind) VALUES($1,$2,$3,$4) RETURNING id',
            [userId, 'Shutdown' + suffix.slice(-7), Types.Entities.SWORD1, Types.Entities.CLOTHARMOR]
        )).rows[0].id;

        var result = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'graceful-shutdown-live-smoke.js')], {
            env: Object.assign({}, process.env, {
                GRACEFUL_SHUTDOWN_CHILD: '1',
                TEST_CHARACTER_ID: String(characterId)
            }),
            encoding: 'utf8',
            timeout: 10000
        });
        if(result.stdout) { process.stdout.write(result.stdout); }
        if(result.stderr) { process.stderr.write(result.stderr); }
        assert.strictEqual(result.status, 0, 'child must exit cleanly after SIGTERM');
        assert.ok(result.stdout.indexOf('Estado persistente salvo') !== -1, 'child must finish graceful persistence before exit');

        var saved = await pool.query(
            'SELECT weapon_kind, armor_kind, checkpoint_id FROM characters WHERE id=$1',
            [characterId]
        );
        assert.strictEqual(saved.rowCount, 1);
        assert.strictEqual(saved.rows[0].weapon_kind, Types.Entities.AXE);
        assert.strictEqual(saved.rows[0].armor_kind, Types.Entities.PLATEARMOR);
        assert.strictEqual(saved.rows[0].checkpoint_id, 7);

        console.log('Live SIGTERM pending-state flush test passed.');
    } finally {
        if(userId) {
            try { await pool.query('DELETE FROM users WHERE id=$1', [userId]); } catch(ignore) {}
        }
        await pool.end();
    }
}

if(process.env.GRACEFUL_SHUTDOWN_CHILD === '1') {
    child().catch(function(error) {
        console.error(error);
        process.exit(1);
    });
} else {
    parent().catch(function(error) {
        console.error(error);
        process.exit(1);
    });
}
