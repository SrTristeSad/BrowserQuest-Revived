'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path'),
    AchievementProgress = require('../server/persistence/account-progress'),
    MissionCompletion = require('../server/story/mission-completion'),
    RewardModule = require('../server/story/item-reward-store'),
    StoryItemRewardStore = RewardModule.StoryItemRewardStore;

function createFakePostgres() {
    var achievements = new Map(),
        stories = new Map(),
        inventories = new Map(),
        receipts = new Map(),
        achievementWrites = 0,
        transactionLog = [];

    function empty() { return {rowCount: 0, rows: []}; }
    function receiptKey(characterId, key) { return String(characterId) + ':' + String(key); }

    async function query(sql, params) {
        sql = String(sql || '');
        params = params || [];

        if(sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.indexOf('pg_advisory_xact_lock') >= 0) {
            transactionLog.push(sql);
            return empty();
        }
        if(sql.indexOf("namespace='legacy'") >= 0 && sql.indexOf("key='achievements'") >= 0 && sql.indexOf('SELECT value') === 0) {
            var storedAchievements = achievements.get(Number(params[0]));
            return storedAchievements ? {rowCount: 1, rows: [{value: storedAchievements}]} : empty();
        }
        if(sql.indexOf("VALUES($1,'legacy','achievements'") >= 0) {
            achievementWrites += 1;
            achievements.set(Number(params[0]), JSON.parse(params[1]));
            return {rowCount: 1, rows: []};
        }
        if(sql.indexOf("namespace='story_inventory'") >= 0 && sql.indexOf('SELECT value') === 0) {
            var inventory = inventories.get(Number(params[0]));
            return inventory ? {rowCount: 1, rows: [{value: inventory}]} : empty();
        }
        if(sql.indexOf("VALUES($1,'story_inventory'") >= 0) {
            inventories.set(Number(params[0]), JSON.parse(params[2]));
            return {rowCount: 1, rows: []};
        }
        if(sql.indexOf("VALUES($1,'story_reward'") >= 0) {
            var key = receiptKey(params[0], params[1]);
            if(receipts.has(key)) { return empty(); }
            var value = JSON.parse(params[2]);
            receipts.set(key, value);
            return {rowCount: 1, rows: [{value: value}]};
        }
        if(sql.indexOf("namespace='story_reward'") >= 0 && sql.indexOf('SELECT value') === 0) {
            var existing = receipts.get(receiptKey(params[0], params[1]));
            return existing ? {rowCount: 1, rows: [{value: existing}]} : empty();
        }
        if(sql.indexOf("UPDATE character_progress SET value=") === 0 && sql.indexOf("namespace='story_reward'") >= 0) {
            receipts.set(receiptKey(params[1], params[2]), JSON.parse(params[0]));
            return {rowCount: 1, rows: []};
        }
        if(sql.indexOf("VALUES($1,'story',$2") >= 0) {
            stories.set(String(params[1]), JSON.parse(params[2]));
            return {rowCount: 1, rows: []};
        }
        if(sql.indexOf('UPDATE characters SET ') === 0) {
            return {rowCount: 1, rows: []};
        }

        throw new Error('Unexpected fake PostgreSQL query: ' + sql);
    }

    return {
        achievements: achievements,
        stories: stories,
        inventories: inventories,
        receipts: receipts,
        transactionLog: transactionLog,
        get achievementWrites() { return achievementWrites; },
        connect: async function() {
            return {query: query, release: function() {}};
        },
        query: query
    };
}

