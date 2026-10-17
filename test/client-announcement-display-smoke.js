'use strict';

var assert = require('assert'),
    fs = require('fs');

function read(path) {
    return fs.readFileSync(path, 'utf8');
}

var html = read('client/index.html'),
    css = read('client/css/announcements.css'),
    app = read('client/js/app.js'),
    game = read('client/js/game.js');

assert.ok(html.indexOf('css/announcements.css') !== -1, 'announcement stylesheet must be linked');
assert.ok(html.indexOf('id="admin-announcement"') !== -1, 'announcement banner markup must exist');
assert.ok(html.indexOf('aria-live="polite"') !== -1, 'announcement banner must expose a polite live region');
assert.ok(html.indexOf('class="announcement-message"') !== -1, 'announcement message node must exist');

assert.ok(css.indexOf('#admin-announcement') !== -1, 'announcement banner styles must exist');
assert.ok(css.indexOf('#admin-announcement.active') !== -1, 'announcement active state must exist');
assert.ok(css.indexOf('pointer-events: none') !== -1, 'announcement banner must not block gameplay input');

assert.ok(app.indexOf('showAnnouncement: function(message)') !== -1, 'App must expose showAnnouncement');
assert.ok(app.indexOf("$message.text(String(message || ''))") !== -1, 'announcement text must be inserted with text(), never html()');
assert.strictEqual(app.indexOf("$message.html("), -1, 'announcement renderer must not inject HTML');
assert.ok(app.indexOf('clearTimeout(this.announcementTimeout)') !== -1, 'new announcements must replace the previous timeout');

assert.ok(game.indexOf('self.client.onAnnouncement(function(message)') !== -1, 'Game must subscribe to announcement transport');
assert.ok(game.indexOf('self.app.showAnnouncement(message)') !== -1, 'Game must forward announcement text to App display');

console.log('Client announcement display smoke test passed.');
