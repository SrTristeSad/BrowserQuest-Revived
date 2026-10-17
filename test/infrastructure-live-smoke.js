'use strict';

var assert = require('assert'),
    pg = require('pg'),
    Infrastructure = require('../server/storage/infrastructure'),
    Migrations = require('../server/storage/migrations');

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
        var tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','characters','settings','admin_audit_log','schema_migrations') ORDER BY table_name");
        assert.strictEqual(tables.rowCount, 5);
        var setting = await pool.query("SELECT value FROM settings WHERE key='access_mode'");
        assert.strictEqual(setting.rows[0].value, 'mixed');
    } finally {
        await pool.end();
    }

    var services = Infrastructure.createServices({postgres: postgres, redis: redis});
    await services.connect();
    var health = await services.health();
    assert.strictEqual(health.postgres, true);
    assert.strictEqual(health.redis, true);
    await services.close();

    console.log('Live PostgreSQL/Redis smoke tests passed.');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
