'use strict';

var PlayerAuthModule = require('./player-auth');

function sendJson(response, statusCode, payload, extraHeaders) {
    var headers = Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    }, extraHeaders || {});
    response.writeHead(statusCode, headers);
    response.end(JSON.stringify(payload));
}

function readJson(request) {
    return new Promise(function(resolve, reject) {
        var chunks = [], size = 0, finished = false;
        request.on('data', function(chunk) {
            if(finished) { return; }
            size += chunk.length;
            if(size > 32 * 1024) {
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

function requestIp(request) {
    return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim();
}

function secureRequest(request) {
    return request.headers['x-forwarded-proto'] === 'https' || Boolean(request.socket.encrypted);
}

function sessionCookie(token, maxAge, secure) {
    return PlayerAuthModule.SESSION_COOKIE + '=' + encodeURIComponent(token || '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + String(maxAge || 0) + (secure ? '; Secure' : '');
}

function publicSession(session, policy) {
    return {
        loggedIn: Boolean(session),
        accessMode: policy.accessMode,
        registrationEnabled: policy.registrationEnabled,
        user: session ? session.user : null,
        character: session ? session.character : null
    };
}

function createPlayerAuthHandler(options) {
    options = options || {};
    var auth = options.auth;
    if(!auth) { throw new Error('Player auth HTTP requer PlayerAuth.'); }

    async function handle(request, response, pathname) {
        var body, policy, session, rate, result;
        try {
            if(request.method === 'GET' && pathname === '/api/auth/policy') {
                policy = await auth.getPolicy();
                sendJson(response, 200, policy);
                return;
            }

            if(request.method === 'GET' && pathname === '/api/auth/session') {
                policy = await auth.getPolicy();
                session = await auth.getSessionFromCookieHeader(request.headers.cookie, true);
                sendJson(response, 200, publicSession(session, policy));
                return;
            }

            if(request.method === 'POST' && pathname === '/api/auth/register') {
                rate = await auth.consumeRateLimit('register', requestIp(request), 5, 10 * 60);
                if(!rate.allowed) {
                    sendJson(response, 429, {error: 'Muitas tentativas de cadastro. Tente novamente mais tarde.', retryAfter: rate.retryAfter});
                    return;
                }
                body = await readJson(request);
                result = await auth.register(body);
                policy = await auth.getPolicy();
                sendJson(response, 201, publicSession(result, policy), {
                    'Set-Cookie': sessionCookie(result.token, result.expiresIn, secureRequest(request))
                });
                return;
            }

            if(request.method === 'POST' && pathname === '/api/auth/login') {
                rate = await auth.consumeRateLimit('login', requestIp(request), 8, 10 * 60);
                if(!rate.allowed) {
                    sendJson(response, 429, {error: 'Muitas tentativas de login. Tente novamente mais tarde.', retryAfter: rate.retryAfter});
                    return;
                }
                body = await readJson(request);
                result = await auth.login(body);
                policy = await auth.getPolicy();
                sendJson(response, 200, publicSession(result, policy), {
                    'Set-Cookie': sessionCookie(result.token, result.expiresIn, secureRequest(request))
                });
                return;
            }

            if(request.method === 'POST' && pathname === '/api/auth/logout') {
                await auth.destroySessionFromCookieHeader(request.headers.cookie);
                policy = await auth.getPolicy();
                sendJson(response, 200, publicSession(null, policy), {
                    'Set-Cookie': sessionCookie('', 0, secureRequest(request))
                });
                return;
            }

            sendJson(response, 404, {error: 'Rota de autenticação não encontrada.'});
        } catch(error) {
            sendJson(response, error.statusCode || 400, {
                error: error.message || 'Falha na autenticação.',
                code: error.code || undefined
            });
        }
    }

    return function playerAuthHandler(request, response) {
        var pathname = String(request.url || '/').split('?')[0];
        if(pathname.indexOf('/api/auth/') !== 0) { return false; }
        handle(request, response, pathname);
        return true;
    };
}

exports.createPlayerAuthHandler = createPlayerAuthHandler;
