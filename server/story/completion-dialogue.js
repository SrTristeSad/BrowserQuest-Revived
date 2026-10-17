'use strict';

var MissionCompletion = require('./mission-completion'),
    MissionService = require('./mission-service'),
    ItemRewardModule = require('./item-reward-store'),
    StoryItemRewardStore = ItemRewardModule.StoryItemRewardStore,
    Utils = require('../js/utils'),
    normalizeStoryProgress = require('./progress-store').normalizeStoryProgress,
    Types = require('../../shared/js/gametypes');

function completionError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function resolveGiverProfileId(npc) {
    if(!npc || npc.type !== 'npc' || !npc.editorData) { return ''; }
    return String(npc.editorData.id || '').trim();
}

function normalizeObjectiveAmount(objective) {
    return MissionCompletion.normalizeObjectiveAmount(objective);
}

function findCompletableMission(options) {
    options = options || {};

    var runtime = options.runtime,
        giverProfileId = String(options.giverProfileId || '').trim(),
        states = Array.isArray(options.states) ? options.states : [],
        candidates = [];

    if(!runtime || typeof runtime.getMission !== 'function') {
        throw completionError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime indisponível.');
    }
    if(!giverProfileId) { return null; }

    states.forEach(function(rawState) {
        var current = normalizeStoryProgress(rawState),
            missionEntry,
            mission,
            objective,
            amount,
            currentProgress,
            giverNpc;

        if(!current.storyId || !current.activeMissionId) { return; }
        missionEntry = runtime.getMission(current.storyId, current.activeMissionId);
        if(!missionEntry || !missionEntry.mission) { return; }

        mission = missionEntry.mission;
        giverNpc = String(mission.giverNpc || '').trim();
        if(!giverNpc || giverNpc !== giverProfileId) { return; }

        objective = mission.objective || {};
        amount = normalizeObjectiveAmount(objective);
        currentProgress = Math.max(0, Math.floor(Number(current.objectiveProgress) || 0));
        if(currentProgress < amount) { return; }

        candidates.push({
            mission: missionEntry,
            state: current,
            dialogue: Array.isArray(mission.completionDialogue) ? mission.completionDialogue : [],
            objectiveAmount: amount
        });
    });

    candidates.sort(function(a, b) {
        var aKey = String(a.state.storyId || '') + '\u0000' + String(a.state.activeMissionId || ''),
            bKey = String(b.state.storyId || '') + '\u0000' + String(b.state.activeMissionId || '');
        return aKey < bKey ? -1 : (aKey > bKey ? 1 : 0);
    });

    return candidates[0] || null;
}

function findCompletionDialogue(options) {
    var result = findCompletableMission(options),
        dialogue;

    if(!result) { return null; }
    dialogue = Array.isArray(result.dialogue) ? result.dialogue : [];
    if(!dialogue.length) { return null; }
    return result;
}

function sanitizeDialogue(dialogue) {
    return (Array.isArray(dialogue) ? dialogue : []).slice(0, 100).map(function(line) {
        return Utils.sanitize(line && line.text || '').substr(0, 2000);
    }).filter(function(text) {
        return text;
    });
}

function createItemRewardStore(player) {
    var postgres = player && player.storyProgress && player.storyProgress.postgres;
    return postgres ? new StoryItemRewardStore({postgres: postgres}) : null;
}

function loadStoryInventory(player) {
    var store;
    if(!player) { return Promise.resolve({inventory: ItemRewardModule.normalizeInventory(null), materialized: [], invalid: []}); }
    if(!player.storyInventory) {
        player.storyInventory = ItemRewardModule.normalizeInventory(null);
    }
    if(!player.characterId || typeof player.queueStoryOperation !== 'function') {
        return Promise.resolve({inventory: player.storyInventory, materialized: [], invalid: []});
    }

    store = createItemRewardStore(player);
    if(!store) {
        return Promise.resolve({inventory: player.storyInventory, materialized: [], invalid: []});
    }

    player.storyInventoryReady = player.queueStoryOperation(function() {
        return store.materializePending(player.characterId).then(function(result) {
            player.storyInventory = result.inventory;
            return result;
        });
    });
    return player.storyInventoryReady;
}

function applyGrantedItemRewards(player, itemRewards) {
    var applied = [];
    if(!player || !Array.isArray(itemRewards)) { return applied; }

    itemRewards.forEach(function(reward) {
        var kind = Number(reward && reward.itemKind),
            kindName = Number.isInteger(kind) ? Types.getKindAsString(kind) : '',
            equipMessage;

        if(!reward || !reward.changed || reward.status !== 'granted' || reward.category !== 'equipment' || reward.delivery !== 'equipment') { return; }
        if(!kindName || (reward.slot !== 'weapon' && reward.slot !== 'armor')) { return; }
        if(typeof player.equipItem !== 'function' || typeof player.equip !== 'function') { return; }

        player.equipItem({kind: kind});
        equipMessage = player.equip(kind);
        if(player.send && equipMessage && typeof equipMessage.serialize === 'function') {
            player.send(equipMessage.serialize());
        }
        if(player.broadcast) {
            player.broadcast(equipMessage);
        }
        applied.push(kind);
    });
    return applied;
}

function queueCompletionDialogue(player, npc) {
    var giverProfileId = resolveGiverProfileId(npc),
        sourceNpcId = npc && npc.id;

    if(!player || player.type !== 'player' || !giverProfileId || sourceNpcId == null || typeof player.queueStoryOperation !== 'function') {
        return Promise.resolve({sent: false, result: null, lines: []});
    }

    return player.queueStoryOperation(function() {
        var result = findCompletionDialogue({
                runtime: player.storyRuntime,
                giverProfileId: giverProfileId,
                states: player.storyState
            }),
            lines;

        if(!result) {
            return {sent: false, result: null, lines: []};
        }

        lines = sanitizeDialogue(result.dialogue);
        if(!lines.length) {
            return {sent: false, result: result, lines: []};
        }

        player.send([Types.Messages.STORY_DIALOGUE, sourceNpcId, lines]);
        return {sent: true, result: result, lines: lines};
    });
}

