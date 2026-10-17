'use strict';

var ACHIEVEMENT_IDS = Object.freeze(Array.from({length: 20}, function(_, index) { return index + 1; }));

var DEFAULT_ACHIEVEMENTS = Object.freeze({
    unlocked: [],
    ratCount: 0,
    skeletonCount: 0,
    totalKills: 0,
    totalDmg: 0,
    totalRevives: 0
});

var LIMITS = Object.freeze({
    ratCount: 10,
    skeletonCount: 10,
    totalKills: 50,
    totalDmg: 5000,
    totalRevives: 5
});

function copyDefaults() {
    return {
        unlocked: [],
        ratCount: 0,
        skeletonCount: 0,
        totalKills: 0,
        totalDmg: 0,
        totalRevives: 0
    };
}

function isValidAchievementId(value) {
    return Number.isInteger(value) && ACHIEVEMENT_IDS.indexOf(value) >= 0;
}

function parseAchievementId(value) {
    var text = String(value == null ? '' : value).trim(), id;
    if(!/^\d+$/.test(text)) { return null; }
    id = Number(text);
    return isValidAchievementId(id) ? id : null;
}

function clampInteger(value, maximum) {
    var number = Number(value);
    if(!Number.isFinite(number)) { return 0; }
    number = Math.floor(number);
    if(number < 0) { return 0; }
    return Math.min(number, maximum);
}

function normalizeUnlocked(value) {
    var seen = {};
    if(!Array.isArray(value)) { return []; }
    return value.map(function(id) { return Number(id); }).filter(function(id) {
        if(!isValidAchievementId(id) || seen[id]) { return false; }
        seen[id] = true;
        return true;
    }).sort(function(a, b) { return a - b; });
}

function normalizeAchievements(value) {
    value = value || {};
    return {
        unlocked: normalizeUnlocked(value.unlocked),
        ratCount: clampInteger(value.ratCount, LIMITS.ratCount),
        skeletonCount: clampInteger(value.skeletonCount, LIMITS.skeletonCount),
        totalKills: clampInteger(value.totalKills, LIMITS.totalKills),
        totalDmg: clampInteger(value.totalDmg, LIMITS.totalDmg),
        totalRevives: clampInteger(value.totalRevives, LIMITS.totalRevives)
    };
}

function mergeAchievements(current, incoming) {
    current = normalizeAchievements(current);
    incoming = normalizeAchievements(incoming);
    return {
        unlocked: normalizeUnlocked(current.unlocked.concat(incoming.unlocked)),
        ratCount: Math.max(current.ratCount, incoming.ratCount),
        skeletonCount: Math.max(current.skeletonCount, incoming.skeletonCount),
        totalKills: Math.max(current.totalKills, incoming.totalKills),
        totalDmg: Math.max(current.totalDmg, incoming.totalDmg),
        totalRevives: Math.max(current.totalRevives, incoming.totalRevives)
    };
}

function AccountProgress(options) {
    options = options || {};
    this.postgres = options.postgres;
    if(!this.postgres) {
        throw new Error('AccountProgress requer PostgreSQL.');
    }
}

AccountProgress.prototype.getAchievements = async function(characterId) {
    var result = await this.postgres.query(
        "SELECT value FROM character_progress WHERE character_id=$1 AND namespace='legacy' AND key='achievements' LIMIT 1",
        [Number(characterId)]
    );
    if(!result.rowCount) { return null; }
    return normalizeAchievements(result.rows[0].value);
};

AccountProgress.prototype.ensureAchievements = async function(characterId) {
    var current = await this.getAchievements(characterId);
    if(current) { return current; }
    current = copyDefaults();
    await this.postgres.query(
        "INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,'legacy','achievements',$2::jsonb) ON CONFLICT(character_id, namespace, key) DO NOTHING",
        [Number(characterId), JSON.stringify(current)]
    );
    return current;
};

AccountProgress.prototype.mergeAchievements = async function(characterId, incoming) {
    var id = Number(characterId),
        client = await this.postgres.connect(),
        current,
        merged;
    try {
        await client.query('BEGIN');
        // An absent row cannot be protected by SELECT ... FOR UPDATE. The transaction-scoped
        // advisory lock serializes the first write and later merges for this character too.
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [id]);
        var result = await client.query(
            "SELECT value FROM character_progress WHERE character_id=$1 AND namespace='legacy' AND key='achievements' FOR UPDATE",
            [id]
        );
        current = result.rowCount ? result.rows[0].value : DEFAULT_ACHIEVEMENTS;
        merged = mergeAchievements(current, incoming);
        await client.query(
            "INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,'legacy','achievements',$2::jsonb) ON CONFLICT(character_id, namespace, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
            [id, JSON.stringify(merged)]
        );
        await client.query('COMMIT');
        return merged;
    } catch(error) {
        try { await client.query('ROLLBACK'); } catch(ignore) {}
        throw error;
    } finally {
        client.release();
    }
};

exports.AccountProgress = AccountProgress;
exports.ACHIEVEMENT_IDS = ACHIEVEMENT_IDS;
exports.DEFAULT_ACHIEVEMENTS = DEFAULT_ACHIEVEMENTS;
exports.isValidAchievementId = isValidAchievementId;
exports.parseAchievementId = parseAchievementId;
exports.normalizeAchievements = normalizeAchievements;
exports.mergeAchievements = mergeAchievements;
