'use strict';

function CharacterStore(options) {
    options = options || {};
    this.postgres = options.postgres;
    this.debounceMs = Number(options.debounceMs || 300);
    this.retryMs = Number(options.retryMs || 1000);
    this.pending = new Map();
    this.inFlight = new Map();
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

CharacterStore.prototype.armFlush = function(id, delay) {
    var self = this;
    if(this.timers.has(id)) {
        clearTimeout(this.timers.get(id));
    }
    this.timers.set(id, setTimeout(function() {
        self.timers.delete(id);
        self.flush(id).catch(function(error) {
            console.error('[BrowserQuest] Falha ao persistir personagem ' + id + ':', error.message);
        });
    }, delay));
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
    this.armFlush(id, this.debounceMs);
};

CharacterStore.prototype.restorePending = function(id, patch) {
    var newer = this.pending.get(id) || {};
    if(newer.weaponKind === undefined && patch.weaponKind !== undefined) { newer.weaponKind = patch.weaponKind; }
    if(newer.armorKind === undefined && patch.armorKind !== undefined) { newer.armorKind = patch.armorKind; }
    if(newer.checkpointId === undefined && patch.checkpointId !== undefined) { newer.checkpointId = patch.checkpointId; }
    this.pending.set(id, newer);
    this.armFlush(id, this.retryMs);
};

CharacterStore.prototype.flushSnapshot = async function(characterId) {
    var id = Number(characterId), patch = this.pending.get(id), columns = [], values = [], index = 1;
    if(!patch) { return false; }

    if(this.timers.has(id)) {
        clearTimeout(this.timers.get(id));
        this.timers.delete(id);
    }
    // Remove this exact snapshot before the query. If newer state is scheduled while
    // the query is running it gets a new pending object and will not be overwritten.
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
    try {
        await this.postgres.query(
            'UPDATE characters SET ' + columns.join(', ') + ', updated_at=NOW() WHERE id=$' + index,
            values
        );
        return true;
    } catch(error) {
        this.restorePending(id, patch);
        throw error;
    }
};

// Serialize writes per character so an older slow UPDATE cannot overwrite
// a newer equipment/checkpoint snapshot that finished first.
CharacterStore.prototype.flush = function(characterId) {
    var id = Number(characterId), self = this,
        previous = this.inFlight.get(id) || Promise.resolve(),
        operation = previous.catch(function() {}).then(function() {
            return self.flushSnapshot(id);
        });
    this.inFlight.set(id, operation);
    return operation.finally(function() {
        if(self.inFlight.get(id) === operation) { self.inFlight.delete(id); }
    });
};

CharacterStore.prototype.flushAll = async function() {
    var self = this,
        ids = Array.from(new Set([...this.pending.keys(), ...this.inFlight.keys()])),
        results = await Promise.allSettled(ids.map(function(id) { return self.flush(id); })),
        errors = results.filter(function(result) { return result.status === 'rejected'; });
    if(errors.length) {
        throw new AggregateError(errors.map(function(result) { return result.reason; }), 'Falha ao persistir personagens.');
    }
    return results.map(function(result) { return result.value; });
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
