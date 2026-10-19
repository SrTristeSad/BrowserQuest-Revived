'use strict';

const assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    vm = require('vm');

const clientDir = path.join(__dirname, '..', 'client'),
    html = fs.readFileSync(path.join(clientDir, 'index.html'), 'utf8'),
    source = fs.readFileSync(path.join(clientDir, 'js', 'form-submit-guard.js'), 'utf8');

assert(!/action=["']none["']/i.test(html), 'No BrowserQuest form should navigate to /none');
assert(html.includes('id="character-form" action="/"'), 'Character form needs a safe fallback route');
assert(html.includes('id="chat-form" action="/"'), 'Chat form needs a safe fallback route');
assert(html.includes('src="js/form-submit-guard.js"'), 'Guard must load independently of RequireJS');
assert(html.includes('defer></script>'), 'Guard must execute after forms are parsed');

let submitHandler, inCapturePhase, clicks = 0,
    input = {value: 'ojojoj'},
    button = {click() { clicks++; }};

const document = {
    addEventListener(type, handler, capture) {
        assert.strictEqual(type, 'submit');
        submitHandler = handler;
        inCapturePhase = capture;
    },
    getElementById(id) {
        return id === 'nameinput' ? input : null;
    },
    querySelector(selector) {
        return selector === '#createcharacter .play div' ? button : null;
    }
};
new vm.Script(source, {filename: 'form-submit-guard.js'}).runInNewContext({document});
assert.strictEqual(inCapturePhase, true, 'Capture native submission before browser navigation');

function submit(id) {
    let prevented = false;
    submitHandler({
        target: {id: id},
        preventDefault() { prevented = true; }
    });
    return prevented;
}

assert.strictEqual(submit('character-form'), true);
assert.strictEqual(clicks, 1, 'Enter on character form must use existing Play button');
assert.strictEqual(submit('chat-form'), true);
assert.strictEqual(clicks, 1, 'Chat Enter must never start a game or navigate to /none');
input.value = '   ';
assert.strictEqual(submit('character-form'), true);
assert.strictEqual(clicks, 1, 'Empty username must not start a game');
input.value = 'test';
assert.strictEqual(submit('other-form'), false, 'Unrelated forms remain untouched');
assert.strictEqual(clicks, 1);

console.log('BrowserQuest native form protection passed: Enter cannot navigate to /none.');