function queueMissionCompletion(player, npc) {
    var giverProfileId = resolveGiverProfileId(npc),
        sourceNpcId = npc && npc.id;

    if(!player || player.type !== 'player' || !giverProfileId || sourceNpcId == null || typeof player.queueStoryOperation !== 'function') {
        return Promise.resolve({completed: false, sent: false, result: null, lines: [], appliedItems: []});
    }

    return player.queueStoryOperation(async function() {
        var candidate = findCompletableMission({
                runtime: player.storyRuntime,
                giverProfileId: giverProfileId,
                states: player.storyState
            }),
            completion,
            lines,
            appliedItems;

        if(!candidate) {
            return {completed: false, sent: false, result: null, lines: [], appliedItems: []};
        }

        completion = await MissionCompletion.completeMission({
            runtime: player.storyRuntime,
            progressStore: player.storyProgress,
            itemRewardStore: createItemRewardStore(player),
            characterId: player.characterId,
            storyId: candidate.state.storyId,
            missionId: candidate.state.activeMissionId,
            giverProfileId: giverProfileId,
            states: player.storyState
        });

        if(!completion.changed) {
            return {completed: false, sent: false, result: completion, lines: [], appliedItems: []};
        }

        player.storyState = MissionService.upsertStoryState(player.storyState, completion.state);
        if(completion.inventory) {
            player.storyInventory = completion.inventory;
        }
        appliedItems = applyGrantedItemRewards(player, completion.itemRewards || []);
        lines = sanitizeDialogue(candidate.dialogue);
        if(lines.length) {
            player.send([Types.Messages.STORY_DIALOGUE, sourceNpcId, lines]);
        }

        return {
            completed: true,
            sent: lines.length > 0,
            result: completion,
            lines: lines,
            appliedItems: appliedItems
        };
    });
}

function isNpcLinkedMissionCompleted(player, npc) {
    var storyId = npc && npc.editorData ? String(npc.editorData.storyId || '').trim() : '',
        missionId = npc && npc.editorData ? String(npc.editorData.missionId || '').trim() : '',
        state;

    if(!player || !storyId || !missionId) { return false; }
    state = MissionService.findStoryState(player.storyState, storyId);
    if(!state) { return false; }
    state = normalizeStoryProgress(state);
    return state.completedMissionIds.indexOf(missionId) >= 0;
}

function invokeOriginalNpcInteraction(player, original, npc) {
    var previousNpcId;

    if(!original) { return; }
    previousNpcId = player.storyInteractionNpcId;
    player.storyInteractionNpcId = npc && npc.id != null ? npc.id : previousNpcId;
    try {
        original(npc);
    } finally {
        player.storyInteractionNpcId = previousNpcId;
    }
}

function logProgressError(player, error) {
    if(typeof log !== 'undefined' && log && typeof log.error === 'function') {
        log.error('Story mission completion failed for ' + ((player && (player.name || player.id)) || 'player') + ': ' + (error && error.message ? error.message : error));
    }
}

function wrapNpcInteraction(player) {
    var original;

    if(!player || player.__storyCompletionDialogueWrapped || typeof player.onNpcInteract !== 'function') { return false; }
    original = player.npcinteract_callback;
    player.onNpcInteract(function(npc) {
        queueMissionCompletion(player, npc).then(function(result) {
            if(result && result.completed) { return; }
            if(isNpcLinkedMissionCompleted(player, npc)) { return; }
            invokeOriginalNpcInteraction(player, original, npc);
        }).catch(function(error) {
            logProgressError(player, error);
            invokeOriginalNpcInteraction(player, original, npc);
        });
    });
    player.__storyCompletionDialogueWrapped = true;
    return true;
}

function attach(WorldServer) {
    var prototype,
        originalOnPlayerEnter;

    if(!WorldServer || !WorldServer.prototype) { return false; }
    prototype = WorldServer.prototype;
    if(prototype.__storyCompletionDialogueAttached) { return true; }
    if(typeof prototype.onPlayerEnter !== 'function') { return false; }

    originalOnPlayerEnter = prototype.onPlayerEnter;
    prototype.onPlayerEnter = function(callback) {
        return originalOnPlayerEnter.call(this, function(player) {
            callback(player);
            loadStoryInventory(player).catch(function(error) {
                logProgressError(player, error);
            });
            wrapNpcInteraction(player);
        });
    };
    prototype.__storyCompletionDialogueAttached = true;
    return true;
}

exports.resolveGiverProfileId = resolveGiverProfileId;
exports.normalizeObjectiveAmount = normalizeObjectiveAmount;
exports.findCompletableMission = findCompletableMission;
exports.findCompletionDialogue = findCompletionDialogue;
exports.sanitizeDialogue = sanitizeDialogue;
exports.createItemRewardStore = createItemRewardStore;
exports.loadStoryInventory = loadStoryInventory;
exports.applyGrantedItemRewards = applyGrantedItemRewards;
exports.queueCompletionDialogue = queueCompletionDialogue;
exports.queueMissionCompletion = queueMissionCompletion;
exports.isNpcLinkedMissionCompleted = isNpcLinkedMissionCompleted;
exports.wrapNpcInteraction = wrapNpcInteraction;
exports.attach = attach;