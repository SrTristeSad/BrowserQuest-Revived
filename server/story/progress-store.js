'use strict';

var MAX_FLAGS = 200,
    RESERVED_IDS = Object.freeze({
        '__proto__': true,
        'constructor': true,
        'prototype': true
    });

function cleanId(value, max) {
    var text = String(value == null ? '' : value).trim().replace(/[^a-zA-Z0-9_-]/g, '');
    return text.slice(0, max || 120);
}

function strictId(value, max) {
    var limit = max || 120,
        text = String(value == null ? '' : value).trim();
    if(!text || text.length > limit || !/^[a-zA-Z0-9_-]+$/.test(text)) { return ''; }
    if(RESERVED_IDS[text.toLowerCase()]) { return ''; }
    return text;
}

function clampProgress(value) {
    var number = Number(value);
    if(!Number.isFinite(number)) { return 0; }
    return Math.max(0, Math.min(100000, Math.floor(number)));
}

function normalizeStringList(value, limit) {
    var seen = Object.create(null), result = [];
    if(!Array.isArray(value)) { return result; }
    value.slice(0, limit || 500).forEach(function(item) {
        var id = cleanId(item, 120);
        if(id && !seen[id]) {
            seen[id] = true;
            result.push(id);
        }
    });
    return result;
}

function normalizeFlags(value) {
    var result = {}, count = 0;
    if(!value || typeof value !== 'object' || Array.isArray(value)) { return result; }
    Object.keys(value).forEach(function(key) {
        if(count >= MAX_FLAGS) { return; }
        var cleanKey = cleanId(key, 120);
        if(!cleanKey || RESERVED_IDS[cleanKey.toLowerCase()]) { return; }
        var raw = value[key];
        if(typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
            result[cleanKey] = typeof raw === 'string' ? raw.slice(0, 250) : raw;
            count += 1;
        }
    });
    return result;
}

function normalizeStoryProgress(value, storyId) {
    value = value || {};
    var id = cleanId(storyId || value.storyId, 120);
    return {
        version: 1,
        storyId: id,
        activeMissionId: cleanId(value.activeMissionId, 120),
        pendingChoiceMissionId: cleanId(value.pendingChoiceMissionId, 120),
        objectiveProgress: clampProgress(value.objectiveProgress),
        completedMissionIds: normalizeStringList(value.completedMissionIds, 500),
        flags: normalizeFlags(value.flags),
        startedAt: value.startedAt ? String(value.startedAt).slice(0, 40) : null,
        updatedAt: value.updatedAt ? String(value.updatedAt).slice(0, 40) : null
    };
}

function StoryProgressStore(options) {
    options = options || {};
    this.postgres = options.postgres;
    if(!this.postgres) {
        throw new Error('StoryProgressStore requer PostgreSQL.');
    }
}

StoryProgressStore.prototype.get = async function(characterId, storyId) {
    var id = Number(characterId), key = cleanId(storyId, 120);
    if(!Number.isInteger(id) || id <= 0 || !key) { return null; }
    var result = await this.postgres.query(
        "SELECT value FROM character_progress WHERE character_id=$1 AND namespace='story' AND key=$2 LIMIT 1",
        [id, key]
    );
    if(!result.rowCount) { return null; }
    return normalizeStoryProgress(result.rows[0].value, key);
};

StoryProgressStore.prototype.list = async function(characterId) {
    var id = Number(characterId);
    if(!Number.isInteger(id) || id <= 0) { return []; }
    var result = await this.postgres.query(
        "SELECT key, value FROM character_progress WHERE character_id=$1 AND namespace='story' ORDER BY key ASC",
        [id]
    );
    return result.rows.map(function(row) {
        return normalizeStoryProgress(row.value, row.key);
    });
};

StoryProgressStore.prototype.save = async function(characterId, storyId, incoming) {
    var id = Number(characterId), key = cleanId(storyId, 120), client;
    if(!Number.isInteger(id) || id <= 0) { throw new Error('Personagem inválido.'); }
    if(!key) { throw new Error('História inválida.'); }

    var normalized = normalizeStoryProgress(incoming, key);
    normalized.storyId = key;
    normalized.updatedAt = new Date().toISOString();
    if(!normalized.startedAt) { normalized.startedAt = normalized.updatedAt; }

    client = await this.postgres.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [id]);
        await client.query(
            "INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,'story',$2,$3::jsonb) ON CONFLICT(character_id, namespace, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
            [id, key, JSON.stringify(normalized)]
        );
        await client.query('COMMIT');
        return normalized;
    } catch(error) {
        try { await client.query('ROLLBACK'); } catch(ignore) {}
        throw error;
    } finally {
        client.release();
    }
};

exports.StoryProgressStore = StoryProgressStore;
exports.MAX_FLAGS = MAX_FLAGS;
exports.cleanId = cleanId;
exports.strictId = strictId;
exports.normalizeFlags = normalizeFlags;
exports.normalizeStoryProgress = normalizeStoryProgress;
