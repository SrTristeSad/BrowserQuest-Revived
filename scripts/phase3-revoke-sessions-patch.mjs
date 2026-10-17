import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

// Centralize player-session revocation in PlayerAuth.
{
  const path = 'server/auth/player-auth.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`PlayerAuth.prototype.destroySessionFromCookieHeader = async function(cookieHeader) {\n    var cookies = parseCookies(cookieHeader);\n    await this.destroySessionByToken(cookies[SESSION_COOKIE]);\n};\n`,
`PlayerAuth.prototype.destroySessionFromCookieHeader = async function(cookieHeader) {\n    var cookies = parseCookies(cookieHeader);\n    await this.destroySessionByToken(cookies[SESSION_COOKIE]);\n};\n\nPlayerAuth.prototype.destroySessionsByUserId = async function(userId) {\n    var numericUserId = Number(userId), cursor = '0', removed = 0, result, keys, values, toDelete;\n    if(!Number.isInteger(numericUserId) || numericUserId <= 0) { return 0; }\n\n    do {\n        result = await this.services.redis.scan(cursor, {MATCH: 'bq:player:session:*', COUNT: 100});\n        cursor = String(result.cursor);\n        keys = result.keys || [];\n        if(!keys.length) { continue; }\n\n        values = await this.services.redis.mGet(keys);\n        toDelete = [];\n        values.forEach(function(raw, index) {\n            var payload;\n            if(!raw) { return; }\n            try { payload = JSON.parse(raw); }\n            catch(ignoreInvalidSession) { return; }\n            if(Number(payload.userId) === numericUserId) { toDelete.push(keys[index]); }\n        });\n\n        if(toDelete.length) { removed += await this.services.redis.del(toDelete); }\n    } while(cursor !== '0');\n\n    return removed;\n};\n`, 'PlayerAuth destroySessionsByUserId');
  fs.writeFileSync(path, source);
}

// Allow admin runtime to close every live connection owned by one account.
{
  const path = 'server/js/main.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`            return found;\n        }\n    };\n`,
`            return found;\n        },\n        kickByUserId: function(userId, reason) {\n            var count = 0;\n            userId = Number(userId);\n            worlds.forEach(function(world) {\n                Object.keys(world.players || {}).forEach(function(playerId) {\n                    var player = world.players[playerId],\n                        auth = player && player.connection ? player.connection.authContext : null;\n                    if(auth && auth.user && Number(auth.user.id) === userId) {\n                        count += 1;\n                        player.connection.close(String(reason || 'Sua sessão foi encerrada pelo administrador.').slice(0, 120));\n                    }\n                });\n            });\n            return count;\n        }\n    };\n`, 'runtime kickByUserId');
  fs.writeFileSync(path, source);
}

// Pass PlayerAuth to the admin handler instead of making the panel know Redis internals.
{
  const path = 'server/bootstrap.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`    adminHandler = AdminHttp.createAdminHandler({configDir: configDir, infrastructure: services, runtime: adminRuntime});\n`,
`    adminHandler = AdminHttp.createAdminHandler({configDir: configDir, infrastructure: services, runtime: adminRuntime, playerAuth: playerAuth});\n`, 'bootstrap PlayerAuth admin dependency');
  fs.writeFileSync(path, source);
}

// Add the isolated administrative revoke-sessions endpoint.
{
  const path = 'server/admin/http.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`        services = options.infrastructure || null,\n        runtime = options.runtime || null,\n        processStartedAt = Date.now(),\n`,
`        services = options.infrastructure || null,\n        runtime = options.runtime || null,\n        playerAuth = options.playerAuth || null,\n        processStartedAt = Date.now(),\n`, 'admin PlayerAuth option');

  source = replaceOnce(source,
`        if(pathname === '/admin/api/accounts' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            var queryValue = '';\n            try { queryValue = new URL(request.url, 'http://admin.local').searchParams.get('q') || ''; }\n            catch(ignoreUrl) {}\n            json(response, 200, {accounts: await listAccounts(queryValue)});\n            return;\n        }\n`,
`        if(pathname === '/admin/api/accounts' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            var queryValue = '';\n            try { queryValue = new URL(request.url, 'http://admin.local').searchParams.get('q') || ''; }\n            catch(ignoreUrl) {}\n            json(response, 200, {accounts: await listAccounts(queryValue)});\n            return;\n        }\n\n        match = pathname.match(/^\\/admin\\/api\\/accounts\\/([0-9]+)\\/sessions\\/revoke$/);\n        if(match && request.method === 'POST') {\n            session = await requireAdmin(request, response, true);\n            if(!session) { return; }\n            if(!playerAuth || typeof playerAuth.destroySessionsByUserId !== 'function') {\n                json(response, 503, {error: 'Gerenciamento de sessões de jogadores indisponível.'});\n                return;\n            }\n            try { body = await readJson(request); }\n            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }\n\n            var accountId = Number(match[1]),\n                accountResult = await services.postgres.query(\"SELECT id, username FROM users WHERE id=$1 AND role='player' LIMIT 1\", [accountId]);\n            if(accountResult.rowCount !== 1) {\n                json(response, 404, {error: 'Conta de jogador não encontrada.'});\n                return;\n            }\n\n            var account = accountResult.rows[0],\n                reason = String(body.reason || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || 'Sessões encerradas pelo administrador.',\n                sessionsRevoked = await playerAuth.destroySessionsByUserId(account.id),\n                controls = controlRuntime(),\n                connectionsClosed = controls && typeof controls.kickByUserId === 'function' ? controls.kickByUserId(account.id, reason) : 0;\n\n            await audit(session, 'account.sessions.revoke', account.username, {\n                userId: Number(account.id),\n                reason: reason,\n                sessionsRevoked: sessionsRevoked,\n                connectionsClosed: connectionsClosed\n            }, request);\n            json(response, 200, {ok: true, sessionsRevoked: sessionsRevoked, connectionsClosed: connectionsClosed});\n            return;\n        }\n`, 'admin revoke sessions route');
  fs.writeFileSync(path, source);
}

console.log('Revoke player sessions microtask patch applied.');
