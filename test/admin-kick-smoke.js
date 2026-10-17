'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http');

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-kick-')),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        auditRows = [],
        kickCalls = [],
        connected = true,
        services = {
            redis: null,
            postgres: {
                query: async function(sql, params) {
                    if(String(sql).indexOf('SELECT id, username, display_name, password_hash') === 0) {
                        return {rowCount: 1, rows: [{
                            id: 1,
                            username: 'owner',
                            display_name: 'Owner',
                            password_hash: passwordHash,
                            role: 'owner',
                            status: 'active'
                        }]};
                    }
                    if(String(sql).indexOf('INSERT INTO admin_audit_log') === 0) {
                        auditRows.push({sql: sql, params: params});
                        return {rowCount: 1, rows: []};
                    }
                    throw new Error('Unexpected SQL in admin kick smoke test: ' + sql);
                }
            }
        },
        runtime = {
            server: {
                adminRuntime: {
                    kickPlayer: function(playerId, reason) {
                        kickCalls.push({playerId: playerId, reason: reason});
                        if(!connected || String(playerId) !== '77') { return null; }
                        connected = false;
                        return {
                            id: '77',
                            name: 'HeroTest',
                            world: 'world1',
                            userId: 33,
                            username: 'hero_account',
                            characterId: 44
                        };
                    }
                }
            }
        },
        handler = AdminHttp.createAdminHandler({configDir: dir, infrastructure: services, runtime: runtime}),
        server = http.createServer(function(request, response) {
            if(!handler(request, response)) {
                response.writeHead(404);
                response.end('not found');
            }
        });

    await new Promise(function(resolve) { server.listen(0, '127.0.0.1', resolve); });
    var base = 'http://127.0.0.1:' + server.address().port;

    async function request(url, options) {
        var response = await fetch(base + url, options || {}), text = await response.text(), data = {};
        try { data = JSON.parse(text || '{}'); } catch(ignore) {}
        return {response: response, data: data};
    }

    try {
        var unauthorized = await request('/admin/api/players/77/kick', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({reason: 'Teste'})
        });
        assert.strictEqual(unauthorized.response.status, 401);
        assert.strictEqual(kickCalls.length, 0);

        var login = await request('/admin/api/login', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'owner', password: password})
        });
        assert.strictEqual(login.response.status, 200);
        assert.strictEqual(login.data.ok, true);
        var cookie = login.response.headers.get('set-cookie');
        assert.ok(cookie && cookie.indexOf('bq_admin_session=') !== -1);
        cookie = cookie.split(';')[0];

        var kicked = await request('/admin/api/players/77/kick', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({reason: 'Comportamento inadequado'})
        });
        assert.strictEqual(kicked.response.status, 200);
        assert.strictEqual(kicked.data.ok, true);
        assert.strictEqual(kicked.data.player.id, '77');
        assert.strictEqual(kickCalls.length, 1);
        assert.deepStrictEqual(kickCalls[0], {playerId: '77', reason: 'Comportamento inadequado'});

        var kickAudit = auditRows.find(function(row) { return row.params && row.params[1] === 'player.kick'; });
        assert.ok(kickAudit, 'player.kick must be written to admin_audit_log');
        assert.strictEqual(kickAudit.params[2], 'hero_account');
        var metadata = JSON.parse(kickAudit.params[3]);
        assert.strictEqual(metadata.playerId, '77');
        assert.strictEqual(metadata.userId, 33);
        assert.strictEqual(metadata.characterId, 44);
        assert.strictEqual(metadata.reason, 'Comportamento inadequado');

        var gone = await request('/admin/api/players/77/kick', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: '{}'
        });
        assert.strictEqual(gone.response.status, 404);

        console.log('Admin kick smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
