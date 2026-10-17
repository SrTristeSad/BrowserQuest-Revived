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
        inventories = new Map(),
        characterUpdates = [],
        transactionLog = [];

    function empty() { return {rowCount: 0, rows: []}; }
    function receiptMapKey(characterId, key) { return String(characterId) + ':' + String(key); }

    async function handleQuery(sql, params) {
        sql = String(sql || '');
        params = params || [];

        if(sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.indexOf('pg_advisory_xact_lock') >= 0) {
            transactionLog.push(sql);
            return empty();
        }

        if(sql.indexOf("INSERT INTO character_progress") >= 0 && sql.indexOf("'story_reward'") >= 0) {
            var insertReceiptKey = receiptMapKey(params[0], params[1]), receiptValue = JSON.parse(params[2]);
            if(receipts.has(insertReceiptKey)) { return empty(); }
            receipts.set(insertReceiptKey, receiptValue);
            return {rowCount: 1, rows: [{value: receiptValue}]};
        }

        if(sql.indexOf("SELECT value FROM character_progress") >= 0 && sql.indexOf("namespace='story_reward'") >= 0 && sql.indexOf('key=$2') >= 0) {
            var existing = receipts.get(receiptMapKey(params[0], params[1]));
            return existing ? {rowCount: 1, rows: [{value: existing}]} : empty();
        }

        if(sql.indexOf("SELECT key, value FROM character_progress") >= 0 && sql.indexOf("namespace='story_reward'") >= 0 && sql.indexOf("value->>'status'='pending'") >= 0) {
            var prefix = String(params[0]) + ':', pendingRows = [];
            receipts.forEach(function(value, storedKey) {
                if(storedKey.indexOf(prefix) !== 0 || !value || value.status !== 'pending') { return; }
                pendingRows.push({key: storedKey.slice(prefix.length), value: value});
            });
            pendingRows.sort(function(a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
            return {rowCount: pendingRows.length, rows: pendingRows};
        }

        if(sql.indexOf("UPDATE character_progress SET value=") === 0 && sql.indexOf("namespace='story_reward'") >= 0) {
            var updatedReceipt = JSON.parse(params[0]);
            receipts.set(receiptMapKey(params[1], params[2]), updatedReceipt);
            return {rowCount: 1, rows: []};
        }

        if(sql.indexOf("SELECT value FROM character_progress") >= 0 && sql.indexOf("namespace='story_inventory'") >= 0) {
            var inventory = inventories.get(Number(params[0]));
            return inventory ? {rowCount: 1, rows: [{value: inventory}]} : empty();
        }

        if(sql.indexOf("INSERT INTO character_progress") >= 0 && sql.indexOf("'story_inventory'") >= 0) {
            var inventoryValue = JSON.parse(params[2]);
            inventories.set(Number(params[0]), inventoryValue);
            return {rowCount: 1, rows: []};
        }

        if(sql.indexOf('UPDATE characters SET weapon_kind=') === 0) {
            characterUpdates.push({slot: 'weapon', kind: Number(params[0]), characterId: Number(params[1])});
            return {rowCount: 1, rows: []};
        }

        if(sql.indexOf('UPDATE characters SET armor_kind=') === 0) {
            characterUpdates.push({slot: 'armor', kind: Number(params[0]), characterId: Number(params[1])});
            return {rowCount: 1, rows: []};
        }

        if(sql.indexOf("INSERT INTO character_progress") >= 0 && sql.indexOf("'story'") >= 0) {
            stories.set(String(params[1]), JSON.parse(params[2]));
            return {rowCount: 1, rows: []};
        }

        throw new Error('Unexpected fake PostgreSQL query: ' + sql);
    }

    return {
        receipts: receipts,
        stories: stories,
        inventories: inventories,
        characterUpdates: characterUpdates,
        transactionLog: transactionLog,
        receiptMapKey: receiptMapKey,
        connect: async function() {
            return {
                query: handleQuery,
                release: function() {}
            };
        },
        query: handleQuery
    };
}

function createQueuedPlayer(postgres) {
    return {
        id: 501,
        name: 'InventoryTester',
        type: 'player',
        characterId: 77,
        storyProgress: {postgres: postgres},
        storyInventory: null,
        storyOperationChain: Promise.resolve(),
        queueStoryOperation: function(operation) {
            var previous = this.storyOperationChain || Promise.resolve(),
                run = previous.catch(function() { return null; }).then(operation);
            this.storyOperationChain = run.catch(function() { return null; });
            return run;
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
        inventory,
        legacyKey,
        legacyPending,
        materialized,
        corruptKey,
        reconnectStore,
        reconnectPlayer,
        observedAfterRecovery,
        runtime,
        progressSaveCalls = 0,
        completion,
        fakePlayer,
        applied;

    assert.deepStrictEqual(ItemRewardModule.normalizeInventory({items: {flask: 2, chest: 7, missing: 3}}).items, {flask: 2});
    assert.strictEqual(ItemRewardModule.normalizeStoredAmount(3), 3);
    assert.strictEqual(ItemRewardModule.normalizeStoredAmount(0), 0);
    assert.strictEqual(ItemRewardModule.normalizeStoredAmount(100001), 0);
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'sword2', amount: 1}, 0).status, 'granted');
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'flask', amount: 1}, 1).status, 'pending');
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'goldensword', amount: 2}, 2).reason, 'equipment_quantity_requires_inventory');
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'chest', amount: 1}, 3).valid, false);
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'item', value: 'missing-item', amount: 1}, 4).reason, 'unknown_item');
    assert.strictEqual(ItemRewardModule.resolveItemReward({type: 'story_flag', value: 'x', amount: 1}, 5), null);

    first = await store.saveCompletionWithItemRewards(77, 'story-rewards', 'mission-one', state, rewards);
    assert.strictEqual(first.itemRewards.length, 5, 'only item rewards should enter the item reward pipeline');
    assert.strictEqual(first.itemRewards[0].status, 'granted');
    assert.strictEqual(first.itemRewards[0].delivery, 'equipment');
    assert.strictEqual(first.itemRewards[1].status, 'granted', 'consumables must become persistent owned inventory instead of world loot');
    assert.strictEqual(first.itemRewards[1].delivery, 'inventory');
    assert.strictEqual(first.itemRewards[2].status, 'granted', 'multi-quantity equipment must become persistent inventory ownership');
    assert.strictEqual(first.itemRewards[2].delivery, 'inventory');
    assert.strictEqual(first.itemRewards[3].status, 'invalid');
    assert.strictEqual(first.itemRewards[4].status, 'invalid');
    assert.strictEqual(postgres.receipts.size, 3, 'only valid canonical items receive durable receipts');
    assert.deepStrictEqual(postgres.characterUpdates, [{slot: 'weapon', kind: Types.Entities.SWORD2, characterId: 77}], 'single equipment reward must still persist directly to the character slot');
    assert.deepStrictEqual(first.inventory.items, {flask: 3, goldensword: 2});
    assert.deepStrictEqual(postgres.inventories.get(77).items, {flask: 3, goldensword: 2}, 'owned item quantities must be persisted server-side');
    assert.strictEqual(postgres.stories.get('story-rewards').completedMissionIds[0], 'mission-one');

    second = await store.saveCompletionWithItemRewards(77, 'story-rewards', 'mission-one', state, rewards);
    assert.strictEqual(second.itemRewards[0].alreadyClaimed, true, 'replaying a receipt must not grant equipment twice');
    assert.strictEqual(second.itemRewards[1].alreadyClaimed, true, 'replaying a receipt must not increment inventory twice');
    assert.deepStrictEqual(second.inventory.items, {flask: 3, goldensword: 2});
    assert.strictEqual(postgres.characterUpdates.length, 1);

    pending = await store.listPending(77);
    assert.strictEqual(pending.length, 0, 'new rewards supported by persistent inventory must not remain pending');

    legacyKey = ItemRewardModule.rewardKey('legacy-story', 'legacy-mission', 0);
    legacyPending = {
        version: 1,
        type: 'item',
        status: 'pending',
        reason: 'persistent_inventory_required',
        storyId: 'legacy-story',
        missionId: 'legacy-mission',
        rewardIndex: 0,
        itemName: 'burger',
        itemKind: Types.Entities.BURGER,
        amount: 2,
        category: 'object',
        slot: null
    };
    postgres.receipts.set(postgres.receiptMapKey(77, legacyKey), legacyPending);
    materialized = await store.materializePending(77);
    assert.strictEqual(materialized.materialized.length, 1, 'legacy pending receipt must be materialized on recovery');
    assert.strictEqual(materialized.inventory.items.burger, 2);
    assert.strictEqual(postgres.receipts.get(postgres.receiptMapKey(77, legacyKey)).status, 'granted');
    assert.strictEqual(postgres.receipts.get(postgres.receiptMapKey(77, legacyKey)).delivery, 'inventory');

    materialized = await store.materializePending(77);
    assert.strictEqual(materialized.materialized.length, 0, 'retry must not materialize an already claimed receipt again');
    assert.strictEqual(materialized.inventory.items.burger, 2);

    corruptKey = ItemRewardModule.rewardKey('legacy-story', 'corrupt-mission', 0);
    postgres.receipts.set(postgres.receiptMapKey(77, corruptKey), Object.assign({}, legacyPending, {
        missionId: 'corrupt-mission',
        itemKind: Types.Entities.SWORD1
    }));
    materialized = await store.materializePending(77);
    assert.strictEqual(materialized.invalid.length, 1, 'corrupted pending receipt must be quarantined instead of granted');
    assert.strictEqual(postgres.receipts.get(postgres.receiptMapKey(77, corruptKey)).status, 'invalid');
    assert.strictEqual(materialized.inventory.items.burger, 2);

    reconnectStore = new StoryItemRewardStore({postgres: postgres});
    inventory = await reconnectStore.getInventory(77);
    assert.deepStrictEqual(inventory.items, {burger: 2, flask: 3, goldensword: 2}, 'a new store instance must reload inventory after reconnect/restart');

    legacyKey = ItemRewardModule.rewardKey('legacy-story', 'reconnect-mission', 0);
    postgres.receipts.set(postgres.receiptMapKey(77, legacyKey), Object.assign({}, legacyPending, {
        missionId: 'reconnect-mission',
        itemName: 'cake',
        itemKind: Types.Entities.CAKE,
        amount: 4
    }));
    reconnectPlayer = createQueuedPlayer(postgres);
    StoryCompletionDialogue.loadStoryInventory(reconnectPlayer);
    observedAfterRecovery = reconnectPlayer.queueStoryOperation(function() {
        return reconnectPlayer.storyInventory.items.cake;
    });
    assert.strictEqual(await observedAfterRecovery, 4, 'subsequent Story Runtime operations must wait for reconnect inventory recovery');
    assert.strictEqual(reconnectPlayer.storyInventory.items.flask, 3);
    assert.strictEqual((await store.listPending(77)).length, 0);

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
            postgres: postgres,
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
        states: [{storyId: 'story-armor', activeMissionId: 'armor-reward', objectiveProgress: 1, completedMissionIds: [], flags: {ready: true}}]
    });
    assert.strictEqual(completion.changed, true);
    assert.strictEqual(progressSaveCalls, 0);
    assert.strictEqual(completion.itemRewards[0].delivery, 'equipment');
    assert.strictEqual(completion.inventory.items.cake, 4, 'mission completion must return current persistent inventory to the live bridge');

    fakePlayer = {
        equipped: [],
        sent: [],
        broadcasted: [],
        equipItem: function(item) { this.equipped.push(item.kind); },
        equip: function(kind) { return {kind: kind, serialize: function() { return [Types.Messages.EQUIP, 501, kind]; }}; },
        send: function(message) { this.sent.push(message); },
        broadcast: function(message) { this.broadcasted.push(message.kind); }
    };
    applied = StoryCompletionDialogue.applyGrantedItemRewards(fakePlayer, completion.itemRewards.concat([{changed: true, status: 'granted', category: 'equipment', delivery: 'inventory', slot: 'weapon', itemKind: Types.Entities.GOLDENSWORD}]));
    assert.deepStrictEqual(applied, [Types.Entities.REDARMOR], 'inventory-owned equipment must not auto-equip');
    assert.deepStrictEqual(fakePlayer.equipped, [Types.Entities.REDARMOR]);

    assert.ok(rewardSource.indexOf("'story_inventory'") !== -1, 'owned rewards must use durable character_progress inventory');
    assert.ok(rewardSource.indexOf('materializePending') !== -1, 'legacy pending receipts need an idempotent recovery path');
    assert.ok(rewardSource.indexOf('pg_advisory_xact_lock') !== -1, 'inventory and receipt mutation must serialize per character');
    assert.strictEqual(rewardSource.indexOf('createItem('), -1, 'story rewards must never spawn public loot');
    assert.strictEqual(rewardSource.indexOf('addItem('), -1, 'story rewards must never become stealable world loot');
    assert.strictEqual(rewardSource.indexOf('regenHealthBy'), -1, 'persisting ownership must not auto-consume healing items');
    assert.strictEqual(rewardSource.indexOf('firepotionTimeout'), -1, 'persisting ownership must not auto-consume firepotion effects');
    assert.ok(missionCompletionSource.indexOf('inventory: rewardResult ? rewardResult.inventory : null') !== -1);
    assert.ok(completionSource.indexOf('player.storyInventory = completion.inventory') !== -1, 'live player state must receive committed inventory');
    assert.ok(completionSource.indexOf('loadStoryInventory(player)') !== -1, 'player enter hook must recover persistent inventory');

    console.log('Story item reward persistent inventory and reconnect recovery smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
