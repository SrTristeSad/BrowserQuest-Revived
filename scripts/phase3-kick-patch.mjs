import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

{
  const path = 'server/js/main.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`            return players;\n        }\n    };\n`,
`            return players;\n        },\n        kickPlayer: function(playerId, reason) {\n            var found = null;\n            worlds.some(function(world, worldIndex) {\n                var player = world.players && world.players[String(playerId)], auth;\n                if(!player) { return false; }\n                auth = player.connection && player.connection.authContext;\n                found = {\n                    id: String(player.id),\n                    name: player.name || null,\n                    world: world.id || ('world' + (worldIndex + 1)),\n                    userId: auth && auth.user ? Number(auth.user.id) : null,\n                    username: auth && auth.user ? auth.user.username : null,\n                    characterId: auth && auth.character ? Number(auth.character.id) : null\n                };\n                player.connection.close(String(reason || 'Conexão encerrada pelo administrador.').slice(0, 120));\n                return true;\n            });\n            return found;\n        }\n    };\n`, 'runtime kick');
  fs.writeFileSync(path, source);
}

{
  const path = 'server/admin/http.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`    async function handle(request, response, pathname) {\n`,
`    function controlRuntime() {\n        return runtime && runtime.server && runtime.server.adminRuntime ? runtime.server.adminRuntime : null;\n    }\n\n    async function handle(request, response, pathname) {\n`, 'runtime helper');

  source = replaceOnce(source,
`        if(pathname === '/admin/api/players' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            json(response, 200, {players: onlinePlayers()});\n            return;\n        }\n`,
`        if(pathname === '/admin/api/players' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            json(response, 200, {players: onlinePlayers()});\n            return;\n        }\n\n        match = pathname.match(/^\\/admin\\/api\\/players\\/([0-9]+)\\/kick$/);\n        if(match && request.method === 'POST') {\n            session = await requireAdmin(request, response, true);\n            if(!session) { return; }\n            try { body = await readJson(request); }\n            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }\n            var reason = String(body.reason || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || 'Conexão encerrada pelo administrador.',\n                controls = controlRuntime(),\n                kicked = controls && typeof controls.kickPlayer === 'function' ? controls.kickPlayer(match[1], reason) : null;\n            if(!kicked) { json(response, 404, {error: 'Jogador não está mais conectado.'}); return; }\n            await audit(session, 'player.kick', kicked.username || kicked.name || kicked.id, {\n                playerId: kicked.id,\n                userId: kicked.userId,\n                characterId: kicked.characterId,\n                reason: reason\n            }, request);\n            json(response, 200, {ok: true, player: kicked});\n            return;\n        }\n`, 'kick route');
  fs.writeFileSync(path, source);
}

console.log('Kick microtask patch applied.');
