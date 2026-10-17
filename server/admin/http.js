'use strict';

var fs = require('fs'),
    path = require('path'),
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
        out[key] = decodeURIComponent(value);
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

function readJson(request, callback) {
    var chunks = [], size = 0, finished = false;
    request.on('data', function(chunk) {
        if(finished) { return; }
        size += chunk.length;
        if(size > 4 * 1024 * 1024) {
            finished = true;
            callback(new Error('Payload too large'));
            request.destroy();
            return;
        }
        chunks.push(chunk);
    });
    request.on('end', function() {
        if(finished) { return; }
        finished = true;
        try {
            callback(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch(error) {
            callback(error);
        }
    });
}

function safeRead(filepath) {
    try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
    catch(error) { return null; }
}

function createAdminHandler(options) {
    options = options || {};

    var configDir = options.configDir,
        publicDir = path.join(__dirname, 'public'),
        adminPath = path.join(configDir, 'admin.json'),
        storiesPath = path.join(configDir, 'stories.json'),
        sessions = Auth.createSessionManager({ttl: 8 * 60 * 60 * 1000}),
        stories = new StoryStore(storiesPath),
        world = new WorldStore({
            baseMapPath: path.join(__dirname, '..', 'maps', 'world_server.json'),
            statePath: path.join(configDir, 'world-editor.json'),
            publishedMapPath: path.join(configDir, 'world_server_published.json'),
            versionsDir: path.join(configDir, 'world-versions')
        }),
        attempts = new Map();

    function currentAdmin(request) {
        var cookies = parseCookies(request.headers.cookie),
            session = sessions.get(cookies.bq_admin_session);
        return session || null;
    }

    function requireAdmin(request, response, apiMode) {
        var session = currentAdmin(request);
        if(session) { return session; }
        if(apiMode) { json(response, 401, {error: 'Sessão administrativa expirada.'}); }
        else { redirect(response, '/admin/login'); }
        return null;
    }

    function requestIp(request) {
        return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
    }

    function canTryLogin(ip) {
        var now = Date.now(), state = attempts.get(ip);
        if(!state || state.resetAt <= now) {
            attempts.set(ip, {count: 0, resetAt: now + 10 * 60 * 1000});
            state = attempts.get(ip);
        }
        return state.count < 8;
    }

    function failLogin(ip) {
        var state = attempts.get(ip);
        if(!state) {
            state = {count: 0, resetAt: Date.now() + 10 * 60 * 1000};
            attempts.set(ip, state);
        }
        state.count += 1;
    }

    function serveFile(response, filename) {
        fs.readFile(path.join(publicDir, filename), 'utf8', function(error, content) {
            if(error) { send(response, 500, 'Admin page unavailable.'); return; }
            send(response, 200, content, 'text/html; charset=utf-8');
        });
    }

    function withAdmin(request, response, callback) {
        if(!requireAdmin(request, response, true)) { return true; }
        try { callback(); }
        catch(error) { json(response, 500, {error: error.message}); }
        return true;
    }

    return function adminHandler(request, response) {
        var pathname = String(request.url || '/').split('?')[0], match;

        if(pathname === '/admin') {
            if(!requireAdmin(request, response, false)) { return true; }
            redirect(response, '/admin/story-editor');
            return true;
        }

        if(pathname === '/admin/login' && request.method === 'GET') {
            if(currentAdmin(request)) { redirect(response, '/admin/story-editor'); }
            else { serveFile(response, 'login.html'); }
            return true;
        }

        if(pathname === '/admin/story-editor' && request.method === 'GET') {
            if(!requireAdmin(request, response, false)) { return true; }
            serveFile(response, 'story-editor.html');
            return true;
        }

        if(pathname === '/admin/world-editor' && request.method === 'GET') {
            if(!requireAdmin(request, response, false)) { return true; }
            serveFile(response, 'world-editor.html');
            return true;
        }

        if(pathname === '/admin/api/login' && request.method === 'POST') {
            var ip = requestIp(request);
            if(!canTryLogin(ip)) {
                json(response, 429, {error: 'Muitas tentativas. Tente novamente mais tarde.'});
                return true;
            }
            readJson(request, function(error, body) {
                var admin = safeRead(adminPath), secure, token;
                if(error || !admin || String(body.username || '') !== String(admin.username || '') || !Auth.verifyPassword(body.password, admin.passwordHash)) {
                    failLogin(ip);
                    json(response, 401, {error: 'Usuário ou senha inválidos.'});
                    return;
                }
                attempts.delete(ip);
                token = sessions.create(admin.username);
                secure = request.headers['x-forwarded-proto'] === 'https' || request.socket.encrypted;
                json(response, 200, {ok: true, username: admin.username}, {
                    'Set-Cookie': 'bq_admin_session=' + encodeURIComponent(token) + '; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=28800' + (secure ? '; Secure' : '')
                });
            });
            return true;
        }

        if(pathname === '/admin/api/logout' && request.method === 'POST') {
            var cookies = parseCookies(request.headers.cookie);
            sessions.destroy(cookies.bq_admin_session);
            json(response, 200, {ok: true}, {
                'Set-Cookie': 'bq_admin_session=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0'
            });
            return true;
        }

        if(pathname === '/admin/api/world' && request.method === 'GET') {
            return withAdmin(request, response, function() { json(response, 200, world.load()); });
        }
        if(pathname === '/admin/api/world' && request.method === 'POST') {
            if(!requireAdmin(request, response, true)) { return true; }
            readJson(request, function(error, body) {
                if(error) { json(response, 400, {error: 'JSON inválido ou grande demais.'}); return; }
                try { json(response, 200, world.save(body)); }
                catch(saveError) { json(response, 400, {error: saveError.message}); }
            });
            return true;
        }
        if(pathname === '/admin/api/world/publish' && request.method === 'POST') {
            return withAdmin(request, response, function() { json(response, 200, world.publish()); });
        }
        if(pathname === '/admin/api/world/reset' && request.method === 'POST') {
            return withAdmin(request, response, function() { json(response, 200, world.reset()); });
        }

        if(pathname === '/admin/api/stories' && request.method === 'GET') {
            if(!requireAdmin(request, response, true)) { return true; }
            try { json(response, 200, stories.list()); }
            catch(error) { json(response, 500, {error: error.message}); }
            return true;
        }

        if(pathname === '/admin/api/stories' && request.method === 'POST') {
            if(!requireAdmin(request, response, true)) { return true; }
            readJson(request, function(error, body) {
                if(error) { json(response, 400, {error: 'JSON inválido.'}); return; }
                try { json(response, 200, stories.save(body)); }
                catch(saveError) { json(response, 400, {error: saveError.message}); }
            });
            return true;
        }

        match = pathname.match(/^\/admin\/api\/stories\/([a-zA-Z0-9_-]+)$/);
        if(match && request.method === 'GET') {
            if(!requireAdmin(request, response, true)) { return true; }
            var story = stories.get(match[1]);
            if(!story) { json(response, 404, {error: 'História não encontrada.'}); }
            else { json(response, 200, story); }
            return true;
        }

        if(match && request.method === 'DELETE') {
            if(!requireAdmin(request, response, true)) { return true; }
            if(stories.remove(match[1])) { json(response, 200, {ok: true}); }
            else { json(response, 404, {error: 'História não encontrada.'}); }
            return true;
        }

        if(pathname.indexOf('/admin/') === 0) {
            json(response, 404, {error: 'Rota administrativa não encontrada.'});
            return true;
        }
        return false;
    };
}

exports.createAdminHandler = createAdminHandler;
