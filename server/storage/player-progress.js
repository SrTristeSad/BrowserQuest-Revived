'use strict';

function PlayerProgress(options) {
    options = options || {};
    this.postgres = options.postgres;
    if(!this.postgres) {
        throw new Error('PlayerProgress requer PostgreSQL conectado.');
    }
}

PlayerProgress.prototype.saveEquipment = async function(characterId, weaponKind, armorKind) {
    var id = Number(characterId);
    if(!Number.isInteger(id) || id <= 0) { return false; }
    await this.postgres.query(
        'UPDATE characters SET weapon_kind=$2, armor_kind=$3, updated_at=NOW(), last_seen_at=NOW() WHERE id=$1',
        [id, Number(weaponKind), Number(armorKind)]
    );
    return true;
};

PlayerProgress.prototype.saveCheckpoint = async function(characterId, checkpointId) {
    var id = Number(characterId), checkpoint = Number(checkpointId);
    if(!Number.isInteger(id) || id <= 0 || !Number.isInteger(checkpoint)) { return false; }
    await this.postgres.query(
        'UPDATE characters SET last_checkpoint_id=$2, updated_at=NOW(), last_seen_at=NOW() WHERE id=$1',
        [id, checkpoint]
    );
    return true;
};

PlayerProgress.prototype.clearCheckpoint = async function(characterId) {
    var id = Number(characterId);
    if(!Number.isInteger(id) || id <= 0) { return false; }
    await this.postgres.query(
        'UPDATE characters SET last_checkpoint_id=NULL, updated_at=NOW(), last_seen_at=NOW() WHERE id=$1',
        [id]
    );
    return true;
};

PlayerProgress.prototype.touch = async function(characterId) {
    var id = Number(characterId);
    if(!Number.isInteger(id) || id <= 0) { return false; }
    await this.postgres.query('UPDATE characters SET last_seen_at=NOW() WHERE id=$1', [id]);
    return true;
};

PlayerProgress.prototype.getFlag = async function(characterId, key) {
    var result = await this.postgres.query(
        'SELECT value FROM character_progress_flags WHERE character_id=$1 AND key=$2 LIMIT 1',
        [Number(characterId), String(key)]
    );
    return result.rowCount ? result.rows[0].value : null;
};

PlayerProgress.prototype.setFlag = async function(characterId, key, value) {
    var name = String(key || '').trim();
    if(!name || name.length > 128) { throw new Error('Progress flag key inválida.'); }
    await this.postgres.query(
        'INSERT INTO character_progress_flags(character_id,key,value) VALUES($1,$2,$3::jsonb) ON CONFLICT(character_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()',
        [Number(characterId), name, JSON.stringify(value)]
    );
    return true;
};

PlayerProgress.prototype.deleteFlag = async function(characterId, key) {
    await this.postgres.query(
        'DELETE FROM character_progress_flags WHERE character_id=$1 AND key=$2',
        [Number(characterId), String(key)]
    );
    return true;
};

PlayerProgress.prototype.listFlags = async function(characterId) {
    var result = await this.postgres.query(
        'SELECT key,value,updated_at FROM character_progress_flags WHERE character_id=$1 ORDER BY key',
        [Number(characterId)]
    ), output = {};
    result.rows.forEach(function(row) { output[row.key] = row.value; });
    return output;
};

PlayerProgress.prototype.unlockAchievement = async function(characterId, achievementId) {
    var id = Number(achievementId);
    if(!Number.isInteger(id) || id <= 0) { throw new Error('Achievement id inválido.'); }
    var result = await this.postgres.query(
        'INSERT INTO character_achievements(character_id,achievement_id) VALUES($1,$2) ON CONFLICT(character_id,achievement_id) DO NOTHING RETURNING achievement_id',
        [Number(characterId), id]
    );
    return result.rowCount > 0;
};

PlayerProgress.prototype.listAchievements = async function(characterId) {
    var result = await this.postgres.query(
        'SELECT achievement_id FROM character_achievements WHERE character_id=$1 ORDER BY achievement_id',
        [Number(characterId)]
    );
    return result.rows.map(function(row) { return Number(row.achievement_id); });
};

exports.PlayerProgress = PlayerProgress;
