'use strict';

var crypto = require('crypto'),
    normalizeStoryProgress = require('./progress-store').normalizeStoryProgress,
    AchievementProgress = require('../persistence/account-progress'),
    Types = require('../../shared/js/gametypes');

var INVENTORY_KEY = 'items',
    INVENTORY_MAX_KINDS = 200,
    INVENTORY_MAX_AMOUNT = 1000000000;

function cleanText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max || 160);
}

function normalizeAmount(value) {
    var amount = Number(value || 1);
    if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
    return Math.min(Math.floor(amount), 100000);
}

function normalizeStoredAmount(value) {
    var amount = Number(value);
    if(!Number.isFinite(amount) || amount < 1 || Math.floor(amount) !== amount || amount > 100000) { return 0; }
    return amount;
}

function rewardKey(storyId, missionId, rewardIndex) {
    var digest = crypto.createHash('sha256')
        .update(String(storyId || '') + '\u0000' + String(missionId || '') + '\u0000' + String(rewardIndex))
        .digest('hex')
        .slice(0, 48);
    return 'item-' + digest;
}

function canonicalItem(itemName) {
    var name = cleanText(itemName, 160).toLowerCase(),
        kind = name ? Types.getKindFromString(name) : undefined;
    if(kind === undefined || kind === null || !Types.isItem(kind)) { return null; }
    return {name: name, kind: kind};
}

function normalizeInventory(value) {
    value = value || {};
    var rawItems = value.items && typeof value.items === 'object' && !Array.isArray(value.items) ? value.items : {},
        items = {},
        count = 0;

    Object.keys(rawItems).sort().forEach(function(rawName) {
        var canonical,
            amount;
        if(count >= INVENTORY_MAX_KINDS) { return; }
        canonical = canonicalItem(rawName);
        amount = Number(rawItems[rawName]);
        if(!canonical || !Number.isFinite(amount) || amount <= 0) { return; }
        amount = Math.min(Math.floor(amount), INVENTORY_MAX_AMOUNT);
        if(amount < 1) { return; }
        items[canonical.name] = amount;
        count += 1;
    });

    return {
        version: 1,
        items: items,
        updatedAt: value.updatedAt ? String(value.updatedAt).slice(0, 40) : null
    };
}

function addInventoryItem(inventory, itemName, amount) {
    var normalized = normalizeInventory(inventory),
        canonical = canonicalItem(itemName),
        quantity = normalizeStoredAmount(amount),
        current;

    if(!canonical || !quantity) { return null; }
    current = Number(normalized.items[canonical.name] || 0);
    normalized.items[canonical.name] = Math.min(INVENTORY_MAX_AMOUNT, current + quantity);
    normalized.updatedAt = new Date().toISOString();
    return normalized;
}

function resolveItemReward(reward, rewardIndex) {
    if(!reward || reward.type !== 'item') { return null; }

    var itemName = cleanText(reward.value, 160).toLowerCase(),
        itemKind = itemName ? Types.getKindFromString(itemName) : undefined,
        amount = normalizeAmount(reward.amount),
        category,
        slot,
        status,
        reason = null;

    if(itemKind === undefined || itemKind === null) {
        return {
            valid: false,
            rewardIndex: rewardIndex,
            itemName: itemName,
            itemKind: null,
            amount: amount,
            status: 'invalid',
            reason: 'unknown_item'
        };
    }
    if(!Types.isItem(itemKind)) {
        return {
            valid: false,
            rewardIndex: rewardIndex,
            itemName: itemName,
            itemKind: itemKind,
            amount: amount,
            status: 'invalid',
            reason: 'not_rewardable_item'
        };
    }

    if(Types.isWeapon(itemKind)) {
        category = 'equipment';
        slot = 'weapon';
    } else if(Types.isArmor(itemKind)) {
        category = 'equipment';
        slot = 'armor';
    } else {
        category = 'object';
        slot = null;
    }

    if(category === 'equipment' && amount === 1) {
        status = 'granted';
    } else {
        status = 'pending';
        reason = category === 'equipment' ? 'equipment_quantity_requires_inventory' : 'persistent_inventory_required';
    }

    return {
        valid: true,
        rewardIndex: rewardIndex,
        itemName: itemName,
        itemKind: itemKind,
        amount: amount,
        category: category,
        slot: slot,
        status: status,
        reason: reason
    };
}

