'use strict';

var PlayerAuthModule = require('./player-auth'),
    AccountProgress = require('../persistence/account-progress').AccountProgress;

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

function originAllowed(request) {
    var origin = request.headers.origin,
        host = request.headers.host;
    if(!origin || !host) { return true; }
    try { return new URL(origin).host === host; }
    catch(error) { return false; }
}

function sessionCookie(token, maxAge, secure) {
    return PlayerAuthModule.SESSION_COOKIE + '=' + encodeURIComponent(token || '') + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + String(maxAge || 0) + (secure ? '; Secure' : '');
}

async function publicSession(session, policy, progress, initializeProgress) {
    var achievements = null;
    if(session && session.character && progress) {
        achievements = initializeProgress ?
            await progress.ensureAchievements(session.character.id) :
            await progress.getAchievements(session.character.id);
    }
    return {
        loggedIn: Boolean(session),
        accessMode: policy.accessMode,
        registrationEnabled: policy.registrationEnabled,
        user: session ? session.user : null,
        character: session ? session.character : null,
        progress: session ? {achievements: achievements} : null
    };
}

function accountsDisabledError(response) {
    sendJson(response, 403, {
        error: 'O administrador configurou este servidor para acesso somente por nome.',
        code: 'ACCOUNTS_DISABLED'
    });
}

function createPlayerAuthHandler(options) {
    options = options || {};
    var auth = options.auth,
        progress;
    if(!auth) { throw new Error('Player auth HTTP requer PlayerAuth.'); }
    progress = options.progress || new AccountProgress({postgres: auth.services.postgres});

    async function requireAccountSession(request) {
        var policy = await auth.getPolicy(), session;
        if(!policy.accountsEnabled) {
            throw PlayerAuthModule.authError ? PlayerAuthModule.authError('Contas estão desativadas.', 403, 'ACCOUNTS_DISABLED') : Object.assign(new Error('Contas estão desativadas.'), {statusCode: 403, code: 'ACCOUNTS_DISABLED'});
        }
        session = await auth.getSessionFromCookieHeader(request.headers.cookie, true);
        if(!session || !session.character) {
            var error = new Error('Faça login para sincronizar o progresso.');
            error.statusCode = 401;
            error.code = 'ACCOUNT_REQUIRED';
            throw error;
        }
        return {policy: policy, session: session};
    }

    async function handle(request, response, pathname) {
        var body, policy, session, rate, result, state, achievements;
        try {
            if(request.method !== 'GET' && request.method !== 'HEAD' && !originAllowed(request)) {
                sendJson(response, 403, {error: 'Origem da requisição não permitida.', code: 'ORIGIN_NOT_ALLOWED'});
                return;
            }

            if(request.method === 'GET' && pathname === '/api/auth/policy') {
                policy = await auth.getPolicy();
                sendJson(response, 200, policy);
                return;
            }

            if(request.method === 'GET' && pathname === '/api/auth/session') {
                policy = await auth.getPolicy();
                // In name_only mode accounts are deliberately invisible to the client.
                // Keep the Redis token intact so it can work again if accounts are re-enabled.
                session = policy.accountsEnabled ? await auth.getSessionFromCookieHeader(request.headers.cookie, true) : null;
                sendJson(response, 200, await publicSession(session, policy, progress, false));
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
                // New accounts start clean and immediately gain a server-side progress record.
                sendJson(response, 201, await publicSession(result, policy, progress, true), {
                    'Set-Cookie': sessionCookie(result.token, result.expiresIn, secureRequest(request))
                });
                return;
            }

            if(request.method === 'POST' && pathname === '/api/auth/login') {
                policy = await auth.getPolicy();
                if(!policy.accountsEnabled) {
                    accountsDisabledError(response);
                    return;
                }
                rate = await auth.consumeRateLimit('login', requestIp(request), 8, 10 * 60);
                if(!rate.allowed) {
                    sendJson(response, 429, {error: 'Muitas tentativas de login. Tente novamente mais tarde.', retryAfter: rate.retryAfter});
                    return;
                }
                body = await readJson(request);
                result = await auth.login(body);
                sendJson(response, 200, await publicSession(result, policy, progress, false), {
                    'Set-Cookie': sessionCookie(result.token, result.expiresIn, secureRequest(request))
                });
                return;
            }

            if(request.method === 'POST' && pathname === '/api/auth/progress/achievements') {
                state = await requireAccountSession(request);
                rate = await auth.consumeRateLimit('achievement-sync', String(state.session.user.id), 120, 60);
                if(!rate.allowed) {
                    sendJson(response, 429, {error: 'Muitas atualizações de progresso. Tente novamente em instantes.', retryAfter: rate.retryAfter});
                    return;
                }
                body = await readJson(request);
                achievements = await progress.mergeAchievements(state.session.character.id, body.achievements || body);
                sendJson(response, 200, {achievements: achievements});
                return;
            }

            if(request.method === 'GET' && pathname === '/api/auth/progress/achievements') {
                state = await requireAccountSession(request);
                achievements = await progress.getAchievements(state.session.character.id);
                sendJson(response, 200, {achievements: achievements});
                return;
            }

            if(request.method === 'POST' && pathname === '/api/auth/logout') {
                await auth.destroySessionFromCookieHeader(request.headers.cookie);
                policy = await auth.getPolicy();
                sendJson(response, 200, await publicSession(null, policy, progress, false), {
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
        handle(request, response, pathname).catch(function(error) {
            console.error('[BrowserQuest] Player auth HTTP:', error && error.stack ? error.stack : error);
            if(!response.headersSent) {
                sendJson(response, 500, {error: 'Falha interna na autenticação.'});
            } else {
                response.end();
            }
        });
        return true;
    };
}

exports.createPlayerAuthHandler = createPlayerAuthHandler;
