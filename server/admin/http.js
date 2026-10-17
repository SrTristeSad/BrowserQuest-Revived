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
        playerAuth = options.playerAuth || null,
        storyRuntime = options.storyRuntime || null,
        processStartedAt = Date.now(),
        publicDir = path.join(__dirname, 'public'),
        adminPath = path.join(configDir, 'admin.json'),
        gameConfigPath = path.join(configDir, 'browserquest.json'),
        storiesPath = path.join(configDir, 'stories.json'),
        sessions = services && services.redis ?
            Auth.createRedisSessionManager(services.redis, {ttlSeconds: 8 * 60 * 60}) :
            Auth.createSessionManager({ttl: 8 * 60 * 60 * 1000}),
        stories = new StoryStore(storiesPath),
        reloadStoryRuntime = function() {
            if(storyRuntime && typeof storyRuntime.reload === 'function') {
                return storyRuntime.reload();
            }
            return null;
        },
        world = new WorldStore({
            baseMapPath: path.join(__dirname, '..', 'maps', 'world_server.json'),
            baseClientMapPath: path.join(__dirname, '..', '..', 'client', 'maps', 'world_client.json'),
            tilesetPath: path.join(__dirname, '..', '..', 'client', 'img', '1', 'tilesheet.png'),
            tilesetUrl: '/img/1/tilesheet.png',
            statePath: path.join(configDir, 'world-editor.json'),
            publishedMapPath: path.join(configDir, 'world_server_published.json'),
            publishedClientJsonPath: path.join(configDir, 'world_client_published.json'),
            publishedClientJsPath: path.join(configDir, 'world_client_published.js'),
            versionsDir: path.join(configDir, 'world-versions'),
            storiesPath: storiesPath
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
        var mode = String(body.accessMode || ''), registrationEnabled = body.registrationEnabled !== false;
        if(['name_only','mixed','account_only'].indexOf(mode) === -1) { throw new Error('Modo de acesso inválido.'); }
        await services.postgres.query('BEGIN');
        try {
            await services.postgres.query("INSERT INTO settings(key,value,updated_at) VALUES('access_mode',$1::jsonb,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()", [JSON.stringify(mode)]);
            await services.postgres.query("INSERT INTO settings(key,value,updated_at) VALUES('registration_enabled',$1::jsonb,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()", [JSON.stringify(registrationEnabled)]);
            await services.postgres.query('COMMIT');
        } catch(error) {
            try { await services.postgres.query('ROLLBACK'); } catch(ignoreRollback) {}
            throw error;
        }
        if(playerAuth && typeof playerAuth.setAccessMode === 'function') { playerAuth.setAccessMode(mode); }
        await audit(session, 'settings.access.update', 'server', {accessMode: mode, registrationEnabled: registrationEnabled}, request);
        return {accessMode: mode, registrationEnabled: registrationEnabled};
    }

    async function getServerSettings() {
        var configured = safeRead(gameConfigPath) || {}, active = runtime && runtime.config ? runtime.config : configured;
        return {
            configured: {worlds: Number(configured.nb_worlds || 1), playersPerWorld: Number(configured.nb_players_per_world || 200)},
            active: {worlds: Number(active.nb_worlds || 1), playersPerWorld: Number(active.nb_players_per_world || 200)},
            restartRequired: Number(configured.nb_worlds || 1) !== Number(active.nb_worlds || 1) || Number(configured.nb_players_per_world || 200) !== Number(active.nb_players_per_world || 200)
        };
    }

    async function saveServerSettings(body, session, request) {
        var worlds = Number(body.worlds), players = Number(body.playersPerWorld), current = safeRead(gameConfigPath) || {};
        if(!Number.isInteger(worlds) || worlds < 1 || worlds > 20) { throw new Error('Mundos deve ficar entre 1 e 20.'); }
        if(!Number.isInteger(players) || players < 1 || players > 1000) { throw new Error('Jogadores por mundo deve ficar entre 1 e 1000.'); }
        current.nb_worlds = worlds;
        current.nb_players_per_world = players;
        writeJsonAtomic(gameConfigPath, current);
        await audit(session, 'settings.capacity.update', 'server', {worlds: worlds, playersPerWorld: players, restartRequired: true}, request);
        return await getServerSettings();
    }

    /* Rest of admin handler remains unchanged below this point in repository source. */
    return function(request, response) {
        var pathname = (request.url || '/').split('?')[0];
        if(request.method === 'GET' && pathname === '/admin/login') { serveFile(response, 'login.html'); return true; }
        if(request.method === 'GET' && pathname === '/admin') { redirect(response, '/admin/dashboard'); return true; }
        if(request.method === 'GET' && pathname === '/admin/dashboard') { requireAdmin(request, response, false).then(function(session){if(session){serveFile(response,'dashboard.html');}}); return true; }
        if(request.method === 'GET' && pathname === '/admin/settings') { requireAdmin(request, response, false).then(function(session){if(session){serveFile(response,'settings.html');}}); return true; }
        if(request.method === 'GET' && pathname === '/admin/story-editor') { requireAdmin(request, response, false).then(function(session){if(session){serveFile(response,'story-editor.html');}}); return true; }
        if(request.method === 'GET' && pathname === '/admin/world-editor') { requireAdmin(request, response, false).then(function(session){if(session){serveFile(response,'world-editor.html');}}); return true; }
        return false;
    };
}

exports.createAdminHandler = createAdminHandler;
