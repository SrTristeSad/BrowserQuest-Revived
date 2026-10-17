'use strict';

var Infrastructure = require('../storage/infrastructure'),
    Migrations = require('../storage/migrations');

function fromBody(body) {
    body = body || {};
    return {
        postgres: Infrastructure.normalizePostgres({
            host: body.pgHost,
            port: body.pgPort,
            database: body.pgDatabase,
            user: body.pgUser,
            password: body.pgPassword,
            ssl: body.pgSsl
        }),
        redis: Infrastructure.normalizeRedis({
            host: body.redisHost,
            port: body.redisPort,
            username: body.redisUsername,
            password: body.redisPassword,
            database: body.redisDatabase,
            tls: body.redisTls
        })
    };
}

async function testPostgresFromBody(body) {
    var infrastructure = fromBody(body);
    return Infrastructure.testPostgres(infrastructure.postgres);
}

async function testRedisFromBody(body) {
    var infrastructure = fromBody(body);
    return Infrastructure.testRedis(infrastructure.redis);
}

async function initialize(body, owner) {
    var infrastructure = fromBody(body), pgResult, redisResult;
    pgResult = await Infrastructure.testPostgres(infrastructure.postgres);
    redisResult = await Infrastructure.testRedis(infrastructure.redis);
    await Migrations.runMigrations(infrastructure.postgres);
    await Migrations.upsertOwner(infrastructure.postgres, owner);
    return {
        infrastructure: infrastructure,
        postgres: pgResult,
        redis: redisResult
    };
}

exports.fromBody = fromBody;
exports.testPostgresFromBody = testPostgresFromBody;
exports.testRedisFromBody = testRedisFromBody;
exports.initialize = initialize;
