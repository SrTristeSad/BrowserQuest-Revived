'use strict';

function CharacterStore(options) {
    options = options || {};
    this.postgres = options.postgres;
    this.debounceMs = Number(options.debounceMs || 300);
    this.pending = new Map();
    this.timers = new Map();
    if(!this.postgres) {
        throw new Error('CharacterStore requer o pool PostgreSQL.');
    }
}

CharacterStore.prototype.load = async function(characterId) {
    var result = await this.postgres.query(
        'SELECT id, weapon_kind, armor_kind, checkpoint_id FROM characters WHERE id=$1 LIMIT 1',
        [Number(characterId)]
    );
    if(!result.rowCount) { return null; }
    return {
        id: Number(result.rows[0].id),
        weaponKind: result.rows[0].weapon_kind === null ? null : Number(result.rows[0].weapon_kind),
        armorKind: result.rows[0].armor_kind === null ? null : Number(result.rows[0].armor_kind),
        checkpointId: result.rows[0].checkpoint_id === null ? null : Number(result.rows[0].checkpoint_id)
    };
};

CharacterStore.prototype.schedule = function(characterId, patch) {
    var id = Number(characterId), current;
    if(!Number.isInteger(id) || id <= 0 || !patch) { return; }

    current = this.pending.get(id) || {};
    if(patch.weaponKind !== undefined) { current.weaponKind = Number(patch.weaponKind); }
    if(patch.armorKind !== undefined) { current.armorKind = Number(patch.armorKind); }
    if(patch.checkpointId !== undefined) {
        current.checkpointId = patch.checkpointId === null ? null : Number(patch.checkpointId);
    }
    this.pending.set(id, current);

    if(this.timers.has(id)) {
        clearTimeout(this.timers.get(id));
    }
    var self = this;
    this.timers.set(id, setTimeout(function() {
        self.timers.delete(id);
        self.flush(id).catch(function(error) {
            console.error('[BrowserQuest] Falha ao persistir personagem ' + id + ':', error.message);
        });
    }, this.debounceMs));
};

CharacterStore.prototype.flush = async function(characterId) {
    var id = Number(characterId), patch = this.pending.get(id), columns = [], values = [], index = 1;
    if(!patch) { return false; }

    if(this.timers.has(id)) {
        clearTimeout(this.timers.get(id));
        this.timers.delete(id);
    }
    this.pending.delete(id);

    if(patch.weaponKind !== undefined && Number.isInteger(patch.weaponKind)) {
        columns.push('weapon_kind=$' + index++);
        values.push(patch.weaponKind);
    }
    if(patch.armorKind !== undefined && Number.isInteger(patch.armorKind)) {
        columns.push('armor_kind=$' + index++);
        values.push(patch.armorKind);
    }
    if(patch.checkpointId !== undefined && (patch.checkpointId === null || Number.isInteger(patch.checkpointId))) {
        columns.push('checkpoint_id=$' + index++);
        values.push(patch.checkpointId);
    }
    if(!columns.length) { return false; }

    values.push(id);
    await this.postgres.query(
        'UPDATE characters SET ' + columns.join(', ') + ', updated_at=NOW() WHERE id=$' + index,
        values
    );
    return true;
};

CharacterStore.prototype.flushAll = async function() {
    var ids = Array.from(this.pending.keys()), results = [];
    for(var i = 0; i < ids.length; i += 1) {
        results.push(await this.flush(ids[i]));
    }
    return results;
};

CharacterStore.prototype.getProgress = async function(characterId, namespace, key) {
    var result = await this.postgres.query(
        'SELECT value FROM character_progress WHERE character_id=$1 AND namespace=$2 AND key=$3 LIMIT 1',
        [Number(characterId), String(namespace), String(key)]
    );
    return result.rowCount ? result.rows[0].value : null;
};

CharacterStore.prototype.setProgress = async function(characterId, namespace, key, value) {
    await this.postgres.query(
        'INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(character_id, namespace, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()',
        [Number(characterId), String(namespace), String(key), JSON.stringify(value)]
    );
};

exports.CharacterStore = CharacterStore;
