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

exports.startMission = startMission;
exports.findStoryState = findStoryState;
exports.upsertStoryState = upsertStoryState;
