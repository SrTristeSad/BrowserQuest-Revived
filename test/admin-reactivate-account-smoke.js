'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http');

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-reactivate-')),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        auditRows = [],
        accounts = {
            77: {id: 77, username: 'suspended_account', status: 'suspended'},
            88: {id: 88, username: 'banned_account', status: 'banned'},
            99: {id: 99, username: 'active_account', status: 'active'}
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
                    if(sql.indexOf("UPDATE users SET status='active'") === 0) {
                        var target = accounts[Number(params[0])];
                        if(!target) { return {rowCount: 0, rows: []}; }
                        target.status = 'active';
                        return {rowCount: 1, rows: [Object.assign({}, target)]};
                    }
                    if(sql.indexOf('INSERT INTO admin_audit_log') === 0) {
                        auditRows.push({sql: sql, params: params});
                        return {rowCount: 1, rows: []};
                    }
                    throw new Error('Unexpected SQL in admin reactivate smoke test: ' + sql);
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
        var unauthorized = await request('/admin/api/accounts/77/reactivate', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: '{}'
        });
        assert.strictEqual(unauthorized.response.status, 401);
        assert.strictEqual(accounts[77].status, 'suspended');

        var login = await request('/admin/api/login', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'owner', password: password})
        });
        assert.strictEqual(login.response.status, 200);
        var cookie = login.response.headers.get('set-cookie');
        assert.ok(cookie && cookie.indexOf('bq_admin_session=') !== -1);
        cookie = cookie.split(';')[0];

        var suspended = await request('/admin/api/accounts/77/reactivate', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({reason: 'Suspensão encerrada'})
        });
        assert.strictEqual(suspended.response.status, 200);
        assert.strictEqual(suspended.data.ok, true);
        assert.strictEqual(suspended.data.account.id, 77);
        assert.strictEqual(suspended.data.account.status, 'active');
        assert.strictEqual(accounts[77].status, 'active');

        var suspendAudit = auditRows.find(function(row) {
            if(!row.params || row.params[1] !== 'account.reactivate' || row.params[2] !== 'suspended_account') { return false; }
            var metadata = JSON.parse(row.params[3]);
            return metadata.previousStatus === 'suspended';
        });
        assert.ok(suspendAudit, 'reactivating a suspended account must be audited');
        var suspendMetadata = JSON.parse(suspendAudit.params[3]);
        assert.strictEqual(suspendMetadata.userId, 77);
        assert.strictEqual(suspendMetadata.reason, 'Suspensão encerrada');

        var banned = await request('/admin/api/accounts/88/reactivate', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({reason: 'Ban removido'})
        });
        assert.strictEqual(banned.response.status, 200);
        assert.strictEqual(banned.data.account.status, 'active');
        assert.strictEqual(accounts[88].status, 'active');

        var banAudit = auditRows.find(function(row) {
            if(!row.params || row.params[1] !== 'account.reactivate' || row.params[2] !== 'banned_account') { return false; }
            var metadata = JSON.parse(row.params[3]);
            return metadata.previousStatus === 'banned';
        });
        assert.ok(banAudit, 'removing a ban must preserve previous status in audit metadata');

        var alreadyActive = await request('/admin/api/accounts/99/reactivate', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: '{}'
        });
        assert.strictEqual(alreadyActive.response.status, 200);
        assert.strictEqual(alreadyActive.data.account.status, 'active');
        assert.strictEqual(accounts[99].status, 'active');

        var activeAudit = auditRows.find(function(row) {
            if(!row.params || row.params[1] !== 'account.reactivate' || row.params[2] !== 'active_account') { return false; }
            return JSON.parse(row.params[3]).previousStatus === 'active';
        });
        assert.ok(activeAudit, 'idempotent reactivation must remain auditable');

        var missing = await request('/admin/api/accounts/404/reactivate', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: '{}'
        });
        assert.strictEqual(missing.response.status, 404);

        console.log('Admin reactivate account smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
