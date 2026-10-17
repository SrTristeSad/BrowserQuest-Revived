'use strict';

var http = require('http'),
    fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    gameMain = require('./js/main'),
    AdminAuth = require('./admin/auth'),
    AdminHttp = require('./admin/http'),
    PlayerAuthModule = require('./auth/player-auth'),
    PlayerAuthHttp = require('./auth/http'),
    SetupPage = require('./setup/page'),
    SetupInfrastructure = require('./setup/infrastructure-setup'),
    Infrastructure = require('./storage/infrastructure'),
    Migrations = require('./storage/migrations'),
    CharacterStore = require('./persistence/character-store').CharacterStore,
    GracefulShutdown = require('./lifecycle/graceful-shutdown');

var root = path.join(__dirname, '..'),
    configDir = process.env.BROWSERQUEST_CONFIG_DIR || path.join(root, 'var', 'config'),
    installedConfigPath = path.join(configDir, 'browserquest.json'),
    adminConfigPath = path.join(configDir, 'admin.json'),
    setupTokenPath = path.join(configDir, 'setup-token.txt'),
    defaultConfigPath = path.join(root, 'server', 'config.json'),
    host = process.env.HOST || '127.0.0.1',
    port = parseInt(process.env.PORT || '8000', 10),
    setupAttempts = new Map();

function ensureConfigDir() {
    fs.mkdirSync(configDir, {recursive: true, mode: 0o700});
}

function readJson(filepath) {
    try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
    catch(error) { return null; }
}

function writePrivateJson(filepath, value) {
    var temporary = filepath + '.tmp-' + process.pid;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, filepath);
}

function getSetupToken() {
    var current;
    ensureConfigDir();
    try { current = fs.readFileSync(setupTokenPath, 'utf8').trim(); }
    catch(error) { current = ''; }
    if(!/^\d{6}$/.test(current)) {
        current = String(crypto.randomInt(100000, 1000000));
        fs.writeFileSync(setupTokenPath, current + '\n', {mode: 0o600});
    }
    return current;
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
    });
    response.end(JSON.stringify(payload));
}

function redirect(response, location) {
    response.writeHead(302, {'Location': location, 'Cache-Control': 'no-store'});
    response.end();
}

