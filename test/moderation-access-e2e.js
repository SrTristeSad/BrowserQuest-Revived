'use strict';

var assert = require('assert'),
    http = require('http'),
    https = require('https'),
    pg = require('pg'),
    WebSocket = require('ws'),
    Types = require('../shared/js/gametypes'),
    URL = require('url').URL;

var httpBase = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8014',
    wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8014/',
    adminUsername = process.env.TEST_ADMIN_USERNAME || 'owner_moderation_e2e',
    adminPassword = process.env.TEST_ADMIN_PASSWORD || 'StrongPassword123!',
    pgConfig = {
        host: process.env.TEST_PG_HOST || '127.0.0.1',
        port: Number(process.env.TEST_PG_PORT || 5432),
        database: process.env.TEST_PG_DATABASE || 'browserquest',
        user: process.env.TEST_PG_USER || 'browserquest',
        password: process.env.TEST_PG_PASSWORD || 'browserquest_test',
        ssl: false
    };

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

        var request = transport.request({
            method: method,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname + target.search,
            headers: headers
        }, function(response) {
            var chunks = [];
            response.on('data', function(chunk) { chunks.push(chunk); });
            response.on('end', function() {
                var raw = Buffer.concat(chunks).toString('utf8'), data = {};
                try { data = JSON.parse(raw || '{}'); }
                catch(error) { return reject(error); }
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
                    assert.strictEqual(message[2], expectedName, 'authenticated character name must be server-authoritative');
                    finished = true;
                    clearTimeout(timeout);
                    resolve(socket);
                } catch(error) {
                    fail(error);
                }
            });
        });
        socket.on('error', fail);
        socket.on('close', function(code, reason) {
            if(!finished) {
                fail(new Error('Authenticated WebSocket closed before WELCOME (' + code + ': ' + reason.toString() + ')'));
            }
        });
    });
}

function waitForClose(socket, label) {
    return new Promise(function(resolve, reject) {
        if(socket.readyState === WebSocket.CLOSED) { resolve({code: 1008, reason: ''}); return; }
        var timeout = setTimeout(function() {
            reject(new Error(label + ' WebSocket was not closed by moderation action'));
        }, 5000);
        socket.once('close', function(code, reason) {
            clearTimeout(timeout);
            resolve({code: code, reason: reason.toString()});
        });
    });
}

