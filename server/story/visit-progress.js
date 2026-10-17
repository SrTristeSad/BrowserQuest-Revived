'use strict';

var MissionService = require('./mission-service'),
    normalizeStoryProgress = require('./progress-store').normalizeStoryProgress;

function resolveLocationIds(map, x, y) {
    if(!map || typeof map.getVisitLocationIdsAt !== 'function') { return []; }
    return map.getVisitLocationIdsAt(x, y);
}

async function progressVisitObjectives(options) {
    options = options || {};

    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        characterId = Number(options.characterId) || 0,
        locationId = String(options.locationId || '').trim(),
        states = Array.isArray(options.states) ? options.states : [],
        updates = [],
        i;

    if(!runtime || typeof runtime.getMission !== 'function') {
        var runtimeError = new Error('Story Runtime indisponível.');
        runtimeError.code = 'STORY_RUNTIME_UNAVAILABLE';
        throw runtimeError;
    }
    if(!locationId) {
        return {changed: false, updates: []};
    }

    for(i = 0; i < states.length; i += 1) {
        var current = normalizeStoryProgress(states[i]),
            missionEntry,
            objective,
            objectiveLocationId,
            amount,
            currentProgress,
            state;

        if(!current.storyId || !current.activeMissionId) { continue; }

        missionEntry = runtime.getMission(current.storyId, current.activeMissionId);
        if(!missionEntry || !missionEntry.mission) { continue; }

        objective = missionEntry.mission.objective || {};
        objectiveLocationId = String(objective.locationId || '').trim();
        if(objective.type !== 'visit' || !objectiveLocationId || objectiveLocationId !== locationId) { continue; }

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
                var characterError = new Error('Personagem autenticado é obrigatório para persistir progresso de missão.');
                characterError.code = 'CHARACTER_REQUIRED';
                throw characterError;
            }
            if(typeof progressStore.save !== 'function') {
                var storeError = new Error('Persistência de Story Runtime indisponível.');
                storeError.code = 'STORY_PROGRESS_UNAVAILABLE';
                throw storeError;
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

function progressVisit(player, locationId) {
    if(!player || player.type !== 'player' || !locationId || typeof player.queueStoryOperation !== 'function') {
        return Promise.resolve({changed: false, updates: []});
    }

    return player.queueStoryOperation(function() {
        return progressVisitObjectives({
            runtime: player.storyRuntime,
            progressStore: player.storyProgress,
            characterId: player.characterId,
            locationId: locationId,
            states: player.storyState
        }).then(function(result) {
            (result.updates || []).forEach(function(update) {
                player.storyState = MissionService.upsertStoryState(player.storyState, update.state);
            });
            return result;
        });
    });
}

function handleAcceptedMove(player, map) {
    var previous = Array.isArray(player && player.__storyVisitPreviousLocationIds) ? player.__storyVisitPreviousLocationIds : [],
        current = player ? resolveLocationIds(map, player.x, player.y) : [],
        entered = current.filter(function(locationId) {
            return previous.indexOf(locationId) < 0;
        });

    if(!player || player.type !== 'player' || !entered.length) {
        return Promise.resolve({changed: false, entered: entered, results: []});
    }

    return Promise.all(entered.map(function(locationId) {
        return progressVisit(player, locationId);
    })).then(function(results) {
        return {
            changed: results.some(function(result) { return result && result.changed; }),
            entered: entered,
            results: results
        };
    });
}

function logProgressError(player, error) {
    if(typeof log !== 'undefined' && log && typeof log.error === 'function') {
        log.error('Story visit progress failed for ' + ((player && (player.name || player.id)) || 'player') + ': ' + (error && error.message ? error.message : error));
    }
}

function wrapPlayerMovement(player, world) {
    var originalSetPosition,
        originalMoveCallback;

    if(!player || player.__storyVisitMoveWrapped || typeof player.setPosition !== 'function' || typeof player.onMove !== 'function') {
        return false;
    }

    originalSetPosition = player.setPosition;
    player.setPosition = function(x, y) {
        this.__storyVisitPreviousLocationIds = resolveLocationIds(this.server && this.server.map, this.x, this.y);
        return originalSetPosition.call(this, x, y);
    };

    originalMoveCallback = player.move_callback;
    player.onMove(function(x, y) {
        handleAcceptedMove(player, world && world.map).catch(function(error) {
            logProgressError(player, error);
        });
        if(originalMoveCallback) {
            originalMoveCallback(x, y);
        }
    });
    player.__storyVisitMoveWrapped = true;
    return true;
}

function attach(WorldServer) {
    var worldPrototype,
        originalOnPlayerEnter;

    if(!WorldServer || !WorldServer.prototype) { return false; }
    worldPrototype = WorldServer.prototype;
    if(worldPrototype.__storyVisitProgressAttached) { return true; }
    if(typeof worldPrototype.onPlayerEnter !== 'function') { return false; }

    originalOnPlayerEnter = worldPrototype.onPlayerEnter;
    worldPrototype.onPlayerEnter = function(callback) {
        var world = this;
        return originalOnPlayerEnter.call(this, function(player) {
            callback(player);
            wrapPlayerMovement(player, world);
        });
    };
    worldPrototype.__storyVisitProgressAttached = true;
    return true;
}

exports.resolveLocationIds = resolveLocationIds;
exports.progressVisitObjectives = progressVisitObjectives;
exports.progressVisit = progressVisit;
exports.handleAcceptedMove = handleAcceptedMove;
exports.wrapPlayerMovement = wrapPlayerMovement;
exports.attach = attach;
