'use strict';

var assert = require('assert'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    pg = require('pg'),
    WebSocket = require('ws'),
    Types = require('../shared/js/gametypes'),
    URL = require('url').URL;

var base = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8015',
    wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8015/',
    mapPath = process.env.TEST_MAP_PATH || 'server/maps/world_server.json',
    adminUsername = process.env.TEST_ADMIN_USERNAME || 'owner_actions',
    adminPassword = process.env.TEST_ADMIN_PASSWORD || 'StrongPassword123!',
    pgConfig = {
        host: process.env.TEST_PG_HOST || '127.0.0.1',
        port: Number(process.env.TEST_PG_PORT || 5432),
        database: process.env.TEST_PG_DATABASE || 'browserquest',
        user: process.env.TEST_PG_USER || 'browserquest',
        password: process.env.TEST_PG_PASSWORD || 'browserquest_test',
        ssl: false
    };

function delay(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

function requestJson(pathname, method, body, cookie) {
    return new Promise(function(resolve, reject) {
        var target = new URL(pathname, base),
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
                try { data = JSON.parse(raw || '{}'); }
                catch(error) { return reject(new Error('Invalid JSON from ' + pathname + ': ' + raw.slice(0, 300))); }
                resolve({status: response.statusCode, data: data, headers: response.headers});
            });
        });
        request.on('error', reject);
        if(payload !== null) { request.write(payload); }
        request.end();
    });
}

function connectPlayer(cookie, expectedName) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}),
            timeout = setTimeout(function() { socket.terminate(); reject(new Error('Timed out waiting for WELCOME')); }, 7000);
        socket.on('message', function(data) {
            var text = data.toString('utf8'), payload, messages;
            if(text === 'go') {
                socket.send(JSON.stringify([Types.Messages.HELLO, 'SpoofedAdminTarget', Types.Entities.CLOTHARMOR, Types.Entities.SWORD1]));
                return;
            }
            try { payload = JSON.parse(text); } catch(ignore) { return; }
            messages = Array.isArray(payload[0]) ? payload : [payload];
            messages.forEach(function(message) {
                if(Array.isArray(message) && message[0] === Types.Messages.WELCOME) {
                    clearTimeout(timeout);
                    assert.strictEqual(message[2], expectedName);
                    resolve({socket: socket, playerId: String(message[1]), messages: messages});
                }
            });
        });
        socket.on('error', function(error) { clearTimeout(timeout); reject(error); });
    });
}

function waitForClose(socket) {
    return new Promise(function(resolve) {
        if(socket.readyState === WebSocket.CLOSED) { resolve(); return; }
        var timeout = setTimeout(function() { try { socket.terminate(); } catch(ignore) {} resolve(); }, 5000);
        socket.once('close', function() { clearTimeout(timeout); resolve(); });
    });
}

function waitForAnnouncement(socket, expected) {
    return new Promise(function(resolve, reject) {
        var timeout = setTimeout(function() { reject(new Error('Timed out waiting for admin announcement')); }, 5000);
        function onMessage(data) {
            var payload;
            try { payload = JSON.parse(data.toString('utf8')); } catch(ignore) { return; }
            var messages = Array.isArray(payload[0]) ? payload : [payload];
            for(var i = 0; i < messages.length; i += 1) {
                var message = messages[i];
                if(Array.isArray(message) && message[0] === Types.Messages.CHAT && message[2] === '[ADMIN] ' + expected) {
                    clearTimeout(timeout);
                    socket.off('message', onMessage);
                    resolve(message);
                    return;
                }
            }
        }
        socket.on('message', onMessage);
    });
}

async function waitForCheckpoint(pool, username, checkpointId) {
    var deadline = Date.now() + 5000;
    while(Date.now() < deadline) {
        var result = await pool.query('SELECT c.checkpoint_id FROM characters c JOIN users u ON u.id=c.user_id WHERE u.username=$1', [username]);
        if(result.rowCount === 1 && Number(result.rows[0].checkpoint_id) === Number(checkpointId)) { return; }
        await delay(100);
    }
    throw new Error('Kick did not flush pending checkpoint to PostgreSQL');
}

async function loginPlayer(username, password) {
    var response = await requestJson('/api/auth/login', 'POST', {username: username, password: password});
    return response;
}