function resolveAchievementReward(reward, rewardIndex) {
    if(!reward || reward.type !== 'achievement') { return null; }
    var achievementId = AchievementProgress.parseAchievementId(reward.value);
    if(achievementId === null) {
        return {
            valid: false,
            rewardIndex: rewardIndex,
            achievementId: null,
            status: 'invalid',
            reason: 'unknown_achievement'
        };
    }
    return {
        valid: true,
        rewardIndex: rewardIndex,
        achievementId: achievementId,
        status: 'granted',
        reason: null
    };
}

async function readInventory(client, characterId, lock) {
    var result = await client.query(
        "SELECT value FROM character_progress WHERE character_id=$1 AND namespace='story_inventory' AND key=$2" + (lock ? ' FOR UPDATE' : ''),
        [Number(characterId), INVENTORY_KEY]
    );
    return normalizeInventory(result.rowCount ? result.rows[0].value : null);
}

async function writeInventory(client, characterId, inventory) {
    var normalized = normalizeInventory(inventory);
    normalized.updatedAt = new Date().toISOString();
    await client.query(
        "INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,'story_inventory',$2,$3::jsonb) ON CONFLICT(character_id, namespace, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
        [Number(characterId), INVENTORY_KEY, JSON.stringify(normalized)]
    );
    return normalized;
}

async function grantAchievementRewards(client, characterId, descriptors) {
    var valid = descriptors.filter(function(descriptor) { return descriptor.valid; }),
        results = descriptors.filter(function(descriptor) { return !descriptor.valid; }).map(function(descriptor) {
            return Object.assign({changed: false, alreadyUnlocked: false}, descriptor);
        }),
        current,
        merged,
        unlocked,
        queryResult,
        changed = false;

    if(!valid.length) {
        return {achievementRewards: results, achievements: null};
    }

    queryResult = await client.query(
        "SELECT value FROM character_progress WHERE character_id=$1 AND namespace='legacy' AND key='achievements' FOR UPDATE",
        [Number(characterId)]
    );
    current = AchievementProgress.normalizeAchievements(queryResult.rowCount ? queryResult.rows[0].value : AchievementProgress.DEFAULT_ACHIEVEMENTS);
    unlocked = current.unlocked.slice();

    valid.forEach(function(descriptor) {
        var alreadyUnlocked = unlocked.indexOf(descriptor.achievementId) >= 0;
        if(!alreadyUnlocked) {
            unlocked.push(descriptor.achievementId);
            changed = true;
        }
        results.push(Object.assign({
            changed: !alreadyUnlocked,
            alreadyUnlocked: alreadyUnlocked
        }, descriptor));
    });

    merged = AchievementProgress.normalizeAchievements({
        unlocked: unlocked,
        ratCount: current.ratCount,
        skeletonCount: current.skeletonCount,
        totalKills: current.totalKills,
        totalDmg: current.totalDmg,
        totalRevives: current.totalRevives
    });

    if(changed) {
        await client.query(
            "INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,'legacy','achievements',$2::jsonb) ON CONFLICT(character_id, namespace, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
            [Number(characterId), JSON.stringify(merged)]
        );
    }

    results.sort(function(a, b) { return a.rewardIndex - b.rewardIndex; });
    return {achievementRewards: results, achievements: merged};
}

function StoryItemRewardStore(options) {
    options = options || {};
    this.postgres = options.postgres;
    if(!this.postgres) {
        throw new Error('StoryItemRewardStore requer PostgreSQL.');
    }
}

StoryItemRewardStore.prototype.getInventory = async function(characterId) {
    var id = Number(characterId), result;
    if(!Number.isInteger(id) || id <= 0) { return normalizeInventory(null); }
    result = await this.postgres.query(
        "SELECT value FROM character_progress WHERE character_id=$1 AND namespace='story_inventory' AND key=$2 LIMIT 1",
        [id, INVENTORY_KEY]
    );
    return normalizeInventory(result.rowCount ? result.rows[0].value : null);
};

