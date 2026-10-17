'use strict';

var StoryProgress = require('./progress-store');

function rewardError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function resolveStoryFlagReward(reward, rewardIndex) {
    if(!reward || reward.type !== 'story_flag') { return null; }

    var key = StoryProgress.strictId(reward.value, 120);
    if(!key) {
        return {
            valid: false,
            rewardIndex: rewardIndex,
            key: null,
            status: 'invalid',
            reason: 'invalid_story_flag'
        };
    }

    return {
        valid: true,
        rewardIndex: rewardIndex,
        key: key,
        status: 'granted',
        reason: null
    };
}

function applyStoryFlagRewards(state, rewards) {
    var normalized = StoryProgress.normalizeStoryProgress(state, state && state.storyId),
        flags = Object.assign({}, normalized.flags),
        count = Object.keys(flags).length,
        descriptors = (Array.isArray(rewards) ? rewards : []).map(function(reward, index) {
            return resolveStoryFlagReward(reward, index);
        }).filter(function(result) {
            return result !== null;
        }),
        results = [];

    descriptors.forEach(function(descriptor) {
        var alreadySet;

        if(!descriptor.valid) {
            results.push(Object.assign({changed: false, alreadySet: false}, descriptor));
            return;
        }

        alreadySet = Object.prototype.hasOwnProperty.call(flags, descriptor.key) && flags[descriptor.key] === true;
        if(!Object.prototype.hasOwnProperty.call(flags, descriptor.key)) {
            if(count >= StoryProgress.MAX_FLAGS) {
                throw rewardError('STORY_FLAG_LIMIT', 'A história atingiu o limite de flags persistentes.');
            }
            count += 1;
        }

        flags[descriptor.key] = true;
        results.push(Object.assign({
            changed: !alreadySet,
            alreadySet: alreadySet
        }, descriptor));
    });

    normalized.flags = StoryProgress.normalizeFlags(flags);
    return {
        state: normalized,
        storyFlagRewards: results
    };
}

function applyStateRewards(state, rewards) {
    return applyStoryFlagRewards(state, rewards);
}

exports.resolveStoryFlagReward = resolveStoryFlagReward;
exports.applyStoryFlagRewards = applyStoryFlagRewards;
exports.applyStateRewards = applyStateRewards;
