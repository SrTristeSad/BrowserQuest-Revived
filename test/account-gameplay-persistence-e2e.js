'use strict';

var assert = require('assert'),
    fs = require('fs'),
    http = require('http'),
    https = require('https'),
    pg = require('pg'),
    WebSocket = require('ws'),
    Types = require('../shared/js/gametypes'),
    URL = require('url').URL;

var httpBase = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8013',
    wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8013/',
    mapPath = process.env.TEST_MAP_PATH || 'server/maps/world_server.json',
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
        var request = transport.request({method: method, hostname: target.hostname, port: target.port, path: target.pathname, headers: headers}, function(response) {
            var chunks = [];
            response.on('data', function(chunk) { chunks.push(chunk); });
            response.on('end', function() {
                var raw = Buffer.concat(chunks).toString('utf8'), data;
                try { data = JSON.parse(raw || '{}'); }
                catch(error) { return reject(error); }
                if(response.statusCode < 200 || response.statusCode >= 300) {
                    return reject(new Error(method + ' ' + pathname + ' -> HTTP ' + response.statusCode + ': ' + (data.error || raw)));
                }
                resolve({data: data, headers: response.headers});
            });
        });
        request.on('error', reject);
        if(payload !== null) { request.write(payload); }
        request.end();
    });
}

function findStaticWeapon() {
    var map = JSON.parse(fs.readFileSync(mapPath, 'utf8')),
        nextItem = Array.isArray(map.staticChests) ? map.staticChests.length : 0,
        chosen = null;

    Object.keys(map.staticEntities || {}).forEach(function(tileId) {
        var kind = Types.getKindFromString(map.staticEntities[tileId]),
            itemId,
            tile,
            x,
            y;
        if(!Types.isItem(kind)) { return; }
        itemId = '9' + nextItem;
        nextItem += 1;
        if(chosen || !Types.isWeapon(kind) || kind === Types.Entities.SWORD1) { return; }
        tile = Number(tileId) - 1;
        x = (tile % map.width) + 1;
        y = Math.floor(tile / map.width);
        chosen = {id: itemId, kind: kind, x: x, y: y};
    });

    assert.ok(chosen, 'world map must contain a static non-default weapon for the gameplay persistence E2E');
    return chosen;
}

function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function waitForWeapon(pool, username, expectedKind) {
    var deadline = Date.now() + 5000;
    while(Date.now() < deadline) {
        var result = await pool.query('SELECT c.weapon_kind FROM characters c JOIN users u ON u.id=c.user_id WHERE u.username=$1', [username]);
        if(result.rowCount === 1 && Number(result.rows[0].weapon_kind) === expectedKind) { return; }
        await delay(100);
    }
    throw new Error('Gameplay equipment change was not persisted to PostgreSQL');
}

function connectAndHandshake(cookie, expectedName, expectedWeapon, expectedArmor, options) {
    options = options || {};
    return new Promise(function(resolve, reject) {
        var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}),
            welcome = null,
            equipCounts = {},
            completed = false,
            timeout = setTimeout(function() {
                socket.terminate();
                reject(new Error('Timed out waiting for authenticated WebSocket state'));
            }, 8000);

        function countEquip(kind) {
            equipCounts[kind] = (equipCounts[kind] || 0) + 1;
        }

        function finish() {
            if(completed) { return; }
            completed = true;
            clearTimeout(timeout);
            resolve({socket: socket, welcome: welcome, equipCounts: equipCounts});
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
                if(!Array.isArray(message)) { return; }
                if(message[0] === Types.Messages.WELCOME) {
                    welcome = message;
                    assert.strictEqual(message[2], expectedName, 'authenticated name must come from PostgreSQL');
                } else if(message[0] === Types.Messages.EQUIP && welcome && message[1] === welcome[1]) {
                    countEquip(Number(message[2]));
                }
            });
            if(welcome && equipCounts[expectedWeapon] === 1 && equipCounts[expectedArmor] === 1) {
                setTimeout(function() {
                    try {
                        assert.strictEqual(equipCounts[expectedWeapon], 1, 'weapon EQUIP sync must be sent exactly once');
                        assert.strictEqual(equipCounts[expectedArmor], 1, 'armor EQUIP sync must be sent exactly once');
                        finish();
                    } catch(error) {
                        clearTimeout(timeout);
                        socket.terminate();
                        reject(error);
                    }
                }, 120);
            }
        });
        socket.on('error', function(error) {
            if(completed) { return; }
            clearTimeout(timeout);
            reject(error);
        });
        socket.on('close', function() {
            if(!completed) {
                clearTimeout(timeout);
                reject(new Error('Authenticated connection closed before state synchronization'));
            }
        });
    });
}

async function main() {
    var suffix = Date.now().toString(36).slice(-7),
        username = 'equip_' + suffix,
        characterName = 'Equip' + suffix.slice(-7),
        password = 'StrongPassword123!',
        target = findStaticWeapon(),
        registration = await requestJson('/api/auth/register', 'POST', {
            username: username,
            password: password,
            characterName: characterName
        }),
        setCookie = registration.headers['set-cookie'],
        cookie,
        armor = Number(registration.data.character.armorKind),
        initialWeapon = Number(registration.data.character.weaponKind),
        pool = new pg.Pool(pgConfig),
        first,
        second;

    assert.ok(setCookie && setCookie.length, 'registration must set player session cookie');
    cookie = setCookie[0].split(';')[0];
    assert.notStrictEqual(target.kind, initialWeapon, 'test weapon must change current equipment');

    try {
        first = await connectAndHandshake(cookie, characterName, initialWeapon, armor);

        // Move to the static item through the normal BrowserQuest protocol, then loot it.
        first.socket.send(JSON.stringify([Types.Messages.LOOTMOVE, target.x, target.y, Number(target.id)]));
        await delay(60);
        first.socket.send(JSON.stringify([Types.Messages.LOOT, Number(target.id)]));

        await waitForWeapon(pool, username, target.kind);
        first.socket.close();
        await delay(150);

        // Reconnect the same account. The HELLO deliberately sends default equipment again;
        // the server must restore the weapon persisted by gameplay, exactly once.
        second = await connectAndHandshake(cookie, characterName, target.kind, armor);
        second.socket.close();

        var result = await pool.query('SELECT c.weapon_kind FROM characters c JOIN users u ON u.id=c.user_id WHERE u.username=$1', [username]);
        assert.strictEqual(result.rowCount, 1);
        assert.strictEqual(Number(result.rows[0].weapon_kind), target.kind);
        console.log('Gameplay equipment -> PostgreSQL -> reconnect E2E passed.');
    } finally {
        if(first && first.socket && first.socket.readyState === WebSocket.OPEN) { first.socket.close(); }
        if(second && second.socket && second.socket.readyState === WebSocket.OPEN) { second.socket.close(); }
        try { await pool.query('DELETE FROM users WHERE username=$1', [username]); } catch(ignore) {}
        await pool.end();
    }
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
