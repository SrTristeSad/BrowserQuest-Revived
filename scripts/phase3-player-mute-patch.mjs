import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

// PlayerAuth: Redis-backed account mute with TTL.
{
  const path = 'server/auth/player-auth.js';
  let source = fs.readFileSync(path, 'utf8');
  const anchor = `PlayerAuth.prototype.isCharacterNameReserved = async function(name) {\n`;
  const block = `PlayerAuth.prototype.setMuteForUser = async function(userId, durationSeconds, reason) {\n    var numericUserId = Number(userId), seconds = Math.floor(Number(durationSeconds));\n    if(!Number.isInteger(numericUserId) || numericUserId <= 0) { throw new Error('ID de usuário inválido para mute.'); }\n    if(!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) { throw new Error('Duração do mute deve ficar entre 60 e 86400 segundos.'); }\n    var until = Date.now() + (seconds * 1000), payload = {\n        until: until,\n        reason: String(reason || '').trim().replace(/\\s+/g, ' ').slice(0, 120)\n    };\n    await this.services.redis.set('bq:player:mute:user:' + numericUserId, JSON.stringify(payload), {EX: seconds});\n    return {until: until, remainingSeconds: seconds, reason: payload.reason};\n};\n\nPlayerAuth.prototype.getMuteForUser = async function(userId) {\n    var numericUserId = Number(userId), key, raw, ttl, payload;\n    if(!Number.isInteger(numericUserId) || numericUserId <= 0) { return null; }\n    key = 'bq:player:mute:user:' + numericUserId;\n    raw = await this.services.redis.get(key);\n    if(!raw) { return null; }\n    ttl = await this.services.redis.ttl(key);\n    if(ttl <= 0) { await this.services.redis.del(key); return null; }\n    try { payload = JSON.parse(raw); }\n    catch(error) { await this.services.redis.del(key); return null; }\n    return {\n        until: Number(payload.until) || (Date.now() + ttl * 1000),\n        remainingSeconds: ttl,\n        reason: String(payload.reason || '').slice(0, 120)\n    };\n};\n\n`;
  source = replaceOnce(source, anchor, block + anchor, 'PlayerAuth mute methods');
  const sessionAnchor = `    if(session) {\n        return {\n            allowed: true,\n            type: 'account',\n            accessMode: policy.accessMode,\n            user: session.user,\n            character: session.character\n        };\n    }\n`;
  const sessionReplacement = `    if(session) {\n        var mute = await this.getMuteForUser(session.user.id);\n        return {\n            allowed: true,\n            type: 'account',\n            accessMode: policy.accessMode,\n            user: session.user,\n            character: session.character,\n            mute: mute\n        };\n    }\n`;
  source = replaceOnce(source, sessionAnchor, sessionReplacement, 'authorizeConnection mute context');
  fs.writeFileSync(path, source);
}

// Player: enforce mute at the authoritative CHAT path.
{
  const path = 'server/js/player.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
    `        this.characterId = null;\n`,
    `        this.characterId = null;\n        this.mutedUntil = 0;\n        this.muteReason = '';\n`,
    'player mute state');
  const chatAnchor = `            else if(action === Types.Messages.CHAT) {\n                var msg = Utils.sanitize(message[1]);\n                \n                if(msg && msg !== \"\") {\n                    msg = msg.substr(0, 60);\n                    self.broadcastToZone(new Messages.Chat(self, msg), false);\n                }\n            }\n`;
  const chatReplacement = `            else if(action === Types.Messages.CHAT) {\n                if(self.isMuted()) {\n                    var remainingMinutes = Math.max(1, Math.ceil((self.mutedUntil - Date.now()) / 60000));\n                    self.send([Types.Messages.ANNOUNCEMENT, 'Você está silenciado. Tempo restante: ' + remainingMinutes + ' min.']);\n                    return;\n                }\n                var msg = Utils.sanitize(message[1]);\n                \n                if(msg && msg !== \"\") {\n                    msg = msg.substr(0, 60);\n                    self.broadcastToZone(new Messages.Chat(self, msg), false);\n                }\n            }\n`;
  source = replaceOnce(source, chatAnchor, chatReplacement, 'chat mute guard');
  const helloAnchor = `        if(auth.type === 'account' && auth.character) {\n            name = String(auth.character.name || '').substr(0, 15);\n`;
  const helloReplacement = `        if(auth.type === 'account' && auth.character) {\n            name = String(auth.character.name || '').substr(0, 15);\n            if(auth.mute && Number(auth.mute.until) > Date.now()) {\n                this.setMute(Number(auth.mute.until), auth.mute.reason);\n            }\n`;
  source = replaceOnce(source, helloAnchor, helloReplacement, 'restore account mute');
  const methodAnchor = `    send: function(message) {\n        this.connection.send(message);\n    },\n`;
  const methods = `    setMute: function(until, reason) {\n        this.mutedUntil = Math.max(Date.now(), Number(until) || 0);\n        this.muteReason = String(reason || '').slice(0, 120);\n    },\n\n    isMuted: function() {\n        if(this.mutedUntil > Date.now()) { return true; }\n        this.mutedUntil = 0;\n        this.muteReason = '';\n        return false;\n    },\n\n${methodAnchor}`;
  source = replaceOnce(source, methodAnchor, methods, 'player mute methods');
  fs.writeFileSync(path, source);
}

