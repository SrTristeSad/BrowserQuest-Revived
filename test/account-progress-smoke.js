'use strict';

var assert = require('assert'),
    Progress = require('../server/persistence/account-progress');

function main() {
    var normalized = Progress.normalizeAchievements({
        unlocked: [1, 1, 2, 20, 21, -1, '3'],
        ratCount: 99,
        skeletonCount: -3,
        totalKills: 999,
        totalDmg: 7000,
        totalRevives: 12
    });

    assert.deepStrictEqual(normalized, {
        unlocked: [1, 2, 3, 20],
        ratCount: 10,
        skeletonCount: 0,
        totalKills: 50,
        totalDmg: 5000,
        totalRevives: 5
    });

    var merged = Progress.mergeAchievements({
        unlocked: [1, 4],
        ratCount: 8,
        skeletonCount: 9,
        totalKills: 30,
        totalDmg: 4000,
        totalRevives: 3
    }, {
        unlocked: [2, 4],
        ratCount: 2,
        skeletonCount: 10,
        totalKills: 5,
        totalDmg: 100,
        totalRevives: 1
    });

    assert.deepStrictEqual(merged, {
        unlocked: [1, 2, 4],
        ratCount: 8,
        skeletonCount: 10,
        totalKills: 30,
        totalDmg: 4000,
        totalRevives: 3
    });

    console.log('Account progress normalization/merge smoke tests passed.');
}

main();
