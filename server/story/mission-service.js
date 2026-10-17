'use strict';

var normalizeStoryProgress = require('./progress-store').normalizeStoryProgress;

function missionError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function findStoryState(states, storyId) {
    if(!Array.isArray(states)) { return null; }
    return states.find(function(state) {
        return state && state.storyId === storyId;
    }) || null;
}

function upsertStoryState(states, nextState) {
    var result = Array.isArray(states) ? states.slice() : [],
        normalized = normalizeStoryProgress(nextState),
        index;

    if(!normalized.storyId) { return result; }
    index = result.findIndex(function(state) {
        return state && state.storyId === normalized.storyId;
    });
    if(index >= 0) { result[index] = normalized; }
    else { result.push(normalized); }
    return result;
}

async function startMission(options) {
    options = options || {};

    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        characterId = Number(options.characterId) || 0,
        storyId = String(options.storyId || '').trim(),
        missionId = String(options.missionId || '').trim(),
        current = findStoryState(options.states, storyId),
        missionEntry,
        state,
        now;

    if(!runtime || typeof runtime.getMission !== 'function') {
        throw missionError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime indisponível.');
    }
    if(!storyId || !missionId) {
        throw missionError('INVALID_MISSION', 'História e missão são obrigatórias.');
    }

    missionEntry = runtime.getMission(storyId, missionId);
    if(!missionEntry || !missionEntry.mission) {
        throw missionError('MISSION_NOT_FOUND', 'Missão publicada não encontrada.');
    }

    if(current && current.activeMissionId && current.activeMissionId !== missionId) {
        throw missionError('MISSION_ALREADY_ACTIVE', 'Esta história já possui uma missão ativa.');
    }

    if(current && current.activeMissionId === missionId) {
        return {
            changed: false,
            mission: missionEntry,
            state: normalizeStoryProgress(current)
        };
    }

    now = new Date().toISOString();
    state = normalizeStoryProgress({
        version: 1,
        storyId: storyId,
        activeMissionId: missionId,
        objectiveProgress: 0,
        completedMissionIds: current && current.completedMissionIds || [],
        flags: current && current.flags || {},
        startedAt: now,
        updatedAt: now
    });

    if(progressStore) {
        if(!characterId) {
            throw missionError('CHARACTER_REQUIRED', 'Personagem autenticado é obrigatório para persistir missão.');
        }
        if(typeof progressStore.save !== 'function') {
            throw missionError('STORY_PROGRESS_UNAVAILABLE', 'Persistência de Story Runtime indisponível.');
        }
        state = await progressStore.save(characterId, storyId, state);
    }

    return {
        changed: true,
        mission: missionEntry,
        state: state
    };
}

async function progressTalkObjectives(options) {
    options = options || {};

    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        characterId = Number(options.characterId) || 0,
        targetProfileId = String(options.targetProfileId || '').trim(),
        states = Array.isArray(options.states) ? options.states : [],
        updates = [],
        i;

    if(!runtime || typeof runtime.getMission !== 'function') {
        throw missionError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime indisponível.');
    }
    if(!targetProfileId) {
        return {changed: false, updates: []};
    }

    for(i = 0; i < states.length; i += 1) {
        var current = normalizeStoryProgress(states[i]),
            missionEntry,
            objective,
            objectiveTarget,
            amount,
            currentProgress,
            state;

        if(!current.storyId || !current.activeMissionId) { continue; }

        missionEntry = runtime.getMission(current.storyId, current.activeMissionId);
        if(!missionEntry || !missionEntry.mission) { continue; }

        objective = missionEntry.mission.objective || {};
        objectiveTarget = String(objective.target || '').trim();
        if(objective.type !== 'talk' || !objectiveTarget || objectiveTarget !== targetProfileId) { continue; }

        amount = Number(objective.amount || 1);
        if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
        amount = Math.min(Math.floor(amount), 100000);
        currentProgress = Math.max(0, Math.floor(Number(current.objectiveProgress) || 0));
        if(currentProgress >= amount) { continue; }

        state = normalizeStoryProgress({
            version: current.version,
            storyId: current.storyId,
            activeMissionId: current.activeMissionId,
            objectiveProgress: Math.min(amount, currentProgress + 1),
            completedMissionIds: current.completedMissionIds,
            flags: current.flags,
            startedAt: current.startedAt,
            updatedAt: new Date().toISOString()
        });

        if(progressStore) {
            if(!characterId) {
                throw missionError('CHARACTER_REQUIRED', 'Personagem autenticado é obrigatório para persistir progresso de missão.');
            }
            if(typeof progressStore.save !== 'function') {
                throw missionError('STORY_PROGRESS_UNAVAILABLE', 'Persistência de Story Runtime indisponível.');
            }
            state = await progressStore.save(characterId, current.storyId, state);
        }

        updates.push({
            mission: missionEntry,
            state: state,
            objectiveAmount: amount,
            objectiveComplete: state.objectiveProgress >= amount
        });
    }

    return {
        changed: updates.length > 0,
        updates: updates
    };
}

