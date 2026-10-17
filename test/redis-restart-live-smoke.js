'use strict';

var assert = require('assert'),
    childProcess = require('child_process'),
    http = require('http'),
    https = require('https'),
    pg = require('pg'),
    URL = require('url').URL;

var httpBase = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8010',
    postgres = {
        host: process.env.TEST_PG_HOST || '127.0.0.1',
        port: Number(process.env.TEST_PG_PORT || 5432),
        database: process.env.TEST_PG_DATABASE || 'browserquest',
        user: process.env.TEST_PG_USER || 'browserquest',
        password: process.env.TEST_PG_PASSWORD || 'browserquest_test'
    };

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function requestJson(pathname, method, body, cookie) {
    return new Promise(function(resolve, reject) {
        var target = new URL(pathname, httpBase),
            transport = target.protocol === 'https:' ? https : http,
            payload = body === undefined ? null : JSON.stringify(body),
            headers = {'accept': 'application/json'};
        if(payload !== null) {
            headers['content-type'] = 'application/json';
            headers['content-length'] = Buffer.byteLength(payload);
        }
        if(cookie) { headers.cookie = cookie; }

        var request = transport.request({
            method: method,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            headers: headers,
            timeout: 5000
        }, function(response) {
            var chunks = [];
            response.on('data', function(chunk) { chunks.push(chunk); });
            response.on('end', function() {
                var text = Buffer.concat(chunks).toString('utf8'), data = {};
                try { data = JSON.parse(text || '{}'); }
                catch(error) { return reject(error); }
                if(response.statusCode < 200 || response.statusCode >= 300) {
                    var failure = new Error(data.error || ('HTTP ' + response.statusCode));
                    failure.statusCode = response.statusCode;
                    failure.code = data.code;
                    return reject(failure);
                }
                resolve({data: data, headers: response.headers});
            });
        });
        request.on('timeout', function() { request.destroy(new Error('HTTP timeout')); });
        request.on('error', reject);
        if(payload !== null) { request.write(payload); }
        request.end();
    });
}

function service(action) {
    childProcess.execFileSync('sudo', ['service', 'redis-server', action], {stdio: 'inherit'});
}

function redisPingSucceeds() {
    try {
        return childProcess.execFileSync('redis-cli', ['ping'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() === 'PONG';
    } catch(error) {
        return false;
    }
}

async function waitForRedisReady() {
    for(var i = 0; i < 40; i += 1) {
        if(redisPingSucceeds()) { return; }
        await sleep(250);
    }
    throw new Error('Redis did not become ready after restart.');
}

async function waitForApplicationRedisReconnect(username, password) {
    var lastError = null;
    for(var i = 0; i < 40; i += 1) {
        try {
            return await requestJson('/api/auth/login', 'POST', {username: username, password: password});
        } catch(error) {
            lastError = error;
            await sleep(250);
        }
    }
    throw lastError || new Error('Application did not reconnect to Redis.');
}

async function main() {
    var suffix = Date.now().toString(36).slice(-8),
        username = 'redis_' + suffix,
        characterName = 'Redis' + suffix.slice(-7),
        password = 'StrongPassword123!',
        pool = new pg.Pool(postgres),
        registration;

    try {
        registration = await requestJson('/api/auth/register', 'POST', {
            username: username,
            password: password,
            characterName: characterName
        });
        assert.strictEqual(registration.data.loggedIn, true);
        assert.strictEqual(registration.data.character.name, characterName);

        var before = await pool.query(
            'SELECT u.username, c.name FROM users u JOIN characters c ON c.user_id=u.id WHERE u.username=$1',
            [username]
        );
        assert.strictEqual(before.rowCount, 1);
        assert.strictEqual(before.rows[0].name, characterName);

        service('stop');
        await sleep(750);
        assert.strictEqual(redisPingSucceeds(), false, 'Redis service must actually be offline during the test');

        service('start');
        await waitForRedisReady();

        var login = await waitForApplicationRedisReconnect(username, password);
        assert.strictEqual(login.data.loggedIn, true);
        assert.strictEqual(login.data.character.name, characterName);
        assert.ok(login.headers['set-cookie'] && login.headers['set-cookie'].length, 'login after Redis restart must issue a session cookie');

        var after = await pool.query(
            'SELECT u.username, c.name FROM users u JOIN characters c ON c.user_id=u.id WHERE u.username=$1',
            [username]
        );
        assert.strictEqual(after.rowCount, 1);
        assert.strictEqual(after.rows[0].name, characterName);

        console.log('Live Redis service restart/reconnect smoke test passed.');
    } finally {
        if(!redisPingSucceeds()) {
            try { service('start'); await waitForRedisReady(); } catch(ignore) {}
        }
        try { await pool.query('DELETE FROM users WHERE username=$1', [username]); } catch(ignorePg) {}
        await pool.end();
    }
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
