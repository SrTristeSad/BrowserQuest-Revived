'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http');

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-suspend-')),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        auditRows = [],
        revokedUsers = [],
        kickCalls = [],
        accounts = {
            77: {id: 77, username: 'hero_account', status: 'active'},
            88: {id: 88, username: 'banned_account', status: 'banned'}
        },
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
                    if(sql.indexOf("SELECT id, username, status FROM users WHERE id=$1 AND role='player'") === 0) {
                        var account = accounts[Number(params[0])];
                        return account ? {rowCount: 1, rows: [Object.assign({}, account)]} : {rowCount: 0, rows: []};
                    }
                    if(sql.indexOf("UPDATE users SET status='suspended'") === 0) {
                        var target = accounts[Number(params[0])];
                        if(!target) { return {rowCount: 0, rows: []}; }
                        target.status = 'suspended';
                        return {rowCount: 1, rows: [Object.assign({}, target)]};
                    }
                    if(sql.indexOf('INSERT INTO admin_audit_log') === 0) {
                        auditRows.push({sql: sql, params: params});
                        return {rowCount: 1, rows: []};
                    }
                    throw new Error('Unexpected SQL in admin suspend smoke test: ' + sql);
                }
            }
        },
        playerAuth = {
            destroySessionsByUserId: async function(userId) {
                revokedUsers.push(Number(userId));
                return Number(userId) === 77 ? 2 : 0;
            }
        },
        runtime = {
            server: {
                adminRuntime: {
                    kickByUserId: function(userId, reason) {
                        kickCalls.push({userId: Number(userId), reason: reason});
                        return Number(userId) === 77 ? 1 : 0;
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
        var unauthorized = await request('/admin/api/accounts/77/suspend', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({reason: 'Teste'})
        });
        assert.strictEqual(unauthorized.response.status, 401);
        assert.strictEqual(revokedUsers.length, 0);
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

        var suspended = await request('/admin/api/accounts/77/suspend', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({reason: 'Investigação temporária'})
        });
        assert.strictEqual(suspended.response.status, 200);
        assert.strictEqual(suspended.data.ok, true);
        assert.strictEqual(suspended.data.account.id, 77);
        assert.strictEqual(suspended.data.account.status, 'suspended');
        assert.strictEqual(suspended.data.sessionsRevoked, 2);
        assert.strictEqual(suspended.data.connectionsClosed, 1);
        assert.strictEqual(accounts[77].status, 'suspended');
        assert.deepStrictEqual(revokedUsers, [77]);
        assert.deepStrictEqual(kickCalls, [{userId: 77, reason: 'Investigação temporária'}]);

        var suspendAudit = auditRows.find(function(row) { return row.params && row.params[1] === 'account.suspend'; });
        assert.ok(suspendAudit, 'account.suspend must be written to admin_audit_log');
        assert.strictEqual(suspendAudit.params[2], 'hero_account');
        var metadata = JSON.parse(suspendAudit.params[3]);
        assert.strictEqual(metadata.userId, 77);
        assert.strictEqual(metadata.previousStatus, 'active');
        assert.strictEqual(metadata.reason, 'Investigação temporária');
        assert.strictEqual(metadata.sessionsRevoked, 2);
        assert.strictEqual(metadata.connectionsClosed, 1);

        var banned = await request('/admin/api/accounts/88/suspend', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: '{}'
        });
        assert.strictEqual(banned.response.status, 409);
        assert.strictEqual(accounts[88].status, 'banned');
        assert.deepStrictEqual(revokedUsers, [77]);
        assert.strictEqual(kickCalls.length, 1);

        var missing = await request('/admin/api/accounts/999/suspend', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: '{}'
        });
        assert.strictEqual(missing.response.status, 404);

        console.log('Admin suspend account smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
