'use strict';

process.umask(0o077);

var http = require('http'),
    fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    gameMain = require('./server/js/main');

var root = __dirname,
    configDir = process.env.BROWSERQUEST_CONFIG_DIR || path.join(root, 'var', 'config'),
    installedConfigPath = path.join(configDir, 'browserquest.json'),
    setupTokenPath = path.join(configDir, 'setup-token.txt'),
    defaultConfigPath = path.join(root, 'server', 'config.json'),
    host = process.env.HOST || '127.0.0.1',
    port = parseInt(process.env.PORT || '8000', 10);

function ensureConfigDir() {
    fs.mkdirSync(configDir, {recursive: true, mode: 0o700});
}

function readJson(filepath) {
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch(error) {
        return null;
    }
}

function writePrivateJson(filepath, value) {
    fs.writeFileSync(filepath, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
    fs.chmodSync(filepath, 0o600);
}

function getSetupToken() {
    var current;

    ensureConfigDir();
    try {
        current = fs.readFileSync(setupTokenPath, 'utf8').trim();
    } catch(error) {
        current = '';
    }

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
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(JSON.stringify(payload));
}

function redirect(response, location) {
    response.writeHead(302, {
        'Location': location,
        'Cache-Control': 'no-store'
    });
    response.end();
}

function readRequestJson(request, callback) {
    var chunks = [],
        size = 0;

    request.on('data', function(chunk) {
        size += chunk.length;
        if(size > 64 * 1024) {
            request.destroy();
            return;
        }
        chunks.push(chunk);
    });

    request.on('end', function() {
        try {
            callback(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch(error) {
            callback(error);
        }
    });
}

function setupPage() {
    return '<!doctype html>' +
        '<html lang="pt-BR"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>BrowserQuest Revived - Instalação</title>' +
        '<style>' +
        '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#efe3c2;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#332819;padding:24px}' +
        '.card{width:min(680px,100%);background:#fffaf0;border:4px solid #49351e;box-shadow:0 12px 0 #c8ab72;padding:28px;border-radius:12px}' +
        'h1{margin:0 0 6px;font-size:30px}.sub{margin:0 0 24px;color:#6e5a3c}.badge{display:inline-block;background:#49351e;color:#fff7df;padding:5px 9px;border-radius:6px;font-size:12px;font-weight:800;letter-spacing:.06em}' +
        '.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field{margin-top:16px}.field.full{grid-column:1/-1}label{display:block;font-weight:800;margin-bottom:7px}' +
        'input,select{width:100%;border:2px solid #bda77b;background:#fff;padding:13px;border-radius:8px;font:inherit;outline:none}input:focus,select:focus{border-color:#6b4e2d}' +
        'button{margin-top:22px;width:100%;border:0;border-radius:8px;background:#704a24;color:white;padding:14px 18px;font-weight:900;font-size:16px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}' +
        '.note{margin-top:18px;padding:12px 14px;background:#f5e8c8;border-radius:8px;font-size:13px}.result{margin-top:16px;min-height:24px;font-weight:700}.ok{color:#20743a}.err{color:#aa2c22}' +
        '@media(max-width:560px){.grid{grid-template-columns:1fr}.field.full{grid-column:auto}.card{padding:20px}h1{font-size:25px}}' +
        '</style></head><body><main class="card">' +
        '<span class="badge">PRIMEIRA INSTALAÇÃO</span><h1>BrowserQuest Revived</h1>' +
        '<p class="sub">Configuração rápida para aaPanel. Nada de Docker, banco de dados ou Redis.</p>' +
        '<form id="setup"><div class="grid">' +
        '<div class="field full"><label for="code">Código de instalação</label><input id="code" name="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="Veja em Projeto Node.js → Logs" required></div>' +
        '<div class="field"><label for="worlds">Mundos</label><input id="worlds" name="worlds" type="number" min="1" max="20" value="5" required></div>' +
        '<div class="field"><label for="players">Jogadores por mundo</label><input id="players" name="players" type="number" min="1" max="1000" value="200" required></div>' +
        '</div><button id="install" type="submit">Instalar e iniciar o jogo</button></form>' +
        '<div class="note">O código aparece nos logs como <strong>CÓDIGO DE INSTALAÇÃO: 123456</strong>. Depois da instalação ele é apagado.</div>' +
        '<div id="result" class="result" role="status"></div></main>' +
        '<script>' +
        'const form=document.getElementById("setup"),btn=document.getElementById("install"),out=document.getElementById("result");' +
        'form.addEventListener("submit",async(e)=>{e.preventDefault();btn.disabled=true;out.className="result";out.textContent="Configurando...";' +
        'try{const r=await fetch("/setup/install",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({code:document.getElementById("code").value,worlds:Number(document.getElementById("worlds").value),players:Number(document.getElementById("players").value)})});' +
        'const d=await r.json();if(!r.ok)throw new Error(d.error||"Falha na instalação");out.className="result ok";out.textContent="Instalação concluída. Abrindo o jogo...";setTimeout(()=>location.href="/",1800)}' +
        'catch(err){out.className="result err";out.textContent=err.message;btn.disabled=false}});' +
        '</script></body></html>';
}

function startGame(config) {
    config = Object.assign({}, config, {
        port: port,
        host: host,
        serve_client: true
    });

    console.log('[BrowserQuest] Instalação encontrada. Iniciando jogo...');
    gameMain.start(config);
}

function startInstaller() {
    var token = getSetupToken(),
        server;

    console.log('');
    console.log('============================================================');
    console.log(' BROWSERQUEST REVIVED - PRIMEIRA INSTALAÇÃO');
    console.log(' CÓDIGO DE INSTALAÇÃO: ' + token);
    console.log(' Abra /setup no domínio configurado no aaPanel.');
    console.log('============================================================');
    console.log('');

    server = http.createServer(function(request, response) {
        var pathname = (request.url || '/').split('?')[0];

        if(request.method === 'GET' && (pathname === '/' || pathname === '/setup')) {
            response.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            });
            response.end(setupPage());
            return;
        }

        if(request.method === 'GET' && pathname === '/health') {
            sendJson(response, 200, {status: 'setup', installed: false});
            return;
        }

        if(request.method === 'GET' && pathname === '/setup/status') {
            sendJson(response, 200, {installed: false});
            return;
        }

        if(request.method === 'POST' && pathname === '/setup/install') {
            readRequestJson(request, function(error, body) {
                var defaults,
                    worlds,
                    players,
                    config;

                if(error) {
                    sendJson(response, 400, {error: 'JSON inválido.'});
                    return;
                }

                if(String(body.code || '') !== token) {
                    sendJson(response, 403, {error: 'Código de instalação incorreto.'});
                    return;
                }

                worlds = Number(body.worlds);
                players = Number(body.players);
                if(!Number.isInteger(worlds) || worlds < 1 || worlds > 20) {
                    sendJson(response, 400, {error: 'Mundos deve ficar entre 1 e 20.'});
                    return;
                }
                if(!Number.isInteger(players) || players < 1 || players > 1000) {
                    sendJson(response, 400, {error: 'Jogadores por mundo deve ficar entre 1 e 1000.'});
                    return;
                }

                defaults = readJson(defaultConfigPath);
                if(!defaults) {
                    sendJson(response, 500, {error: 'Configuração padrão do jogo não foi encontrada.'});
                    return;
                }

                config = Object.assign({}, defaults, {
                    port: port,
                    host: host,
                    nb_worlds: worlds,
                    nb_players_per_world: players,
                    metrics_enabled: false,
                    serve_client: true
                });

                ensureConfigDir();
                writePrivateJson(installedConfigPath, config);
                try {
                    fs.unlinkSync(setupTokenPath);
                } catch(unlinkError) {
                    // Token may already be absent; installation is still valid.
                }

                sendJson(response, 200, {ok: true});
                setTimeout(function() {
                    server.close(function() {
                        startGame(config);
                    });
                }, 250);
            });
            return;
        }

        redirect(response, '/setup');
    });

    server.listen(port, host, function() {
        console.log('[BrowserQuest] Instalador ativo em http://' + host + ':' + port + '/setup');
    });
}

ensureConfigDir();

var installedConfig = readJson(installedConfigPath);
if(installedConfig) {
    try {
        fs.unlinkSync(setupTokenPath);
    } catch(error) {
        // Nothing to clean up.
    }
    startGame(installedConfig);
} else {
    startInstaller();
}
