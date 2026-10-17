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
        npcClient = fs.readFileSync(path.join(root, 'client', 'js', 'npc.js'), 'utf8'),
        player = fs.readFileSync(path.join(root, 'server', 'js', 'player.js'), 'utf8'),
        worldServer = fs.readFileSync(path.join(root, 'server', 'js', 'worldserver.js'), 'utf8');

    assert.strictEqual(Types.Messages.NPC_INTERACT, 28);
    assert.strictEqual(Types.Messages.STORY_DIALOGUE, 29);
    assert.strictEqual(checker.check([Types.Messages.NPC_INTERACT, 123]), true);
    assert.strictEqual(checker.check([Types.Messages.NPC_INTERACT, '123']), false);
    assert.strictEqual(checker.check([Types.Messages.NPC_INTERACT]), false);
    assert.strictEqual(checker.check([Types.Messages.NPC_INTERACT, 123, 456]), false);

    assert.ok(gameClient.indexOf('sendNpcInteract: function(npc)') !== -1, 'GameClient must expose NPC interaction sender');
    assert.ok(gameClient.indexOf('this.pendingNpcInteractions[npc.id] = npc;') !== -1, 'GameClient must retain the interacted NPC until Story Runtime replies');
    assert.ok(gameClient.indexOf('this.sendMessage([Types.Messages.NPC_INTERACT, npc.id])') !== -1, 'GameClient must send the NPC id');
    assert.ok(game.indexOf('this.client.sendNpcInteract(npc);') !== -1, 'talking to an NPC must notify the server');

    assert.ok(gameClient.indexOf('this.handlers[Types.Messages.STORY_DIALOGUE] = this.receiveStoryDialogue;') !== -1, 'GameClient must register Story Runtime dialogue messages');
    assert.ok(gameClient.indexOf('receiveStoryDialogue: function(data)') !== -1, 'GameClient must consume Story Runtime dialogue');
    assert.ok(gameClient.indexOf("typeof npc.setStoryDialogue === 'function'") !== -1, 'Story Runtime dialogue must be attached to the interacted NPC');
    assert.ok(gameClient.indexOf('this.chat_callback(npcId, message);') !== -1, 'first mission intro line must reuse the existing NPC bubble callback');
    assert.ok(npcClient.indexOf('setStoryDialogue: function(lines)') !== -1, 'NPC must expose a temporary Story Runtime dialogue queue');
    assert.ok(npcClient.indexOf('if(this.storyDialogue.length)') !== -1, 'mission intro dialogue must take priority over normal NPC chatter');
    assert.ok(npcClient.indexOf('this.storyDialogue = [];') !== -1, 'temporary mission dialogue must clear after it is consumed');

    assert.ok(player.indexOf('else if(action === Types.Messages.NPC_INTERACT)') !== -1, 'Player must handle NPC_INTERACT');
    assert.ok(player.indexOf("npc && npc.type === 'npc'") !== -1, 'server must reject non-NPC entities');
    assert.ok(player.indexOf('Math.abs(self.x - npc.x) + Math.abs(self.y - npc.y)') !== -1, 'server must calculate authoritative NPC distance');
    assert.ok(player.indexOf('npcDistance === 1 && self.npcinteract_callback') !== -1, 'server must require cardinal adjacency');
    assert.ok(player.indexOf('self.storyInteractionNpcId = npc.id;') !== -1, 'validated NPC id must be scoped to the mission-start interaction');
    assert.ok(player.indexOf('self.storyInteractionNpcId = null;') !== -1, 'NPC interaction context must be cleared after the callback');
    assert.ok(player.indexOf('onNpcInteract: function(callback)') !== -1, 'Player must expose validated NPC interaction callback');

    assert.ok(worldServer.indexOf('player.onNpcInteract(function(npc)') !== -1, 'WorldServer must consume validated NPC interactions');
    assert.ok(worldServer.indexOf("npc.editorData.storyId") !== -1, 'linked NPC interaction must read storyId');
    assert.ok(worldServer.indexOf("npc.editorData.missionId") !== -1, 'linked NPC interaction must read missionId');
    assert.ok(worldServer.indexOf('if(!story || !mission) { return; }') !== -1, 'unlinked NPCs must not start missions');
    assert.ok(worldServer.indexOf('player.startStoryMission(story, mission)') !== -1, 'linked NPCs must start the published mission through Player');
    assert.ok(worldServer.indexOf("error.code === 'MISSION_ALREADY_ACTIVE'") !== -1, 'expected active-mission conflicts must be handled safely');
    assert.ok(worldServer.indexOf("error.code === 'MISSION_NOT_FOUND'") !== -1, 'stale editor links must be handled safely');

    assert.ok(player.indexOf('result && result.changed && sourceNpcId && result.mission && result.mission.mission') !== -1, 'intro dialogue must only be emitted for a newly started mission');
    assert.ok(player.indexOf('result.mission.mission.introDialogue') !== -1, 'mission intro must come from the published Story Runtime mission');
    assert.ok(player.indexOf("Utils.sanitize(line && line.text || '')") !== -1, 'mission intro text must be sanitized server-side');
    assert.ok(player.indexOf('self.send([Types.Messages.STORY_DIALOGUE, sourceNpcId, lines]);') !== -1, 'server must send only the NPC context and intro lines through STORY_DIALOGUE');

    console.log('NPC interaction, linked mission start, and mission intro dialogue smoke test passed.');
}

try { main(); }
catch(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
}
