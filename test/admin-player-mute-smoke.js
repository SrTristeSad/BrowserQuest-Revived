'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http'),
    PlayerAuth = require('../server/auth/player-auth').PlayerAuth;

function fakeRedis() {
    var values = new Map(), expires = new Map();
    return {
        set: async function(key, value, options) {
            values.set(key, value);
            if(options && options.EX) { expires.set(key, Number(options.EX)); }
            return 'OK';
        },
        get: async function(key) { return values.has(key) ? values.get(key) : null; },
        ttl: async function(key) { return values.has(key) ? (expires.get(key) || -1) : -2; },
        del: async function(key) {
            var keys = Array.isArray(key) ? key : [key], removed = 0;
            keys.forEach(function(item) {
                if(values.delete(item)) { removed += 1; }
                expires.delete(item);
            });
            return removed;
        }
    };
}

async function main() {
    var redis = fakeRedis(),
        auth = new PlayerAuth({services: {postgres: {}, redis: redis}}),
        stored = await auth.setMuteForUser(77, 900, '  Flood   no chat  '),
        restored = await auth.getMuteForUser(77);

    assert.strictEqual(stored.remainingSeconds, 900);
    assert.strictEqual(stored.reason, 'Flood no chat');
    assert.ok(stored.until > Date.now());
    assert.strictEqual(restored.remainingSeconds, 900);
    assert.strictEqual(restored.reason, 'Flood no chat');
    assert.strictEqual(restored.until, stored.until);
    assert.strictEqual(await auth.getMuteForUser(0), null);
    await assert.rejects(function() { return auth.setMuteForUser(77, 30, 'curto'); }, /60 e 86400/);
    await assert.rejects(function() { return auth.setMuteForUser(77, 90000, 'longo'); }, /60 e 86400/);

    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-mute-')),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        audits = [],
        muteCalls = [],
        services = {
            redis: null,
            postgres: {
                query: async function(sql, params) {
                    sql = String(sql);
                    if(sql.indexOf('SELECT id, username, display_name, password_hash') === 0) {
                        return {rowCount: 1, rows: [{id: 1, username: 'owner', display_name: 'Owner', password_hash: passwordHash, role: 'owner', status: 'active'}]};
                    }
                    if(sql.indexOf('INSERT INTO admin_audit_log') === 0) {
                        audits.push({sql: sql, params: params});
                        return {rowCount: 1, rows: []};
                    }
                    throw new Error('Unexpected SQL in admin mute smoke test: ' + sql);
                }
            }
        },
        runtime = {
            server: {
                adminRuntime: {
                    mutePlayer: async function(playerId, durationSeconds, reason) {
                        muteCalls.push({playerId: String(playerId), durationSeconds: durationSeconds, reason: reason});
                        if(String(playerId) !== '123') { return null; }
                        return {
                            id: '123', name: 'MutedHero', world: 'world1', type: 'account',
                            userId: 77, username: 'hero_account', characterId: 88,
                            until: Date.now() + durationSeconds * 1000,
                            durationSeconds: durationSeconds, persistent: true
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
        var unauthorized = await request('/admin/api/players/123/mute', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({durationMinutes: 15, reason: 'Teste'})
        });
        assert.strictEqual(unauthorized.response.status, 401);
        assert.strictEqual(muteCalls.length, 0);

        var login = await request('/admin/api/login', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'owner', password: password})
        });
        assert.strictEqual(login.response.status, 200);
        var cookie = login.response.headers.get('set-cookie').split(';')[0];

        var invalid = await request('/admin/api/players/123/mute', {
            method: 'POST', headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({durationMinutes: 0, reason: 'Teste'})
        });
        assert.strictEqual(invalid.response.status, 400);
        assert.strictEqual(muteCalls.length, 0);

        var muted = await request('/admin/api/players/123/mute', {
            method: 'POST', headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({durationMinutes: 15, reason: '  spam   repetido  '})
        });
        assert.strictEqual(muted.response.status, 200);
        assert.strictEqual(muted.data.ok, true);
        assert.strictEqual(muted.data.player.id, '123');
        assert.strictEqual(muted.data.player.persistent, true);
        assert.deepStrictEqual(muteCalls[0], {playerId: '123', durationSeconds: 900, reason: 'spam repetido'});

        var audit = audits.find(function(row) { return row.params && row.params[1] === 'player.mute'; });
        assert.ok(audit, 'player.mute must be audited');
        assert.strictEqual(audit.params[2], 'hero_account');
        var metadata = JSON.parse(audit.params[3]);
        assert.strictEqual(metadata.playerId, '123');
        assert.strictEqual(metadata.userId, 77);
        assert.strictEqual(metadata.durationMinutes, 15);
        assert.strictEqual(metadata.reason, 'spam repetido');
        assert.strictEqual(metadata.persistent, true);

        var missing = await request('/admin/api/players/999/mute', {
            method: 'POST', headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({durationMinutes: 10, reason: 'Teste'})
        });
        assert.strictEqual(missing.response.status, 404);

        console.log('Admin player mute smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
