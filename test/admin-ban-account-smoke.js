'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http');

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-ban-')),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        auditRows = [],
        revokedUsers = [],
        kickCalls = [],
        accounts = {
            77: {id: 77, username: 'hero_account', status: 'suspended'},
            88: {id: 88, username: 'already_banned', status: 'banned'}
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
                    if(sql.indexOf("UPDATE users SET status='banned'") === 0) {
                        var target = accounts[Number(params[0])];
                        if(!target) { return {rowCount: 0, rows: []}; }
                        target.status = 'banned';
                        return {rowCount: 1, rows: [Object.assign({}, target)]};
                    }
                    if(sql.indexOf('INSERT INTO admin_audit_log') === 0) {
                        auditRows.push({sql: sql, params: params});
                        return {rowCount: 1, rows: []};
                    }
                    throw new Error('Unexpected SQL in admin ban smoke test: ' + sql);
                }
            }
        },
        playerAuth = {
            destroySessionsByUserId: async function(userId) {
                revokedUsers.push(Number(userId));
                return Number(userId) === 77 ? 3 : 1;
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
        var unauthorized = await request('/admin/api/accounts/77/ban', {
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

        var banned = await request('/admin/api/accounts/77/ban', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({reason: 'Violação grave das regras'})
        });
        assert.strictEqual(banned.response.status, 200);
        assert.strictEqual(banned.data.ok, true);
        assert.strictEqual(banned.data.account.id, 77);
        assert.strictEqual(banned.data.account.status, 'banned');
        assert.strictEqual(banned.data.sessionsRevoked, 3);
        assert.strictEqual(banned.data.connectionsClosed, 1);
        assert.strictEqual(accounts[77].status, 'banned');
        assert.deepStrictEqual(revokedUsers, [77]);
        assert.deepStrictEqual(kickCalls, [{userId: 77, reason: 'Violação grave das regras'}]);

        var banAudit = auditRows.find(function(row) { return row.params && row.params[1] === 'account.ban'; });
        assert.ok(banAudit, 'account.ban must be written to admin_audit_log');
        assert.strictEqual(banAudit.params[2], 'hero_account');
        var metadata = JSON.parse(banAudit.params[3]);
        assert.strictEqual(metadata.userId, 77);
        assert.strictEqual(metadata.previousStatus, 'suspended');
        assert.strictEqual(metadata.reason, 'Violação grave das regras');
        assert.strictEqual(metadata.sessionsRevoked, 3);
        assert.strictEqual(metadata.connectionsClosed, 1);

        var idempotent = await request('/admin/api/accounts/88/ban', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: '{}'
        });
        assert.strictEqual(idempotent.response.status, 200);
        assert.strictEqual(idempotent.data.account.status, 'banned');
        assert.strictEqual(accounts[88].status, 'banned');
        assert.deepStrictEqual(revokedUsers, [77, 88]);
        assert.strictEqual(kickCalls.length, 2);

        var missing = await request('/admin/api/accounts/999/ban', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: '{}'
        });
        assert.strictEqual(missing.response.status, 404);

        console.log('Admin ban account smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