async function progressKillObjectives(options) {
    options = options || {};

    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        characterId = Number(options.characterId) || 0,
        targetId = String(options.targetId || '').trim(),
        states = Array.isArray(options.states) ? options.states : [],
        updates = [],
        i;

    if(!runtime || typeof runtime.getMission !== 'function') {
        throw missionError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime indisponível.');
    }
    if(!targetId) {
        return {changed: false, updates: []};
    }

    for(i = 0; i < states.length; i += 1) {
        var current = normalizeStoryProgress(states[i]),
            missionEntry,
            objective,
            objectiveTarget,
            amount,
            currentProgress,
            state;

        if(!current.storyId || !current.activeMissionId) { continue; }

        missionEntry = runtime.getMission(current.storyId, current.activeMissionId);
        if(!missionEntry || !missionEntry.mission) { continue; }

        objective = missionEntry.mission.objective || {};
        objectiveTarget = String(objective.target || '').trim();
        if(objective.type !== 'kill' || !objectiveTarget || objectiveTarget !== targetId) { continue; }

        amount = Number(objective.amount || 1);
        if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
        amount = Math.min(Math.floor(amount), 100000);
        currentProgress = Math.max(0, Math.floor(Number(current.objectiveProgress) || 0));
        if(currentProgress >= amount) { continue; }

        state = normalizeStoryProgress({
            version: current.version,
            storyId: current.storyId,
            activeMissionId: current.activeMissionId,
            objectiveProgress: Math.min(amount, currentProgress + 1),
            completedMissionIds: current.completedMissionIds,
            flags: current.flags,
            startedAt: current.startedAt,
            updatedAt: new Date().toISOString()
        });

        if(progressStore) {
            if(!characterId) {
                throw missionError('CHARACTER_REQUIRED', 'Personagem autenticado é obrigatório para persistir progresso de missão.');
            }
            if(typeof progressStore.save !== 'function') {
                throw missionError('STORY_PROGRESS_UNAVAILABLE', 'Persistência de Story Runtime indisponível.');
            }
            state = await progressStore.save(characterId, current.storyId, state);
        }

        updates.push({
            mission: missionEntry,
            state: state,
            objectiveAmount: amount,
            objectiveComplete: state.objectiveProgress >= amount
        });
    }

    return {
        changed: updates.length > 0,
        updates: updates
    };
}

async function progressCollectObjectives(options) {
    options = options || {};

    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        characterId = Number(options.characterId) || 0,
        targetKind = String(options.targetKind || '').trim(),
        states = Array.isArray(options.states) ? options.states : [],
        updates = [],
        i;

    if(!runtime || typeof runtime.getMission !== 'function') {
        throw missionError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime indisponível.');
    }
    if(!targetKind) {
        return {changed: false, updates: []};
    }

    for(i = 0; i < states.length; i += 1) {
        var current = normalizeStoryProgress(states[i]),
            missionEntry,
            objective,
            objectiveTarget,
            amount,
            currentProgress,
            state;

        if(!current.storyId || !current.activeMissionId) { continue; }

        missionEntry = runtime.getMission(current.storyId, current.activeMissionId);
        if(!missionEntry || !missionEntry.mission) { continue; }

        objective = missionEntry.mission.objective || {};
        objectiveTarget = String(objective.target || '').trim();
        if(objective.type !== 'collect' || !objectiveTarget || objectiveTarget !== targetKind) { continue; }

        amount = Number(objective.amount || 1);
        if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
        amount = Math.min(Math.floor(amount), 100000);
        currentProgress = Math.max(0, Math.floor(Number(current.objectiveProgress) || 0));
        if(currentProgress >= amount) { continue; }

        state = normalizeStoryProgress({
            version: current.version,
            storyId: current.storyId,
            activeMissionId: current.activeMissionId,
            objectiveProgress: Math.min(amount, currentProgress + 1),
            completedMissionIds: current.completedMissionIds,
            flags: current.flags,
            startedAt: current.startedAt,
            updatedAt: new Date().toISOString()
        });

        if(progressStore) {
            if(!characterId) {
                throw missionError('CHARACTER_REQUIRED', 'Personagem autenticado é obrigatório para persistir progresso de missão.');
            }
            if(typeof progressStore.save !== 'function') {
                throw missionError('STORY_PROGRESS_UNAVAILABLE', 'Persistência de Story Runtime indisponível.');
            }
            state = await progressStore.save(characterId, current.storyId, state);
        }

        updates.push({
            mission: missionEntry,
            state: state,
            objectiveAmount: amount,
            objectiveComplete: state.objectiveProgress >= amount
        });
    }

    return {
        changed: updates.length > 0,
        updates: updates
    };
}

exports.startMission = startMission;
exports.progressTalkObjectives = progressTalkObjectives;
exports.progressKillObjectives = progressKillObjectives;
exports.progressCollectObjectives = progressCollectObjectives;
exports.findStoryState = findStoryState;
exports.upsertStoryState = upsertStoryState;
