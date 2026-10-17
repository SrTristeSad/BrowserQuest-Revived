'use strict';

var crypto = require('crypto'),
    AdminAuth = require('../admin/auth'),
    Types = require('../../shared/js/gametypes');

var SESSION_COOKIE = 'bq_player_session',
    SESSION_TTL_SECONDS = 8 * 60 * 60;

function normalizeUsername(value) {
    var username = String(value || '').trim().toLowerCase();
    if(!/^[a-z0-9_-]{3,32}$/.test(username)) {
        throw new Error('Usuário deve ter entre 3 e 32 caracteres e usar apenas letras, números, _ ou -.');
    }
    return username;
}

function normalizeCharacterName(value) {
    var name = String(value || '').trim().replace(/\s+/g, ' ');
    if(name.length < 1 || name.length > 15) {
        throw new Error('Nome do personagem deve ter entre 1 e 15 caracteres.');
    }
    if(!/^[A-Za-zÀ-ÿ0-9 _-]+$/.test(name)) {
        throw new Error('Nome do personagem contém caracteres não permitidos.');
    }
    return name;
}

function validatePassword(value) {
    var password = String(value || '');
    if(password.length < 10 || password.length > 128) {
        throw new Error('A senha precisa ter entre 10 e 128 caracteres.');
    }
    return password;
}

function parseCookies(header) {
    var result = {};
    String(header || '').split(';').forEach(function(part) {
        var index = part.indexOf('='), key, value;
        if(index <= 0) { return; }
        key = part.slice(0, index).trim();
        value = part.slice(index + 1).trim();
        try { result[key] = decodeURIComponent(value); }
        catch(ignore) { result[key] = value; }
    });
    return result;
}

function tokenHash(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function authError(message, statusCode, code) {
    var error = new Error(message);
    error.statusCode = statusCode || 400;
    error.code = code || 'AUTH_ERROR';
    return error;
}

function PlayerAuth(options) {
    options = options || {};
    this.services = options.services;
    this.fallbackAccessMode = options.accessMode || 'mixed';
    this.sessionTtlSeconds = options.sessionTtlSeconds || SESSION_TTL_SECONDS;
    if(!this.services || !this.services.postgres || !this.services.redis) {
        throw new Error('PlayerAuth requer PostgreSQL e Redis conectados.');
    }
}

PlayerAuth.prototype.getPolicy = async function() {
    var result = await this.services.postgres.query(
        "SELECT key, value FROM settings WHERE key IN ('access_mode','registration_enabled')"
    ), values = {}, accessMode, registrationEnabled;

    result.rows.forEach(function(row) { values[row.key] = row.value; });
    accessMode = typeof values.access_mode === 'string' ? values.access_mode : this.fallbackAccessMode;
    if(['name_only', 'account_only', 'mixed'].indexOf(accessMode) === -1) {
        accessMode = this.fallbackAccessMode;
    }
    registrationEnabled = values.registration_enabled !== false;

    return {
        accessMode: accessMode,
        registrationEnabled: registrationEnabled,
        accountsEnabled: accessMode !== 'name_only'
    };
};

PlayerAuth.prototype.consumeRateLimit = async function(kind, identity, limit, windowSeconds) {
    var digest = crypto.createHash('sha256').update(String(identity || 'unknown')).digest('hex').slice(0, 24),
        key = 'bq:rate:' + kind + ':' + digest,
        count = await this.services.redis.incr(key);
    if(count === 1) {
        await this.services.redis.expire(key, windowSeconds);
    }
    return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfter: Math.max(1, await this.services.redis.ttl(key))
    };
};

PlayerAuth.prototype.register = async function(input) {
    var policy = await this.getPolicy(), username, characterName, password, client, userResult, user, character;
    if(!policy.accountsEnabled || !policy.registrationEnabled) {
        throw authError('Cadastro de contas está desativado.', 403, 'REGISTRATION_DISABLED');
    }

    username = normalizeUsername(input.username);
    characterName = normalizeCharacterName(input.characterName);
    password = validatePassword(input.password);
    client = await this.services.postgres.connect();

    try {
        await client.query('BEGIN');
        userResult = await client.query(
            "INSERT INTO users(username, display_name, password_hash, role, status) VALUES($1,$2,$3,'player','active') RETURNING id, username, display_name, role, status, created_at",
            [username, username, AdminAuth.hashPassword(password)]
        );
        user = userResult.rows[0];
        character = (await client.query(
            'INSERT INTO characters(user_id, name, weapon_kind, armor_kind) VALUES($1,$2,$3,$4) RETURNING id, user_id, name, weapon_kind, armor_kind, image',
            [user.id, characterName, Types.Entities.SWORD1, Types.Entities.CLOTHARMOR]
        )).rows[0];
        await client.query('COMMIT');
    } catch(error) {
        try { await client.query('ROLLBACK'); } catch(ignore) {}
        if(error && error.code === '23505') {
            if(String(error.constraint || '').indexOf('characters') !== -1) {
                throw authError('Esse nome de personagem já está reservado.', 409, 'CHARACTER_NAME_TAKEN');
            }
            throw authError('Esse usuário já existe.', 409, 'USERNAME_TAKEN');
        }
        throw error;
    } finally {
        client.release();
    }

    return this.createSession(user, character);
};

