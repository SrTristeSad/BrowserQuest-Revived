'use strict';

var assert = require('assert'),
    Infrastructure = require('../server/storage/infrastructure'),
    Migrations = require('../server/storage/migrations'),
    PlayerAuth = require('../server/auth/player-auth').PlayerAuth;

async function main() {
    var postgres = {
        host: process.env.TEST_PG_HOST || '127.0.0.1',
        port: Number(process.env.TEST_PG_PORT || 5432),
        database: process.env.TEST_PG_DATABASE || 'browserquest',
        user: process.env.TEST_PG_USER || 'browserquest',
        password: process.env.TEST_PG_PASSWORD || 'browserquest_test',
        ssl: false
    }, redis = {
        host: process.env.TEST_REDIS_HOST || '127.0.0.1',
        port: Number(process.env.TEST_REDIS_PORT || 6379),
        database: Number(process.env.TEST_REDIS_DATABASE || 0),
        username: process.env.TEST_REDIS_USERNAME || '',
        password: process.env.TEST_REDIS_PASSWORD || '',
        tls: false
    };

    await Migrations.runMigrations(postgres);
    var services = Infrastructure.createServices({postgres: postgres, redis: redis});
    await services.connect();
    var auth = new PlayerAuth({services: services, accessMode: 'mixed'}), registered, logged, session, context;

    try {
        await services.postgres.query("DELETE FROM users WHERE username='alice_auth_test'");
        await services.redis.flushDb();
        await services.postgres.query("INSERT INTO settings(key,value) VALUES('access_mode','\"mixed\"'::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
        await services.postgres.query("INSERT INTO settings(key,value) VALUES('registration_enabled','true'::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");

        registered = await auth.register({username: 'Alice_Auth_Test', password: 'StrongPassword123!', characterName: 'Hero Alice'});
        assert.strictEqual(registered.user.username, 'alice_auth_test');
        assert.strictEqual(registered.character.name, 'Hero Alice');
        assert.ok(registered.token.length === 64);
        assert.strictEqual(await auth.isCharacterNameReserved('hero alice'), true);

        session = await auth.getSessionByToken(registered.token, false);
        assert.strictEqual(session.character.name, 'Hero Alice');

        await auth.destroySessionByToken(registered.token);
        assert.strictEqual(await auth.getSessionByToken(registered.token, false), null);

        logged = await auth.login({username: 'alice_auth_test', password: 'StrongPassword123!'});
        assert.strictEqual(logged.character.name, 'Hero Alice');

        context = await auth.authorizeConnection({headers: {cookie: 'bq_player_session=' + logged.token}});
        assert.strictEqual(context.allowed, true);
        assert.strictEqual(context.type, 'account');
        assert.strictEqual(context.character.name, 'Hero Alice');

        await services.postgres.query("UPDATE settings SET value='\"account_only\"'::jsonb WHERE key='access_mode'");
        context = await auth.authorizeConnection({headers: {}});
        assert.strictEqual(context.allowed, false);
        assert.strictEqual(context.code, 'ACCOUNT_REQUIRED');

        await services.postgres.query("UPDATE settings SET value='\"name_only\"'::jsonb WHERE key='access_mode'");
        context = await auth.authorizeConnection({headers: {}});
        assert.strictEqual(context.allowed, true);
        assert.strictEqual(context.type, 'guest');

        var badLogin = false;
        try { await auth.login({username: 'alice_auth_test', password: 'wrong-password'}); }
        catch(error) { badLogin = error.code === 'INVALID_CREDENTIALS'; }
        assert.strictEqual(badLogin, true);

        console.log('Player authentication live smoke tests passed.');
    } finally {
        await services.postgres.query("UPDATE settings SET value='\"mixed\"'::jsonb WHERE key='access_mode'");
        await services.postgres.query("DELETE FROM users WHERE username='alice_auth_test'");
        await services.redis.flushDb();
        await services.close();
    }
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