function expectWebSocketDenied(cookie, label) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}),
            sawGo = false,
            timeout = setTimeout(function() {
                socket.terminate();
                reject(new Error(label + ' WebSocket was not rejected'));
            }, 5000);

        socket.on('message', function(data) {
            if(data.toString('utf8') === 'go') { sawGo = true; }
        });
        socket.on('close', function(code, reason) {
            clearTimeout(timeout);
            try {
                assert.strictEqual(sawGo, false, label + ' must be rejected before game handshake');
                assert.strictEqual(code, 1008, label + ' must be closed as a policy violation');
                resolve({code: code, reason: reason.toString()});
            } catch(error) { reject(error); }
        });
        socket.on('error', function(error) {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

async function main() {
    var suffix = Date.now().toString(36).slice(-7),
        username = 'mod_' + suffix,
        characterName = ('Mod' + suffix).slice(0, 15),
        password = 'StrongPassword123!',
        pool = new pg.Pool(pgConfig),
        playerSocket = null,
        playerCookie,
        adminCookie,
        userId,
        response,
        closeResult;

    try {
        response = await requestJson('/api/auth/register', 'POST', {
            username: username,
            password: password,
            characterName: characterName
        });
        assert.strictEqual(response.status, 201, 'player registration must succeed');
        playerCookie = cookieFrom(response, 'bq_player_session');

        var userResult = await pool.query('SELECT id, status FROM users WHERE username=$1', [username]);
        assert.strictEqual(userResult.rowCount, 1);
        userId = Number(userResult.rows[0].id);
        assert.strictEqual(userResult.rows[0].status, 'active');

        response = await requestJson('/admin/api/login', 'POST', {
            username: adminUsername,
            password: adminPassword
        });
        assert.strictEqual(response.status, 200, 'admin login must succeed');
        adminCookie = cookieFrom(response, 'bq_admin_session');

        playerSocket = await connectAuthenticated(playerCookie, characterName);
        var suspendedClose = waitForClose(playerSocket, 'Suspended account');
        response = await requestJson('/admin/api/accounts/' + userId + '/suspend', 'POST', {
            reason: 'Moderation E2E suspension'
        }, adminCookie);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.account.status, 'suspended');
        assert.ok(response.data.sessionsRevoked >= 1, 'suspension must revoke the active player session');
        assert.ok(response.data.connectionsClosed >= 1, 'suspension must close the active game connection');
        closeResult = await suspendedClose;
        assert.strictEqual(closeResult.code, 1008);
        playerSocket = null;

        response = await requestJson('/api/auth/login', 'POST', {username: username, password: password});
        assert.strictEqual(response.status, 403, 'suspended account login must be rejected');
        assert.strictEqual(response.data.code, 'ACCOUNT_SUSPENDED');
        await expectWebSocketDenied(playerCookie, 'Suspended account');

        response = await requestJson('/admin/api/accounts/' + userId + '/reactivate', 'POST', {
            reason: 'Moderation E2E suspension cleared'
        }, adminCookie);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.account.status, 'active');

        response = await requestJson('/api/auth/login', 'POST', {username: username, password: password});
        assert.strictEqual(response.status, 200, 'reactivated account login must succeed');
        playerCookie = cookieFrom(response, 'bq_player_session');
        playerSocket = await connectAuthenticated(playerCookie, characterName);

        var bannedClose = waitForClose(playerSocket, 'Banned account');
        response = await requestJson('/admin/api/accounts/' + userId + '/ban', 'POST', {
            reason: 'Moderation E2E ban'
        }, adminCookie);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.account.status, 'banned');
        assert.ok(response.data.sessionsRevoked >= 1, 'ban must revoke the active player session');
        assert.ok(response.data.connectionsClosed >= 1, 'ban must close the active game connection');
        closeResult = await bannedClose;
        assert.strictEqual(closeResult.code, 1008);
        playerSocket = null;

        response = await requestJson('/api/auth/login', 'POST', {username: username, password: password});
        assert.strictEqual(response.status, 403, 'banned account login must be rejected');
        assert.strictEqual(response.data.code, 'ACCOUNT_BANNED');
        await expectWebSocketDenied(playerCookie, 'Banned account');

        response = await requestJson('/admin/api/accounts/' + userId + '/reactivate', 'POST', {
            reason: 'Moderation E2E ban cleared'
        }, adminCookie);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.account.status, 'active');

        response = await requestJson('/api/auth/login', 'POST', {username: username, password: password});
        assert.strictEqual(response.status, 200, 'account must be usable after ban removal');
        playerCookie = cookieFrom(response, 'bq_player_session');
        playerSocket = await connectAuthenticated(playerCookie, characterName);
        playerSocket.close();
        playerSocket = null;

        var audit = await pool.query(
            "SELECT action FROM admin_audit_log WHERE target=$1 AND action IN ('account.suspend','account.ban','account.reactivate') ORDER BY id",
            [username]
        );
        assert.ok(audit.rows.some(function(row) { return row.action === 'account.suspend'; }), 'suspension must be audited');
        assert.ok(audit.rows.some(function(row) { return row.action === 'account.ban'; }), 'ban must be audited');
        assert.ok(audit.rows.filter(function(row) { return row.action === 'account.reactivate'; }).length >= 2, 'both reactivations must be audited');

        console.log('Moderation access E2E passed: suspend/ban block login and WebSocket, reactivation restores access.');
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