PlayerAuth.prototype.login = async function(input) {
    var username = normalizeUsername(input.username), password = String(input.password || ''), result, row;
    result = await this.services.postgres.query(
        "SELECT u.id AS user_id, u.username, u.display_name, u.password_hash, u.role, u.status, c.id AS character_id, c.name AS character_name, c.weapon_kind, c.armor_kind, c.image FROM users u LEFT JOIN characters c ON c.user_id=u.id WHERE u.username=$1 LIMIT 1",
        [username]
    );
    row = result.rows[0];
    if(!row || !AdminAuth.verifyPassword(password, row.password_hash)) {
        throw authError('Usuário ou senha inválidos.', 401, 'INVALID_CREDENTIALS');
    }
    if(row.role !== 'player') {
        throw authError('Esta conta não é uma conta de jogador.', 403, 'NOT_PLAYER');
    }
    if(row.status === 'banned') {
        throw authError('Esta conta está banida.', 403, 'ACCOUNT_BANNED');
    }
    if(row.status === 'suspended') {
        throw authError('Esta conta está suspensa.', 403, 'ACCOUNT_SUSPENDED');
    }
    if(!row.character_id) {
        throw authError('Esta conta ainda não possui personagem.', 409, 'CHARACTER_MISSING');
    }

    await this.services.postgres.query('UPDATE users SET last_login_at=NOW(), updated_at=NOW() WHERE id=$1', [row.user_id]);
    return this.createSession({
        id: row.user_id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        status: row.status
    }, {
        id: row.character_id,
        user_id: row.user_id,
        name: row.character_name,
        weapon_kind: row.weapon_kind,
        armor_kind: row.armor_kind,
        image: row.image
    });
};

PlayerAuth.prototype.createSession = async function(user, character) {
    var token = crypto.randomBytes(32).toString('hex'), key = 'bq:player:session:' + tokenHash(token), payload = {
        userId: Number(user.id),
        characterId: Number(character.id),
        createdAt: Date.now()
    };
    await this.services.redis.set(key, JSON.stringify(payload), {EX: this.sessionTtlSeconds});
    return {
        token: token,
        expiresIn: this.sessionTtlSeconds,
        user: {
            id: Number(user.id),
            username: user.username,
            displayName: user.display_name || user.username,
            role: user.role || 'player'
        },
        character: {
            id: Number(character.id),
            name: character.name,
            weaponKind: Number(character.weapon_kind || Types.Entities.SWORD1),
            armorKind: Number(character.armor_kind || Types.Entities.CLOTHARMOR),
            image: character.image || null
        }
    };
};

PlayerAuth.prototype.getSessionByToken = async function(token, refresh) {
    var key, raw, session, result, row;
    if(!token || !/^[a-f0-9]{64}$/i.test(String(token))) { return null; }
    key = 'bq:player:session:' + tokenHash(token);
    raw = await this.services.redis.get(key);
    if(!raw) { return null; }
    try { session = JSON.parse(raw); }
    catch(error) { await this.services.redis.del(key); return null; }

    result = await this.services.postgres.query(
        "SELECT u.id AS user_id, u.username, u.display_name, u.role, u.status, c.id AS character_id, c.name AS character_name, c.weapon_kind, c.armor_kind, c.image FROM users u JOIN characters c ON c.user_id=u.id WHERE u.id=$1 AND c.id=$2 LIMIT 1",
        [session.userId, session.characterId]
    );
    row = result.rows[0];
    if(!row) { await this.services.redis.del(key); return null; }
    if(row.status === 'banned') { throw authError('Esta conta está banida.', 403, 'ACCOUNT_BANNED'); }
    if(row.status === 'suspended') { throw authError('Esta conta está suspensa.', 403, 'ACCOUNT_SUSPENDED'); }
    if(row.status !== 'active') { throw authError('Esta conta não está ativa.', 403, 'ACCOUNT_INACTIVE'); }
    if(refresh !== false) { await this.services.redis.expire(key, this.sessionTtlSeconds); }

    return {
        token: token,
        user: {id: Number(row.user_id), username: row.username, displayName: row.display_name, role: row.role},
        character: {
            id: Number(row.character_id),
            name: row.character_name,
            weaponKind: Number(row.weapon_kind || Types.Entities.SWORD1),
            armorKind: Number(row.armor_kind || Types.Entities.CLOTHARMOR),
            image: row.image || null
        }
    };
};

