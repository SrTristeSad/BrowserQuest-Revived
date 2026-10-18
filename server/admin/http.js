'use strict';

var fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    Auth = require('./auth'),
    StoryStore = require('./story-store').StoryStore,
    WorldStore = require('./world-store').WorldStore,
    SpriteImportStore = require('./sprite-import-store').SpriteImportStore;

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
            statePath: path.join(configDir, 'world-editor.json'),
            publishedMapPath: path.join(configDir, 'world_server_published.json'),
            publishedClientJsonPath: path.join(configDir, 'world_client_published.json'),
            publishedClientJsPath: path.join(configDir, 'world_client_published.js'),
            versionsDir: path.join(configDir, 'world-versions')
        }),
        spriteImports = new SpriteImportStore(path.join(configDir,'sprite-imports')),
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

    function getServerCapacitySettings() {
        var configured = safeRead(gameConfigPath) || {}, active = gameSnapshot(),
            worlds = Number(configured.nb_worlds || active.worldCount || 1),
            playersPerWorld = Number(configured.nb_players_per_world || active.maxPlayersPerWorld || 1),
            activeWorlds = Number(active.worldCount || worlds),
            activePlayersPerWorld = Number(active.maxPlayersPerWorld || playersPerWorld);
        return {
            configured: {worlds: worlds, playersPerWorld: playersPerWorld},
            active: {worlds: activeWorlds, playersPerWorld: activePlayersPerWorld},
            restartRequired: worlds !== activeWorlds || playersPerWorld !== activePlayersPerWorld
        };
    }

    async function saveServerCapacitySettings(body, session, request) {
        var worlds = Number(body.worlds), playersPerWorld = Number(body.playersPerWorld);
        if(!Number.isInteger(worlds) || worlds < 1 || worlds > 20) {
            var invalidWorlds = new Error('Mundos deve ficar entre 1 e 20.');
            invalidWorlds.statusCode = 400;
            throw invalidWorlds;
        }
        if(!Number.isInteger(playersPerWorld) || playersPerWorld < 1 || playersPerWorld > 1000) {
            var invalidPlayers = new Error('Jogadores por mundo deve ficar entre 1 e 1000.');
            invalidPlayers.statusCode = 400;
            throw invalidPlayers;
        }

        var gameConfig = safeRead(gameConfigPath);
        if(!gameConfig) {
            var missing = new Error('Configuração instalada do jogo não foi encontrada.');
            missing.statusCode = 409;
            throw missing;
        }

        var previousConfig = JSON.parse(JSON.stringify(gameConfig)), previous = {
                worlds: Number(gameConfig.nb_worlds || 0),
                playersPerWorld: Number(gameConfig.nb_players_per_world || 0)
            },
            active = gameSnapshot(), client = null, fileWritten = false;

        try {
            if(services && services.postgres) {
                client = await services.postgres.connect();
                await client.query('BEGIN');
                await client.query("INSERT INTO settings(key,value) VALUES('world_count',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()", [JSON.stringify(worlds)]);
                await client.query("INSERT INTO settings(key,value) VALUES('players_per_world',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()", [JSON.stringify(playersPerWorld)]);
            }

            gameConfig.nb_worlds = worlds;
            gameConfig.nb_players_per_world = playersPerWorld;
            writeJsonAtomic(gameConfigPath, gameConfig);
            fileWritten = true;
            if(client) { await client.query('COMMIT'); }
        } catch(error) {
            if(client) { try { await client.query('ROLLBACK'); } catch(ignoreRollback) {} }
            if(fileWritten) {
                try { writeJsonAtomic(gameConfigPath, previousConfig); }
                catch(restoreError) { console.error('[BrowserQuest] Falha ao restaurar configuração após erro:', restoreError.message); }
            }
            throw error;
        } finally {
            if(client) { client.release(); }
        }

        var restartRequired = Number(active.worldCount || 0) !== worlds || Number(active.maxPlayersPerWorld || 0) !== playersPerWorld;
        await audit(session, 'settings.server_capacity.update', 'server_capacity', {
            previous: previous,
            configured: {worlds: worlds, playersPerWorld: playersPerWorld},
            restartRequired: restartRequired
        }, request);
        return {
            configured: {worlds: worlds, playersPerWorld: playersPerWorld},
            active: {worlds: Number(active.worldCount || 0), playersPerWorld: Number(active.maxPlayersPerWorld || 0)},
            restartRequired: restartRequired
        };
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

    function sanitizeAuditMetadata(value) {
        if(Array.isArray(value)) {
            return value.map(sanitizeAuditMetadata);
        }
        if(!value || typeof value !== 'object') { return value; }
        var clean = {};
        Object.keys(value).forEach(function(key) {
            if(/password|token|secret|cookie|authorization/i.test(key)) { return; }
            clean[key] = sanitizeAuditMetadata(value[key]);
        });
        return clean;
    }

    async function listAuditEntries(limit, before) {
        if(!services || !services.postgres) { return {entries: [], nextBefore: null}; }
        limit = Math.max(1, Math.min(100, Number(limit) || 50));
        before = before && /^[0-9]+$/.test(String(before)) ? Number(before) : null;
        var result = await services.postgres.query(
            "SELECT l.id, l.actor_user_id, u.username AS actor_username, u.role AS actor_role, l.action, l.target, l.metadata, l.created_at FROM admin_audit_log l LEFT JOIN users u ON u.id=l.actor_user_id WHERE ($1::bigint IS NULL OR l.id < $1::bigint) ORDER BY l.id DESC LIMIT $2",
            [before, limit]
        ), entries = result.rows.map(function(row) {
            return {
                id: Number(row.id),
                actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
                actorUsername: row.actor_username || null,
                actorRole: row.actor_role || null,
                action: row.action,
                target: row.target || null,
                metadata: sanitizeAuditMetadata(row.metadata || {}),
                createdAt: row.created_at
            };
        });
        return {
            entries: entries,
            nextBefore: entries.length === limit ? entries[entries.length - 1].id : null
        };
    }

    function controlRuntime() {
        return runtime && runtime.server && runtime.server.adminRuntime ? runtime.server.adminRuntime : null;
    }

    async function handle(request, response, pathname) {
        var session, body, match;

        if(request.method !== 'GET' && request.method !== 'HEAD' && !originAllowed(request)) {
            json(response, 403, {error: 'Origem da requisição não permitida.'});
            return;
        }

        if(pathname === '/game/sprites/catalog.js' && request.method === 'GET') {
            const list=spriteImports.publicCatalog();
            send(response,200,'window.BrowserQuestPublishedSprites = '+JSON.stringify(list)+';\n',
                'application/javascript; charset=utf-8');
            return;
        }
        if(request.method === 'GET' && /^\/game\/sprites\/[a-f0-9]{32}\.png$/.test(pathname)) {
            try{
                const spriteId=pathname.slice('/game/sprites/'.length,-4);
                send(response,200,spriteImports.publishedImage(spriteId),'image/png');
            }catch(error){json(response,404,{error:'Sprite publicado não encontrado.'});}
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

        if(pathname === '/admin/sprite-importer' && request.method === 'GET') {
            if(await requireAdmin(request,response,false)) { serveFile(response,'sprite-importer.html'); }
            return;
        }
        if(pathname === '/admin/api/sprites' && request.method === 'GET') {
            if(!await requireAdmin(request,response,true)) { return; }
            try { json(response,200,{sprites:spriteImports.list()}); }
            catch(error) { json(response,500,{error:'Falha ao listar sprites.'}); }
            return;
        }
        if(pathname === '/admin/api/sprites' && request.method === 'POST') {
            session=await requireAdmin(request,response,true);
            if(!session) { return; }
            try { body=await readJson(request); }
            catch(error) { json(response,400,{error:'JSON inválido ou arquivo muito grande.'}); return; }
            try {
                var imported=spriteImports.import(body);
                await audit(session,'sprite.import',imported.id,
                    {label:imported.label,width:imported.width,height:imported.height,frames:imported.frames},request);
                json(response,201,imported);
            } catch(error) { json(response,error.statusCode||500,{error:error.statusCode?error.message:'Falha ao importar sprite.'}); }
            return;
        }
        if(pathname === '/admin/api/sprites/animations' && request.method === 'POST') {
            session=await requireAdmin(request,response,true);
            if(!session) { return; }
            try { body=await readJson(request); }
            catch(error) { json(response,400,{error:'JSON de animações inválido.'}); return; }
            try {
                const updated=spriteImports.configure(body && body.id,body);
                await audit(session,'sprite.animate',updated.id,{animations:Object.keys(updated.animations)},request);
                json(response,200,updated);
            }catch(error){json(response,error.statusCode||500,{error:error.statusCode?error.message:'Falha ao configurar animações.'});}
            return;
        }
        if(pathname === '/admin/api/sprites/publish' && request.method === 'POST') {
            session=await requireAdmin(request,response,true);if(!session)return;
            try{body=await readJson(request);}catch(error){json(response,400,{error:'JSON inválido.'});return;}
            try{
                const published=spriteImports.publish(body&&body.id);
                await audit(session,'sprite.publish',published.id,{label:published.label},request);
                json(response,200,published);
            }catch(error){json(response,error.statusCode||500,{error:error.statusCode?error.message:'Falha ao publicar sprite.'});}
            return;
        }
        if(pathname === '/admin/api/sprites/image' && request.method === 'GET') {
            if(!await requireAdmin(request,response,true)) { return; }
            try {
                var spriteId=new URL(request.url,'http://localhost').searchParams.get('id');
                send(response,200,spriteImports.image(spriteId),'image/png');
            }catch(error){json(response,error.statusCode||404,{error:'Sprite não encontrado ou inválido.'});}
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

        if(pathname === '/admin/api/audit' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            var auditLimit = 50, auditBefore = null;
            try {
                var auditUrl = new URL(request.url, 'http://admin.local');
                auditLimit = auditUrl.searchParams.get('limit') || 50;
                auditBefore = auditUrl.searchParams.get('before');
            } catch(ignoreAuditUrl) {}
            json(response, 200, await listAuditEntries(auditLimit, auditBefore));
            return;
        }

        if(pathname === '/admin/api/players' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            json(response, 200, {players: onlinePlayers()});
            return;
        }

        match = pathname.match(/^\/admin\/api\/players\/([0-9]+)\/mute$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }

            var muteMinutes = Math.floor(Number(body.durationMinutes)),
                muteReason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'Silenciado pelo administrador.';
            if(!Number.isInteger(muteMinutes) || muteMinutes < 1 || muteMinutes > 1440) {
                json(response, 400, {error: 'Duração deve ficar entre 1 e 1440 minutos.'});
                return;
            }
            var muteControls = controlRuntime(),
                muted = muteControls && typeof muteControls.mutePlayer === 'function' ? await muteControls.mutePlayer(match[1], muteMinutes * 60, muteReason) : null;
            if(!muted) { json(response, 404, {error: 'Jogador não está mais conectado.'}); return; }
            await audit(session, 'player.mute', muted.username || muted.name || muted.id, {
                playerId: muted.id,
                userId: muted.userId,
                characterId: muted.characterId,
                durationMinutes: muteMinutes,
                reason: muteReason,
                persistent: muted.persistent
            }, request);
            json(response, 200, {ok: true, player: muted});
            return;
        }

        match = pathname.match(/^\/admin\/api\/players\/([0-9]+)\/kick$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
            var reason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'Conexão encerrada pelo administrador.',
                controls = controlRuntime(),
                kicked = controls && typeof controls.kickPlayer === 'function' ? await controls.kickPlayer(match[1], reason) : null;
            if(!kicked) { json(response, 404, {error: 'Jogador não está mais conectado.'}); return; }
            await audit(session, 'player.kick', kicked.username || kicked.name || kicked.id, {
                playerId: kicked.id,
                userId: kicked.userId,
                characterId: kicked.characterId,
                reason: reason
            }, request);
            json(response, 200, {ok: true, player: kicked});
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

        match = pathname.match(/^\/admin\/api\/accounts\/([0-9]+)\/sessions\/revoke$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            if(!playerAuth || typeof playerAuth.destroySessionsByUserId !== 'function') {
                json(response, 503, {error: 'Gerenciamento de sessões de jogadores indisponível.'});
                return;
            }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }

            var accountId = Number(match[1]),
                accountResult = await services.postgres.query("SELECT id, username FROM users WHERE id=$1 AND role='player' LIMIT 1", [accountId]);
            if(accountResult.rowCount !== 1) {
                json(response, 404, {error: 'Conta de jogador não encontrada.'});
                return;
            }

            var account = accountResult.rows[0],
                reason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'Sessões encerradas pelo administrador.',
                sessionsRevoked = await playerAuth.destroySessionsByUserId(account.id),
                controls = controlRuntime(),
                connectionsClosed = controls && typeof controls.kickByUserId === 'function' ? controls.kickByUserId(account.id, reason) : 0;

            await audit(session, 'account.sessions.revoke', account.username, {
                userId: Number(account.id),
                reason: reason,
                sessionsRevoked: sessionsRevoked,
                connectionsClosed: connectionsClosed
            }, request);
            json(response, 200, {ok: true, sessionsRevoked: sessionsRevoked, connectionsClosed: connectionsClosed});
            return;
        }

        match = pathname.match(/^\/admin\/api\/accounts\/([0-9]+)\/suspend$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            if(!playerAuth || typeof playerAuth.destroySessionsByUserId !== 'function') {
                json(response, 503, {error: 'Gerenciamento de sessões de jogadores indisponível.'});
                return;
            }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }

            var suspendAccountId = Number(match[1]),
                suspendResult = await services.postgres.query("SELECT id, username, status FROM users WHERE id=$1 AND role='player' LIMIT 1", [suspendAccountId]);
            if(suspendResult.rowCount !== 1) {
                json(response, 404, {error: 'Conta de jogador não encontrada.'});
                return;
            }

            var suspendAccount = suspendResult.rows[0];
            if(suspendAccount.status === 'banned') {
                json(response, 409, {error: 'A conta está banida. Remova o ban antes de aplicar suspensão.'});
                return;
            }

            var suspendReason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'Conta suspensa pelo administrador.',
                previousStatus = suspendAccount.status,
                suspended = (await services.postgres.query("UPDATE users SET status='suspended', updated_at=NOW() WHERE id=$1 AND role='player' RETURNING id, username, status", [suspendAccount.id])).rows[0],
                suspendedSessions = await playerAuth.destroySessionsByUserId(suspendAccount.id),
                suspendControls = controlRuntime(),
                suspendedConnections = suspendControls && typeof suspendControls.kickByUserId === 'function' ? suspendControls.kickByUserId(suspendAccount.id, suspendReason) : 0;

            await audit(session, 'account.suspend', suspendAccount.username, {
                userId: Number(suspendAccount.id),
                previousStatus: previousStatus,
                reason: suspendReason,
                sessionsRevoked: suspendedSessions,
                connectionsClosed: suspendedConnections
            }, request);
            json(response, 200, {
                ok: true,
                account: {id: Number(suspended.id), username: suspended.username, status: suspended.status},
                sessionsRevoked: suspendedSessions,
                connectionsClosed: suspendedConnections
            });
            return;
        }

        match = pathname.match(/^\/admin\/api\/accounts\/([0-9]+)\/ban$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            if(!playerAuth || typeof playerAuth.destroySessionsByUserId !== 'function') {
                json(response, 503, {error: 'Gerenciamento de sessões de jogadores indisponível.'});
                return;
            }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }

            var banAccountId = Number(match[1]),
                banResult = await services.postgres.query("SELECT id, username, status FROM users WHERE id=$1 AND role='player' LIMIT 1", [banAccountId]);
            if(banResult.rowCount !== 1) {
                json(response, 404, {error: 'Conta de jogador não encontrada.'});
                return;
            }

            var banAccount = banResult.rows[0],
                banReason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'Conta banida pelo administrador.',
                banPreviousStatus = banAccount.status,
                banned = (await services.postgres.query("UPDATE users SET status='banned', updated_at=NOW() WHERE id=$1 AND role='player' RETURNING id, username, status", [banAccount.id])).rows[0],
                bannedSessions = await playerAuth.destroySessionsByUserId(banAccount.id),
                banControls = controlRuntime(),
                bannedConnections = banControls && typeof banControls.kickByUserId === 'function' ? banControls.kickByUserId(banAccount.id, banReason) : 0;

            await audit(session, 'account.ban', banAccount.username, {
                userId: Number(banAccount.id),
                previousStatus: banPreviousStatus,
                reason: banReason,
                sessionsRevoked: bannedSessions,
                connectionsClosed: bannedConnections
            }, request);
            json(response, 200, {
                ok: true,
                account: {id: Number(banned.id), username: banned.username, status: banned.status},
                sessionsRevoked: bannedSessions,
                connectionsClosed: bannedConnections
            });
            return;
        }

        match = pathname.match(/^\/admin\/api\/accounts\/([0-9]+)\/reactivate$/);
        if(match && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }

            var reactivateAccountId = Number(match[1]),
                reactivateResult = await services.postgres.query("SELECT id, username, status FROM users WHERE id=$1 AND role='player' LIMIT 1", [reactivateAccountId]);
            if(reactivateResult.rowCount !== 1) {
                json(response, 404, {error: 'Conta de jogador não encontrada.'});
                return;
            }

            var reactivateAccount = reactivateResult.rows[0],
                reactivateReason = String(body.reason || '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'Conta reativada pelo administrador.',
                reactivatePreviousStatus = reactivateAccount.status,
                reactivated = (await services.postgres.query("UPDATE users SET status='active', updated_at=NOW() WHERE id=$1 AND role='player' RETURNING id, username, status", [reactivateAccount.id])).rows[0];

            await audit(session, 'account.reactivate', reactivateAccount.username, {
                userId: Number(reactivateAccount.id),
                previousStatus: reactivatePreviousStatus,
                reason: reactivateReason
            }, request);
            json(response, 200, {
                ok: true,
                account: {id: Number(reactivated.id), username: reactivated.username, status: reactivated.status}
            });
            return;
        }

        if(pathname === '/admin/api/announcements' && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }

            var announcementMessage = String(body.message || '').trim().replace(/\s+/g, ' ').slice(0, 300);
            if(!announcementMessage) {
                json(response, 400, {error: 'A mensagem do anúncio é obrigatória.'});
                return;
            }
            var announcementControls = controlRuntime();
            if(!announcementControls || typeof announcementControls.broadcastAnnouncement !== 'function') {
                json(response, 503, {error: 'Envio de anúncios indisponível.'});
                return;
            }
            var announcementDelivered = announcementControls.broadcastAnnouncement(announcementMessage);
            await audit(session, 'announcement.broadcast', 'all', {
                message: announcementMessage,
                delivered: announcementDelivered
            }, request);
            json(response, 200, {ok: true, message: announcementMessage, delivered: announcementDelivered});
            return;
        }

        if(pathname === '/admin/api/settings/server' && request.method === 'GET') {
            if(!await requireAdmin(request, response, true)) { return; }
            json(response, 200, getServerCapacitySettings());
            return;
        }

        if(pathname === '/admin/api/settings/server' && request.method === 'POST') {
            session = await requireAdmin(request, response, true);
            if(!session) { return; }
            try { body = await readJson(request); }
            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
            try { json(response, 200, await saveServerCapacitySettings(body, session, request)); }
            catch(error) { json(response, error.statusCode || 500, {error: error.message}); }
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

        if(pathname === '/admin/api/world/preview' && request.method === 'GET') {
            if(!await requireAdmin(request,response,true)) { return; }
            try { json(response,200,world.preview()); }
            catch(error) { json(response,error.statusCode||422,{error:error.message}); }
            return;
        }
        if(pathname === '/admin/api/world/versions' && request.method === 'GET') {
            if(!await requireAdmin(request,response,true)) { return; }
            try { json(response,200,{versions:world.listVersions()}); }
            catch(error) { json(response,500,{error:error.message}); }
            return;
        }
        if(pathname === '/admin/api/world/restore' && request.method === 'POST') {
            if(!await requireAdmin(request,response,true)) { return; }
            try { body=await readJson(request); }
            catch(error) { json(response,400,{error:'JSON inválido.'}); return; }
            if(!body || typeof body.versionId!=='string') { json(response,400,{error:'Selecione uma versão válida.'}); return; }
            try { json(response,200,world.restoreVersion(body.versionId)); }
            catch(error) { json(response,error.statusCode||422,{error:error.message}); }
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
            try {
                var savedStory = stories.save(body);
                reloadStoryRuntime();
                json(response, 200, savedStory);
            }
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
            if(stories.remove(match[1])) {
                reloadStoryRuntime();
                json(response, 200, {ok: true});
            }
            else { json(response, 404, {error: 'História não encontrada.'}); }
            return;
        }

        json(response, 404, {error: 'Rota administrativa não encontrada.'});
    }

    return function adminHandler(request, response) {
        var pathname = String(request.url || '/').split('?')[0];
        if(pathname !== '/admin' && pathname.indexOf('/admin/') !== 0 &&
           pathname !== '/game/sprites/catalog.js' && !/^\/game\/sprites\/[a-f0-9]{32}\.png$/.test(pathname)) { return false; }
        handle(request, response, pathname).catch(function(error) {
            console.error('[BrowserQuest] Admin HTTP:', error && error.stack ? error.stack : error);
            if(!response.headersSent) { json(response, 500, {error: 'Falha interna no painel administrativo.'}); }
            else { response.end(); }
        });
        return true;
    };
}

exports.createAdminHandler = createAdminHandler;
