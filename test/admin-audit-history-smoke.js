'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http');

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-audit-')),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        auditQueryParams = [],
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
                    if(sql.indexOf('INSERT INTO admin_audit_log') === 0) {
                        return {rowCount: 1, rows: []};
                    }
                    if(sql.indexOf('SELECT l.id, l.actor_user_id') === 0) {
                        auditQueryParams.push(params.slice());
                        return {rowCount: 2, rows: [
                            {
                                id: 42,
                                actor_user_id: 1,
                                actor_username: 'owner',
                                actor_role: 'owner',
                                action: 'account.ban',
                                target: 'player_one',
                                metadata: {
                                    reason: 'Teste',
                                    token: 'should-not-leak',
                                    nested: {ok: true, password: 'hidden'},
                                    list: [{secret: 'hidden-too', value: 7}]
                                },
                                created_at: '2026-10-17T07:00:00.000Z'
                            },
                            {
                                id: 41,
                                actor_user_id: null,
                                actor_username: null,
                                actor_role: null,
                                action: 'legacy.action',
                                target: null,
                                metadata: {},
                                created_at: '2026-10-17T06:59:00.000Z'
                            }
                        ]};
                    }
                    throw new Error('Unexpected SQL in admin audit history smoke test: ' + sql);
                }
            }
        },
        handler = AdminHttp.createAdminHandler({
            configDir: dir,
            infrastructure: services,
            runtime: {server: {adminRuntime: {}}}
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
        var unauthorized = await request('/admin/api/audit?limit=10');
        assert.strictEqual(unauthorized.response.status, 401);
        assert.strictEqual(auditQueryParams.length, 0);

        var login = await request('/admin/api/login', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'owner', password: password})
        });
        assert.strictEqual(login.response.status, 200);
        var cookie = login.response.headers.get('set-cookie');
        assert.ok(cookie && cookie.indexOf('bq_admin_session=') !== -1);
        cookie = cookie.split(';')[0];

        var history = await request('/admin/api/audit?limit=250&before=99', {
            headers: {cookie: cookie}
        });
        assert.strictEqual(history.response.status, 200);
        assert.strictEqual(history.data.entries.length, 2);
        assert.strictEqual(history.data.entries[0].id, 42);
        assert.strictEqual(history.data.entries[0].actorUserId, 1);
        assert.strictEqual(history.data.entries[0].actorUsername, 'owner');
        assert.strictEqual(history.data.entries[0].actorRole, 'owner');
        assert.strictEqual(history.data.entries[0].action, 'account.ban');
        assert.strictEqual(history.data.entries[0].target, 'player_one');
        assert.strictEqual(history.data.entries[0].metadata.reason, 'Teste');
        assert.strictEqual(history.data.entries[0].metadata.token, undefined);
        assert.strictEqual(history.data.entries[0].metadata.nested.password, undefined);
        assert.strictEqual(history.data.entries[0].metadata.nested.ok, true);
        assert.strictEqual(history.data.entries[0].metadata.list[0].secret, undefined);
        assert.strictEqual(history.data.entries[0].metadata.list[0].value, 7);
        assert.strictEqual(history.data.entries[1].actorUsername, null);
        assert.strictEqual(history.data.nextBefore, null);
        assert.deepStrictEqual(auditQueryParams[0], [99, 100], 'limit must be clamped to 100 and before must be forwarded');

        var invalidBefore = await request('/admin/api/audit?limit=1&before=nope', {
            headers: {cookie: cookie}
        });
        assert.strictEqual(invalidBefore.response.status, 200);
        assert.deepStrictEqual(auditQueryParams[1], [null, 1]);
        assert.strictEqual(invalidBefore.data.nextBefore, 41, 'full page must expose the last id as nextBefore');

        console.log('Admin audit history smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
