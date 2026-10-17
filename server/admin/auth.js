'use strict';

var crypto = require('crypto');

function hashPassword(password) {
    var salt = crypto.randomBytes(16),
        hash = crypto.scryptSync(String(password), salt, 64);

    return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(password, stored) {
    var parts = String(stored || '').split('$'),
        salt,
        expected,
        actual;

    if(parts.length !== 3 || parts[0] !== 'scrypt') {
        return false;
    }

    try {
        salt = Buffer.from(parts[1], 'hex');
        expected = Buffer.from(parts[2], 'hex');
        actual = crypto.scryptSync(String(password), salt, expected.length);
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch(error) {
        return false;
    }
}

function tokenHash(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createSessionManager(options) {
    options = options || {};

    var sessions = new Map(),
        ttl = options.ttl || (8 * 60 * 60 * 1000);

    function cleanup() {
        var now = Date.now();
        sessions.forEach(function(session, token) {
            if(session.expiresAt <= now) {
                sessions.delete(token);
            }
        });
    }

    return {
        storage: 'memory',
        create: async function(username, role, userId) {
            var token = crypto.randomBytes(32).toString('hex');
            cleanup();
            sessions.set(token, {
                username: username,
                role: role || 'owner',
                userId: userId || null,
                expiresAt: Date.now() + ttl
            });
            return token;
        },

        get: async function(token) {
            var session;
            cleanup();
            session = sessions.get(String(token || ''));
            if(!session) {
                return null;
            }
            session.expiresAt = Date.now() + ttl;
            return session;
        },

        destroy: async function(token) {
            sessions.delete(String(token || ''));
        },

        destroyAll: async function() {
            sessions.clear();
        }
    };
}

function createRedisSessionManager(redisClient, options) {
    options = options || {};
    var ttlSeconds = Number(options.ttlSeconds || 8 * 60 * 60),
        prefix = String(options.prefix || 'bq:admin:session:');

    if(!redisClient) {
        throw new Error('Redis client is required for admin sessions.');
    }

    return {
        storage: 'redis',
        create: async function(username, role, userId) {
            var token = crypto.randomBytes(32).toString('hex'),
                key = prefix + tokenHash(token),
                value = JSON.stringify({
                    username: String(username || ''),
                    role: role || 'owner',
                    userId: userId || null,
                    createdAt: Date.now()
                });
            await redisClient.set(key, value, {EX: ttlSeconds});
            return token;
        },

        get: async function(token) {
            var clean = String(token || ''), key, raw, value;
            if(!/^[a-f0-9]{64}$/i.test(clean)) { return null; }
            key = prefix + tokenHash(clean);
            raw = await redisClient.get(key);
            if(!raw) { return null; }
            try { value = JSON.parse(raw); }
            catch(error) { await redisClient.del(key); return null; }
            await redisClient.expire(key, ttlSeconds);
            return value;
        },

        destroy: async function(token) {
            var clean = String(token || '');
            if(!clean) { return; }
            await redisClient.del(prefix + tokenHash(clean));
        },

        destroyAll: async function() {
            var cursor = '0', keys;
            do {
                var result = await redisClient.scan(cursor, {MATCH: prefix + '*', COUNT: 100});
                cursor = String(result.cursor);
                keys = result.keys || [];
                if(keys.length) { await redisClient.del(keys); }
            } while(cursor !== '0');
        }
    };
}

exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.createSessionManager = createSessionManager;
exports.createRedisSessionManager = createRedisSessionManager;
exports.tokenHash = tokenHash;
