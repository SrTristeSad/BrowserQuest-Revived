import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

// Expose a read-only administrative runtime snapshot from the live game server.
{
  const path = 'server/js/main.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`    server.onRequestStatus(function() {\n        return JSON.stringify(getWorldDistribution(worlds));\n    });\n`,
`    server.onRequestStatus(function() {\n        return JSON.stringify(getWorldDistribution(worlds));\n    });\n\n    server.adminRuntime = {\n        startedAt: Date.now(),\n        getSnapshot: function() {\n            var distribution = getWorldDistribution(worlds);\n            return {\n                onlinePlayers: distribution.reduce(function(total, count) { return total + count; }, 0),\n                worldCount: worlds.length,\n                maxPlayersPerWorld: config.nb_players_per_world,\n                worlds: worlds.map(function(world, index) {\n                    return {\n                        id: world.id || ('world' + (index + 1)),\n                        index: index + 1,\n                        players: world.playerCount,\n                        capacity: config.nb_players_per_world\n                    };\n                }),\n                websocket: true\n            };\n        },\n        listPlayers: function() {\n            var players = [];\n            worlds.forEach(function(world, worldIndex) {\n                Object.keys(world.players || {}).forEach(function(playerId) {\n                    var player = world.players[playerId],\n                        auth = player && player.connection ? player.connection.authContext : null;\n                    if(!player) { return; }\n                    players.push({\n                        id: String(player.id),\n                        name: player.name || null,\n                        type: auth && auth.type === 'account' ? 'account' : 'guest',\n                        world: world.id || ('world' + (worldIndex + 1)),\n                        worldIndex: worldIndex + 1,\n                        userId: auth && auth.user ? Number(auth.user.id) : null,\n                        username: auth && auth.user ? auth.user.username : null,\n                        characterId: auth && auth.character ? Number(auth.character.id) : null,\n                        connected: true\n                    });\n                });\n            });\n            return players;\n        }\n    };\n`, 'server admin runtime');
  fs.writeFileSync(path, source);
}

// Give the admin handler a mutable runtime reference before starting the game.
{
  const path = 'server/bootstrap.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`        characterStore = null,\n        adminHandler,\n        combinedHttpHandler;\n`,
`        characterStore = null,\n        adminRuntime = {startedAt: Date.now(), server: null, config: null},\n        adminHandler,\n        combinedHttpHandler;\n`, 'bootstrap runtime var');
  source = replaceOnce(source,
`    adminHandler = AdminHttp.createAdminHandler({configDir: configDir, infrastructure: services});\n`,
`    adminHandler = AdminHttp.createAdminHandler({configDir: configDir, infrastructure: services, runtime: adminRuntime});\n`, 'bootstrap admin handler runtime');
  source = replaceOnce(source,
`    console.log('[BrowserQuest] Instalação encontrada. Iniciando jogo...');\n`,
`    adminRuntime.config = config;\n\n    console.log('[BrowserQuest] Instalação encontrada. Iniciando jogo...');\n`, 'bootstrap config snapshot');
  source = replaceOnce(source,
`    gameMain.start(config);\n\n    if(services) {\n`,
`    adminRuntime.server = gameMain.start(config);\n\n    if(services) {\n`, 'bootstrap server capture');
  fs.writeFileSync(path, source);
}

