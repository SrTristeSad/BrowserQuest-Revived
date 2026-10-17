'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    Types = require('../shared/js/gametypes'),
    FormatChecker = require('../server/js/format').FormatChecker;

function main() {
    var checker = new FormatChecker(),
        root = path.join(__dirname, '..'),
        gameClient = fs.readFileSync(path.join(root, 'client', 'js', 'gameclient.js'), 'utf8'),
        game = fs.readFileSync(path.join(root, 'client', 'js', 'game.js'), 'utf8'),
        player = fs.readFileSync(path.join(root, 'server', 'js', 'player.js'), 'utf8');

    assert.strictEqual(Types.Messages.NPC_INTERACT, 28);
    assert.strictEqual(checker.check([Types.Messages.NPC_INTERACT, 123]), true);
    assert.strictEqual(checker.check([Types.Messages.NPC_INTERACT, '123']), false);
    assert.strictEqual(checker.check([Types.Messages.NPC_INTERACT]), false);
    assert.strictEqual(checker.check([Types.Messages.NPC_INTERACT, 123, 456]), false);

    assert.ok(gameClient.indexOf('sendNpcInteract: function(npc)') !== -1, 'GameClient must expose NPC interaction sender');
    assert.ok(gameClient.indexOf('this.sendMessage([Types.Messages.NPC_INTERACT, npc.id])') !== -1, 'GameClient must send the NPC id');
    assert.ok(game.indexOf('this.client.sendNpcInteract(npc);') !== -1, 'talking to an NPC must notify the server');

    assert.ok(player.indexOf('else if(action === Types.Messages.NPC_INTERACT)') !== -1, 'Player must handle NPC_INTERACT');
    assert.ok(player.indexOf("npc && npc.type === 'npc'") !== -1, 'server must reject non-NPC entities');
    assert.ok(player.indexOf('Math.abs(self.x - npc.x) + Math.abs(self.y - npc.y)') !== -1, 'server must calculate authoritative NPC distance');
    assert.ok(player.indexOf('npcDistance === 1 && self.npcinteract_callback') !== -1, 'server must require cardinal adjacency');
    assert.ok(player.indexOf('onNpcInteract: function(callback)') !== -1, 'Player must expose validated NPC interaction callback');

    console.log('NPC interaction protocol smoke test passed.');
}

try { main(); }
catch(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
}
