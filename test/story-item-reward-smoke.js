'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    MissionCompletion = require('../server/story/mission-completion'),
    StoryCompletionDialogue = require('../server/story/completion-dialogue'),
    StoryItemRewardStore = require('../server/story/item-reward-store').StoryItemRewardStore,
    ItemRewardModule = require('../server/story/item-reward-store'),
    Types = require('../shared/js/gametypes');

function createFakePostgres() {
    var receipts = new Map(),
        stories = new Map(),
        characterUpdates = [],
        transactionLog = [];

    function empty() { return {rowCount: 0, rows: []}; }

    function handleQuery(sql, params) {
        sql = String(sql || '');
        params = params || [];

        if(sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.indexOf('pg_advisory_xact_lock') >= 0) {
            transactionLog.push(sql);
            return Promise.resolve(empty());
        }

        if(sql.indexOf("INSERT INTO character_progress") >= 0 && sql.indexOf("'story_reward'") >= 0) {
            var receiptKey = String(params[1]), receiptValue = JSON.parse(params[2]);
            if(receipts.has(receiptKey)) { return Promise.resolve(empty()); }
            receipts.set(receiptKey, receiptValue);
            return Promise.resolve({rowCount: 1, rows: [{value: receiptValue}]});
        }

        if(sql.indexOf("SELECT value FROM character_progress") >= 0 && sql.indexOf("namespace='story_reward'") >= 0 && sql.indexOf("key=$2") >= 0) {
            var existing = receipts.get(String(params[1]));
            return Promise.resolve(existing ? {rowCount: 1, rows: [{value: existing}]} : empty());
        }

        if(sql.indexOf('UPDATE characters SET weapon_kind=') === 0) {
            characterUpdates.push({slot: 'weapon', kind: Number(params[0]), characterId: Number(params[1])});
            return Promise.resolve({rowCount: 1, rows: []});
        }

        if(sql.indexOf('UPDATE characters SET armor_kind=') === 0) {
            characterUpdates.push({slot: 'armor', kind: Number(params[0]), characterId: Number(params[1])});
            return Promise.resolve({rowCount: 1, rows: []});
        }

        if(sql.indexOf("INSERT INTO character_progress") >= 0 && sql.indexOf("'story'") >= 0) {
            stories.set(String(params[1]), JSON.parse(params[2]));
            return Promise.resolve({rowCount: 1, rows: []});
        }

        throw new Error('Unexpected fake PostgreSQL query: ' + sql);
    }

    return {
        receipts: receipts,
        stories: stories,
        characterUpdates: characterUpdates,
        transactionLog: transactionLog,
        connect: async function() {
            return {
                query: handleQuery,
                release: function() {}
            };
        },
        query: async function(sql, params) {
            sql = String(sql || '');
            if(sql.indexOf("namespace='story_reward'") >= 0 && sql.indexOf("value->>'status'='pending'") >= 0) {
                var rows = [];
                receipts.forEach(function(value, key) {
                    if(value && value.status === 'pending') { rows.push({key: key, value: value}); }
                });
                rows.sort(function(a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
                return {rowCount: rows.length, rows: rows};
            }
            return handleQuery(sql, params);
        }
    };
}

async function main() {
    var root = path.join(__dirname, '..'),
        rewardSource = fs.readFileSync(path.join(root, 'server', 'story', 'item-reward-store.js'), 'utf8'),
        completionSource = fs.readFileSync(path.join(root, 'server', 'story', 'completion-dialogue.js'), 'utf8'),
        missionCompletionSource = fs.readFileSync(path.join(root, 'server', 'story', 'mission-completion.js'), 'utf8'),
        postgres = createFakePostgres(),
        store = new StoryItemRewardStore({postgres: postgres}),
        state = {
            version: 1,
            storyId: 'story-rewards',
            activeMissionId: '',
            objectiveProgress: 0,
            completedMissionIds: ['mission-one'],
            flags: {gateOpen: true},
            startedAt: '2026-10-17T00:00:00.000Z'
        },
        rewards = [
            {type: 'item', value: 'sword2', amount: 1},
            {type: 'item', value: 'flask', amount: 3},
            {type: 'item', value: 'goldensword', amount: 2},
            {type: 'item', value: 'chest', amount: 1},
            {type: 'item', value: 'missing-item', amount: 1},
            {type: 'achievement', value: '1', amount: 1}
        ],
        first,
        second,
        pending,
        runtime,
        progressSaveCalls = 0,
        completion,
        fakePlayer,
        applied;

    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'sword2', amount: 1}, 0).status, 'granted');
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'flask', amount: 1}, 1).status, 'pending');
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'goldensword', amount: 2}, 2).reason, 'equipment_quantity_requires_inventory');
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'chest', amount: 1}, 3).valid, false);
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'missing-item', amount: 1}, 4).reason, 'unknown_item');
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'story_flag', value: 'x', amount: 1}, 5), null);
    assert.strictEqual(ItemRewardModule.rewardKey('a', 'b', 0), ItemRewardModule.rewardKey('a', 'b', 0), 'receipt keys must be deterministic');
    assert.notStrictEqual(ItemRewardModule.rewardKey('a', 'b', 0), ItemRewardModule.rewardKey('a', 'b', 1), 'each reward index needs an independent receipt');

    first = await store.saveCompletionWithItemRewards(77, 'story-rewards', 'mission-one', state, rewards);
    assert.strictEqual(first.itemRewards.length, 5, 'only item rewards should enter the item reward pipeline');
    assert.strictEqual(first.itemRewards[0].status, 'granted');
    assert.strictEqual(first.itemRewards[0].changed, true);
    assert.strictEqual(first.itemRewards[1].status, 'pending', 'consumables must remain durable pending rewards instead of world loot');
    assert.strictEqual(first.itemRewards[2].status, 'pending', 'multi-quantity equipment needs inventory instead of silent duplication');
    assert.strictEqual(first.itemRewards[3].status, 'invalid');
    assert.strictEqual(first.itemRewards[4].status, 'invalid');
    assert.strictEqual(postgres.receipts.size, 3, 'only valid canonical items receive durable receipts');
    assert.deepStrictEqual(postgres.characterUpdates, [{slot: 'weapon', kind: Types.Entities.SWORD2, characterId: 77}], 'single equipment reward must be persisted directly to the character slot');
    assert.strictEqual(postgres.stories.get('story-rewards').completedMissionIds[0], 'mission-one', 'story completion state must be committed by the same store');
    assert.ok(postgres.transactionLog.indexOf('BEGIN') >= 0 && postgres.transactionLog.indexOf('COMMIT') >= 0, 'reward and mission completion must share a PostgreSQL transaction');

    second = await store.saveCompletionWithItemRewards(77, 'story-rewards', 'mission-one', state, rewards);
    assert.strictEqual(second.itemRewards[0].alreadyClaimed, true, 'replaying a reward receipt must not grant equipment twice');
    assert.strictEqual(second.itemRewards[0].changed, false);
    assert.strictEqual(postgres.characterUpdates.length, 1, 'duplicate receipt must not update equipment a second time');
    assert.strictEqual(postgres.receipts.size, 3);

    pending = await store.listPending(77);
    assert.strictEqual(pending.length, 2, 'unsupported consumable/object semantics must remain durably pending');
    assert.ok(pending.some(function(entry) { return entry.itemName === 'flask' && entry.amount === 3; }));
    assert.ok(pending.some(function(entry) { return entry.itemName === 'goldensword' && entry.amount === 2; }));

    runtime = {
        getMission: function(storyId, missionId) {
            if(storyId === 'story-armor' && missionId === 'armor-reward') {
                return {
                    storyId: storyId,
                    chapterId: 'chapter-one',
                    mission: {
                        id: missionId,
                        giverNpc: 'captain',
                        objective: {type: 'talk', target: 'captain', amount: 1},
                        rewards: [{type: 'item', value: 'redarmor', amount: 1}]
                    }
                };
            }
            return null;
        }
    };

    completion = await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: {
            save: async function() {
                progressSaveCalls += 1;
                throw new Error('normal StoryProgressStore.save must be bypassed by the atomic reward store');
            }
        },
        itemRewardStore: store,
        characterId: 77,
        storyId: 'story-armor',
        missionId: 'armor-reward',
        giverProfileId: 'captain',
        states: [{
            storyId: 'story-armor',
            activeMissionId: 'armor-reward',
            objectiveProgress: 1,
            completedMissionIds: [],
            flags: {ready: true}
        }]
    });
    assert.strictEqual(completion.changed, true);
    assert.strictEqual(progressSaveCalls, 0, 'mission completion must not perform a second non-atomic story write');
    assert.strictEqual(completion.itemRewards.length, 1);
    assert.strictEqual(completion.itemRewards[0].status, 'granted');
    assert.strictEqual(postgres.characterUpdates[1].slot, 'armor');
    assert.strictEqual(postgres.characterUpdates[1].kind, Types.Entities.REDARMOR);
    assert.ok(completion.state.completedMissionIds.indexOf('armor-reward') >= 0);

    fakePlayer = {
        equipped: [],
        sent: [],
        broadcasted: [],
        equipItem: function(item) { this.equipped.push(item.kind); },
        equip: function(kind) {
            return {kind: kind, serialize: function() { return [Types.Messages.EQUIP, 501, kind]; }};
        },
        send: function(message) { this.sent.push(message); },
        broadcast: function(message) { this.broadcasted.push(message.kind); }
    };
    applied = StoryCompletionDialogue.applyGrantedItemRewards(fakePlayer, completion.itemRewards);
    assert.deepStrictEqual(applied, [Types.Entities.REDARMOR]);
    assert.deepStrictEqual(fakePlayer.equipped, [Types.Entities.REDARMOR], 'granted equipment must update authoritative in-memory player equipment');
    assert.strictEqual(fakePlayer.sent.length, 1, 'server-triggered equipment reward must explicitly synchronize the receiving client');
    assert.deepStrictEqual(fakePlayer.broadcasted, [Types.Entities.REDARMOR], 'nearby clients must receive the equipment visual update');

    assert.ok(rewardSource.indexOf("namespace, key, value) VALUES($1,'story_reward'") !== -1, 'item rewards must use durable character_progress receipts');
    assert.ok(rewardSource.indexOf("value->>'status'='pending'") !== -1, 'pending object rewards must remain queryable for later delivery');
    assert.ok(rewardSource.indexOf('pg_advisory_xact_lock') !== -1, 'mission reward transaction must serialize per character');
    assert.ok(rewardSource.indexOf('UPDATE characters SET weapon_kind=') !== -1);
    assert.ok(rewardSource.indexOf('UPDATE characters SET armor_kind=') !== -1);
    assert.ok(rewardSource.indexOf("namespace, key, value) VALUES($1,'story',$2") !== -1, 'story completion must be committed in the same transaction as reward receipts');
    assert.strictEqual(rewardSource.indexOf('createItem('), -1, 'story item rewards must not spawn loot entities');
    assert.strictEqual(rewardSource.indexOf('addItem('), -1, 'story item rewards must not become stealable world loot');
    assert.ok(missionCompletionSource.indexOf('saveCompletionWithItemRewards') !== -1, 'mission completion must delegate atomic persistence to the reward store');
    assert.ok(completionSource.indexOf('applyGrantedItemRewards(player, completion.itemRewards') !== -1, 'completion bridge must apply only committed equipment rewards to live player state');

    console.log('Story item reward receipt and equipment grant smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
