'use strict';

var MissionService = require('./mission-service'),
    normalizeStoryProgress = require('./progress-store').normalizeStoryProgress;

function interactionError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function resolveInteractionTarget(entity) {
    var profileId,
        x,
        y;

    if(!entity) { return ''; }

    if(entity.type === 'npc') {
        profileId = entity.editorData ? String(entity.editorData.id || '').trim() : '';
        return profileId ? 'npc:' + profileId : '';
    }

    if(entity.storyInteractionId) {
        return String(entity.storyInteractionId).trim();
    }

    if(entity.kind != null && entity.x != null && entity.y != null) {
        x = Number(entity.x);
        y = Number(entity.y);
        if(Number.isFinite(x) && Number.isFinite(y) && entity.isStoryChest === true) {
            return 'chest:' + Math.floor(x) + ':' + Math.floor(y);
        }
    }

    return '';
}

function canInteractWith(player, entity) {
    var dx,
        dy;

    if(!player || !entity) { return false; }
    dx = Math.abs(Number(player.x) - Number(entity.x));
    dy = Math.abs(Number(player.y) - Number(entity.y));
    return Number.isFinite(dx) && Number.isFinite(dy) && (dx + dy === 1);
}

async function progressInteractObjectives(options) {
    options = options || {};

    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        characterId = Number(options.characterId) || 0,
        targetId = String(options.targetId || '').trim(),
        states = Array.isArray(options.states) ? options.states : [],
        updates = [],
        i;

    if(!runtime || typeof runtime.getMission !== 'function') {
        throw interactionError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime indisponível.');
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
        if(objective.type !== 'interact' || !objectiveTarget || objectiveTarget !== targetId) { continue; }

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
                throw interactionError('CHARACTER_REQUIRED', 'Personagem autenticado é obrigatório para persistir progresso de missão.');
            }
            if(typeof progressStore.save !== 'function') {
                throw interactionError('STORY_PROGRESS_UNAVAILABLE', 'Persistência de Story Runtime indisponível.');
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

function progressInteraction(player, entityOrTarget) {
    var targetId = typeof entityOrTarget === 'string'
        ? String(entityOrTarget).trim()
        : resolveInteractionTarget(entityOrTarget);

    if(!player || player.type !== 'player' || !targetId || typeof player.queueStoryOperation !== 'function') {
        return Promise.resolve({changed: false, updates: []});
    }

    return player.queueStoryOperation(function() {
        return progressInteractObjectives({
            runtime: player.storyRuntime,
            progressStore: player.storyProgress,
            characterId: player.characterId,
            targetId: targetId,
            states: player.storyState
        }).then(function(result) {
            (result.updates || []).forEach(function(update) {
                player.storyState = MissionService.upsertStoryState(player.storyState, update.state);
            });
            return result;
        });
    });
}

function logProgressError(player, error) {
    if(typeof log !== 'undefined' && log && typeof log.error === 'function') {
        log.error('Story interact progress failed for ' + ((player && (player.name || player.id)) || 'player') + ': ' + (error && error.message ? error.message : error));
    }
}

function wrapNpcInteraction(player) {
    var original;

    if(!player || player.__storyInteractNpcWrapped || typeof player.onNpcInteract !== 'function') { return false; }
    original = player.npcinteract_callback;
    player.onNpcInteract(function(npc) {
        progressInteraction(player, npc).catch(function(error) {
            logProgressError(player, error);
        });
        if(original) { original(npc); }
    });
    player.__storyInteractNpcWrapped = true;
    return true;
}

function attach(WorldServer) {
    var prototype,
        originalCreateChest,
        originalHandleOpenedChest,
        originalOnPlayerEnter;

    if(!WorldServer || !WorldServer.prototype) { return false; }
    prototype = WorldServer.prototype;
    if(prototype.__storyInteractProgressAttached) { return true; }
    if(typeof prototype.createChest !== 'function' || typeof prototype.handleOpenedChest !== 'function' || typeof prototype.onPlayerEnter !== 'function') {
        return false;
    }

    originalCreateChest = prototype.createChest;
    prototype.createChest = function(x, y, items) {
        var chest = originalCreateChest.call(this, x, y, items),
            cx = Number(chest && chest.x),
            cy = Number(chest && chest.y);

        if(chest && Number.isFinite(cx) && Number.isFinite(cy)) {
            chest.isStoryChest = true;
            chest.storyInteractionId = 'chest:' + Math.floor(cx) + ':' + Math.floor(cy);
        }
        return chest;
    };

    originalHandleOpenedChest = prototype.handleOpenedChest;
    prototype.handleOpenedChest = function(chest, player) {
        var targetId;

        if(!chest || !player || !canInteractWith(player, chest)) {
            return false;
        }

        targetId = resolveInteractionTarget(chest);
        originalHandleOpenedChest.call(this, chest, player);
        if(targetId) {
            progressInteraction(player, targetId).catch(function(error) {
                logProgressError(player, error);
            });
        }
        return true;
    };

    originalOnPlayerEnter = prototype.onPlayerEnter;
    prototype.onPlayerEnter = function(callback) {
        return originalOnPlayerEnter.call(this, function(player) {
            callback(player);
            wrapNpcInteraction(player);
        });
    };

    prototype.__storyInteractProgressAttached = true;
    return true;
}

exports.resolveInteractionTarget = resolveInteractionTarget;
exports.canInteractWith = canInteractWith;
exports.progressInteractObjectives = progressInteractObjectives;
exports.progressInteraction = progressInteraction;
exports.wrapNpcInteraction = wrapNpcInteraction;
exports.attach = attach;
