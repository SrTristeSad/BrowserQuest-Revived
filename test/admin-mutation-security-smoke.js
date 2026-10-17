'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    http = require('http'),
    AdminHttp = require('../server/admin/http');

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-admin-security-')),
        handler = AdminHttp.createAdminHandler({
            configDir: dir,
            infrastructure: null,
            runtime: {server: {adminRuntime: {}}},
            playerAuth: null
        }),
        server = http.createServer(function(request, response) {
            if(!handler(request, response)) {
                response.writeHead(404);
                response.end('not found');
            }
        });

    await new Promise(function(resolve) { server.listen(0, '127.0.0.1', resolve); });
    var base = 'http://127.0.0.1:' + server.address().port,
        mutations = [
            {method: 'POST', path: '/admin/api/players/123/mute', body: {durationMinutes: 5, reason: 'test'}},
            {method: 'POST', path: '/admin/api/players/123/kick', body: {reason: 'test'}},
            {method: 'POST', path: '/admin/api/accounts/77/sessions/revoke', body: {reason: 'test'}},
            {method: 'POST', path: '/admin/api/accounts/77/suspend', body: {reason: 'test'}},
            {method: 'POST', path: '/admin/api/accounts/77/ban', body: {reason: 'test'}},
            {method: 'POST', path: '/admin/api/accounts/77/reactivate', body: {reason: 'test'}},
            {method: 'POST', path: '/admin/api/announcement', body: {message: 'test'}},
            {method: 'POST', path: '/admin/api/settings/server', body: {worlds: 2, playersPerWorld: 50}},
            {method: 'POST', path: '/admin/api/settings/access', body: {accessMode: 'mixed', registrationEnabled: true}},
            {method: 'POST', path: '/admin/api/world', body: {}},
            {method: 'POST', path: '/admin/api/world/publish', body: {}},
            {method: 'POST', path: '/admin/api/world/reset', body: {}},
            {method: 'POST', path: '/admin/api/stories', body: {}},
            {method: 'DELETE', path: '/admin/api/stories/test-story', body: null}
        ];

    async function request(item, extraHeaders) {
        var headers = Object.assign({'content-type': 'application/json'}, extraHeaders || {}), options = {method: item.method, headers: headers};
        if(item.body !== null) { options.body = JSON.stringify(item.body || {}); }
        var response = await fetch(base + item.path, options), text = await response.text(), data = {};
        try { data = JSON.parse(text || '{}'); } catch(ignore) {}
        return {response: response, data: data};
    }

    try {
        for(var i = 0; i < mutations.length; i += 1) {
            var item = mutations[i], unauthorized = await request(item);
            assert.strictEqual(
                unauthorized.response.status,
                401,
                item.method + ' ' + item.path + ' must require an authenticated admin session'
            );
        }

        var crossOrigin = await request(
            {method: 'POST', path: '/admin/api/settings/server', body: {worlds: 2, playersPerWorld: 50}},
            {origin: 'https://evil.example', host: 'admin.local'}
        );
        assert.strictEqual(crossOrigin.response.status, 403);
        assert.match(String(crossOrigin.data.error || ''), /Origem/);

        var crossOriginDelete = await request(
            {method: 'DELETE', path: '/admin/api/stories/test-story', body: null},
            {origin: 'https://evil.example', host: 'admin.local'}
        );
        assert.strictEqual(crossOriginDelete.response.status, 403);

        console.log('Admin mutation security smoke test passed.');
    } finally {
        await new Promise(function(resolve) { server.close(resolve); });
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
