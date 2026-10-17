'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    PlayerAuth = require('../server/auth/player-auth').PlayerAuth,
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http');

async function verifyPlayerAuthRevocation() {
    var values = new Map([
            ['bq:player:session:a', JSON.stringify({userId: 7, characterId: 70})],
            ['bq:player:session:b', JSON.stringify({userId: 8, characterId: 80})],
            ['bq:player:session:c', JSON.stringify({userId: 7, characterId: 71})],
            ['bq:player:session:bad', '{invalid-json']
        ]),
        redis = {
            scan: async function() { return {cursor: 0, keys: Array.from(values.keys())}; },
            mGet: async function(keys) { return keys.map(function(key) { return values.get(key) || null; }); },
            del: async function(keys) {
                if(!Array.isArray(keys)) { keys = [keys]; }
                var removed = 0;
                keys.forEach(function(key) { if(values.delete(key)) { removed += 1; } });
                return removed;
            }
        },
        auth = new PlayerAuth({services: {postgres: {}, redis: redis}}),
        removed = await auth.destroySessionsByUserId(7);

    assert.strictEqual(removed, 2);
    assert.strictEqual(values.has('bq:player:session:a'), false);
    assert.strictEqual(values.has('bq:player:session:c'), false);
    assert.strictEqual(values.has('bq:player:session:b'), true);
    assert.strictEqual(values.has('bq:player:session:bad'), true);
    assert.strictEqual(await auth.destroySessionsByUserId('invalid'), 0);
}

async function verifyAdminEndpoint() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-revoke-')),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        auditRows = [],
        revokeCalls = [],
        disconnectCalls = [],
        services = {
            redis: null,
            postgres: {
                query: async function(sql, params) {
                    sql = String(sql);
                    if(sql.indexOf('SELECT id, username, display_name, password_hash') === 0) {
                        return {rowCount: 1, rows: [{
                            id: 1,
                            username: 'owner',
                            display_name: 'Owner',
                            password_hash: passwordHash,
                            role: 'owner',
                            status: 'active'
                        }]};
                    }
                    if(sql.indexOf("SELECT id, username FROM users WHERE id=$1 AND role='player'") === 0) {
                        if(Number(params[0]) !== 33) { return {rowCount: 0, rows: []}; }
                        return {rowCount: 1, rows: [{id: 33, username: 'hero_account'}]};
                    }
                    if(sql.indexOf('INSERT INTO admin_audit_log') === 0) {
                        auditRows.push({sql: sql, params: params});
                        return {rowCount: 1, rows: []};
                    }
                    throw new Error('Unexpected SQL in session revoke smoke test: ' + sql);
                }
            }
        },
        playerAuth = {
            destroySessionsByUserId: async function(userId) {
                revokeCalls.push(Number(userId));
                return 2;
            }
        },
        runtime = {
            server: {
                adminRuntime: {
                    kickByUserId: function(userId, reason) {
                        disconnectCalls.push({userId: Number(userId), reason: reason});
                        return 1;
                    }
                }
            }
        },
        handler = AdminHttp.createAdminHandler({
            configDir: dir,
            infrastructure: services,
            runtime: runtime,
            playerAuth: playerAuth
        }),
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
        var unauthorized = await request('/admin/api/accounts/33/sessions/revoke', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: '{}'
        });
        assert.strictEqual(unauthorized.response.status, 401);
        assert.strictEqual(revokeCalls.length, 0);

        var login = await request('/admin/api/login', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'owner', password: password})
        });
        assert.strictEqual(login.response.status, 200);
        var cookie = login.response.headers.get('set-cookie').split(';')[0];

        var revoked = await request('/admin/api/accounts/33/sessions/revoke', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({reason: 'Reautenticação necessária'})
        });
        assert.strictEqual(revoked.response.status, 200);
        assert.strictEqual(revoked.data.ok, true);
        assert.strictEqual(revoked.data.sessionsRevoked, 2);
        assert.strictEqual(revoked.data.connectionsClosed, 1);
        assert.deepStrictEqual(revokeCalls, [33]);
        assert.deepStrictEqual(disconnectCalls, [{userId: 33, reason: 'Reautenticação necessária'}]);

        var auditRow = auditRows.find(function(row) { return row.params && row.params[1] === 'account.sessions.revoke'; });
        assert.ok(auditRow, 'account.sessions.revoke must be audited');
        assert.strictEqual(auditRow.params[2], 'hero_account');
        var metadata = JSON.parse(auditRow.params[3]);
        assert.strictEqual(metadata.userId, 33);
        assert.strictEqual(metadata.reason, 'Reautenticação necessária');
        assert.strictEqual(metadata.sessionsRevoked, 2);
        assert.strictEqual(metadata.connectionsClosed, 1);

        var missing = await request('/admin/api/accounts/999/sessions/revoke', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: '{}'
        });
        assert.strictEqual(missing.response.status, 404);

        console.log('Admin session revoke smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

(async function() {
    await verifyPlayerAuthRevocation();
    await verifyAdminEndpoint();
})().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
