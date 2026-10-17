'use strict';

var assert = require('assert'),
    http = require('http'),
    https = require('https'),
    pg = require('pg'),
    WebSocket = require('ws'),
    Types = require('../shared/js/gametypes'),
    URL = require('url').URL;

var httpBase = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8016',
    wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8016/',
    adminUsername = process.env.TEST_ADMIN_USERNAME || 'owner_announcement_e2e',
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

function connectAuthenticated(cookie, expectedName) {
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}),
            finished = false,
            timeout = setTimeout(function() {
                socket.terminate();
                reject(new Error('Timed out waiting for WELCOME for ' + expectedName));
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

function waitForAnnouncement(socket, label) {
    return new Promise(function(resolve, reject) {
        var timeout = setTimeout(function() {
            reject(new Error(label + ' did not receive ANNOUNCEMENT'));
        }, 5000);
        function onMessage(data) {
            var payload, messages;
            try { payload = JSON.parse(data.toString('utf8')); } catch(ignore) { return; }
            messages = Array.isArray(payload[0]) ? payload : [payload];
            for(var i = 0; i < messages.length; i += 1) {
                if(Array.isArray(messages[i]) && messages[i][0] === Types.Messages.ANNOUNCEMENT) {
                    clearTimeout(timeout);
                    socket.off('message', onMessage);
                    resolve(messages[i][1]);
                    return;
                }
            }
        }
        socket.on('message', onMessage);
    });
}

async function main() {
    var suffix = Date.now().toString(36).slice(-6),
        user1 = 'ann1_' + suffix,
        user2 = 'ann2_' + suffix,
        char1 = ('AnnA' + suffix).slice(0, 15),
        char2 = ('AnnB' + suffix).slice(0, 15),
        password = 'StrongPassword123!',
        pool = new pg.Pool(pgConfig),
        socket1 = null,
        socket2 = null,
        response,
        cookie1,
        cookie2,
        adminCookie,
        expectedMessage = 'Servidor reiniciará em 10 minutos.';

    try {
        response = await requestJson('/api/auth/register', 'POST', {username: user1, password: password, characterName: char1});
        assert.strictEqual(response.status, 201);
        cookie1 = cookieFrom(response, 'bq_player_session');

        response = await requestJson('/api/auth/register', 'POST', {username: user2, password: password, characterName: char2});
        assert.strictEqual(response.status, 201);
        cookie2 = cookieFrom(response, 'bq_player_session');

        response = await requestJson('/admin/api/login', 'POST', {username: adminUsername, password: adminPassword});
        assert.strictEqual(response.status, 200);
        adminCookie = cookieFrom(response, 'bq_admin_session');

        socket1 = await connectAuthenticated(cookie1, char1);
        socket2 = await connectAuthenticated(cookie2, char2);

        var receive1 = waitForAnnouncement(socket1, char1),
            receive2 = waitForAnnouncement(socket2, char2);

        response = await requestJson('/admin/api/announcements', 'POST', {
            message: '  Servidor   reiniciará   em 10 minutos.  '
        }, adminCookie);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.ok, true);
        assert.strictEqual(response.data.message, expectedMessage);
        assert.strictEqual(response.data.delivered, 2, 'delivered count must match the two connected players');

        assert.strictEqual(await receive1, expectedMessage);
        assert.strictEqual(await receive2, expectedMessage);

        var audit = await pool.query(
            "SELECT target, metadata FROM admin_audit_log WHERE action='announcement.broadcast' ORDER BY id DESC LIMIT 1"
        );
        assert.strictEqual(audit.rowCount, 1);
        assert.strictEqual(audit.rows[0].target, 'all');
        assert.strictEqual(audit.rows[0].metadata.message, expectedMessage);
        assert.strictEqual(Number(audit.rows[0].metadata.delivered), 2);

        console.log('Announcement delivery E2E passed for two authenticated WebSocket players.');
    } finally {
        if(socket1 && socket1.readyState !== WebSocket.CLOSED) { try { socket1.terminate(); } catch(ignore1) {} }
        if(socket2 && socket2.readyState !== WebSocket.CLOSED) { try { socket2.terminate(); } catch(ignore2) {} }
        try { await pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [[user1, user2]]); } catch(ignoreDelete) {}
        await pool.end();
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
