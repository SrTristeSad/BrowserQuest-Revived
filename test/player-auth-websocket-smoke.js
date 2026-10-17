'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    http = require('http'),
    https = require('https'),
    WebSocket = require('ws'),
    URL = require('url').URL;

var httpBase = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8010',
    wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8010/',
    baseWorld = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'maps', 'world_server.json'), 'utf8'));

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
            headers: headers
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
                    return reject(failure);
                }
                resolve({data: data, headers: response.headers});
            });
        });
        request.on('error', reject);
        if(payload !== null) { request.write(payload); }
        request.end();
    });
}

function checkpointContaining(x, y) {
    return (baseWorld.checkpoints || []).find(function(checkpoint) {
        return x >= checkpoint.x && x < checkpoint.x + checkpoint.w &&
               y >= checkpoint.y && y < checkpoint.y + checkpoint.h;
    }) || (baseWorld.checkpoints || []).find(function(checkpoint) {
        return x >= checkpoint.x && x < checkpoint.x + checkpoint.width &&
               y >= checkpoint.y && y < checkpoint.y + checkpoint.height;
    }) || null;
}

function authenticatedPersistenceHandshake(cookie, expectedName) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}),
            done = false,
            welcome = null,
            checkpoint = null,
            equipment = new Set(),
            timeout = setTimeout(function() {
                if(done) { return; }
                done = true;
                socket.terminate();
                reject(new Error('Timed out waiting for authenticated persistence handshake'));
            }, 8000);

        function maybeCheckpoint() {
            if(!welcome || !equipment.has(21) || !equipment.has(60) || checkpoint) { return; }
            checkpoint = checkpointContaining(Number(welcome[3]), Number(welcome[4]));
            if(!checkpoint) {
                done = true;
                clearTimeout(timeout);
                socket.terminate();
                reject(new Error('Initial account spawn is not inside a known checkpoint'));
                return;
            }
            socket.send(JSON.stringify([26, checkpoint.id]));
            setTimeout(function() {
                if(done) { return; }
                done = true;
                clearTimeout(timeout);
                socket.close();
                resolve(checkpoint);
            }, 250);
        }

        socket.on('message', function(data) {
            var text = data.toString('utf8');
            if(text === 'go') {
                // Send valid but forged high-level equipment. The server must ignore it for accounts.
                socket.send(JSON.stringify([0, 'SpoofedName', 26, 63]));
                return;
            }
            var message;
            try { message = JSON.parse(text); } catch(ignore) { return; }
            if(!Array.isArray(message)) { return; }
            if(message[0] === 1) {
                try {
                    assert.strictEqual(message[2], expectedName, 'server must override spoofed HELLO name');
                    welcome = message;
                    maybeCheckpoint();
                } catch(error) {
                    done = true;
                    clearTimeout(timeout);
                    socket.terminate();
                    reject(error);
                }
            } else if(message[0] === 13) {
                equipment.add(Number(message[2]));
                maybeCheckpoint();
            }
        });
        socket.on('error', function(error) {
            if(!done) { done = true; clearTimeout(timeout); reject(error); }
        });
    });
}

function reconnectAtCheckpoint(cookie, expectedName, checkpoint) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}), done = false,
            timeout = setTimeout(function() {
                if(done) { return; }
                done = true;
                socket.terminate();
                reject(new Error('Timed out waiting for checkpoint reconnect'));
            }, 8000);

        socket.on('message', function(data) {
            var text = data.toString('utf8');
            if(text === 'go') {
                socket.send(JSON.stringify([0, 'AnotherSpoof', 26, 63]));
                return;
            }
            var message;
            try { message = JSON.parse(text); } catch(ignore) { return; }
            if(Array.isArray(message) && message[0] === 1) {
                try {
                    assert.strictEqual(message[2], expectedName);
                    var x = Number(message[3]), y = Number(message[4]), width = Number(checkpoint.w || checkpoint.width), height = Number(checkpoint.h || checkpoint.height);
                    assert.ok(x >= checkpoint.x && x < checkpoint.x + width, 'reconnected x must be inside saved checkpoint');
                    assert.ok(y >= checkpoint.y && y < checkpoint.y + height, 'reconnected y must be inside saved checkpoint');
                    done = true;
                    clearTimeout(timeout);
                    socket.close();
                    resolve();
                } catch(error) {
                    done = true;
                    clearTimeout(timeout);
                    socket.terminate();
                    reject(error);
                }
            }
        });
        socket.on('error', function(error) {
            if(!done) { done = true; clearTimeout(timeout); reject(error); }
        });
    });
}

