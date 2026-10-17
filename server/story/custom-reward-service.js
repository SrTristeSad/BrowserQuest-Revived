'use strict';

var CustomObjective = require('./custom-objective-service'),
    parseHandlerId = require('./custom-handler-registry').parseHandlerId,
    ItemRewardService = require('./item-reward-store'),
    StateRewardService = require('./state-reward-service');

var MAX_EFFECTS_PER_CUSTOM_REWARD = 10,
    MAX_EXPANDED_REWARDS = 30,
    MAX_REWARD_AMOUNT = 100000,
    ALLOWED_EFFECT_TYPES = Object.freeze(['item', 'achievement', 'story_flag']);

function customRewardError(code, message, details) {
    var error = new Error(message);
    error.code = code;
    error.details = details || null;
    return error;
}

function isPlainObject(value) {
    if(!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function normalizeRewardAmount(value) {
    var amount = Number(value || 1);
    if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
    return Math.min(Math.floor(amount), MAX_REWARD_AMOUNT);
}

function buildHandlerContext(state, missionEntry, reward, rewardIndex, handlerId) {
    var flags = CustomObjective.copyDataOnly(state && state.flags || {}, 0, {nodes: 0}),
        completed = CustomObjective.copyDataOnly(state && state.completedMissionIds || [], 0, {nodes: 0});

    if(!flags.ok) { flags = {ok: true, value: {}}; }
    if(!completed.ok) { completed = {ok: true, value: []}; }

    return CustomObjective.deepFreeze({
        version: 1,
        story: {id: String(state && state.storyId || '')},
        mission: {
            id: String(missionEntry && missionEntry.mission && missionEntry.mission.id || ''),
            chapterId: String(missionEntry && missionEntry.chapterId || '')
        },
        reward: {
            handlerId: handlerId,
            amount: normalizeRewardAmount(reward && reward.amount),
            index: rewardIndex
        },
        state: {
            flags: flags.value,
            completedMissionIds: completed.value
        }
    });
}

function validateEffectShape(effect) {
    if(!isPlainObject(effect)) {
        return {valid: false, reason: 'effect_not_object'};
    }

    var keys = Object.keys(effect).sort(),
        allowedKeys = ['amount', 'type', 'value'],
        i;

    for(i = 0; i < keys.length; i += 1) {
        if(allowedKeys.indexOf(keys[i]) === -1) {
            return {valid: false, reason: 'effect_unknown_field'};
        }
    }
    if(keys.indexOf('type') === -1 || keys.indexOf('value') === -1) {
        return {valid: false, reason: 'effect_missing_field'};
    }
    if(ALLOWED_EFFECT_TYPES.indexOf(effect.type) === -1) {
        return {valid: false, reason: 'effect_unknown_type'};
    }
    if(typeof effect.value !== 'string') {
        return {valid: false, reason: 'effect_invalid_value'};
    }

    var value = effect.value.trim(),
        amount = effect.amount == null ? 1 : Number(effect.amount);

    if(!value || value.length > 160) {
        return {valid: false, reason: 'effect_invalid_value'};
    }
    if(!Number.isInteger(amount) || amount < 1 || amount > MAX_REWARD_AMOUNT) {
        return {valid: false, reason: 'effect_invalid_amount'};
    }

    return {
        valid: true,
        reward: {type: effect.type, value: value, amount: amount}
    };
}

function canonicalizeEffect(effect, effectIndex) {
    var shaped = validateEffectShape(effect),
        descriptor;

    if(!shaped.valid) { return shaped; }

    if(shaped.reward.type === 'item') {
        descriptor = ItemRewardService.resolveItemReward(shaped.reward, effectIndex);
        if(!descriptor || !descriptor.valid) {
            return {valid: false, reason: descriptor && descriptor.reason || 'invalid_item'};
        }
        return {
            valid: true,
            reward: {type: 'item', value: descriptor.itemName, amount: descriptor.amount}
        };
    }

    if(shaped.reward.type === 'achievement') {
        descriptor = ItemRewardService.resolveAchievementReward(shaped.reward, effectIndex);
        if(!descriptor || !descriptor.valid) {
            return {valid: false, reason: descriptor && descriptor.reason || 'invalid_achievement'};
        }
        return {
            valid: true,
            reward: {type: 'achievement', value: String(descriptor.achievementId), amount: 1}
        };
    }

    descriptor = StateRewardService.resolveStoryFlagReward(shaped.reward, effectIndex);
    if(!descriptor || !descriptor.valid) {
        return {valid: false, reason: descriptor && descriptor.reason || 'invalid_story_flag'};
    }
    return {
        valid: true,
        reward: {type: 'story_flag', value: descriptor.key, amount: 1}
    };
}

function normalizeHandlerResult(value) {
    if(value && typeof value.then === 'function') {
        if(typeof value.catch === 'function') { value.catch(function() { return null; }); }
        return {valid: false, reason: 'async_result'};
    }
    if(!isPlainObject(value)) {
        return {valid: false, reason: 'invalid_result'};
    }

    var keys = Object.keys(value);
    if(keys.length !== 1 || keys[0] !== 'effects' || !Array.isArray(value.effects)) {
        return {valid: false, reason: 'invalid_result'};
    }
    if(value.effects.length > MAX_EFFECTS_PER_CUSTOM_REWARD) {
        return {valid: false, reason: 'too_many_effects'};
    }

    var rewards = [];
    for(var i = 0; i < value.effects.length; i += 1) {
        var normalized = canonicalizeEffect(value.effects[i], i);
        if(!normalized.valid) {
            return {valid: false, reason: normalized.reason, effectIndex: i};
        }
        rewards.push(normalized.reward);
    }

    return {valid: true, rewards: rewards};
}

function clonePublishedReward(reward) {
    return {
        type: String(reward && reward.type || ''),
        value: String(reward && reward.value || ''),
        amount: normalizeRewardAmount(reward && reward.amount)
    };
}

function expandCustomRewards(options) {
    options = options || {};

    var runtime = options.runtime,
        missionEntry = options.missionEntry,
        state = options.state || {},
        sourceRewards = Array.isArray(options.rewards) ? options.rewards : [],
        hasCustom = sourceRewards.some(function(reward) { return reward && reward.type === 'custom'; }),
        expanded = [],
        executions = [];

    if(hasCustom && (!runtime || typeof runtime.resolveCustomHandler !== 'function')) {
        throw customRewardError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime custom indisponível para recompensa.');
    }

    for(var sourceIndex = 0; sourceIndex < sourceRewards.length; sourceIndex += 1) {
        var reward = sourceRewards[sourceIndex] || {};

        if(reward.type !== 'custom') {
            expanded.push(clonePublishedReward(reward));
        } else {
            var handlerId = parseHandlerId(reward.value),
                handler = handlerId ? runtime.resolveCustomHandler('reward', handlerId) : null,
                context,
                rawResult,
                normalized;

            if(!handlerId) {
                throw customRewardError('CUSTOM_REWARD_INVALID_HANDLER_ID', 'ID de handler custom de recompensa inválido.', {rewardIndex: sourceIndex});
            }
            if(!handler) {
                throw customRewardError('CUSTOM_REWARD_HANDLER_MISSING', 'Handler custom de recompensa não está registrado no servidor.', {rewardIndex: sourceIndex, handlerId: handlerId});
            }

            context = buildHandlerContext(state, missionEntry, reward, sourceIndex, handlerId);
            try {
                rawResult = handler(context);
            } catch(error) {
                throw customRewardError('CUSTOM_REWARD_HANDLER_ERROR', 'Handler custom de recompensa falhou.', {rewardIndex: sourceIndex, handlerId: handlerId});
            }

            normalized = normalizeHandlerResult(rawResult);
            if(!normalized.valid) {
                throw customRewardError('CUSTOM_REWARD_INVALID_RESULT', 'Handler custom de recompensa retornou efeitos inválidos.', {
                    rewardIndex: sourceIndex,
                    handlerId: handlerId,
                    reason: normalized.reason,
                    effectIndex: normalized.effectIndex == null ? null : normalized.effectIndex
                });
            }

            executions.push({handlerId: handlerId, rewardIndex: sourceIndex, effectCount: normalized.rewards.length});
            Array.prototype.push.apply(expanded, normalized.rewards);
        }

        if(expanded.length > MAX_EXPANDED_REWARDS) {
            throw customRewardError('CUSTOM_REWARD_LIMIT', 'Recompensas expandidas excederam o limite seguro da missão.');
        }
    }

    return {
        rewards: expanded,
        executions: executions
    };
}

exports.MAX_EFFECTS_PER_CUSTOM_REWARD = MAX_EFFECTS_PER_CUSTOM_REWARD;
exports.MAX_EXPANDED_REWARDS = MAX_EXPANDED_REWARDS;
exports.ALLOWED_EFFECT_TYPES = ALLOWED_EFFECT_TYPES;
exports.buildHandlerContext = buildHandlerContext;
exports.validateEffectShape = validateEffectShape;
exports.canonicalizeEffect = canonicalizeEffect;
exports.normalizeHandlerResult = normalizeHandlerResult;
exports.expandCustomRewards = expandCustomRewards;
