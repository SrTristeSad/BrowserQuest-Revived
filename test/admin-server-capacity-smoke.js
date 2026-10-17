'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminAuth = require('../server/admin/auth'),
    AdminHttp = require('../server/admin/http');

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-capacity-')),
        configPath = path.join(dir, 'browserquest.json'),
        password = 'StrongPassword123!',
        passwordHash = AdminAuth.hashPassword(password),
        txQueries = [],
        audits = [];

    fs.writeFileSync(configPath, JSON.stringify({
        nb_worlds: 5,
        nb_players_per_world: 200,
        infrastructure: {postgres: {password: 'do-not-expose'}, redis: {password: 'hidden'}}
    }, null, 2));

    var transactionClient = {
            query: async function(sql, params) {
                txQueries.push({sql: String(sql), params: params || []});
                return {rowCount: 1, rows: []};
            },
            release: function() {}
        },
        services = {
            redis: null,
            postgres: {
                connect: async function() { return transactionClient; },
                query: async function(sql, params) {
                    sql = String(sql);
                    if(sql.indexOf('SELECT id, username, display_name, password_hash') === 0) {
                        return {rowCount: 1, rows: [{id: 1, username: 'owner', display_name: 'Owner', password_hash: passwordHash, role: 'owner', status: 'active'}]};
                    }
                    if(sql.indexOf('INSERT INTO admin_audit_log') === 0) {
                        audits.push({sql: sql, params: params});
                        return {rowCount: 1, rows: []};
                    }
                    throw new Error('Unexpected SQL in capacity smoke test: ' + sql);
                }
            }
        },
        runtime = {
            server: {
                adminRuntime: {
                    getSnapshot: function() {
                        return {onlinePlayers: 0, worldCount: 5, maxPlayersPerWorld: 200, worlds: [], websocket: true};
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
        var unauthorized = await request('/admin/api/settings/server');
        assert.strictEqual(unauthorized.response.status, 401);

        var login = await request('/admin/api/login', {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({username: 'owner', password: password})
        });
        assert.strictEqual(login.response.status, 200);
        var cookie = login.response.headers.get('set-cookie').split(';')[0];

        var initial = await request('/admin/api/settings/server', {headers: {cookie: cookie}});
        assert.strictEqual(initial.response.status, 200);
        assert.deepStrictEqual(initial.data.configured, {worlds: 5, playersPerWorld: 200});
        assert.deepStrictEqual(initial.data.active, {worlds: 5, playersPerWorld: 200});
        assert.strictEqual(initial.data.restartRequired, false);
        assert.strictEqual(JSON.stringify(initial.data).indexOf('do-not-expose'), -1);

        var invalidWorlds = await request('/admin/api/settings/server', {
            method: 'POST', headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({worlds: 21, playersPerWorld: 200})
        });
        assert.strictEqual(invalidWorlds.response.status, 400);

        var invalidPlayers = await request('/admin/api/settings/server', {
            method: 'POST', headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({worlds: 5, playersPerWorld: 1001})
        });
        assert.strictEqual(invalidPlayers.response.status, 400);

        var saved = await request('/admin/api/settings/server', {
            method: 'POST', headers: {'content-type': 'application/json', cookie: cookie},
            body: JSON.stringify({worlds: 3, playersPerWorld: 150})
        });
        assert.strictEqual(saved.response.status, 200);
        assert.deepStrictEqual(saved.data.configured, {worlds: 3, playersPerWorld: 150});
        assert.deepStrictEqual(saved.data.active, {worlds: 5, playersPerWorld: 200});
        assert.strictEqual(saved.data.restartRequired, true);

        var disk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.strictEqual(disk.nb_worlds, 3);
        assert.strictEqual(disk.nb_players_per_world, 150);
        assert.strictEqual(disk.infrastructure.postgres.password, 'do-not-expose');

        assert.ok(txQueries.some(function(row) { return row.sql === 'BEGIN'; }));
        assert.ok(txQueries.some(function(row) { return row.sql.indexOf("'world_count'") !== -1 && row.params[0] === '3'; }));
        assert.ok(txQueries.some(function(row) { return row.sql.indexOf("'players_per_world'") !== -1 && row.params[0] === '150'; }));
        assert.ok(txQueries.some(function(row) { return row.sql === 'COMMIT'; }));

        var audit = audits.find(function(row) { return row.params && row.params[1] === 'settings.server_capacity.update'; });
        assert.ok(audit, 'capacity update must be audited');
        var metadata = JSON.parse(audit.params[3]);
        assert.deepStrictEqual(metadata.previous, {worlds: 5, playersPerWorld: 200});
        assert.deepStrictEqual(metadata.configured, {worlds: 3, playersPerWorld: 150});
        assert.strictEqual(metadata.restartRequired, true);

        var after = await request('/admin/api/settings/server', {headers: {cookie: cookie}});
        assert.strictEqual(after.response.status, 200);
        assert.deepStrictEqual(after.data.configured, {worlds: 3, playersPerWorld: 150});
        assert.deepStrictEqual(after.data.active, {worlds: 5, playersPerWorld: 200});
        assert.strictEqual(after.data.restartRequired, true);

        console.log('Admin server capacity smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
