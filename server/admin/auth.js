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
        create: function(username) {
            var token = crypto.randomBytes(32).toString('hex');
            cleanup();
            sessions.set(token, {
                username: username,
                expiresAt: Date.now() + ttl
            });
            return token;
        },

        get: function(token) {
            var session;
            cleanup();
            session = sessions.get(String(token || ''));
            if(!session) {
                return null;
            }
            session.expiresAt = Date.now() + ttl;
            return session;
        },

        destroy: function(token) {
            sessions.delete(String(token || ''));
        },

        destroyAll: function() {
            sessions.clear();
        }
    };
}

exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.createSessionManager = createSessionManager;
