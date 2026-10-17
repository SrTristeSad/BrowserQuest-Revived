'use strict';

var MissionService = require('./mission-service'),
    normalizeStoryProgress = require('./progress-store').normalizeStoryProgress,
    parseHandlerId = require('./custom-handler-registry').parseHandlerId;

var MAX_PROGRESS = 100000,
    MAX_EVENT_DEPTH = 4,
    MAX_EVENT_KEYS = 32,
    MAX_EVENT_ARRAY = 32,
    MAX_EVENT_STRING = 500,
    MAX_EVENT_NODES = 200,
    RESERVED_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

function customError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function isPlainObject(value) {
    if(!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function safeDataKey(value) {
    if(typeof value !== 'string' || !value || value.length > 80) { return false; }
    if(!/^[A-Za-z0-9_-]+$/.test(value)) { return false; }
    return RESERVED_KEYS.indexOf(value.toLowerCase()) === -1;
}

function copyDataOnly(value, depth, budget) {
    depth = depth || 0;
    budget = budget || {nodes: 0};
    budget.nodes += 1;
    if(budget.nodes > MAX_EVENT_NODES || depth > MAX_EVENT_DEPTH) { return {ok: false}; }

    if(value === null || typeof value === 'boolean') {
        return {ok: true, value: value};
    }
    if(typeof value === 'number') {
        return Number.isFinite(value) ? {ok: true, value: value} : {ok: false};
    }
    if(typeof value === 'string') {
        return value.length <= MAX_EVENT_STRING ? {ok: true, value: value} : {ok: false};
    }
    if(Array.isArray(value)) {
        if(value.length > MAX_EVENT_ARRAY) { return {ok: false}; }
        var array = [];
        for(var i = 0; i < value.length; i += 1) {
            var item = copyDataOnly(value[i], depth + 1, budget);
            if(!item.ok) { return {ok: false}; }
            array.push(item.value);
        }
        return {ok: true, value: array};
    }
    if(isPlainObject(value)) {
        var keys = Object.keys(value), object = {};
        if(keys.length > MAX_EVENT_KEYS) { return {ok: false}; }
        for(var j = 0; j < keys.length; j += 1) {
            var key = keys[j];
            if(!safeDataKey(key)) { return {ok: false}; }
            var child = copyDataOnly(value[key], depth + 1, budget);
            if(!child.ok) { return {ok: false}; }
            object[key] = child.value;
        }
        return {ok: true, value: object};
    }
    return {ok: false};
}

function deepFreeze(value) {
    if(!value || typeof value !== 'object' || Object.isFrozen(value)) { return value; }
    Object.keys(value).forEach(function(key) {
        deepFreeze(value[key]);
    });
    return Object.freeze(value);
}

function buildEvent(eventType, eventData) {
    var type = parseHandlerId(eventType),
        copied;
    if(!type) { return null; }
    if(eventData == null) { eventData = {}; }
    if(!isPlainObject(eventData)) { return null; }
    copied = copyDataOnly(eventData, 0, {nodes: 0});
    if(!copied.ok) { return null; }
    return deepFreeze({type: type, data: copied.value});
}

function normalizeObjectiveAmount(objective) {
    var amount = Number(objective && objective.amount || 1);
    if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
    return Math.min(Math.floor(amount), MAX_PROGRESS);
}

function normalizeHandlerResult(value) {
    if(value && typeof value.then === 'function') {
        return {valid: false, reason: 'async_result'};
    }
    if(!isPlainObject(value)) {
        return {valid: false, reason: 'invalid_result'};
    }
    var keys = Object.keys(value);
    if(keys.length !== 1 || keys[0] !== 'progress') {
        return {valid: false, reason: 'invalid_result'};
    }
    var progress = value.progress;
    if(!Number.isInteger(progress) || progress < 0 || progress > MAX_PROGRESS) {
        return {valid: false, reason: 'invalid_progress'};
    }
    return {valid: true, progress: progress};
}

function buildHandlerContext(current, missionEntry, objective, event) {
    var flags = copyDataOnly(current.flags || {}, 0, {nodes: 0}),
        amount = normalizeObjectiveAmount(objective);
    if(!flags.ok) { flags = {ok: true, value: {}}; }

    return deepFreeze({
        version: 1,
        event: {type: event.type, data: event.data},
        story: {id: current.storyId},
        mission: {id: current.activeMissionId, chapterId: String(missionEntry.chapterId || '')},
        objective: {handlerId: String(objective.target || ''), amount: amount},
        progress: {
            current: Math.max(0, Math.floor(Number(current.objectiveProgress) || 0)),
            required: amount
        },
        flags: flags.value
    });
}

async function progressCustomObjectives(options) {
    options = options || {};

    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        characterId = Number(options.characterId) || 0,
        states = Array.isArray(options.states) ? options.states : [],
        event = buildEvent(options.eventType, options.eventData),
        updates = [],
        failures = [],
        i;

    if(!runtime || typeof runtime.getMission !== 'function' || typeof runtime.resolveCustomHandler !== 'function') {
        throw customError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime custom indisponível.');
    }
    if(!event) {
        return {changed: false, updates: [], failures: [{reason: 'invalid_event'}]};
    }

    for(i = 0; i < states.length; i += 1) {
        var current = normalizeStoryProgress(states[i]),
            missionEntry,
            objective,
            handlerId,
            handler,
            context,
            rawResult,
            result,
            currentProgress,
            amount,
            nextProgress,
            state;

        if(!current.storyId || !current.activeMissionId) { continue; }
        missionEntry = runtime.getMission(current.storyId, current.activeMissionId);
        if(!missionEntry || !missionEntry.mission) { continue; }

        objective = missionEntry.mission.objective || {};
        if(objective.type !== 'custom') { continue; }

        handlerId = parseHandlerId(objective.target);
        handler = handlerId ? runtime.resolveCustomHandler('objective', handlerId) : null;
        if(!handler) {
            failures.push({
                storyId: current.storyId,
                missionId: current.activeMissionId,
                handlerId: handlerId,
                reason: handlerId ? 'missing_handler' : 'invalid_handler_id'
            });
            continue;
        }

        context = buildHandlerContext(current, missionEntry, objective, event);
        try {
            rawResult = handler(context);
        } catch(error) {
            failures.push({
                storyId: current.storyId,
                missionId: current.activeMissionId,
                handlerId: handlerId,
                reason: 'handler_error'
            });
            continue;
        }

        result = normalizeHandlerResult(rawResult);
        if(!result.valid) {
            failures.push({
                storyId: current.storyId,
                missionId: current.activeMissionId,
                handlerId: handlerId,
                reason: result.reason
            });
            continue;
        }

        amount = normalizeObjectiveAmount(objective);
        currentProgress = Math.max(0, Math.floor(Number(current.objectiveProgress) || 0));
        nextProgress = Math.min(amount, result.progress);
        if(nextProgress <= currentProgress) { continue; }

        state = normalizeStoryProgress({
            version: current.version,
            storyId: current.storyId,
            activeMissionId: current.activeMissionId,
            objectiveProgress: nextProgress,
            completedMissionIds: current.completedMissionIds,
            flags: current.flags,
            startedAt: current.startedAt,
            updatedAt: new Date().toISOString()
        });

        if(progressStore) {
            if(!characterId) {
                throw customError('CHARACTER_REQUIRED', 'Personagem autenticado é obrigatório para persistir objetivo custom.');
            }
            if(typeof progressStore.save !== 'function') {
                throw customError('STORY_PROGRESS_UNAVAILABLE', 'Persistência de Story Runtime indisponível.');
            }
            state = await progressStore.save(characterId, current.storyId, state);
        }

        updates.push({
            mission: missionEntry,
            state: state,
            handlerId: handlerId,
            eventType: event.type,
            objectiveAmount: amount,
            objectiveComplete: state.objectiveProgress >= amount
        });
    }

    return {changed: updates.length > 0, updates: updates, failures: failures};
}

function queuePlayerCustomObjective(player, eventType, eventData) {
    if(!player || typeof player.queueStoryOperation !== 'function') {
        return Promise.reject(customError('PLAYER_STORY_QUEUE_UNAVAILABLE', 'Fila de Story Runtime do jogador indisponível.'));
    }

    return player.queueStoryOperation(function() {
        return progressCustomObjectives({
            runtime: player.storyRuntime,
            progressStore: player.storyProgress,
            characterId: player.characterId,
            states: player.storyState,
            eventType: eventType,
            eventData: eventData
        }).then(function(result) {
            (result.updates || []).forEach(function(update) {
                player.storyState = MissionService.upsertStoryState(player.storyState, update.state);
            });
            return result;
        });
    });
}

exports.MAX_PROGRESS = MAX_PROGRESS;
exports.buildEvent = buildEvent;
exports.copyDataOnly = copyDataOnly;
exports.deepFreeze = deepFreeze;
exports.normalizeHandlerResult = normalizeHandlerResult;
exports.progressCustomObjectives = progressCustomObjectives;
exports.queuePlayerCustomObjective = queuePlayerCustomObjective;