async function main() {
    var root = path.join(__dirname, '..'),
        accountSource = fs.readFileSync(path.join(root, 'server', 'persistence', 'account-progress.js'), 'utf8'),
        rewardSource = fs.readFileSync(path.join(root, 'server', 'story', 'item-reward-store.js'), 'utf8'),
        completionSource = fs.readFileSync(path.join(root, 'server', 'story', 'mission-completion.js'), 'utf8'),
        postgres = createFakePostgres(),
        store = new StoryItemRewardStore({postgres: postgres}),
        initialAchievements = {
            unlocked: [3],
            ratCount: 7,
            skeletonCount: 4,
            totalKills: 23,
            totalDmg: 1234,
            totalRevives: 2
        },
        state = {
            storyId: 'achievement-story',
            activeMissionId: '',
            objectiveProgress: 0,
            completedMissionIds: ['reward-mission'],
            flags: {gateOpen: true}
        },
        rewards = [
            {type: 'achievement', value: '17', amount: 99},
            {type: 'achievement', value: '3', amount: 2},
            {type: 'achievement', value: '17', amount: 1},
            {type: 'achievement', value: '21', amount: 1},
            {type: 'achievement', value: '1x', amount: 1}
        ],
        first,
        second,
        runtime,
        completion;

    assert.deepStrictEqual(AchievementProgress.ACHIEVEMENT_IDS, Array.from({length: 20}, function(_, index) { return index + 1; }));
    assert.strictEqual(AchievementProgress.parseAchievementId('1'), 1);
    assert.strictEqual(AchievementProgress.parseAchievementId('20'), 20);
    assert.strictEqual(AchievementProgress.parseAchievementId('0'), null);
    assert.strictEqual(AchievementProgress.parseAchievementId('21'), null);
    assert.strictEqual(AchievementProgress.parseAchievementId('1x'), null);
    assert.strictEqual(AchievementProgress.parseAchievementId('1.5'), null);

    assert.strictEqual(RewardModule.resolveAchievementReward({type: 'achievement', value: '17', amount: 999}, 0).achievementId, 17, 'reward.amount must not repeat an achievement');
    assert.strictEqual(RewardModule.resolveAchievementReward({type: 'achievement', value: '21'}, 1).valid, false);
    assert.strictEqual(RewardModule.resolveAchievementReward({type: 'item', value: 'sword1'}, 2), null);

    postgres.achievements.set(77, initialAchievements);
    first = await store.saveCompletionWithRewards(77, 'achievement-story', 'reward-mission', state, rewards);
    assert.strictEqual(first.achievementRewards.length, 5);
    assert.strictEqual(first.achievementRewards[0].achievementId, 17);
    assert.strictEqual(first.achievementRewards[0].changed, true);
    assert.strictEqual(first.achievementRewards[1].achievementId, 3);
    assert.strictEqual(first.achievementRewards[1].alreadyUnlocked, true);
    assert.strictEqual(first.achievementRewards[2].achievementId, 17);
    assert.strictEqual(first.achievementRewards[2].alreadyUnlocked, true, 'duplicate achievement in one mission must not unlock twice');
    assert.strictEqual(first.achievementRewards[3].status, 'invalid');
    assert.strictEqual(first.achievementRewards[4].status, 'invalid');
    assert.deepStrictEqual(first.achievements.unlocked, [3, 17]);
    assert.strictEqual(first.achievements.ratCount, 7);
    assert.strictEqual(first.achievements.skeletonCount, 4);
    assert.strictEqual(first.achievements.totalKills, 23);
    assert.strictEqual(first.achievements.totalDmg, 1234);
    assert.strictEqual(first.achievements.totalRevives, 2);
    assert.strictEqual(postgres.achievementWrites, 1, 'new achievement set must be persisted once');
    assert.ok(postgres.transactionLog.indexOf('BEGIN') >= 0 && postgres.transactionLog.indexOf('COMMIT') >= 0, 'achievement and mission completion must share the reward transaction');
    assert.ok(postgres.stories.has('achievement-story'), 'story completion must be committed by the same store');

    second = await store.saveCompletionWithRewards(77, 'achievement-story', 'reward-mission', state, rewards);
    assert.strictEqual(second.achievementRewards[0].alreadyUnlocked, true, 'replay must be idempotent');
    assert.strictEqual(postgres.achievementWrites, 1, 'idempotent replay must not rewrite unchanged achievements');
    assert.deepStrictEqual(second.achievements.unlocked, [3, 17]);

    runtime = {
        getMission: function(storyId, missionId) {
            if(storyId !== 'mission-story' || missionId !== 'mission-achievement') { return null; }
            return {
                storyId: storyId,
                mission: {
                    id: missionId,
                    giverNpc: 'captain',
                    objective: {type: 'talk', target: 'captain', amount: 1},
                    rewards: [{type: 'achievement', value: '20', amount: 500}]
                }
            };
        }
    };

    completion = await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: {postgres: postgres, save: async function() { throw new Error('atomic reward store must own persistence'); }},
        itemRewardStore: store,
        characterId: 88,
        storyId: 'mission-story',
        missionId: 'mission-achievement',
        giverProfileId: 'captain',
        states: [{storyId: 'mission-story', activeMissionId: 'mission-achievement', objectiveProgress: 1, completedMissionIds: [], flags: {ready: true}}]
    });
    assert.strictEqual(completion.changed, true);
    assert.strictEqual(completion.achievementRewards.length, 1);
    assert.strictEqual(completion.achievementRewards[0].achievementId, 20);
    assert.deepStrictEqual(completion.achievements.unlocked, [20]);
    assert.ok(completion.state.completedMissionIds.indexOf('mission-achievement') >= 0);

    assert.ok(accountSource.indexOf('ACHIEVEMENT_IDS') !== -1, 'server must own an explicit canonical achievement catalog');
    assert.ok(accountSource.indexOf('parseAchievementId') !== -1, 'story rewards must share canonical server validation');
    assert.ok(rewardSource.indexOf("namespace='legacy' AND key='achievements' FOR UPDATE") !== -1, 'achievement row must be locked inside the reward transaction');
    assert.ok(rewardSource.indexOf("VALUES($1,'legacy','achievements'") !== -1, 'achievement reward must reuse canonical legacy persistence');
    assert.ok(completionSource.indexOf('saveCompletionWithRewards') !== -1, 'mission completion must use the general atomic reward path');
    assert.strictEqual(rewardSource.indexOf('eval('), -1);

    console.log('Story achievement reward smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