// Runtime: mute a currently connected player; account mute is persisted in Redis TTL.
{
  const path = 'server/js/main.js';
  let source = fs.readFileSync(path, 'utf8');
  const anchor = `        kickPlayer: async function(playerId, reason) {\n`;
  const block = `        mutePlayer: async function(playerId, durationSeconds, reason) {\n            var targetPlayer = null, found = null;\n            worlds.some(function(world, worldIndex) {\n                var player = world.players && world.players[String(playerId)], auth;\n                if(!player) { return false; }\n                auth = player.connection && player.connection.authContext;\n                targetPlayer = player;\n                found = {\n                    id: String(player.id),\n                    name: player.name || null,\n                    world: world.id || ('world' + (worldIndex + 1)),\n                    userId: auth && auth.user ? Number(auth.user.id) : null,\n                    username: auth && auth.user ? auth.user.username : null,\n                    characterId: auth && auth.character ? Number(auth.character.id) : null,\n                    type: auth && auth.type === 'account' ? 'account' : 'guest'\n                };\n                return true;\n            });\n            if(!targetPlayer) { return null; }\n\n            var seconds = Math.floor(Number(durationSeconds)), until = Date.now() + (seconds * 1000), persistent = false;\n            if(found.userId && targetPlayer.connection.playerAuthService && typeof targetPlayer.connection.playerAuthService.setMuteForUser === 'function') {\n                var stored = await targetPlayer.connection.playerAuthService.setMuteForUser(found.userId, seconds, reason);\n                until = stored.until;\n                persistent = true;\n            }\n            if(typeof targetPlayer.setMute === 'function') { targetPlayer.setMute(until, reason); }\n            targetPlayer.send([require('../../shared/js/gametypes').Messages.ANNOUNCEMENT, 'Você foi silenciado por ' + Math.ceil(seconds / 60) + ' min.']);\n            found.until = until;\n            found.durationSeconds = seconds;\n            found.persistent = persistent;\n            return found;\n        },\n`;
  source = replaceOnce(source, anchor, block + anchor, 'admin runtime mute');
  fs.writeFileSync(path, source);
}

// Admin API.
{
  const path = 'server/admin/http.js';
  let source = fs.readFileSync(path, 'utf8');
  const anchor = `        match = pathname.match(/^\\/admin\\/api\\/players\\/([0-9]+)\\/kick$/);\n`;
  const block = `        match = pathname.match(/^\\/admin\\/api\\/players\\/([0-9]+)\\/mute$/);\n        if(match && request.method === 'POST') {\n            session = await requireAdmin(request, response, true);\n            if(!session) { return; }\n            try { body = await readJson(request); }\n            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }\n\n            var muteMinutes = Math.floor(Number(body.durationMinutes)),\n                muteReason = String(body.reason || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || 'Silenciado pelo administrador.';\n            if(!Number.isInteger(muteMinutes) || muteMinutes < 1 || muteMinutes > 1440) {\n                json(response, 400, {error: 'Duração deve ficar entre 1 e 1440 minutos.'});\n                return;\n            }\n            var muteControls = controlRuntime(),\n                muted = muteControls && typeof muteControls.mutePlayer === 'function' ? await muteControls.mutePlayer(match[1], muteMinutes * 60, muteReason) : null;\n            if(!muted) { json(response, 404, {error: 'Jogador não está mais conectado.'}); return; }\n            await audit(session, 'player.mute', muted.username || muted.name || muted.id, {\n                playerId: muted.id,\n                userId: muted.userId,\n                characterId: muted.characterId,\n                durationMinutes: muteMinutes,\n                reason: muteReason,\n                persistent: muted.persistent\n            }, request);\n            json(response, 200, {ok: true, player: muted});\n            return;\n        }\n\n`;
  source = replaceOnce(source, anchor, block + anchor, 'admin mute route');
  fs.writeFileSync(path, source);
}

console.log('Player mute backend patch applied.');
