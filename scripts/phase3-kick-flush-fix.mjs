import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

{
  const path = 'server/js/player.js';
  let source = fs.readFileSync(path, 'utf8');
  const before = `    flushPersistence: function() {\n        if(this.characterPersistence && this.characterId) {\n            this.characterPersistence.flush(this.characterId).catch(function(error) {\n                log.error('Falha no flush do personagem: ' + error.message);\n            });\n        }\n    },`;
  const after = `    flushPersistence: function() {\n        if(this.characterPersistence && this.characterId) {\n            return this.characterPersistence.flush(this.characterId).catch(function(error) {\n                log.error('Falha no flush do personagem: ' + error.message);\n                return false;\n            });\n        }\n        return Promise.resolve(false);\n    },`;
  source = replaceOnce(source, before, after, 'Player.flushPersistence returns promise');
  fs.writeFileSync(path, source);
}

{
  const path = 'server/js/main.js';
  let source = fs.readFileSync(path, 'utf8');
  const before = `        kickPlayer: function(playerId, reason) {\n            var found = null;\n            worlds.some(function(world, worldIndex) {\n                var player = world.players && world.players[String(playerId)], auth;\n                if(!player) { return false; }\n                auth = player.connection && player.connection.authContext;\n                found = {\n                    id: String(player.id),\n                    name: player.name || null,\n                    world: world.id || ('world' + (worldIndex + 1)),\n                    userId: auth && auth.user ? Number(auth.user.id) : null,\n                    username: auth && auth.user ? auth.user.username : null,\n                    characterId: auth && auth.character ? Number(auth.character.id) : null\n                };\n                player.connection.close(String(reason || 'Conexão encerrada pelo administrador.').slice(0, 120));\n                return true;\n            });\n            return found;\n        },`;
  const after = `        kickPlayer: async function(playerId, reason) {\n            var found = null, targetPlayer = null;\n            worlds.some(function(world, worldIndex) {\n                var player = world.players && world.players[String(playerId)], auth;\n                if(!player) { return false; }\n                auth = player.connection && player.connection.authContext;\n                targetPlayer = player;\n                found = {\n                    id: String(player.id),\n                    name: player.name || null,\n                    world: world.id || ('world' + (worldIndex + 1)),\n                    userId: auth && auth.user ? Number(auth.user.id) : null,\n                    username: auth && auth.user ? auth.user.username : null,\n                    characterId: auth && auth.character ? Number(auth.character.id) : null\n                };\n                return true;\n            });\n            if(!targetPlayer) { return null; }\n\n            targetPlayer.connection.close(String(reason || 'Conexão encerrada pelo administrador.').slice(0, 120));\n            if(typeof targetPlayer.flushPersistence === 'function') {\n                await targetPlayer.flushPersistence();\n            }\n            return found;\n        },`;
  source = replaceOnce(source, before, after, 'adminRuntime.kickPlayer awaits flush');
  fs.writeFileSync(path, source);
}

{
  const path = 'server/admin/http.js';
  let source = fs.readFileSync(path, 'utf8');
  const before = `                kicked = controls && typeof controls.kickPlayer === 'function' ? controls.kickPlayer(match[1], reason) : null;`;
  const after = `                kicked = controls && typeof controls.kickPlayer === 'function' ? await controls.kickPlayer(match[1], reason) : null;`;
  source = replaceOnce(source, before, after, 'admin kick route awaits runtime');
  fs.writeFileSync(path, source);
}

console.log('Admin kick persistence flush fix applied.');