function reservedGuestHandshake(reservedName) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl), welcomed = false, done = false,
            timeout = setTimeout(function() {
                if(done) { return; }
                done = true;
                socket.terminate();
                reject(new Error('Guest reserved-name test timed out'));
            }, 7000);

        socket.on('message', function(data) {
            var text = data.toString('utf8');
            if(text === 'go') {
                socket.send(JSON.stringify([0, reservedName, 21, 60]));
                return;
            }
            try {
                var message = JSON.parse(text);
                if(Array.isArray(message) && message[0] === 1) { welcomed = true; }
            } catch(ignore) {}
        });
        socket.on('close', function() {
            if(done) { return; }
            done = true;
            clearTimeout(timeout);
            if(welcomed) { reject(new Error('Guest entered with a registered character name')); }
            else { resolve(); }
        });
        socket.on('error', function(error) {
            if(!done) { done = true; clearTimeout(timeout); reject(error); }
        });
    });
}

async function verifyAdminInfrastructure() {
    var adminUsername = process.env.TEST_ADMIN_USERNAME,
        adminPassword = process.env.TEST_ADMIN_PASSWORD;
    if(!adminUsername || !adminPassword) { return; }

    var login = await requestJson('/admin/api/login', 'POST', {username: adminUsername, password: adminPassword}),
        setCookie = login.headers['set-cookie'];
    assert.ok(setCookie && setCookie.length, 'admin login must set a session cookie');
    var adminCookie = setCookie[0].split(';')[0];
    assert.ok(/^bq_admin_session=/.test(adminCookie));

    var health = await requestJson('/admin/api/health', 'GET', undefined, adminCookie);
    assert.strictEqual(health.data.postgres, true);
    assert.strictEqual(health.data.redis, true);
    assert.strictEqual(health.data.adminSessions, 'redis');

    var settings = await requestJson('/admin/api/settings/access', 'GET', undefined, adminCookie);
    assert.strictEqual(settings.data.accessMode, 'mixed');
    assert.strictEqual(settings.data.registrationEnabled, true);

    var changed = await requestJson('/admin/api/settings/access', 'POST', {
        accessMode: 'account_only',
        registrationEnabled: false
    }, adminCookie);
    assert.strictEqual(changed.data.accessMode, 'account_only');
    assert.strictEqual(changed.data.registrationEnabled, false);

    var publicPolicy = await requestJson('/api/auth/policy', 'GET');
    assert.strictEqual(publicPolicy.data.accessMode, 'account_only');
    assert.strictEqual(publicPolicy.data.registrationEnabled, false);

    await requestJson('/admin/api/settings/access', 'POST', {
        accessMode: 'mixed',
        registrationEnabled: true
    }, adminCookie);
    publicPolicy = await requestJson('/api/auth/policy', 'GET');
    assert.strictEqual(publicPolicy.data.accessMode, 'mixed');
    assert.strictEqual(publicPolicy.data.registrationEnabled, true);

    await requestJson('/admin/api/logout', 'POST', {}, adminCookie);
}

async function main() {
    var suffix = Date.now().toString(36).slice(-8),
        username = 'wsauth_' + suffix,
        characterName = 'Hero' + suffix.slice(-7),
        password = 'StrongPassword123!',
        policy = await requestJson('/api/auth/policy', 'GET');

    assert.strictEqual(policy.data.accessMode, 'mixed');
    assert.strictEqual(policy.data.registrationEnabled, true);

    var registration = await requestJson('/api/auth/register', 'POST', {
        username: username,
        password: password,
        characterName: characterName
    });
    assert.strictEqual(registration.data.loggedIn, true);
    assert.strictEqual(registration.data.character.name, characterName);
    assert.strictEqual(registration.data.character.armorKind, 21);
    assert.strictEqual(registration.data.character.weaponKind, 60);

    var setCookie = registration.headers['set-cookie'];
    assert.ok(setCookie && setCookie.length, 'registration must set a session cookie');
    var cookie = setCookie[0].split(';')[0];
    assert.ok(/^bq_player_session=/.test(cookie));

    var session = await requestJson('/api/auth/session', 'GET', undefined, cookie);
    assert.strictEqual(session.data.loggedIn, true);
    assert.strictEqual(session.data.character.name, characterName);

    var checkpoint = await authenticatedPersistenceHandshake(cookie, characterName);
    await reconnectAtCheckpoint(cookie, characterName, checkpoint);
    await reservedGuestHandshake(characterName);

    var logout = await requestJson('/api/auth/logout', 'POST', {}, cookie);
    assert.strictEqual(logout.data.loggedIn, false);

    var afterLogout = await requestJson('/api/auth/session', 'GET', undefined, cookie);
    assert.strictEqual(afterLogout.data.loggedIn, false);

    var relogin = await requestJson('/api/auth/login', 'POST', {username: username, password: password});
    assert.strictEqual(relogin.data.character.lastCheckpointId, Number(checkpoint.id));

    await verifyAdminInfrastructure();

    console.log('Player persistence/auth/admin HTTP/WebSocket smoke tests passed.');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
