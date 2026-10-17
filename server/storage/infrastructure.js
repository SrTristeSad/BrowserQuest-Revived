'use strict';

var pg = require('pg'),
    redis = require('redis');

function asPort(value, fallback) {
    var port = Number(value || fallback);
    if(!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Porta inválida.');
    }
    return port;
}

function normalizePostgres(input) {
    input = input || {};
    var config = {
        host: String(input.host || '127.0.0.1').trim(),
        port: asPort(input.port, 5432),
        database: String(input.database || '').trim(),
        user: String(input.user || '').trim(),
        password: String(input.password || ''),
        ssl: Boolean(input.ssl),
        max: Number.isInteger(Number(input.max)) ? Number(input.max) : 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000
    };

    if(!config.host || config.host.length > 255) { throw new Error('Host PostgreSQL inválido.'); }
    if(!/^[A-Za-z0-9_.-]{1,63}$/.test(config.database)) { throw new Error('Nome do banco PostgreSQL inválido.'); }
    if(!/^[A-Za-z0-9_.-]{1,63}$/.test(config.user)) { throw new Error('Usuário PostgreSQL inválido.'); }
    if(config.password.length > 512) { throw new Error('Senha PostgreSQL grande demais.'); }
    if(config.max < 1 || config.max > 100) { throw new Error('Pool PostgreSQL inválido.'); }
    return config;
}

function postgresPoolOptions(input) {
    var config = normalizePostgres(input), options = {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: config.max,
        connectionTimeoutMillis: config.connectionTimeoutMillis,
        idleTimeoutMillis: config.idleTimeoutMillis
    };
    if(config.ssl) {
        options.ssl = {rejectUnauthorized: false};
    }
    return options;
}

function normalizeRedis(input) {
    input = input || {};
    var database = Number(input.database || 0), config = {
        host: String(input.host || '127.0.0.1').trim(),
        port: asPort(input.port, 6379),
        username: String(input.username || '').trim(),
        password: String(input.password || ''),
        database: database,
        tls: Boolean(input.tls)
    };
    if(!config.host || config.host.length > 255) { throw new Error('Host Redis inválido.'); }
    if(config.username.length > 128) { throw new Error('Usuário Redis grande demais.'); }
    if(config.password.length > 512) { throw new Error('Senha Redis grande demais.'); }
    if(!Number.isInteger(database) || database < 0 || database > 15) { throw new Error('Database Redis deve ficar entre 0 e 15.'); }
    return config;
}

function redisClientOptions(input) {
    var config = normalizeRedis(input), options = {
        socket: {
            host: config.host,
            port: config.port,
            connectTimeout: 5000,
            reconnectStrategy: function(retries) {
                return Math.min(250 + (retries * 250), 5000);
            }
        },
        database: config.database
    };
    if(config.tls) {
        options.socket.tls = true;
        options.socket.servername = config.host;
    }
    if(config.username) { options.username = config.username; }
    if(config.password) { options.password = config.password; }
    return options;
}

async function testPostgres(input) {
    var pool = new pg.Pool(postgresPoolOptions(input));
    try {
        var result = await pool.query('SELECT current_setting(\'server_version\') AS version, current_database() AS database');
        return {ok: true, version: result.rows[0].version, database: result.rows[0].database};
    } finally {
        await pool.end();
    }
}

async function testRedis(input) {
    var client = redis.createClient(redisClientOptions(input)), version = null;
    client.on('error', function() {});
    try {
        await client.connect();
        await client.ping();
        try {
            var info = await client.info('server'), match = String(info).match(/redis_version:([^\r\n]+)/);
            if(match) { version = match[1].trim(); }
        } catch(ignore) {}
        return {ok: true, version: version};
    } finally {
        if(client.isOpen) {
            await client.quit();
        }
    }
}

function createServices(config) {
    config = config || {};
    var pool = new pg.Pool(postgresPoolOptions(config.postgres)),
        redisClient = redis.createClient(redisClientOptions(config.redis)),
        redisConnected = false;

    redisClient.on('error', function(error) {
        console.error('[BrowserQuest] Redis:', error.message);
    });

    return {
        postgres: pool,
        redis: redisClient,
        connect: async function() {
            await pool.query('SELECT 1');
            if(!redisClient.isOpen) {
                await redisClient.connect();
            }
            await redisClient.ping();
            redisConnected = true;
            return this;
        },
        health: async function() {
            var result = {postgres: false, redis: false};
            try { await pool.query('SELECT 1'); result.postgres = true; } catch(ignorePg) {}
            try { if(redisClient.isOpen) { await redisClient.ping(); result.redis = true; } } catch(ignoreRedis) {}
            return result;
        },
        close: async function() {
            if(redisClient.isOpen) {
                try { await redisClient.quit(); } catch(ignoreQuit) { redisClient.destroy(); }
            }
            redisConnected = false;
            await pool.end();
        },
        isRedisConnected: function() { return redisConnected && redisClient.isOpen; }
    };
}

exports.normalizePostgres = normalizePostgres;
exports.normalizeRedis = normalizeRedis;
exports.postgresPoolOptions = postgresPoolOptions;
exports.redisClientOptions = redisClientOptions;
exports.testPostgres = testPostgres;
exports.testRedis = testRedis;
exports.createServices = createServices;