StoryItemRewardStore.prototype.materializePending = async function(characterId) {
    var id = Number(characterId),
        client,
        inventory,
        pending,
        materialized = [],
        invalid = [],
        dirty = false,
        now = new Date().toISOString();

    if(!Number.isInteger(id) || id <= 0) { throw new Error('Personagem inválido para materializar recompensas.'); }

    client = await this.postgres.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [id]);
        pending = await client.query(
            "SELECT key, value FROM character_progress WHERE character_id=$1 AND namespace='story_reward' AND value->>'status'='pending' ORDER BY key ASC FOR UPDATE",
            [id]
        );
        inventory = await readInventory(client, id, true);

        for(var i = 0; i < pending.rows.length; i += 1) {
            var row = pending.rows[i],
                receipt = row.value || {},
                canonical = canonicalItem(receipt.itemName),
                quantity = normalizeStoredAmount(receipt.amount),
                nextInventory,
                claimed;

            if(!canonical || Number(receipt.itemKind) !== canonical.kind || !quantity) {
                claimed = Object.assign({}, receipt, {
                    status: 'invalid',
                    reason: 'invalid_pending_receipt',
                    invalidAt: now
                });
                await client.query(
                    "UPDATE character_progress SET value=$1::jsonb, updated_at=NOW() WHERE character_id=$2 AND namespace='story_reward' AND key=$3",
                    [JSON.stringify(claimed), id, row.key]
                );
                invalid.push(Object.assign({key: row.key}, claimed));
                continue;
            }

            nextInventory = addInventoryItem(inventory, canonical.name, quantity);
            if(!nextInventory) { continue; }
            inventory = nextInventory;
            dirty = true;
            claimed = Object.assign({}, receipt, {
                status: 'granted',
                reason: null,
                delivery: 'inventory',
                claimedAt: now
            });
            await client.query(
                "UPDATE character_progress SET value=$1::jsonb, updated_at=NOW() WHERE character_id=$2 AND namespace='story_reward' AND key=$3",
                [JSON.stringify(claimed), id, row.key]
            );
            materialized.push(Object.assign({key: row.key}, claimed));
        }

        if(dirty) {
            inventory = await writeInventory(client, id, inventory);
        }
        await client.query('COMMIT');
        return {inventory: inventory, materialized: materialized, invalid: invalid};
    } catch(error) {
        try { await client.query('ROLLBACK'); } catch(ignore) {}
        throw error;
    } finally {
        client.release();
    }
};

