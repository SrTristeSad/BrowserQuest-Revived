'use strict';

var assert = require('assert'),
    http = require('http'),
    https = require('https'),
    WebSocket = require('ws'),
    Types = require('../shared/js/gametypes'),
    URL = require('url').URL;

var base = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8014',
    wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8014/',
    adminUsername = process.env.TEST_ADMIN_USERNAME || 'owner_dashboard',
    adminPassword = process.env.TEST_ADMIN_PASSWORD || 'StrongPassword123!';

function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

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

function connectPlayer(cookie, spoofedName) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}),
            timeout = setTimeout(function() {
                socket.terminate();
                reject(new Error('Timed out waiting for player WELCOME'));
            }, 7000);

        socket.on('message', function(data) {
            var text = data.toString('utf8'), payload;
            if(text === 'go') {
                socket.send(JSON.stringify([Types.Messages.HELLO, spoofedName, Types.Entities.CLOTHARMOR, Types.Entities.SWORD1]));
                return;
            }
            try { payload = JSON.parse(text); } catch(ignore) { return; }
            var messages = Array.isArray(payload[0]) ? payload : [payload];
            messages.forEach(function(message) {
                if(Array.isArray(message) && message[0] === Types.Messages.WELCOME) {
                    clearTimeout(timeout);
                    resolve({socket: socket, welcome: message});
                }
            });
        });
        socket.on('error', function(error) {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

async function waitForPlayer(adminCookie, characterName, shouldExist) {
    var deadline = Date.now() + 5000;
    while(Date.now() < deadline) {
        var response = await requestJson('/admin/api/players', 'GET', undefined, adminCookie);
        assert.strictEqual(response.status, 200);
        var match = (response.data.players || []).some(function(player) { return player.name === characterName; });
        if(match === shouldExist) { return response.data.players; }
        await delay(100);
    }
    throw new Error('Online player state did not become ' + String(shouldExist));
}

async function main() {
    var suffix = Date.now().toString(36).slice(-7),
        username = 'dash_' + suffix,
        characterName = 'Dash' + suffix.slice(-7),
        password = 'StrongPassword123!',
        unauthorized,
        adminLogin,
        adminCookie,
        registration,
        playerCookie,
        connected,
        dashboard,
        players,
        accounts,
        search;

    unauthorized = await requestJson('/admin/api/dashboard', 'GET');
    assert.strictEqual(unauthorized.status, 401, 'dashboard API must require admin session');

    adminLogin = await requestJson('/admin/api/login', 'POST', {username: adminUsername, password: adminPassword});
    assert.strictEqual(adminLogin.status, 200);
    assert.ok(adminLogin.headers['set-cookie'] && adminLogin.headers['set-cookie'].length);
    adminCookie = adminLogin.headers['set-cookie'][0].split(';')[0];

    registration = await requestJson('/api/auth/register', 'POST', {
        username: username,
        password: password,
        characterName: characterName
    });
    assert.strictEqual(registration.status, 201);
    playerCookie = registration.headers['set-cookie'][0].split(';')[0];

    connected = await connectPlayer(playerCookie, 'FakeDashboardName');
    assert.strictEqual(connected.welcome[2], characterName, 'dashboard test account identity must remain server-authoritative');

    players = await waitForPlayer(adminCookie, characterName, true);
    var live = players.find(function(player) { return player.name === characterName; });
    assert.ok(live);
    assert.strictEqual(live.type, 'account');
    assert.strictEqual(live.username, username);
    assert.ok(live.userId > 0);
    assert.ok(live.characterId > 0);
    assert.ok(/^world\d+$/.test(live.world));

    dashboard = await requestJson('/admin/api/dashboard', 'GET', undefined, adminCookie);
    assert.strictEqual(dashboard.status, 200);
    assert.strictEqual(dashboard.data.health.postgres, true);
    assert.strictEqual(dashboard.data.health.redis, true);
    assert.strictEqual(dashboard.data.health.websocket, true);
    assert.ok(dashboard.data.uptimeSeconds >= 0);
    assert.ok(dashboard.data.game.worldCount >= 1);
    assert.ok(Array.isArray(dashboard.data.game.worlds));
    assert.ok(dashboard.data.game.onlinePlayers >= 1);
    assert.ok(dashboard.data.accounts.total >= 1);
    assert.ok(dashboard.data.accounts.active >= 1);

    accounts = await requestJson('/admin/api/accounts', 'GET', undefined, adminCookie);
    assert.strictEqual(accounts.status, 200);
    var account = (accounts.data.accounts || []).find(function(item) { return item.username === username; });
    assert.ok(account, 'new player account must appear in admin accounts list');
    assert.strictEqual(account.status, 'active');
    assert.strictEqual(account.character.name, characterName);
    assert.ok(account.character.weaponKind > 0);
    assert.ok(account.character.armorKind > 0);
    assert.ok(!Object.prototype.hasOwnProperty.call(account, 'passwordHash'), 'admin account listing must never expose password hashes');

    search = await requestJson('/admin/api/accounts?q=' + encodeURIComponent(characterName.toLowerCase()), 'GET', undefined, adminCookie);
    assert.strictEqual(search.status, 200);
    assert.strictEqual(search.data.accounts.length, 1);
    assert.strictEqual(search.data.accounts[0].username, username);

    connected.socket.close();
    await waitForPlayer(adminCookie, characterName, false);

    dashboard = await requestJson('/admin/api/dashboard', 'GET', undefined, adminCookie);
    assert.strictEqual(dashboard.status, 200);
    assert.strictEqual(dashboard.data.game.onlinePlayers, 0);

    console.log('Admin dashboard health/players/accounts E2E passed.');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
