'use strict';

var crypto = require('crypto'),
    normalizeStoryProgress = require('./progress-store').normalizeStoryProgress,
    Types = require('../../shared/js/gametypes');

function cleanText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max || 160);
}

function normalizeAmount(value) {
    var amount = Number(value || 1);
    if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
    return Math.min(Math.floor(amount), 100000);
}

function rewardKey(storyId, missionId, rewardIndex) {
    var digest = crypto.createHash('sha256')
        .update(String(storyId || '') + '\u0000' + String(missionId || '') + '\u0000' + String(rewardIndex))
        .digest('hex')
        .slice(0, 48);
    return 'item-' + digest;
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

function StoryItemRewardStore(options) {
    options = options || {};
    this.postgres = options.postgres;
    if(!this.postgres) {
        throw new Error('StoryItemRewardStore requer PostgreSQL.');
    }
}

StoryItemRewardStore.prototype.saveCompletionWithItemRewards = async function(characterId, storyId, missionId, storyState, rewards) {
    var id = Number(characterId),
        cleanStoryId = cleanText(storyId, 120),
        cleanMissionId = cleanText(missionId, 120),
        normalizedState = normalizeStoryProgress(storyState, cleanStoryId),
        descriptors = (Array.isArray(rewards) ? rewards : []).map(function(reward, index) {
            return resolveItemReward(reward, index);
        }).filter(function(reward) {
            return reward !== null;
        }),
        client,
        results = [],
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
                existing;

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
                if(descriptor.slot === 'weapon') {
                    await client.query('UPDATE characters SET weapon_kind=$1, updated_at=NOW() WHERE id=$2', [descriptor.itemKind, id]);
                } else if(descriptor.slot === 'armor') {
                    await client.query('UPDATE characters SET armor_kind=$1, updated_at=NOW() WHERE id=$2', [descriptor.itemKind, id]);
                }
            }

            results.push(Object.assign({
                key: key,
                changed: true,
                alreadyClaimed: false
            }, receipt));
        }

        await client.query(
            "INSERT INTO character_progress(character_id, namespace, key, value) VALUES($1,'story',$2,$3::jsonb) ON CONFLICT(character_id, namespace, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
            [id, cleanStoryId, JSON.stringify(normalizedState)]
        );

        await client.query('COMMIT');
        return {state: normalizedState, itemRewards: results};
    } catch(error) {
        try { await client.query('ROLLBACK'); } catch(ignore) {}
        throw error;
    } finally {
        client.release();
    }
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
exports.normalizeAmount = normalizeAmount;
exports.rewardKey = rewardKey;
exports.resolveItemReward = resolveItemReward;