StoryItemRewardStore.prototype.saveCompletionWithRewards = async function(characterId, storyId, missionId, storyState, rewards) {
    var id = Number(characterId),
        cleanStoryId = cleanText(storyId, 120),
        cleanMissionId = cleanText(missionId, 120),
        normalizedState = normalizeStoryProgress(storyState, cleanStoryId),
        rewardList = Array.isArray(rewards) ? rewards : [],
        descriptors = rewardList.map(function(reward, index) {
            return resolveItemReward(reward, index);
        }).filter(function(reward) {
            return reward !== null;
        }),
        achievementDescriptors = rewardList.map(function(reward, index) {
            return resolveAchievementReward(reward, index);
        }).filter(function(reward) {
            return reward !== null;
        }),
        client,
        results = [],
        achievementResult,
        inventory = null,
        inventoryLoaded = false,
        inventoryDirty = false,
        now = new Date().toISOString();

    if(!Number.isInteger(id) || id <= 0) { throw new Error('Personagem inválido para recompensa de missão.'); }
    if(!cleanStoryId || !cleanMissionId) { throw new Error('História ou missão inválida para recompensa.'); }

    normalizedState.storyId = cleanStoryId;
    normalizedState.updatedAt = now;
    if(!normalizedState.startedAt) { normalizedState.startedAt = now; }

    client = await this.postgres.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [id]);

        for(var i = 0; i < descriptors.length; i += 1) {
            var descriptor = descriptors[i],
                key,
                receipt,
                inserted,
                existing,
                nextInventory;

            if(!descriptor.valid) {
                results.push(Object.assign({changed: false, alreadyClaimed: false}, descriptor));
                continue;
            }

            key = rewardKey(cleanStoryId, cleanMissionId, descriptor.rewardIndex);
            receipt = {
                version: 1,
                type: 'item',
                status: descriptor.status,
                reason: descriptor.reason,
                storyId: cleanStoryId,
                missionId: cleanMissionId,
                rewardIndex: descriptor.rewardIndex,
                itemName: descriptor.itemName,
                itemKind: descriptor.itemKind,
                amount: descriptor.amount,
                category: descriptor.category,
                slot: descriptor.slot,
                createdAt: now
            };

            inserted = await client.query(
                "INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,'story_reward',$2,$3::jsonb) ON CONFLICT(character_id, namespace, key) DO NOTHING RETURNING value",
                [id, key, JSON.stringify(receipt)]
            );

            if(!inserted.rowCount) {
                existing = await client.query(
                    "SELECT value FROM character_progress WHERE character_id=$1 AND namespace='story_reward' AND key=$2 LIMIT 1",
                    [id, key]
                );
                results.push(Object.assign({
                    key: key,
                    changed: false,
                    alreadyClaimed: true
                }, existing.rowCount ? existing.rows[0].value : receipt));
                continue;
            }

            if(descriptor.status === 'granted') {
                receipt.delivery = 'equipment';
                receipt.claimedAt = now;
                await client.query(
                    "UPDATE character_progress SET value=$1::jsonb, updated_at=NOW() WHERE character_id=$2 AND namespace='story_reward' AND key=$3",
                    [JSON.stringify(receipt), id, key]
                );
                if(descriptor.slot === 'weapon') {
                    await client.query('UPDATE characters SET weapon_kind=$1, updated_at=NOW() WHERE id=$2', [descriptor.itemKind, id]);
                } else if(descriptor.slot === 'armor') {
                    await client.query('UPDATE characters SET armor_kind=$1, updated_at=NOW() WHERE id=$2', [descriptor.itemKind, id]);
                }
            } else {
                if(!inventoryLoaded) {
                    inventory = await readInventory(client, id, true);
                    inventoryLoaded = true;
                }
                nextInventory = addInventoryItem(inventory, descriptor.itemName, descriptor.amount);
                if(!nextInventory) {
                    throw new Error('Falha ao materializar recompensa de item no inventário persistente.');
                }
                inventory = nextInventory;
                inventoryDirty = true;
                receipt.status = 'granted';
                receipt.reason = null;
                receipt.delivery = 'inventory';
                receipt.claimedAt = now;
                await client.query(
                    "UPDATE character_progress SET value=$1::jsonb, updated_at=NOW() WHERE character_id=$2 AND namespace='story_reward' AND key=$3",
                    [JSON.stringify(receipt), id, key]
                );
            }

            results.push(Object.assign({
                key: key,
                changed: true,
                alreadyClaimed: false
            }, receipt));
        }

        if(inventoryDirty) {
            inventory = await writeInventory(client, id, inventory);
        } else if(!inventoryLoaded) {
            inventory = await readInventory(client, id, false);
        }

        achievementResult = await grantAchievementRewards(client, id, achievementDescriptors);

        await client.query(
            "INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,'story',$2,$3::jsonb) ON CONFLICT(character_id, namespace, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
            [id, cleanStoryId, JSON.stringify(normalizedState)]
        );

        await client.query('COMMIT');
        return {
            state: normalizedState,
            itemRewards: results,
            inventory: inventory,
            achievementRewards: achievementResult.achievementRewards,
            achievements: achievementResult.achievements
        };
    } catch(error) {
        try { await client.query('ROLLBACK'); } catch(ignore) {}
        throw error;
    } finally {
        client.release();
    }
};

StoryItemRewardStore.prototype.saveCompletionWithItemRewards = function(characterId, storyId, missionId, storyState, rewards) {
    var itemOnly = (Array.isArray(rewards) ? rewards : []).filter(function(reward) {
        return reward && reward.type === 'item';
    });
    return this.saveCompletionWithRewards(characterId, storyId, missionId, storyState, itemOnly);
};

StoryItemRewardStore.prototype.listPending = async function(characterId) {
    var id = Number(characterId);
    if(!Number.isInteger(id) || id <= 0) { return []; }
    var result = await this.postgres.query(
        "SELECT key, value FROM character_progress WHERE character_id=$1 AND namespace='story_reward' AND value->>'status'='pending' ORDER BY key ASC",
        [id]
    );
    return result.rows.map(function(row) {
        return Object.assign({key: row.key}, row.value || {});
    });
};

exports.StoryItemRewardStore = StoryItemRewardStore;
exports.INVENTORY_KEY = INVENTORY_KEY;
exports.normalizeAmount = normalizeAmount;
exports.normalizeStoredAmount = normalizeStoredAmount;
exports.normalizeInventory = normalizeInventory;
exports.addInventoryItem = addInventoryItem;
exports.rewardKey = rewardKey;
exports.resolveItemReward = resolveItemReward;
exports.resolveAchievementReward = resolveAchievementReward;
exports.grantAchievementRewards = grantAchievementRewards;
