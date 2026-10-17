'use strict';

var MissionService = require('./mission-service'),
    StateRewardService = require('./state-reward-service'),
    CustomRewardService = require('./custom-reward-service'),
    ChoiceService = require('./choice-service'),
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

function resolveLinearNextMission(runtime, storyId, missionId, mission, completedMissionIds) {
    var nextMissionId = String(mission && mission.nextMissionId || '').trim(),
        nextMissionEntry;

    if(!nextMissionId) {
        return {nextMissionId: '', nextMission: null};
    }
    if(nextMissionId === missionId) {
        throw completionError('NEXT_MISSION_SELF_REFERENCE', 'A próxima missão não pode apontar para a própria missão concluída.');
    }
    if(Array.isArray(completedMissionIds) && completedMissionIds.indexOf(nextMissionId) >= 0) {
        throw completionError('NEXT_MISSION_ALREADY_COMPLETED', 'A próxima missão já foi concluída nesta história.');
    }

    nextMissionEntry = runtime.getMission(storyId, nextMissionId);
    if(!nextMissionEntry || !nextMissionEntry.mission) {
        throw completionError('NEXT_MISSION_NOT_FOUND', 'A próxima missão publicada não existe nesta história.');
    }
    if(nextMissionEntry.storyId && nextMissionEntry.storyId !== storyId) {
        throw completionError('NEXT_MISSION_WRONG_STORY', 'A próxima missão precisa pertencer à mesma história publicada.');
    }
    if(String(nextMissionEntry.mission.id || '').trim() !== nextMissionId) {
        throw completionError('NEXT_MISSION_INVALID', 'A próxima missão publicada não corresponde ao destino configurado.');
    }

    return {
        nextMissionId: nextMissionId,
        nextMission: nextMissionEntry
    };
}

function hasPlayerChoices(mission) {
    return Array.isArray(mission && mission.choices) && mission.choices.length > 0;
}

function unchangedResult(missionEntry, state, alreadyCompleted) {
    return {
        changed: false,
        alreadyCompleted: !!alreadyCompleted,
        mission: missionEntry,
        state: state,
        awaitingChoice: !!(state && state.pendingChoiceMissionId),
        nextMissionId: '',
        nextMission: null,
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
        awaitingChoice,
        transition,
        now,
        state,
        expandedRewardResult,
        expandedRewards,
        stateRewardResult,
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
    if(current.completedMissionIds.indexOf(missionId) >= 0 && current.activeMissionId !== missionId) {
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
    awaitingChoice = hasPlayerChoices(mission);
    transition = awaitingChoice ? {nextMissionId: '', nextMission: null} : resolveLinearNextMission(runtime, storyId, missionId, mission, completedMissionIds);
    now = new Date().toISOString();
    state = normalizeStoryProgress({
        version: current.version,
        storyId: current.storyId,
        activeMissionId: transition.nextMissionId,
        pendingChoiceMissionId: awaitingChoice ? missionId : '',
        objectiveProgress: 0,
        completedMissionIds: completedMissionIds,
        flags: current.flags,
        startedAt: transition.nextMissionId ? now : current.startedAt,
        updatedAt: now
    });

    expandedRewardResult = CustomRewardService.expandCustomRewards({
        runtime: runtime,
        missionEntry: missionEntry,
        state: state,
        rewards: mission.rewards || []
    });
    expandedRewards = expandedRewardResult.rewards;

    stateRewardResult = StateRewardService.applyStateRewards(state, expandedRewards);
    state = stateRewardResult.state;

    if(awaitingChoice && ChoiceService.getAvailableChoices(runtime, storyId, missionId, state).length === 0) {
        transition = resolveLinearNextMission(runtime, storyId, missionId, mission, completedMissionIds);
        awaitingChoice = false;
        state = normalizeStoryProgress({
            version: state.version,
            storyId: state.storyId,
            activeMissionId: transition.nextMissionId,
            pendingChoiceMissionId: '',
            objectiveProgress: 0,
            completedMissionIds: state.completedMissionIds,
            flags: state.flags,
            startedAt: transition.nextMissionId ? now : current.startedAt,
            updatedAt: now
        });
    }

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
                expandedRewards
            );
            state = rewardResult.state;
        } else if(itemRewardStore && typeof itemRewardStore.saveCompletionWithItemRewards === 'function') {
            rewardResult = await itemRewardStore.saveCompletionWithItemRewards(
                characterId,
                storyId,
                missionId,
                state,
                expandedRewards
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
        awaitingChoice: awaitingChoice,
        nextMissionId: transition.nextMissionId,
        nextMission: transition.nextMission,
        itemRewards: rewardResult ? rewardResult.itemRewards : [],
        inventory: rewardResult ? rewardResult.inventory : null
    };
}

exports.normalizeObjectiveAmount = normalizeObjectiveAmount;
exports.appendCompletedMission = appendCompletedMission;
exports.resolveLinearNextMission = resolveLinearNextMission;
exports.hasPlayerChoices = hasPlayerChoices;
exports.completeMission = completeMission;