// Add dashboard/read-only API routes.
{
  const path = 'server/admin/http.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
`        services = options.infrastructure || null,\n        publicDir = path.join(__dirname, 'public'),\n`,
`        services = options.infrastructure || null,\n        runtime = options.runtime || null,\n        processStartedAt = Date.now(),\n        publicDir = path.join(__dirname, 'public'),\n`, 'admin runtime option');

  source = replaceOnce(source,
`    async function handle(request, response, pathname) {\n`,
`    function gameSnapshot() {\n        var serverRuntime = runtime && runtime.server && runtime.server.adminRuntime;\n        if(serverRuntime && typeof serverRuntime.getSnapshot === 'function') {\n            return serverRuntime.getSnapshot();\n        }\n        var gameConfig = runtime && runtime.config ? runtime.config : (safeRead(gameConfigPath) || {});\n        return {\n            onlinePlayers: 0,\n            worldCount: Number(gameConfig.nb_worlds || 0),\n            maxPlayersPerWorld: Number(gameConfig.nb_players_per_world || 0),\n            worlds: [],\n            websocket: Boolean(runtime && runtime.server)\n        };\n    }\n\n    function onlinePlayers() {\n        var serverRuntime = runtime && runtime.server && runtime.server.adminRuntime;\n        if(serverRuntime && typeof serverRuntime.listPlayers === 'function') {\n            return serverRuntime.listPlayers();\n        }\n        return [];\n    }\n\n    async function accountSummary() {\n        if(!services || !services.postgres) {\n            return {total: 0, active: 0, suspended: 0, banned: 0};\n        }\n        var result = await services.postgres.query(\n            \"SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active, COUNT(*) FILTER (WHERE status='suspended')::int AS suspended, COUNT(*) FILTER (WHERE status='banned')::int AS banned FROM users WHERE role='player'\"\n        );\n        return result.rows[0] || {total: 0, active: 0, suspended: 0, banned: 0};\n    }\n\n    async function listAccounts(query) {\n        if(!services || !services.postgres) { return []; }\n        query = String(query || '').trim().slice(0, 64);\n        var values = [], where = \"u.role='player'\";\n        if(query) {\n            values.push('%' + query.toLowerCase() + '%');\n            where += \" AND (LOWER(u.username) LIKE $1 OR LOWER(COALESCE(c.name,'')) LIKE $1)\";\n        }\n        var result = await services.postgres.query(\n            \"SELECT u.id, u.username, u.display_name, u.status, u.last_login_at, u.created_at, c.id AS character_id, c.name AS character_name, c.weapon_kind, c.armor_kind, c.checkpoint_id FROM users u LEFT JOIN characters c ON c.user_id=u.id WHERE \" + where + \" ORDER BY u.created_at DESC LIMIT 100\",\n            values\n        );\n        return result.rows.map(function(row) {\n            return {\n                id: Number(row.id),\n                username: row.username,\n                displayName: row.display_name,\n                status: row.status,\n                lastLoginAt: row.last_login_at,\n                createdAt: row.created_at,\n                character: row.character_id ? {\n                    id: Number(row.character_id),\n                    name: row.character_name,\n                    weaponKind: Number(row.weapon_kind || 0),\n                    armorKind: Number(row.armor_kind || 0),\n                    checkpointId: row.checkpoint_id === null ? null : Number(row.checkpoint_id)\n                } : null\n            };\n        });\n    }\n\n    async function handle(request, response, pathname) {\n`, 'admin read helpers');

  source = replaceOnce(source,
`        if(pathname === '/admin') {\n            session = await requireAdmin(request, response, false);\n            if(session) { redirect(response, '/admin/settings'); }\n            return;\n        }\n\n        if(pathname === '/admin/login' && request.method === 'GET') {\n            if(await currentAdmin(request)) { redirect(response, '/admin/settings'); }\n            else { serveFile(response, 'login.html'); }\n            return;\n        }\n`,
`        if(pathname === '/admin') {\n            session = await requireAdmin(request, response, false);\n            if(session) { redirect(response, '/admin/dashboard'); }\n            return;\n        }\n\n        if(pathname === '/admin/login' && request.method === 'GET') {\n            if(await currentAdmin(request)) { redirect(response, '/admin/dashboard'); }\n            else { serveFile(response, 'login.html'); }\n            return;\n        }\n\n        if(pathname === '/admin/dashboard' && request.method === 'GET') {\n            if(await requireAdmin(request, response, false)) { serveFile(response, 'dashboard.html'); }\n            return;\n        }\n`, 'admin dashboard routes');

  source = replaceOnce(source,
`        if(pathname === '/admin/api/health' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            var health = services ? await services.health() : {postgres: false, redis: false};\n            json(response, 200, {postgres: health.postgres, redis: health.redis, adminSessions: sessions.storage});\n            return;\n        }\n`,
`        if(pathname === '/admin/api/health' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            var health = services ? await services.health() : {postgres: false, redis: false};\n            json(response, 200, {postgres: health.postgres, redis: health.redis, adminSessions: sessions.storage});\n            return;\n        }\n\n        if(pathname === '/admin/api/dashboard' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            var dashboardHealth = services ? await services.health() : {postgres: false, redis: false},\n                game = gameSnapshot(),\n                accounts = await accountSummary();\n            json(response, 200, {\n                uptimeSeconds: Math.max(0, Math.floor((Date.now() - processStartedAt) / 1000)),\n                health: {postgres: dashboardHealth.postgres, redis: dashboardHealth.redis, websocket: Boolean(game.websocket)},\n                game: game,\n                accounts: accounts,\n                adminSessions: sessions.storage\n            });\n            return;\n        }\n\n        if(pathname === '/admin/api/players' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            json(response, 200, {players: onlinePlayers()});\n            return;\n        }\n\n        if(pathname === '/admin/api/accounts' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            var queryValue = '';\n            try { queryValue = new URL(request.url, 'http://admin.local').searchParams.get('q') || ''; }\n            catch(ignoreUrl) {}\n            json(response, 200, {accounts: await listAccounts(queryValue)});\n            return;\n        }\n`, 'admin dashboard APIs');
  fs.writeFileSync(path, source);
}

console.log('Phase 3 dashboard server patch applied.');