PlayerAuth.prototype.getSessionFromCookieHeader = async function(cookieHeader, refresh) {
    var cookies = parseCookies(cookieHeader);
    return this.getSessionByToken(cookies[SESSION_COOKIE], refresh);
};

PlayerAuth.prototype.destroySessionByToken = async function(token) {
    if(!token) { return; }
    await this.services.redis.del('bq:player:session:' + tokenHash(token));
};

PlayerAuth.prototype.destroySessionFromCookieHeader = async function(cookieHeader) {
    var cookies = parseCookies(cookieHeader);
    await this.destroySessionByToken(cookies[SESSION_COOKIE]);
};

PlayerAuth.prototype.destroySessionsByUserId = async function(userId) {
    var numericUserId = Number(userId), cursor = '0', removed = 0, result, keys, values, toDelete;
    if(!Number.isInteger(numericUserId) || numericUserId <= 0) { return 0; }

    do {
        result = await this.services.redis.scan(cursor, {MATCH: 'bq:player:session:*', COUNT: 100});
        cursor = String(result.cursor);
        keys = result.keys || [];
        if(!keys.length) { continue; }

        values = await this.services.redis.mGet(keys);
        toDelete = [];
        values.forEach(function(raw, index) {
            var payload;
            if(!raw) { return; }
            try { payload = JSON.parse(raw); }
            catch(ignoreInvalidSession) { return; }
            if(Number(payload.userId) === numericUserId) { toDelete.push(keys[index]); }
        });

        if(toDelete.length) { removed += await this.services.redis.del(toDelete); }
    } while(cursor !== '0');

    return removed;
};

PlayerAuth.prototype.setMuteForUser = async function(userId, durationSeconds, reason) {
    var numericUserId = Number(userId), seconds = Math.floor(Number(durationSeconds));
    if(!Number.isInteger(numericUserId) || numericUserId <= 0) { throw new Error('ID de usuário inválido para mute.'); }
    if(!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) { throw new Error('Duração do mute deve ficar entre 60 e 86400 segundos.'); }
    var until = Date.now() + (seconds * 1000), payload = {
        until: until,
        reason: String(reason || '').trim().replace(/\s+/g, ' ').slice(0, 120)
    };
    await this.services.redis.set('bq:player:mute:user:' + numericUserId, JSON.stringify(payload), {EX: seconds});
    return {until: until, remainingSeconds: seconds, reason: payload.reason};
};

PlayerAuth.prototype.getMuteForUser = async function(userId) {
    var numericUserId = Number(userId), key, raw, ttl, payload;
    if(!Number.isInteger(numericUserId) || numericUserId <= 0) { return null; }
    key = 'bq:player:mute:user:' + numericUserId;
    raw = await this.services.redis.get(key);
    if(!raw) { return null; }
    ttl = await this.services.redis.ttl(key);
    if(ttl <= 0) { await this.services.redis.del(key); return null; }
    try { payload = JSON.parse(raw); }
    catch(error) { await this.services.redis.del(key); return null; }
    return {
        until: Number(payload.until) || (Date.now() + ttl * 1000),
        remainingSeconds: ttl,
        reason: String(payload.reason || '').slice(0, 120)
    };
};

PlayerAuth.prototype.isCharacterNameReserved = async function(name) {
    var normalized = normalizeCharacterName(name), result = await this.services.postgres.query(
        'SELECT 1 FROM characters WHERE LOWER(name)=LOWER($1) LIMIT 1',
        [normalized]
    );
    return result.rowCount > 0;
};

PlayerAuth.prototype.authorizeConnection = async function(connection) {
    var policy = await this.getPolicy(), session;
    if(policy.accessMode === 'name_only') {
        return {allowed: true, type: 'guest', accessMode: policy.accessMode};
    }

    try {
        session = await this.getSessionFromCookieHeader(connection.headers && connection.headers.cookie, true);
    } catch(error) {
        return {allowed: false, type: 'account', accessMode: policy.accessMode, reason: error.message, code: error.code};
    }

    if(session) {
        var mute = await this.getMuteForUser(session.user.id);
        return {
            allowed: true,
            type: 'account',
            accessMode: policy.accessMode,
            user: session.user,
            character: session.character,
            mute: mute
        };
    }
    if(policy.accessMode === 'account_only') {
        return {allowed: false, type: 'guest', accessMode: policy.accessMode, reason: 'Faça login para entrar neste servidor.', code: 'ACCOUNT_REQUIRED'};
    }
    return {allowed: true, type: 'guest', accessMode: policy.accessMode};
};

exports.PlayerAuth = PlayerAuth;
exports.SESSION_COOKIE = SESSION_COOKIE;
exports.SESSION_TTL_SECONDS = SESSION_TTL_SECONDS;
exports.normalizeUsername = normalizeUsername;
exports.normalizeCharacterName = normalizeCharacterName;
exports.parseCookies = parseCookies;
