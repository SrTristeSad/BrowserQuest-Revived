'use strict';

var WebSocket = require('ws');

var socket = new WebSocket('ws://127.0.0.1:8000/'),
    receivedGo = false,
    timeout = setTimeout(function() {
        console.error('Timed out waiting for BrowserQuest WebSocket handshake.');
        socket.terminate();
        process.exit(1);
    }, 5000);

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
            console.log('WebSocket HELLO/WELCOME handshake succeeded.');
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
    if(receivedGo) {
        setTimeout(function() {
            process.exit(0);
        }, 10);
    }
});
