'use strict';

var fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    Auth = require('./auth'),
    StoryStore = require('./story-store').StoryStore,
    WorldStore = require('./world-store').WorldStore;

function parseCookies(header) {
    var out = {};
    String(header || '').split(';').forEach(function(part) {
        var index = part.indexOf('='), key, value;
        if(index <= 0) { return; }
        key = part.slice(0, index).trim();
        value = part.slice(index + 1).trim();
        try { out[key] = decodeURIComponent(value); }
        catch(ignore) { out[key] = value; }
    });
    return out;
}

function send(response, statusCode, body, contentType, extraHeaders) {
    var headers = Object.assign({
        'Content-Type': contentType || 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    }, extraHeaders || {});
    response.writeHead(statusCode, headers);
    response.end(body);
}

function json(response, statusCode, payload, extraHeaders) {
    send(response, statusCode, JSON.stringify(payload), 'application/json; charset=utf-8', extraHeaders);
}

function redirect(response, location) {
    send(response, 302, '', 'text/plain; charset=utf-8', {Location: location});
}

function readJson(request) {
    return new Promise(function(resolve, reject) {
        var chunks = [], size = 0, finished = false;
        request.on('data', function(chunk) {
            if(finished) { return; }
            size += chunk.length;
            if(size > 4 * 1024 * 1024) {
                finished = true;
                reject(new Error('Payload too large'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', function() {
            if(finished) { return; }
            finished = true;
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
            catch(error) { reject(error); }
        });
        request.on('error', reject);
    });
}

function safeRead(filepath) {
    try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
    catch(error) { return null; }
}

function writeJsonAtomic(filepath, value) {
    var temporary = filepath + '.tmp-' + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, filepath);
}

function createAdminHandler(options) {
    options = options || {};

    var configDir = options.configDir,
        services = options.infrastructure || null,
        runtime = options.runtime || null,
        processStartedAt = Date.now(),
        publicDir = path.join(__dirname, 'public'),
        adminPath = path.join(configDir, 'admin.json'),
        gameConfigPath = path.join(configDir, 'browserquest.json'),
        storiesPath = path.join(configDir, 'stories.json'),
        sessions = services && services.redis ?
            Auth.createRedisSessionManager(services.redis, {ttlSeconds: 8 * 60 * 60}) :
            Auth.createSessionManager({ttl: 8 * 60 * 60 * 1000}),
        stories = new StoryStore(storiesPath),
        world = new WorldStore({
            baseMapPath: path.join(__dirname, '..', 'maps', 'world_server.json'),
            baseClientMapPath: path.join(__dirname, '..', '..', 'client', 'maps', 'world_client.json'),
            statePath: path.join(configDir, 'world-editor.json'),
            publishedMapPath: path.join(configDir, 'world_server_published.json'),
            publishedClientJsonPath: path.join(configDir, 'world_client_published.json'),
            publishedClientJsPath: path.join(configDir, 'world_client_published.js'),
            versionsDir: path.join(configDir, 'world-versions')
        }),
        legacyAttempts = new Map();

    async function currentAdmin(request) {
        var cookies = parseCookies(request.headers.cookie);
        return await sessions.get(cookies.bq_admin_session) || null;
    }

    async function requireAdmin(request, response, apiMode) {
        var session = await currentAdmin(request);
        if(session) { return session; }
        if(apiMode) { json(response, 401, {error: 'Sessão administrativa expirada.'}); }
        else { redirect(response, '/admin/login'); }
        return null;
    }

    function requestIp(request) {
        return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
    }

    function secureRequest(request) {
        return request.headers['x-forwarded-proto'] === 'https' || Boolean(request.socket.encrypted);
    }

    function originAllowed(request) {
        var origin = request.headers.origin, host = request.headers.host;
        if(!origin || !host) { return true; }
        try { return new URL(origin).host === host; }
        catch(error) { return false; }
    }

    async function checkLoginRate(ip) {
        if(services && services.redis) {
            var digest = crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 24),
                key = 'bq:admin:rate:login:' + digest,
                count = await services.redis.incr(key);
            if(count === 1) { await services.redis.expire(key, 10 * 60); }
            return {allowed: count <= 8, key: key, retryAfter: Math.max(1, await services.redis.ttl(key))};
        }

        var now = Date.now(), state = legacyAttempts.get(ip);
        if(!state || state.resetAt <= now) {
            state = {count: 0, resetAt: now + 10 * 60 * 1000};
            legacyAttempts.set(ip, state);
        }
        state.count += 1;
        return {allowed: state.count <= 8, key: null, retryAfter: Math.ceil((state.resetAt - now) / 1000)};
    }

    async function clearLoginRate(ip, key) {
        if(services && services.redis && key) { await services.redis.del(key); }
        legacyAttempts.delete(ip);
    }

    async function loadAdminCredential(username) {
        if(services && services.postgres) {
            var result = await services.postgres.query(
                "SELECT id, username, display_name, password_hash, role, status FROM users WHERE LOWER(username)=LOWER($1) AND role IN ('owner','admin','moderator') LIMIT 1",
                [String(username || '').trim()]
            );
            if(!result.rowCount) { return null; }
            return {
                id: Number(result.rows[0].id),
                username: result.rows[0].username,
                displayName: result.rows[0].display_name,
                passwordHash: result.rows[0].password_hash,
                role: result.rows[0].role,
                status: result.rows[0].status
            };
        }

        var legacy = safeRead(adminPath);
        if(!legacy || String(username || '') !== String(legacy.username || '')) { return null; }
        return {id: null, username: legacy.username, displayName: legacy.username, passwordHash: legacy.passwordHash, role: legacy.role || 'owner', status: 'active'};
    }

    async function audit(session, action, target, metadata, request) {
        if(!services || !services.postgres) { return; }
        try {
            await services.postgres.query(
                'INSERT INTO admin_audit_log(actor_user_id, action, target, metadata, ip) VALUES($1,$2,$3,$4::jsonb,$5)',
                [session && session.userId ? session.userId : null, action, target || null, JSON.stringify(metadata || {}), requestIp(request) || null]
            );
        } catch(error) {
            console.error('[BrowserQuest] Admin audit:', error.message);
        }
    }

    function serveFile(response, filename) {
        fs.readFile(path.join(publicDir, filename), 'utf8', function(error, content) {
            if(error) { send(response, 500, 'Admin page unavailable.'); return; }
            send(response, 200, content, 'text/html; charset=utf-8');
        });
    }

    async function getAccessSettings() {
        if(services && services.postgres) {
            var result = await services.postgres.query("SELECT key, value FROM settings WHERE key IN ('access_mode','registration_enabled')"), values = {};
            result.rows.forEach(function(row) { values[row.key] = row.value; });
            return {
                accessMode: ['name_only','mixed','account_only'].indexOf(values.access_mode) !== -1 ? values.access_mode : 'mixed',
                registrationEnabled: values.registration_enabled !== false
            };
        }
        var gameConfig = safeRead(gameConfigPath) || {};
        return {accessMode: gameConfig.access_mode || 'name_only', registrationEnabled: false, legacy: true};
    }

    async function saveAccessSettings(body, session, request) {
        if(!services || !services.postgres) {
            var unavailable = new Error('PostgreSQL não está disponível nesta instalação legada.');
            unavailable.statusCode = 409;
            throw unavailable;
        }
        var accessMode = String(body.accessMode || ''), registrationEnabled = Boolean(body.registrationEnabled);
        if(['name_only','mixed','account_only'].indexOf(accessMode) === -1) {
            var invalid = new Error('Política de acesso inválida.');
            invalid.statusCode = 400;
            throw invalid;
        }

        var client = await services.postgres.connect();
        try {
            await client.query('BEGIN');
            await client.query("INSERT INTO settings(key,value) VALUES('access_mode',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()", [JSON.stringify(accessMode)]);
            await client.query("INSERT INTO settings(key,value) VALUES('registration_enabled',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()", [JSON.stringify(registrationEnabled)]);
            await client.query('COMMIT');
        } catch(error) {
            try { await client.query('ROLLBACK'); } catch(ignore) {}
            throw error;
        } finally {
            client.release();
        }

        var gameConfig = safeRead(gameConfigPath);
        if(gameConfig) {
            gameConfig.access_mode = accessMode;
            writeJsonAtomic(gameConfigPath, gameConfig);
        }
        await audit(session, 'settings.access.update', 'player_access', {accessMode: accessMode, registrationEnabled: registrationEnabled}, request);
        return {accessMode: accessMode, registrationEnabled: registrationEnabled};
    }

    function gameSnapshot() {
        var serverRuntime = runtime && runtime.server && runtime.server.adminRuntime;
        if(serverRuntime && typeof serverRuntime.getSnapshot === 'function') {
            return serverRuntime.getSnapshot();
        }
        var gameConfig = runtime && runtime.config ? runtime.config : (safeRead(gameConfigPath) || {});
        return {
            onlinePlayers: 0,
            worldCount: Number(gameConfig.nb_worlds || 0),
            maxPlayersPerWorld: Number(gameConfig.nb_players_per_world || 0),
            worlds: [],
            websocket: Boolean(runtime && runtime.server)
        };
    }

    function onlinePlayers() {
        var serverRuntime = runtime && runtime.server && runtime.server.adminRuntime;
        if(serverRuntime && typeof serverRuntime.listPlayers === 'function') {
            return serverRuntime.listPlayers();
        }
        return [];
    }

    async function accountSummary() {
        if(!services || !services.postgres) {
            return {total: 0, active: 0, suspended: 0, banned: 0};
        }
        var result = await services.postgres.query(
            "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active, COUNT(*) FILTER (WHERE status='suspended')::int AS suspended, COUNT(*) FILTER (WHERE status='banned')::int AS banned FROM users WHERE role='player'"
        );
        return result.rows[0] || {total: 0, active: 0, suspended: 0, banned: 0};
    }

    async function listAccounts(query) {
        if(!services || !services.postgres) { return []; }
        query = String(query || '').trim().slice(0, 64);
        var values = [], where = "u.role='player'";
        if(query) {
            values.push('%' + query.toLowerCase() + '%');
            where += " AND (LOWER(u.username) LIKE $1 OR LOWER(COALESCE(c.name,'')) LIKE $1)";
        }
        var result = await services.postgres.query(
            "SELECT u.id, u.username, u.display_name, u.status, u.last_login_at, u.created_at, c.id AS character_id, c.name AS character_name, c.weapon_kind, c.armor_kind, c.checkpoint_id FROM users u LEFT JOIN characters c ON c.user_id=u.id WHERE " + where + " ORDER BY u.created_at DESC LIMIT 100",
            values
        );
        return result.rows.map(function(row) {
            return {
                id: Number(row.id),
                username: row.username,
                displayName: row.display_name,
                status: row.status,
                lastLoginAt: row.last_login_at,
                createdAt: row.created_at,
                character: row.character_id ? {
                    id: Number(row.character_id),
                    name: row.character_name,
                    weaponKind: Number(row.weapon_kind || 0),
                    armorKind: Number(row.armor_kind || 0),
                    checkpointId: row.checkpoint_id === null ? null : Number(row.checkpoint_id)
                } : null
            };
        });
    }

    function controlRuntime() {
        return runtime && runtime.server && runtime.server.adminRuntime ? runtime.server.adminRuntime : null;
    }

    async function revokePlayerSessions(userId) {
        if(!services || !services.redis) { return 0; }
        var removed = 0;
        for await (var page of services.redis.scanIterator({MATCH: 'bq:player:session:*', COUNT: 100})) {
            var keys = Array.isArray(page) ? page : [page];
            if(!keys.length) { continue; }
            var values = await services.redis.mGet(keys), toDelete = [];
            values.forEach(function(raw, index) {
                if(!raw) { return; }
                try {
                    var session = JSON.parse(raw);
                    if(Number(session.userId) === Number(userId)) { toDelete.push(keys[index]); }
                } catch(ignoreSession) {}
            });
            if(toDelete.length) {
                removed += await services.redis.del(toDelete);
            }
        }
        return removed;
    }

    function cleanReason(value, fallback) {
        var reason = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
        return reason || fallback;
    }

    async function handle(request, response, pathname) {
        var session, body, match;

        if(request.method !== 'GET' && request.method !== 'HEAD' && !originAllowed(request)) {
            json(response, 403, {error: 'Origem da requisição não permitida.'});
            return;
        }

        if(pathname === '/admin') {
            session = await requireAdmin(request, response, false);
            if(session) { redirect(response, '/admin/dashboard'); }
            return;
        }

        if(pathname === '/admin/login' && request.method === 'GET') {
            if(await currentAdmin(request)) { redirect(response, '/admin/dashboard'); }
            else { serveFile(response, 'login.html'); }
            return;
        }

        if(pathname === '/admin/dashboard' && request.method === 'GET') {
            if(await requireAdmin(request, response, false)) { serveFile(response, 'dashboard.html'); }
            return;
        }

        if(pathname === '/admin/settings' && request.method === 'GET') {
            if(await requireAdmin(request, response, false)) { serveFile(response, 'settings.html'); }
            return;
        }

        if(pathname === '/admin/story-editor' && request.method === 'GET') {
            if(await requireAdmin(request, response, false)) { serveFile(response, 'story-editor.html'); }
            return;
        }

        if(pathname === '/admin/world-editor' && request.method === 'GET') {
            if(await requireAdmin(request, response, false)) { serveFile(response, 'world-editor.html'); }
            return;
        }

        if(pathname === '/admin/api/login' && request.method === 'POST') {
            var ip = requestIp(request), rate = await checkLoginRate(ip);
            if(!rate.allowed) {
                json(response, 429, {error: 'Muitas tentativas. Tente novamente mais tarde.', retryAfter: rate.retryAfter});
                return;
            }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }

            var admin = await loadAdminCredential(body.username);
            if(!admin || admin.status !== 'active' || !Auth.verifyPassword(body.password, admin.passwordHash)) {
                json(response, 401, {error: 'Usuário ou senha inválidos.'});
                return;
            }
            await clearLoginRate(ip, rate.key);
            var token = await sessions.create(admin.username, admin.role, admin.id), secure = secureRequest(request);
            await audit({userId: admin.id, username: admin.username, role: admin.role}, 'admin.login', admin.username, {}, request);
            json(response, 200, {ok: true, username: admin.username, role: admin.role}, {
                'Set-Cookie': 'bq_admin_session=' + encodeURIComponent(token) + '; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=28800' + (secure ? '; Secure' : '')
            });
            return;
        }

        if(pathname === '/admin/api/logout' && request.method === 'POST') {
            session = await currentAdmin(request);
            var cookies = parseCookies(request.headers.cookie);
            await sessions.destroy(cookies.bq_admin_session);
            await audit(session, 'admin.logout', session && session.username, {}, request);
            json(response, 200, {ok: true}, {
                'Set-Cookie': 'bq_admin_session=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0'
            });
            return;
        }

        if(pathname === '/admin/api/health' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            var health = services ? await services.health() : {postgres: false, redis: false};
            json(response, 200, {postgres: health.postgres, redis: health.redis, adminSessions: sessions.storage});
            return;
        }

        if(pathname === '/admin/api/dashboard' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            var dashboardHealth = services ? await services.health() : {postgres: false, redis: false},
                game = gameSnapshot(),
                accounts = await accountSummary();
            json(response, 200, {
                uptimeSeconds: Math.max(0, Math.floor((Date.now() - processStartedAt) / 1000)),
                health: {postgres: dashboardHealth.postgres, redis: dashboardHealth.redis, websocket: Boolean(game.websocket)},
                game: game,
                accounts: accounts,
                adminSessions: sessions.storage
            });
            return;
        }

        if(pathname === '/admin/api/players' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            json(response, 200, {players: onlinePlayers()});
            return;
        }

        if(pathname === '/admin/api/accounts' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            var queryValue = '';
            try { queryValue = new URL(request.url, 'http://admin.local').searchParams.get('q') || ''; }
            catch(ignoreUrl) {}
            json(response, 200, {accounts: await listAccounts(queryValue)});
            return;
        }

        match = pathname.match(/^\/admin\/api\/players\/([0-9]+)\/kick$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
            var kickReason = cleanReason(body.reason, 'Conexão encerrada pelo administrador.'),
                controls = controlRuntime(),
                kicked = controls && typeof controls.kickPlayer === 'function' ? controls.kickPlayer(match[1], kickReason) : null;
            if(!kicked) { json(response, 404, {error: 'Jogador não está mais conectado.'}); return; }
            await audit(session, 'player.kick', kicked.username || kicked.name || kicked.id, {playerId: kicked.id, userId: kicked.userId, characterId: kicked.characterId, reason: kickReason}, request);
            json(response, 200, {ok: true, player: kicked});
            return;
        }

        match = pathname.match(/^\/admin\/api\/accounts\/([0-9]+)\/status$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
            var nextStatus = String(body.status || ''),
                statusReason = cleanReason(body.reason, nextStatus === 'active' ? 'Status restaurado pelo administrador.' : 'Ação administrativa.'),
                allowedStatuses = ['active', 'suspended', 'banned'];
            if(allowedStatuses.indexOf(nextStatus) === -1) { json(response, 400, {error: 'Status de conta inválido.'}); return; }
            var statusResult = await services.postgres.query(
                "UPDATE users SET status=$1, updated_at=NOW() WHERE id=$2 AND role='player' RETURNING id, username, status",
                [nextStatus, Number(match[1])]
            );
            if(statusResult.rowCount !== 1) { json(response, 404, {error: 'Conta de jogador não encontrada.'}); return; }
            var changed = statusResult.rows[0], removedSessions = 0, disconnected = 0;
            if(nextStatus !== 'active') {
                removedSessions = await revokePlayerSessions(changed.id);
                controls = controlRuntime();
                if(controls && typeof controls.kickByUserId === 'function') {
                    disconnected = controls.kickByUserId(changed.id, nextStatus === 'banned' ? 'Sua conta foi banida.' : 'Sua conta foi suspensa.');
                }
            }
            await audit(session, 'account.status.' + nextStatus, changed.username, {userId: Number(changed.id), reason: statusReason, sessionsRevoked: removedSessions, connectionsClosed: disconnected}, request);
            json(response, 200, {ok: true, account: {id: Number(changed.id), username: changed.username, status: changed.status}, sessionsRevoked: removedSessions, connectionsClosed: disconnected});
            return;
        }

        match = pathname.match(/^\/admin\/api\/accounts\/([0-9]+)\/sessions\/revoke$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
            var accountResult = await services.postgres.query("SELECT id, username FROM users WHERE id=$1 AND role='player'", [Number(match[1])]);
            if(accountResult.rowCount !== 1) { json(response, 404, {error: 'Conta de jogador não encontrada.'}); return; }
            var account = accountResult.rows[0], revokeReason = cleanReason(body.reason, 'Sessões encerradas pelo administrador.');
            removedSessions = await revokePlayerSessions(account.id);
            controls = controlRuntime();
            disconnected = controls && typeof controls.kickByUserId === 'function' ? controls.kickByUserId(account.id, revokeReason) : 0;
            await audit(session, 'account.sessions.revoke', account.username, {userId: Number(account.id), reason: revokeReason, sessionsRevoked: removedSessions, connectionsClosed: disconnected}, request);
            json(response, 200, {ok: true, sessionsRevoked: removedSessions, connectionsClosed: disconnected});
            return;
        }

        if(pathname === '/admin/api/announcement' && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
            var announcement = String(body.message || '').trim().replace(/\s+/g, ' ').slice(0, 120);
            if(!announcement) { json(response, 400, {error: 'Digite uma mensagem para o anúncio.'}); return; }
            controls = controlRuntime();
            var delivered = controls && typeof controls.broadcastAnnouncement === 'function' ? controls.broadcastAnnouncement(announcement) : 0;
            await audit(session, 'announcement.send', 'all-online-players', {message: announcement, delivered: delivered}, request);
            json(response, 200, {ok: true, delivered: delivered});
            return;
        }

        if(pathname === '/admin/api/settings/access' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            json(response, 200, await getAccessSettings());
            return;
        }

        if(pathname === '/admin/api/settings/access' && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
            try { json(response, 200, await saveAccessSettings(body, session, request)); }
            catch(error) { json(response, error.statusCode || 500, {error: error.message}); }
            return;
        }

        if(pathname === '/admin/api/world' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            try { json(response, 200, world.load()); }
            catch(error) { json(response, 500, {error: error.message}); }
            return;
        }

        if(pathname === '/admin/api/world' && request.method === 'POST') {
            if(!await requireAdmin(request, response, true)) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido ou grande demais.'}); return; }
            try { json(response, 200, world.save(body)); }
            catch(error) { json(response, 400, {error: error.message}); }
            return;
        }

        if(pathname === '/admin/api/world/publish' && request.method === 'POST') {
            if(!await requireAdmin(request, response, true)) { return; }
            try { json(response, 200, world.publish()); }
            catch(error) { json(response, 500, {error: error.message}); }
            return;
        }

        if(pathname === '/admin/api/world/reset' && request.method === 'POST') {
            if(!await requireAdmin(request, response, true)) { return; }
            try { json(response, 200, world.reset()); }
            catch(error) { json(response, 500, {error: error.message}); }
            return;
        }

        if(pathname === '/admin/api/stories' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            try { json(response, 200, stories.list()); }
            catch(error) { json(response, 500, {error: error.message}); }
            return;
        }

        if(pathname === '/admin/api/stories' && request.method === 'POST') {
            if(!await requireAdmin(request, response, true)) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
            try { json(response, 200, stories.save(body)); }
            catch(error) { json(response, 400, {error: error.message}); }
            return;
        }

        match = pathname.match(/^\/admin\/api\/stories\/([a-zA-Z0-9_-]+)$/);
        if(match && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            var story = stories.get(match[1]);
            if(!story) { json(response, 404, {error: 'História não encontrada.'}); }
            else { json(response, 200, story); }
            return;
        }

        if(match && request.method === 'DELETE') {
            if(!await requireAdmin(request, response, true)) { return; }
            if(stories.remove(match[1])) { json(response, 200, {ok: true}); }
            else { json(response, 404, {error: 'História não encontrada.'}); }
            return;
        }

        json(response, 404, {error: 'Rota administrativa não encontrada.'});
    }

    return function adminHandler(request, response) {
        var pathname = String(request.url || '/').split('?')[0];
        if(pathname !== '/admin' && pathname.indexOf('/admin/') !== 0) { return false; }
        handle(request, response, pathname).catch(function(error) {
            console.error('[BrowserQuest] Admin HTTP:', error && error.stack ? error.stack : error);
            if(!response.headersSent) { json(response, 500, {error: 'Falha interna no painel administrativo.'}); }
            else { response.end(); }
        });
        return true;
    };
}

exports.createAdminHandler = createAdminHandler;
