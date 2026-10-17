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
  source = replaceOnce(source, '        CHECK: 26\n', '        CHECK: 26,\n        ANNOUNCEMENT: 27\n', 'announcement message type');
  fs.writeFileSync(path, source);
}

{
  const path = 'client/js/gameclient.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    '            this.handlers[Types.Messages.CHAT] = this.receiveChat;\n',
    '            this.handlers[Types.Messages.CHAT] = this.receiveChat;\n            this.handlers[Types.Messages.ANNOUNCEMENT] = this.receiveAnnouncement;\n',
    'announcement handler registration'
  );
  source = replaceOnce(
    source,
    `        receiveChat: function(data) {\n            var id = data[1],\n                text = data[2];\n        \n            if(this.chat_callback) {\n                this.chat_callback(id, text);\n            }\n        },\n`,
    `        receiveChat: function(data) {\n            var id = data[1],\n                text = data[2];\n        \n            if(this.chat_callback) {\n                this.chat_callback(id, text);\n            }\n        },\n\n        receiveAnnouncement: function(data) {\n            var text = data[1];\n            if(this.announcement_callback) {\n                this.announcement_callback(text);\n            }\n        },\n`,
    'announcement receiver'
  );
  source = replaceOnce(
    source,
    `        onChatMessage: function(callback) {\n            this.chat_callback = callback;\n        },\n`,
    `        onChatMessage: function(callback) {\n            this.chat_callback = callback;\n        },\n\n        onAnnouncement: function(callback) {\n            this.announcement_callback = callback;\n        },\n`,
    'announcement callback registration'
  );
  fs.writeFileSync(path, source);
}

{
  const path = 'server/js/main.js';
  let source = fs.readFileSync(path, 'utf8');
  const anchor = `        kickPlayer: async function(playerId, reason) {\n`;
  const block = `        broadcastAnnouncement: function(message) {\n            var delivered = 0, payload = [require('../../shared/js/gametypes').Messages.ANNOUNCEMENT, message];\n            worlds.forEach(function(world) {\n                Object.keys(world.players || {}).forEach(function(playerId) {\n                    var player = world.players[playerId];\n                    if(player && player.connection) {\n                        player.connection.send(payload);\n                        delivered += 1;\n                    }\n                });\n            });\n            return delivered;\n        },\n`;
  source = replaceOnce(source, anchor, block + anchor, 'announcement runtime');
  fs.writeFileSync(path, source);
}

{
  const path = 'server/admin/http.js';
  let source = fs.readFileSync(path, 'utf8');
  const anchor = `        if(pathname === '/admin/api/settings/access' && request.method === 'GET') {\n`;
  const block = `        if(pathname === '/admin/api/announcements' && request.method === 'POST') {\n            session = await requireAdmin(request, response, true);\n            if(!session) { return; }\n            try { body = await readJson(request); }\n            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }\n\n            var announcementMessage = String(body.message || '').trim().replace(/\\s+/g, ' ').slice(0, 300);\n            if(!announcementMessage) {\n                json(response, 400, {error: 'A mensagem do anúncio é obrigatória.'});\n                return;\n            }\n            var announcementControls = controlRuntime();\n            if(!announcementControls || typeof announcementControls.broadcastAnnouncement !== 'function') {\n                json(response, 503, {error: 'Envio de anúncios indisponível.'});\n                return;\n            }\n            var announcementDelivered = announcementControls.broadcastAnnouncement(announcementMessage);\n            await audit(session, 'announcement.broadcast', 'all', {\n                message: announcementMessage,\n                delivered: announcementDelivered\n            }, request);\n            json(response, 200, {ok: true, message: announcementMessage, delivered: announcementDelivered});\n            return;\n        }\n\n`;
  source = replaceOnce(source, anchor, block + anchor, 'announcement admin endpoint');
  fs.writeFileSync(path, source);
}

console.log('Announcement transport/backend patch applied.');
