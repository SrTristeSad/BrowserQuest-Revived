'use strict';

var assert = require('assert'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    pg = require('pg'),
    WebSocket = require('ws'),
    Types = require('../shared/js/gametypes'),
    URL = require('url').URL;

var httpBase = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8015',
    wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8015/',
    adminUsername = process.env.TEST_ADMIN_USERNAME || 'owner_kick_flush_e2e',
    adminPassword = process.env.TEST_ADMIN_PASSWORD || 'StrongPassword123!',
    mapPath = process.env.TEST_MAP_PATH || 'server/maps/world_server.json',
    pgConfig = {
        host: process.env.TEST_PG_HOST || '127.0.0.1',
        port: Number(process.env.TEST_PG_PORT || 5432),
        database: process.env.TEST_PG_DATABASE || 'browserquest',
        user: process.env.TEST_PG_USER || 'browserquest',
        password: process.env.TEST_PG_PASSWORD || 'browserquest_test',
        ssl: false
    };

function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function requestJson(pathname, method, body, cookie) {
    return new Promise(function(resolve, reject) {
        var target = new URL(pathname, httpBase),
            transport = target.protocol === 'https:' ? https : http,
            payload = body === undefined ? null : JSON.stringify(body),
            headers = {accept: 'application/json'};
        if(payload !== null) {
            headers['content-type'] = 'application/json';
            headers['content-length'] = Buffer.byteLength(payload);
        }
        if(cookie) { headers.cookie = cookie; }
        var request = transport.request({method: method, hostname: target.hostname, port: target.port, path: target.pathname + target.search, headers: headers}, function(response) {
            var chunks = [];
            response.on('data', function(chunk) { chunks.push(chunk); });
            response.on('end', function() {
                var raw = Buffer.concat(chunks).toString('utf8'), data = {};
                try { data = JSON.parse(raw || '{}'); } catch(error) { return reject(error); }
                resolve({status: response.statusCode, data: data, headers: response.headers});
            });
        });
        request.on('error', reject);
        if(payload !== null) { request.write(payload); }
        request.end();
    });
}

function cookieFrom(response, name) {
    var values = response.headers['set-cookie'] || [], prefix = name + '=';
    for(var i = 0; i < values.length; i += 1) {
        var first = values[i].split(';')[0];
        if(first.indexOf(prefix) === 0) { return first; }
    }
    throw new Error('Cookie ' + name + ' was not returned');
}

function firstCheckpointId() {
    var map = JSON.parse(fs.readFileSync(mapPath, 'utf8')),
        checkpoints = Array.isArray(map.checkpoints) ? map.checkpoints : [],
        checkpoint = checkpoints.find(function(value) {
            return value && Number.isInteger(Number(value.id));
        });
    assert.ok(checkpoint, 'server map must contain at least one checkpoint');
    return Number(checkpoint.id);
}

function connectAuthenticated(cookie, expectedName) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}),
            finished = false,
            timeout = setTimeout(function() {
                socket.terminate();
                reject(new Error('Timed out waiting for authenticated WebSocket welcome'));
            }, 8000);

        function fail(error) {
            if(finished) { return; }
            finished = true;
            clearTimeout(timeout);
            try { socket.terminate(); } catch(ignore) {}
            reject(error);
        }

        socket.on('message', function(data) {
            var text = data.toString('utf8'), payload, messages;
            if(text === 'go') {
                socket.send(JSON.stringify([Types.Messages.HELLO, 'SpoofedName', Types.Entities.CLOTHARMOR, Types.Entities.SWORD1]));
                return;
            }
            try { payload = JSON.parse(text); } catch(ignore) { return; }
            messages = Array.isArray(payload[0]) ? payload : [payload];
            messages.forEach(function(message) {
                if(finished || !Array.isArray(message) || message[0] !== Types.Messages.WELCOME) { return; }
                try {
                    assert.strictEqual(message[2], expectedName);
                    finished = true;
                    clearTimeout(timeout);
                    resolve(socket);
                } catch(error) { fail(error); }
            });
        });
        socket.on('error', fail);
        socket.on('close', function(code, reason) {
            if(!finished) { fail(new Error('WebSocket closed before WELCOME (' + code + ': ' + reason.toString() + ')')); }
        });
    });
}

