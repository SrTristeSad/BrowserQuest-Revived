'use strict';

var assert = require('assert'),
    CharacterStore = require('../server/persistence/character-store').CharacterStore;

async function main() {
    var failNext = true,
        updates = [],
        postgres = {
            query: async function(sql, values) {
                if(sql.indexOf('UPDATE characters SET') === 0) {
                    updates.push({sql: sql, values: values});
                    if(failNext) {
                        failNext = false;
                        throw new Error('temporary database failure');
                    }
                    return {rowCount: 1, rows: []};
                }
                return {rowCount: 0, rows: []};
            }
        },
        store = new CharacterStore({postgres: postgres, debounceMs: 10000, retryMs: 10000}),
        failed = false;

    store.schedule(42, {weaponKind: 60, checkpointId: 3});
    try {
        await store.flush(42);
    } catch(error) {
        failed = error.message === 'temporary database failure';
    }
    assert.strictEqual(failed, true);
    assert.deepStrictEqual(store.pending.get(42), {weaponKind: 60, checkpointId: 3});

    // A newer value wins over the restored failed snapshot.
    store.schedule(42, {weaponKind: 61, armorKind: 21});
    assert.deepStrictEqual(store.pending.get(42), {weaponKind: 61, checkpointId: 3, armorKind: 21});
    assert.strictEqual(await store.flush(42), true);
    assert.strictEqual(store.pending.has(42), false);
    assert.strictEqual(updates.length, 2);
    assert.ok(updates[1].values.indexOf(61) !== -1);
    assert.ok(updates[1].values.indexOf(21) !== -1);
    assert.ok(updates[1].values.indexOf(3) !== -1);

    console.log('Character store retry smoke tests passed.');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
