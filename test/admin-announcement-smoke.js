'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http');

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-announcement-')),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        auditRows = [],
        broadcasts = [],
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
                        auditRows.push({sql: sql, params: params});
                        return {rowCount: 1, rows: []};
                    }
                    throw new Error('Unexpected SQL in admin announcement smoke test: ' + sql);
                }
            }
        },
        runtime = {
            server: {
                adminRuntime: {
                    broadcastAnnouncement: function(message) {
                        broadcasts.push(message);
                        return 3;
                    }
                }
            }
        },
        handler = AdminHttp.createAdminHandler({
            configDir: dir,
            infrastructure: services,
            runtime: runtime
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
        var unauthorized = await request('/admin/api/announcements', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({message: 'Teste'})
        });
        assert.strictEqual(unauthorized.response.status, 401);
        assert.strictEqual(broadcasts.length, 0);

        var login = await request('/admin/api/login', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'owner', password: password})
        });
        assert.strictEqual(login.response.status, 200);
        var cookie = login.response.headers.get('set-cookie');
        assert.ok(cookie && cookie.indexOf('bq_admin_session=') !== -1);
        cookie = cookie.split(';')[0];

        var empty = await request('/admin/api/announcements', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({message: '   \n  \t '})
        });
        assert.strictEqual(empty.response.status, 400);
        assert.strictEqual(broadcasts.length, 0);

        var sent = await request('/admin/api/announcements', {
            method: 'POST',
            headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({message: '  Servidor   reiniciará   em 10 minutos.  '})
        });
        assert.strictEqual(sent.response.status, 200);
        assert.strictEqual(sent.data.ok, true);
        assert.strictEqual(sent.data.message, 'Servidor reiniciará em 10 minutos.');
        assert.strictEqual(sent.data.delivered, 3);
        assert.deepStrictEqual(broadcasts, ['Servidor reiniciará em 10 minutos.']);

        var announcementAudit = auditRows.find(function(row) {
            return row.params && row.params[1] === 'announcement.broadcast';
        });
        assert.ok(announcementAudit, 'announcement.broadcast must be written to admin_audit_log');
        assert.strictEqual(announcementAudit.params[2], 'all');
        var metadata = JSON.parse(announcementAudit.params[3]);
        assert.strictEqual(metadata.message, 'Servidor reiniciará em 10 minutos.');
        assert.strictEqual(metadata.delivered, 3);

        var longMessage = 'A'.repeat(340),
            longResult = await request('/admin/api/announcements', {
                method: 'POST',
                headers: {'content-type': 'application/json', cookie: cookie},
                body: JSON.stringify({message: longMessage})
            });
        assert.strictEqual(longResult.response.status, 200);
        assert.strictEqual(longResult.data.message.length, 300);
        assert.strictEqual(broadcasts[1].length, 300);

        console.log('Admin announcement smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
