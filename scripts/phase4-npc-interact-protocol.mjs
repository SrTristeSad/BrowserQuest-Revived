import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

{
  const path = 'shared/js/gametypes.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
    '        CHECK: 26,\n        ANNOUNCEMENT: 27',
    '        CHECK: 26,\n        ANNOUNCEMENT: 27,\n        NPC_INTERACT: 28',
    'message type');
  fs.writeFileSync(path, source);
}

{
  const path = 'server/js/format.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
    '        this.formats[Types.Messages.CHECK] = [\'n\'];',
    '        this.formats[Types.Messages.CHECK] = [\'n\'];\n        this.formats[Types.Messages.NPC_INTERACT] = [\'n\'];',
    'format');
  fs.writeFileSync(path, source);
}

{
  const path = 'client/js/gameclient.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
    '        sendCheck: function(id) {\n            this.sendMessage([Types.Messages.CHECK,\n                              id]);\n        }',
    '        sendCheck: function(id) {\n            this.sendMessage([Types.Messages.CHECK,\n                              id]);\n        },\n\n        sendNpcInteract: function(npc) {\n            if(npc) {\n                this.sendMessage([Types.Messages.NPC_INTERACT, npc.id]);\n            }\n        }',
    'client sender');
  fs.writeFileSync(path, source);
}

{
  const path = 'client/js/game.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
    '        makeNpcTalk: function(npc) {\n            var msg;\n        \n            if(npc) {\n                msg = npc.talk();',
    '        makeNpcTalk: function(npc) {\n            var msg;\n        \n            if(npc) {\n                this.client.sendNpcInteract(npc);\n                msg = npc.talk();',
    'talk notification');
  fs.writeFileSync(path, source);
}

{
  const path = 'server/js/player.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
    '            else if(action === Types.Messages.CHECK) {\n                var checkpoint = self.server.map.getCheckpoint(message[1]);\n                if(checkpoint) {\n                    self.lastCheckpoint = checkpoint;\n                    self.schedulePersistence({checkpointId: checkpoint.id});\n                }\n            }\n            else {',
    '            else if(action === Types.Messages.CHECK) {\n                var checkpoint = self.server.map.getCheckpoint(message[1]);\n                if(checkpoint) {\n                    self.lastCheckpoint = checkpoint;\n                    self.schedulePersistence({checkpointId: checkpoint.id});\n                }\n            }\n            else if(action === Types.Messages.NPC_INTERACT) {\n                var npc = self.server.getEntityById(message[1]);\n                if(npc && npc.type === \'npc\') {\n                    var npcDistance = Math.abs(self.x - npc.x) + Math.abs(self.y - npc.y);\n                    if(npcDistance === 1 && self.npcinteract_callback) {\n                        self.npcinteract_callback(npc);\n                    }\n                }\n            }\n            else {',
    'server validation');
  source = replaceOnce(source,
    '    onMessage: function(callback) {\n        this.message_callback = callback;\n    },',
    '    onMessage: function(callback) {\n        this.message_callback = callback;\n    },\n\n    onNpcInteract: function(callback) {\n        this.npcinteract_callback = callback;\n    },',
    'callback registration');
  fs.writeFileSync(path, source);
}

console.log('NPC interaction protocol patch applied.');
