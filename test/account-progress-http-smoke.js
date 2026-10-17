'use strict';

var assert = require('assert'),
    http = require('http'),
    https = require('https'),
    URL = require('url').URL;

var base = process.env.TEST_HTTP_URL || 'http://127.0.0.1:8010';

function requestJson(pathname, method, body, cookie) {
    return new Promise(function(resolve, reject) {
        var target = new URL(pathname, base),
            transport = target.protocol === 'https:' ? https : http,
            payload = body === undefined ? null : JSON.stringify(body),
            headers = {accept: 'application/json'};
        if(payload !== null) {
            headers['content-type'] = 'application/json';
            headers['content-length'] = Buffer.byteLength(payload);
        }
        if(cookie) { headers.cookie = cookie; }

        var request = transport.request({
            method: method,
            hostname: target.hostname,
            port: target.port,
            path: target.pathname,
            headers: headers
        }, function(response) {
            var chunks = [];
            response.on('data', function(chunk) { chunks.push(chunk); });
            response.on('end', function() {
                var raw = Buffer.concat(chunks).toString('utf8'), data;
                try { data = JSON.parse(raw || '{}'); }
                catch(error) {
                    error.message = method + ' ' + pathname + ' returned invalid JSON: ' + raw.slice(0, 500) + ' :: ' + error.message;
                    return reject(error);
                }
                if(response.statusCode < 200 || response.statusCode >= 300) {
                    var serverMessage = typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data),
                        failure = new Error(method + ' ' + pathname + ' -> HTTP ' + response.statusCode + ': ' + serverMessage);
                    failure.statusCode = response.statusCode;
                    failure.response = data;
                    return reject(failure);
                }
                resolve({data: data, headers: response.headers});
            });
        });
        request.on('error', function(error) {
            error.message = method + ' ' + pathname + ' transport error: ' + error.message;
            reject(error);
        });
        if(payload !== null) { request.write(payload); }
        request.end();
    });
}

async function main() {
    var suffix = Date.now().toString(36).slice(-8),
        registration = await requestJson('/api/auth/register', 'POST', {
            username: 'progress_' + suffix,
            password: 'StrongPassword123!',
            characterName: 'Prog' + suffix.slice(-7)
        }),
        setCookie = registration.headers['set-cookie'], cookie, first, second, fetched, session, concurrent;

    assert.strictEqual(registration.data.loggedIn, true);
    assert.ok(registration.data.progress && registration.data.progress.achievements, 'new account must receive server achievement defaults');
    assert.deepStrictEqual(registration.data.progress.achievements, {
        unlocked: [], ratCount: 0, skeletonCount: 0, totalKills: 0, totalDmg: 0, totalRevives: 0
    });

    assert.ok(setCookie && setCookie.length);
    cookie = setCookie[0].split(';')[0];

    first = await requestJson('/api/auth/progress/achievements', 'POST', {
        achievements: {
            unlocked: [1, 2, 2, 99],
            ratCount: 7,
            skeletonCount: 3,
            totalKills: 22,
            totalDmg: 1234,
            totalRevives: 2
        }
    }, cookie);
    assert.deepStrictEqual(first.data.achievements, {
        unlocked: [1, 2], ratCount: 7, skeletonCount: 3, totalKills: 22, totalDmg: 1234, totalRevives: 2
    });

    // A stale/older client cannot roll progress backwards; a new unlock is merged.
    second = await requestJson('/api/auth/progress/achievements', 'POST', {
        achievements: {
            unlocked: [3],
            ratCount: 1,
            skeletonCount: 1,
            totalKills: 2,
            totalDmg: 100,
            totalRevives: 0
        }
    }, cookie);
    assert.deepStrictEqual(second.data.achievements, {
        unlocked: [1, 2, 3], ratCount: 7, skeletonCount: 3, totalKills: 22, totalDmg: 1234, totalRevives: 2
    });

    // Two tabs/devices can update the same character concurrently without losing either unlock.
    await Promise.all([
        requestJson('/api/auth/progress/achievements', 'POST', {
            achievements: {unlocked: [4], ratCount: 8, skeletonCount: 3, totalKills: 23, totalDmg: 1300, totalRevives: 2}
        }, cookie),
        requestJson('/api/auth/progress/achievements', 'POST', {
            achievements: {unlocked: [5], ratCount: 7, skeletonCount: 4, totalKills: 24, totalDmg: 1250, totalRevives: 3}
        }, cookie)
    ]);
    concurrent = await requestJson('/api/auth/progress/achievements', 'GET', undefined, cookie);
    assert.deepStrictEqual(concurrent.data.achievements, {
        unlocked: [1, 2, 3, 4, 5], ratCount: 8, skeletonCount: 4, totalKills: 24, totalDmg: 1300, totalRevives: 3
    });

    // Server clamps legacy counters to the original game thresholds.
    await requestJson('/api/auth/progress/achievements', 'POST', {
        achievements: {unlocked: [20], ratCount: 500, skeletonCount: 500, totalKills: 500, totalDmg: 50000, totalRevives: 500}
    }, cookie);

    fetched = await requestJson('/api/auth/progress/achievements', 'GET', undefined, cookie);
    assert.deepStrictEqual(fetched.data.achievements, {
        unlocked: [1, 2, 3, 4, 5, 20], ratCount: 10, skeletonCount: 10, totalKills: 50, totalDmg: 5000, totalRevives: 5
    });

    session = await requestJson('/api/auth/session', 'GET', undefined, cookie);
    assert.deepStrictEqual(session.data.progress.achievements, fetched.data.achievements, 'session response must use PostgreSQL progress');

    await requestJson('/api/auth/logout', 'POST', {}, cookie);
    console.log('Account achievement HTTP persistence smoke tests passed.');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
