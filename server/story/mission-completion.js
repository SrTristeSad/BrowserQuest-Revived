'use strict';

var MissionService = require('./mission-service'),
    normalizeStoryProgress = require('./progress-store').normalizeStoryProgress;

function completionError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function normalizeObjectiveAmount(objective) {
    var amount = Number(objective && objective.amount || 1);
    if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
    return Math.min(Math.floor(amount), 100000);
}

function appendCompletedMission(completedMissionIds, missionId) {
    var result = Array.isArray(completedMissionIds) ? completedMissionIds.filter(function(id) {
        return id !== missionId;
    }) : [];

    if(result.length >= 500) {
        result = result.slice(result.length - 499);
    }
    result.push(missionId);
    return result;
}

function unchangedResult(missionEntry, state, alreadyCompleted) {
    return {
        changed: false,
        alreadyCompleted: !!alreadyCompleted,
        mission: missionEntry,
        state: state,
        itemRewards: [],
        inventory: null
    };
}

async function completeMission(options) {
    options = options || {};

    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        itemRewardStore = options.itemRewardStore || null,
        characterId = Number(options.characterId) || 0,
        storyId = String(options.storyId || '').trim(),
        missionId = String(options.missionId || '').trim(),
        giverProfileId = String(options.giverProfileId || '').trim(),
        current = MissionService.findStoryState(options.states, storyId),
        missionEntry,
        mission,
        objective,
        amount,
        currentProgress,
        completedMissionIds,
        state,
        rewardResult = null;

    if(!runtime || typeof runtime.getMission !== 'function') {
        throw completionError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime indisponível.');
    }
    if(!storyId || !missionId || !giverProfileId) {
        throw completionError('INVALID_MISSION_COMPLETION', 'História, missão e NPC de entrega são obrigatórios.');
    }

    missionEntry = runtime.getMission(storyId, missionId);
    if(!missionEntry || !missionEntry.mission) {
        throw completionError('MISSION_NOT_FOUND', 'Missão publicada não encontrada.');
    }

    mission = missionEntry.mission;
    if(String(mission.giverNpc || '').trim() !== giverProfileId) {
        return unchangedResult(missionEntry, current ? normalizeStoryProgress(current) : null, false);
    }

    if(!current) {
        return unchangedResult(missionEntry, null, false);
    }

    current = normalizeStoryProgress(current);
    if(current.completedMissionIds.indexOf(missionId) >= 0 && !current.activeMissionId) {
        return unchangedResult(missionEntry, current, true);
    }
    if(current.activeMissionId !== missionId) {
        return unchangedResult(missionEntry, current, current.completedMissionIds.indexOf(missionId) >= 0);
    }

    objective = mission.objective || {};
    amount = normalizeObjectiveAmount(objective);
    currentProgress = Math.max(0, Math.floor(Number(current.objectiveProgress) || 0));
    if(currentProgress < amount) {
        return unchangedResult(missionEntry, current, false);
    }

    completedMissionIds = appendCompletedMission(current.completedMissionIds, missionId);
    state = normalizeStoryProgress({
        version: current.version,
        storyId: current.storyId,
        activeMissionId: '',
        objectiveProgress: 0,
        completedMissionIds: completedMissionIds,
        flags: current.flags,
        startedAt: current.startedAt,
        updatedAt: new Date().toISOString()
    });

    if(progressStore) {
        if(!characterId) {
            throw completionError('CHARACTER_REQUIRED', 'Personagem autenticado é obrigatório para persistir conclusão de missão.');
        }
        if(typeof progressStore.save !== 'function') {
            throw completionError('STORY_PROGRESS_UNAVAILABLE', 'Persistência de Story Runtime indisponível.');
        }

        if(itemRewardStore && typeof itemRewardStore.saveCompletionWithRewards === 'function') {
            rewardResult = await itemRewardStore.saveCompletionWithRewards(
                characterId,
                storyId,
                missionId,
                state,
                mission.rewards || []
            );
            state = rewardResult.state;
        } else if(itemRewardStore && typeof itemRewardStore.saveCompletionWithItemRewards === 'function') {
            rewardResult = await itemRewardStore.saveCompletionWithItemRewards(
                characterId,
                storyId,
                missionId,
                state,
                mission.rewards || []
            );
            state = rewardResult.state;
        } else {
            state = await progressStore.save(characterId, storyId, state);
        }
    }

    return {
        changed: true,
        alreadyCompleted: false,
        mission: missionEntry,
        state: state,
        completedMissionId: missionId,
        itemRewards: rewardResult ? rewardResult.itemRewards : [],
        inventory: rewardResult ? rewardResult.inventory : null
    };
}

exports.normalizeObjectiveAmount = normalizeObjectiveAmount;
exports.appendCompletedMission = appendCompletedMission;
exports.completeMission = completeMission;
