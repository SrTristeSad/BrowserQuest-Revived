'use strict';

var assert = require('assert'),
    Infrastructure = require('../server/storage/infrastructure'),
    SetupInfrastructure = require('../server/setup/infrastructure-setup');

var pg = Infrastructure.normalizePostgres({
    host: '127.0.0.1', port: 5432, database: 'browserquest', user: 'browserquest', password: 'secret', ssl: false
});
assert.strictEqual(pg.host, '127.0.0.1');
assert.strictEqual(pg.port, 5432);
assert.strictEqual(pg.database, 'browserquest');
assert.strictEqual(pg.user, 'browserquest');
assert.strictEqual(pg.ssl, false);

var redis = Infrastructure.normalizeRedis({
    host: '127.0.0.1', port: 6379, database: 2, username: '', password: '', tls: false
});
assert.strictEqual(redis.port, 6379);
assert.strictEqual(redis.database, 2);
assert.strictEqual(redis.tls, false);

var parsed = SetupInfrastructure.fromBody({
    pgHost: 'db.internal', pgPort: 5544, pgDatabase: 'bq_prod', pgUser: 'bq_user', pgPassword: 'pw', pgSsl: true,
    redisHost: 'cache.internal', redisPort: 6380, redisDatabase: 3, redisUsername: 'default', redisPassword: 'rpw', redisTls: true
});
assert.strictEqual(parsed.postgres.host, 'db.internal');
assert.strictEqual(parsed.postgres.ssl, true);
assert.strictEqual(parsed.redis.host, 'cache.internal');
assert.strictEqual(parsed.redis.database, 3);
assert.strictEqual(parsed.redis.tls, true);

assert.throws(function() { Infrastructure.normalizePostgres({database: 'bad db', user: 'user'}); }, /banco PostgreSQL/);
assert.throws(function() { Infrastructure.normalizeRedis({database: 99}); }, /Database Redis/);

console.log('Infrastructure configuration smoke tests passed.');