function waitForClose(socket) {
    return new Promise(function(resolve, reject) {
        var timeout = setTimeout(function() { reject(new Error('Admin kick did not close the player WebSocket')); }, 4000);
        socket.once('close', function(code, reason) {
            clearTimeout(timeout);
            resolve({code: code, reason: reason.toString()});
        });
    });
}

async function checkpointValue(pool, username) {
    var result = await pool.query('SELECT c.checkpoint_id FROM characters c JOIN users u ON u.id=c.user_id WHERE u.username=$1', [username]);
    assert.strictEqual(result.rowCount, 1);
    return result.rows[0].checkpoint_id === null ? null : Number(result.rows[0].checkpoint_id);
}

async function main() {
    var suffix = Date.now().toString(36).slice(-7),
        username = 'kick_' + suffix,
        characterName = ('Kick' + suffix).slice(0, 15),
        password = 'StrongPassword123!',
        checkpointId = firstCheckpointId(),
        pool = new pg.Pool(pgConfig),
        playerSocket = null,
        playerCookie,
        adminCookie,
        playerId,
        response,
        sentAt,
        closeInfo,
        value;

    try {
        response = await requestJson('/api/auth/register', 'POST', {username: username, password: password, characterName: characterName});
        assert.strictEqual(response.status, 201);
        playerCookie = cookieFrom(response, 'bq_player_session');
        assert.strictEqual(await checkpointValue(pool, username), null, 'new character must start without persisted checkpoint');

        response = await requestJson('/admin/api/login', 'POST', {username: adminUsername, password: adminPassword});
        assert.strictEqual(response.status, 200);
        adminCookie = cookieFrom(response, 'bq_admin_session');

        playerSocket = await connectAuthenticated(playerCookie, characterName);
        response = await requestJson('/admin/api/players', 'GET', undefined, adminCookie);
        assert.strictEqual(response.status, 200);
        var player = (response.data.players || []).find(function(item) { return item.username === username; });
        assert.ok(player, 'authenticated player must appear in admin online list');
        playerId = player.id;

        // CHECK schedules a debounced PostgreSQL write (300 ms by default).
        // The admin kick happens before that debounce can fire. The assertion below
        // requires the close-path flush to make the value visible before 250 ms.
        sentAt = Date.now();
        playerSocket.send(JSON.stringify([Types.Messages.CHECK, checkpointId]));
        await delay(35);
        assert.strictEqual(await checkpointValue(pool, username), null, 'checkpoint must still be pending before the kick');

        var closed = waitForClose(playerSocket);
        response = await requestJson('/admin/api/players/' + encodeURIComponent(playerId) + '/kick', 'POST', {
            reason: 'Kick flush E2E'
        }, adminCookie);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.ok, true);
        closeInfo = await closed;
        assert.strictEqual(closeInfo.code, 1008);
        playerSocket = null;

        value = await checkpointValue(pool, username);
        assert.strictEqual(value, checkpointId, 'admin kick must flush pending checkpoint immediately on close');
        assert.ok(Date.now() - sentAt < 250, 'checkpoint became durable only after the normal debounce window; close-path flush is not proven');

        var audit = await pool.query("SELECT action, metadata FROM admin_audit_log WHERE action='player.kick' AND metadata->>'reason'='Kick flush E2E' ORDER BY id DESC LIMIT 1");
        assert.strictEqual(audit.rowCount, 1, 'admin kick must remain audited');

        console.log('Admin kick pending-state flush E2E passed before the normal persistence debounce.');
    } finally {
        if(playerSocket && (playerSocket.readyState === WebSocket.OPEN || playerSocket.readyState === WebSocket.CONNECTING)) {
            try { playerSocket.terminate(); } catch(ignoreSocket) {}
        }
        try { await pool.query('DELETE FROM users WHERE username=$1', [username]); } catch(ignoreDelete) {}
        await pool.end();
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