function readRequestJson(request) {
    return new Promise(function(resolve, reject) {
        var chunks = [], size = 0, finished = false;
        request.on('data', function(chunk) {
            if(finished) { return; }
            size += chunk.length;
            if(size > 64 * 1024) {
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

function setupCodeAllowed(ip) {
    var now = Date.now(), state = setupAttempts.get(ip);
    if(!state || state.resetAt <= now) {
        state = {count: 0, resetAt: now + 15 * 60 * 1000};
        setupAttempts.set(ip, state);
    }
    return state.count < 10;
}

function validateSetupCode(request, body, token) {
    var ip = requestIp(request), state;
    if(!setupCodeAllowed(ip)) {
        var limited = new Error('Muitas tentativas de código. Tente novamente mais tarde.');
        limited.statusCode = 429;
        throw limited;
    }
    if(String(body.code || '') !== token) {
        state = setupAttempts.get(ip);
        state.count += 1;
        var invalid = new Error('Código de instalação incorreto.');
        invalid.statusCode = 403;
        throw invalid;
    }
    setupAttempts.delete(ip);
}

function validateInstall(body) {
    var worlds = Number(body.worlds), players = Number(body.players),
        adminUsername = String(body.adminUsername || '').trim(),
        adminPassword = String(body.adminPassword || ''),
        accessMode = String(body.accessMode || 'mixed');

    if(!Number.isInteger(worlds) || worlds < 1 || worlds > 20) { throw new Error('Mundos deve ficar entre 1 e 20.'); }
    if(!Number.isInteger(players) || players < 1 || players > 1000) { throw new Error('Jogadores por mundo deve ficar entre 1 e 1000.'); }
    if(['name_only', 'account_only', 'mixed'].indexOf(accessMode) === -1) { throw new Error('Política de acesso inválida.'); }
    if(!/^[A-Za-z0-9_-]{3,32}$/.test(adminUsername)) { throw new Error('Usuário administrativo inválido.'); }
    if(adminPassword.length < 10 || adminPassword.length > 128) { throw new Error('A senha administrativa precisa ter entre 10 e 128 caracteres.'); }
    if(adminPassword !== String(body.adminPasswordConfirm || '')) { throw new Error('As senhas administrativas não conferem.'); }

    return {worlds: worlds, players: players, adminUsername: adminUsername, adminPassword: adminPassword, accessMode: accessMode};
}

async function startGame(config) {
    var services = null,
        playerAuth = null,
        playerAuthHandler = null,
        characterStore = null,
        adminRuntime = {startedAt: Date.now(), server: null, config: null},
        adminHandler,
        combinedHttpHandler;

    if(config.infrastructure && config.infrastructure.postgres && config.infrastructure.redis) {
        // Upgrades run pending migrations automatically before the game accepts players.
        await Migrations.runMigrations(config.infrastructure.postgres);
        services = Infrastructure.createServices(config.infrastructure);
        await services.connect();
        playerAuth = new PlayerAuthModule.PlayerAuth({services: services, accessMode: config.access_mode || 'mixed'});
        characterStore = new CharacterStore({postgres: services.postgres});
        playerAuthHandler = PlayerAuthHttp.createPlayerAuthHandler({auth: playerAuth});
        console.log('[BrowserQuest] PostgreSQL conectado.');
        console.log('[BrowserQuest] Redis conectado.');
    } else {
        console.warn('[BrowserQuest] Instalação legada sem PostgreSQL/Redis. O jogo continuará iniciando até a migração ser concluída.');
    }

    adminHandler = AdminHttp.createAdminHandler({configDir: configDir, infrastructure: services, runtime: adminRuntime, playerAuth: playerAuth});
    combinedHttpHandler = function(request, response) {
        if(playerAuthHandler && playerAuthHandler(request, response)) { return true; }
        return adminHandler(request, response);
    };

    config = Object.assign({}, config, {
        port: port,
        host: host,
        serve_client: true,
        http_handler: combinedHttpHandler,
        player_authenticator: playerAuth ? function(connection) {
            if(!connection.headers && connection._request) {
                connection.headers = connection._request.headers || {};
            }
            return playerAuth.authorizeConnection(connection);
        } : null,
        player_auth_service: playerAuth,
        player_persistence: characterStore,
        // When PostgreSQL persistence is active the bootstrap owns SIGTERM/SIGINT
        // so pending state can be flushed before the aaPanel process exits.
        manage_process_signals: services ? false : true
    });

    adminRuntime.config = config;

    console.log('[BrowserQuest] Instalação encontrada. Iniciando jogo...');
    console.log('[BrowserQuest] Painel administrativo: /admin');
    if(playerAuth) {
        console.log('[BrowserQuest] Autenticação de jogadores: ' + (config.access_mode || 'mixed'));
    }
    adminRuntime.server = gameMain.start(config);

    if(services) {
        GracefulShutdown.install({
            characterStore: characterStore,
            services: services,
            logger: console,
            timeoutMs: 5000
        });
    }
}

function startInstaller() {
    var token = getSetupToken(), server;

    console.log('');
    console.log('============================================================');
    console.log(' BROWSERQUEST REVIVED - PRIMEIRA INSTALAÇÃO');
    console.log(' CÓDIGO DE INSTALAÇÃO: ' + token);
    console.log(' Abra /setup no domínio configurado no aaPanel.');
    console.log(' PostgreSQL e Redis serão testados antes da instalação.');
    console.log('============================================================');
    console.log('');

    server = http.createServer(async function(request, response) {
        var pathname = (request.url || '/').split('?')[0], body;
        try {
            if(request.method === 'GET' && (pathname === '/' || pathname === '/setup')) {
                response.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'X-Frame-Options': 'DENY'
                });
                response.end(SetupPage.render());
                return;
            }

            if(request.method === 'GET' && pathname === '/health') {
                sendJson(response, 200, {status: 'setup', installed: false, requires: ['postgresql', 'redis']});
                return;
            }

            if(request.method === 'GET' && pathname === '/setup/status') {
                sendJson(response, 200, {installed: false, database: 'postgresql', cache: 'redis'});
                return;
            }

            if(request.method === 'POST' && pathname === '/setup/test-postgres') {
                body = await readRequestJson(request);
                validateSetupCode(request, body, token);
                sendJson(response, 200, await SetupInfrastructure.testPostgresFromBody(body));
                return;
            }

            if(request.method === 'POST' && pathname === '/setup/test-redis') {
                body = await readRequestJson(request);
                validateSetupCode(request, body, token);
                sendJson(response, 200, await SetupInfrastructure.testRedisFromBody(body));
                return;
            }

            if(request.method === 'POST' && pathname === '/setup/install') {
                body = await readRequestJson(request);
                validateSetupCode(request, body, token);
                var validated = validateInstall(body), defaults = readJson(defaultConfigPath), passwordHash, initialized, config;
                if(!defaults) { throw new Error('Configuração padrão do jogo não foi encontrada.'); }

                passwordHash = AdminAuth.hashPassword(validated.adminPassword);
                initialized = await SetupInfrastructure.initialize(body, {
                    username: validated.adminUsername,
                    passwordHash: passwordHash,
                    accessMode: validated.accessMode
                });

                config = Object.assign({}, defaults, {
                    port: port,
                    host: host,
                    nb_worlds: validated.worlds,
                    nb_players_per_world: validated.players,
                    metrics_enabled: false,
                    serve_client: true,
                    access_mode: validated.accessMode,
                    infrastructure: initialized.infrastructure
                });

                ensureConfigDir();
                writePrivateJson(installedConfigPath, config);
                writePrivateJson(adminConfigPath, {
                    username: validated.adminUsername,
                    passwordHash: passwordHash,
                    role: 'owner',
                    storage: 'postgresql',
                    createdAt: new Date().toISOString()
                });

                try { fs.unlinkSync(setupTokenPath); } catch(ignoreUnlink) {}
                sendJson(response, 200, {ok: true, adminPath: '/admin', accessMode: validated.accessMode});
                setTimeout(function() {
                    server.close(function() {
                        startGame(config).catch(function(error) {
                            console.error('[BrowserQuest] Falha ao iniciar após instalação:', error);
                            process.exitCode = 1;
                        });
                    });
                }, 250);
                return;
            }

            redirect(response, '/setup');
        } catch(error) {
            console.error('[BrowserQuest] Setup:', error.message);
            sendJson(response, error.statusCode || 400, {error: error.message || 'Falha na configuração.'});
        }
    });

    server.listen(port, host, function() {
        console.log('[BrowserQuest] Instalador ativo em http://' + host + ':' + port + '/setup');
    });
}

async function start() {
    ensureConfigDir();
    var installedConfig = readJson(installedConfigPath), adminConfig = readJson(adminConfigPath);
    if(installedConfig && adminConfig) {
        try { fs.unlinkSync(setupTokenPath); } catch(ignore) {}
        await startGame(installedConfig);
    } else {
        startInstaller();
    }
}

exports.start = start;
