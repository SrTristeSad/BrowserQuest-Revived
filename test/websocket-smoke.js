'use strict';

var WebSocket = require('ws'),
    http = require('http'),
    https = require('https'),
    childProcess = require('child_process'),
    URL = require('url').URL;

var target = process.env.TEST_WS_URL || 'ws://127.0.0.1:8000/',
    socket = new WebSocket(target),
    receivedGo = false,
    completed = false,
    timeout = setTimeout(function() {
        console.error('Timed out waiting for BrowserQuest WebSocket handshake at ' + target);
        socket.terminate();
        process.exit(1);
    }, 5000);

function derivedHttpBase() {
    return target.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
}

function authApiAvailable(callback) {
    var url = new URL('/api/auth/policy', derivedHttpBase()),
        transport = url.protocol === 'https:' ? https : http,
        request = transport.get(url, function(response) {
            response.resume();
            callback(response.statusCode === 200);
        });
    request.on('error', function() { callback(false); });
    request.setTimeout(1500, function() { request.destroy(); callback(false); });
}

function runScript(script, extraEnv) {
    return childProcess.spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        env: Object.assign({}, process.env, extraEnv || {}),
        stdio: 'inherit'
    });
}

function runOptionalAuthSmoke() {
    authApiAvailable(function(available) {
        if(!available) {
            process.exit(0);
            return;
        }

        var sharedEnv = {
                TEST_HTTP_URL: derivedHttpBase(),
                TEST_WS_URL: target,
                TEST_ADMIN_USERNAME: process.env.TEST_ADMIN_USERNAME || 'owner',
                TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD || 'StrongPassword123!'
            },
            authResult = runScript('test/player-auth-websocket-smoke.js', sharedEnv);

        if(authResult.status !== 0) {
            process.exit(authResult.status || 1);
            return;
        }

        var progressResult = runScript('test/account-progress-http-smoke.js', sharedEnv);
        process.exit(progressResult.status || 0);
    });
}

socket.on('message', function(data, isBinary) {
    var text = isBinary ? null : data.toString('utf8');

    if(!receivedGo) {
        if(text !== 'go') {
            console.error('Expected initial "go" message, got:', text);
            process.exit(1);
        }

        receivedGo = true;
        socket.send(JSON.stringify([0, 'SmokeTest', 21, 60]));
        return;
    }

    try {
        var message = JSON.parse(text);
        if(Array.isArray(message) && message[0] === 1 && message[2] === 'SmokeTest') {
            clearTimeout(timeout);
            completed = true;
            console.log('WebSocket HELLO/WELCOME handshake succeeded at ' + target);
            socket.close();
            return;
        }
    } catch(error) {
        console.error('Server returned invalid JSON:', text);
        process.exit(1);
    }
});

socket.on('error', function(error) {
    clearTimeout(timeout);
    console.error(error);
    process.exit(1);
});

socket.on('close', function() {
    if(completed) {
        runOptionalAuthSmoke();
    } else if(receivedGo) {
        process.exit(1);
    }
});
