'use strict';

var assert = require('assert'),
    fs = require('fs'),
    WebSocket = require('ws'),
    Types = require('../shared/js/gametypes');

var wsUrl = process.env.TEST_WS_URL || 'ws://127.0.0.1:8012/',
    cookie = process.env.TEST_PLAYER_COOKIE,
    expectedName = process.env.TEST_CHARACTER_NAME,
    expectedWeapon = Number(process.env.TEST_EXPECTED_WEAPON),
    expectedArmor = Number(process.env.TEST_EXPECTED_ARMOR),
    checkpointId = Number(process.env.TEST_CHECKPOINT_ID),
    mapPath = process.env.TEST_MAP_PATH || 'server/maps/world_server.json';

if(!cookie || !expectedName || !Number.isInteger(expectedWeapon) || !Number.isInteger(expectedArmor) || !Number.isInteger(checkpointId)) {
    throw new Error('Missing TEST_PLAYER_COOKIE / TEST_CHARACTER_NAME / TEST_EXPECTED_WEAPON / TEST_EXPECTED_ARMOR / TEST_CHECKPOINT_ID');
}

var map = JSON.parse(fs.readFileSync(mapPath, 'utf8')),
    checkpoint = map.checkpoints.find(function(item) { return Number(item.id) === checkpointId; });

assert.ok(checkpoint, 'checkpoint must exist in the map');
assert.ok(Types.isWeapon(expectedWeapon), 'expected weapon must be a valid weapon kind');
assert.ok(Types.isArmor(expectedArmor), 'expected armor must be a valid armor kind');

new Promise(function(resolve, reject) {
    var socket = new WebSocket(wsUrl, {headers: {Cookie: cookie}}),
        welcome = null,
        equipment = [],
        timeout = setTimeout(function() {
            socket.terminate();
            reject(new Error('Timed out waiting for persisted WELCOME/EQUIP state'));
        }, 8000);

    function finishIfReady() {
        if(!welcome || equipment.indexOf(expectedWeapon) === -1 || equipment.indexOf(expectedArmor) === -1) { return; }
        try {
            assert.strictEqual(welcome[2], expectedName, 'server must restore the account character name');
            assert.ok(welcome[3] >= checkpoint.x && welcome[3] < checkpoint.x + checkpoint.w, 'WELCOME x must be inside the persisted checkpoint');
            assert.ok(welcome[4] >= checkpoint.y && welcome[4] < checkpoint.y + checkpoint.h, 'WELCOME y must be inside the persisted checkpoint');
            clearTimeout(timeout);
            socket.close();
            resolve();
        } catch(error) {
            clearTimeout(timeout);
            socket.terminate();
            reject(error);
        }
    }

    socket.on('message', function(data) {
        var text = data.toString('utf8');
        if(text === 'go') {
            // Deliberately send false/default equipment. Account state must come from PostgreSQL.
            socket.send(JSON.stringify([Types.Messages.HELLO, 'SpoofedName', Types.Entities.CLOTHARMOR, Types.Entities.SWORD1]));
            return;
        }

        var payload;
        try { payload = JSON.parse(text); } catch(ignore) { return; }
        var messages = Array.isArray(payload[0]) ? payload : [payload];
        messages.forEach(function(message) {
            if(!Array.isArray(message)) { return; }
            if(message[0] === Types.Messages.WELCOME) {
                welcome = message;
            } else if(message[0] === Types.Messages.EQUIP && welcome && message[1] === welcome[1]) {
                equipment.push(Number(message[2]));
            }
        });
        finishIfReady();
    });

    socket.on('error', function(error) {
        clearTimeout(timeout);
        reject(error);
    });
    socket.on('close', function() {
        if(!welcome) {
            clearTimeout(timeout);
            reject(new Error('Connection closed before WELCOME'));
        }
    });
}).then(function() {
    console.log('Account persisted equipment/checkpoint WebSocket smoke test passed.');
}).catch(function(error) {
    console.error(error);
    process.exit(1);
});