async function main() {
    var suffix = Date.now().toString(36).slice(-7),
        username = 'mod_' + suffix,
        characterName = 'Mod' + suffix.slice(-7),
        password = 'StrongPassword123!',
        map = JSON.parse(fs.readFileSync(mapPath, 'utf8')),
        checkpoint = (map.checkpoints || [])[0],
        pool = new pg.Pool(pgConfig),
        adminLogin,
        adminCookie,
        registration,
        playerCookie,
        userId,
        connected,
        result,
        session,
        login,
        announcementPromise,
        audit;

    assert.ok(checkpoint && checkpoint.id !== undefined, 'map must contain a checkpoint for kick flush E2E');

    adminLogin = await requestJson('/admin/api/login', 'POST', {username: adminUsername, password: adminPassword});
    assert.strictEqual(adminLogin.status, 200);
    adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];

    registration = await requestJson('/api/auth/register', 'POST', {username: username, password: password, characterName: characterName});
    assert.strictEqual(registration.status, 201);
    playerCookie = registration.headers['set-cookie'][0].split(';')[0];
    userId = Number(registration.data.user.id);
    assert.ok(userId > 0);

    connected = await connectPlayer(playerCookie, characterName);
    connected.socket.send(JSON.stringify([Types.Messages.CHECK, checkpoint.id]));

    result = await requestJson('/admin/api/players/' + connected.playerId + '/kick', 'POST', {reason: 'Teste de kick com flush'}, adminCookie);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.ok, true);
    await waitForClose(connected.socket);
    await waitForCheckpoint(pool, username, checkpoint.id);

    // Kick only closes the current connection; it must not revoke the account session.
    session = await requestJson('/api/auth/session', 'GET', undefined, playerCookie);
    assert.strictEqual(session.status, 200);
    assert.strictEqual(session.data.loggedIn, true);

    connected = await connectPlayer(playerCookie, characterName);
    announcementPromise = waitForAnnouncement(connected.socket, 'Servidor em manutenção em breve.');
    result = await requestJson('/admin/api/announcement', 'POST', {message: 'Servidor em manutenção em breve.'}, adminCookie);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.delivered, 1);
    await announcementPromise;

    result = await requestJson('/admin/api/accounts/' + userId + '/sessions/revoke', 'POST', {reason: 'Teste de revogação'}, adminCookie);
    assert.strictEqual(result.status, 200);
    assert.ok(result.data.sessionsRevoked >= 1);
    assert.strictEqual(result.data.connectionsClosed, 1);
    await waitForClose(connected.socket);
    session = await requestJson('/api/auth/session', 'GET', undefined, playerCookie);
    assert.strictEqual(session.status, 200);
    assert.strictEqual(session.data.loggedIn, false);

    login = await loginPlayer(username, password);
    assert.strictEqual(login.status, 200);
    playerCookie = login.headers['set-cookie'][0].split(';')[0];
    connected = await connectPlayer(playerCookie, characterName);

    result = await requestJson('/admin/api/accounts/' + userId + '/status', 'POST', {status: 'suspended', reason: 'Teste suspensão'}, adminCookie);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.account.status, 'suspended');
    assert.strictEqual(result.data.connectionsClosed, 1);
    await waitForClose(connected.socket);
    login = await loginPlayer(username, password);
    assert.strictEqual(login.status, 403);
    assert.strictEqual(login.data.code, 'ACCOUNT_SUSPENDED');

    result = await requestJson('/admin/api/accounts/' + userId + '/status', 'POST', {status: 'active', reason: 'Teste reativação'}, adminCookie);
    assert.strictEqual(result.status, 200);
    login = await loginPlayer(username, password);
    assert.strictEqual(login.status, 200);
    playerCookie = login.headers['set-cookie'][0].split(';')[0];
    connected = await connectPlayer(playerCookie, characterName);

    result = await requestJson('/admin/api/accounts/' + userId + '/status', 'POST', {status: 'banned', reason: 'Teste ban'}, adminCookie);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.data.account.status, 'banned');
    assert.strictEqual(result.data.connectionsClosed, 1);
    await waitForClose(connected.socket);
    login = await loginPlayer(username, password);
    assert.strictEqual(login.status, 403);
    assert.strictEqual(login.data.code, 'ACCOUNT_BANNED');

    result = await requestJson('/admin/api/accounts/' + userId + '/status', 'POST', {status: 'active', reason: 'Limpeza do teste'}, adminCookie);
    assert.strictEqual(result.status, 200);

    // Mutating routes must not work without an admin session.
    result = await requestJson('/admin/api/accounts/' + userId + '/status', 'POST', {status: 'banned'});
    assert.strictEqual(result.status, 401);

    audit = await pool.query(
        "SELECT action, target, details FROM admin_audit_log WHERE target=$1 OR target='all-online-players' ORDER BY id",
        [username]
    );
    var actions = audit.rows.map(function(row) { return row.action; });
    assert.ok(actions.indexOf('player.kick') !== -1);
    assert.ok(actions.indexOf('announcement.send') !== -1);
    assert.ok(actions.indexOf('account.sessions.revoke') !== -1);
    assert.ok(actions.indexOf('account.status.suspended') !== -1);
    assert.ok(actions.indexOf('account.status.banned') !== -1);
    assert.ok(actions.indexOf('account.status.active') !== -1);
    audit.rows.forEach(function(row) {
        var serialized = JSON.stringify(row.details || {});
        assert.strictEqual(serialized.indexOf(password), -1, 'audit details must not contain player password');
        assert.strictEqual(serialized.indexOf('bq_player_session'), -1, 'audit details must not contain session cookie/token');
    });

    await pool.query('DELETE FROM users WHERE username=$1', [username]);
    await pool.end();
    console.log('Audited admin kick/status/session/announcement E2E passed.');
}

main().catch(async function(error) {
    console.error(error);
    process.exit(1);
});
