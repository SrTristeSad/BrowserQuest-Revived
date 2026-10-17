'use strict';

var assert = require('assert'),
    http = require('http'),
    https = require('https'),
    WebSocket = require('ws'),
    URL = require('url').URL;

var httpBase = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8010',
    wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8010/';

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
                    failure.code = data.code;
                    failure.data = data;
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

function authenticatedHandshake(cookie, expectedName) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}), done = false,
            timeout = setTimeout(function() {
                if(done) { return; }
                done = true;
                socket.terminate();
                reject(new Error('Timed out waiting for authenticated WELCOME'));
            }, 7000);

        socket.on('message', function(data) {
            var text = data.toString('utf8');
            if(text === 'go') {
                socket.send(JSON.stringify([0, 'SpoofedName', 21, 60]));
                return;
            }
            var message;
            try { message = JSON.parse(text); } catch(ignore) { return; }
            if(Array.isArray(message) && message[0] === 1) {
                try {
                    assert.strictEqual(message[2], expectedName, 'server must override spoofed HELLO name');
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

function guestHandshake(name) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl), done = false,
            timeout = setTimeout(function() {
                if(done) { return; }
                done = true;
                socket.terminate();
                reject(new Error('Guest handshake timed out'));
            }, 7000);

        socket.on('message', function(data) {
            var text = data.toString('utf8');
            if(text === 'go') {
                socket.send(JSON.stringify([0, name, 21, 60]));
                return;
            }
            var message;
            try { message = JSON.parse(text); } catch(ignore) { return; }
            if(Array.isArray(message) && message[0] === 1) {
                try {
                    assert.strictEqual(message[2], name);
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
        socket.on('close', function(code, reason) {
            if(!done) {
                done = true;
                clearTimeout(timeout);
                reject(new Error('Guest was unexpectedly rejected: ' + code + ' ' + reason.toString()));
            }
        });
        socket.on('error', function(error) {
            if(!done) { done = true; clearTimeout(timeout); reject(error); }
        });
    });
}

function expectGuestRejectedBeforeGo() {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl), receivedGo = false, done = false,
            timeout = setTimeout(function() {
                if(done) { return; }
                done = true;
                socket.terminate();
                reject(new Error('account_only guest rejection timed out'));
            }, 7000);

        socket.on('message', function(data) {
            if(data.toString('utf8') === 'go') { receivedGo = true; }
        });
        socket.on('close', function(code) {
            if(done) { return; }
            done = true;
            clearTimeout(timeout);
            if(receivedGo) { reject(new Error('account_only sent go to an unauthenticated guest')); }
            else if(code !== 1008) { reject(new Error('account_only rejected guest with unexpected close code ' + code)); }
            else { resolve(); }
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

async function adminLogin() {
    var adminUsername = process.env.TEST_ADMIN_USERNAME,
        adminPassword = process.env.TEST_ADMIN_PASSWORD;
    if(!adminUsername || !adminPassword) { return null; }
    var login = await requestJson('/admin/api/login', 'POST', {username: adminUsername, password: adminPassword}),
        setCookie = login.headers['set-cookie'];
    assert.ok(setCookie && setCookie.length, 'admin login must set a session cookie');
    var adminCookie = setCookie[0].split(';')[0];
    assert.ok(/^bq_admin_session=/.test(adminCookie));
    return adminCookie;
}

async function setAccess(adminCookie, accessMode, registrationEnabled) {
    var changed = await requestJson('/admin/api/settings/access', 'POST', {
        accessMode: accessMode,
        registrationEnabled: registrationEnabled
    }, adminCookie);
    assert.strictEqual(changed.data.accessMode, accessMode);
    assert.strictEqual(changed.data.registrationEnabled, registrationEnabled);

    var publicPolicy = await requestJson('/api/auth/policy', 'GET');
    assert.strictEqual(publicPolicy.data.accessMode, accessMode);
    assert.strictEqual(publicPolicy.data.registrationEnabled, registrationEnabled);
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

    var setCookie = registration.headers['set-cookie'];
    assert.ok(setCookie && setCookie.length, 'registration must set a session cookie');
    var cookie = setCookie[0].split(';')[0];
    assert.ok(/^bq_player_session=/.test(cookie));

    var session = await requestJson('/api/auth/session', 'GET', undefined, cookie);
    assert.strictEqual(session.data.loggedIn, true);
    assert.strictEqual(session.data.character.name, characterName);

    await authenticatedHandshake(cookie, characterName);
    await reservedGuestHandshake(characterName);

    var adminCookie = await adminLogin();
    if(adminCookie) {
        var health = await requestJson('/admin/api/health', 'GET', undefined, adminCookie);
        assert.strictEqual(health.data.postgres, true);
        assert.strictEqual(health.data.redis, true);
        assert.strictEqual(health.data.adminSessions, 'redis');

        var settings = await requestJson('/admin/api/settings/access', 'GET', undefined, adminCookie);
        assert.strictEqual(settings.data.accessMode, 'mixed');
        assert.strictEqual(settings.data.registrationEnabled, true);

        await setAccess(adminCookie, 'account_only', false);
        await authenticatedHandshake(cookie, characterName);
        await expectGuestRejectedBeforeGo();

        var blockedRegistration = false;
        try {
            await requestJson('/api/auth/register', 'POST', {
                username: 'blocked_' + suffix,
                password: password,
                characterName: 'Blocked' + suffix.slice(-6)
            });
        } catch(error) {
            blockedRegistration = error.statusCode === 403 && error.code === 'REGISTRATION_DISABLED';
        }
        assert.strictEqual(blockedRegistration, true, 'registration must respect admin policy');

        await setAccess(adminCookie, 'name_only', false);
        await guestHandshake('Classic' + suffix.slice(-7));

        await setAccess(adminCookie, 'mixed', true);
    }

    var logout = await requestJson('/api/auth/logout', 'POST', {}, cookie);
    assert.strictEqual(logout.data.loggedIn, false);

    var afterLogout = await requestJson('/api/auth/session', 'GET', undefined, cookie);
    assert.strictEqual(afterLogout.data.loggedIn, false);

    if(adminCookie) {
        await requestJson('/admin/api/logout', 'POST', {}, adminCookie);
    }

    console.log('Player auth/admin settings HTTP/WebSocket smoke tests passed.');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
