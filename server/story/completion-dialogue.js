'use strict';

var Utils = require('../js/utils'),
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
    var amount = Number(objective && objective.amount || 1);
    if(!Number.isFinite(amount) || amount < 1) { amount = 1; }
    return Math.min(Math.floor(amount), 100000);
}

function findCompletionDialogue(options) {
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
            giverNpc,
            dialogue;

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

        dialogue = Array.isArray(mission.completionDialogue) ? mission.completionDialogue : [];
        if(!dialogue.length) { return; }

        candidates.push({
            mission: missionEntry,
            state: current,
            dialogue: dialogue,
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

        lines = result.dialogue.slice(0, 100).map(function(line) {
            return Utils.sanitize(line && line.text || '').substr(0, 2000);
        }).filter(function(text) {
            return text;
        });

        if(!lines.length) {
            return {sent: false, result: result, lines: []};
        }

        player.send([Types.Messages.STORY_DIALOGUE, sourceNpcId, lines]);
        return {sent: true, result: result, lines: lines};
    });
}

function logProgressError(player, error) {
    if(typeof log !== 'undefined' && log && typeof log.error === 'function') {
        log.error('Story completion dialogue failed for ' + ((player && (player.name || player.id)) || 'player') + ': ' + (error && error.message ? error.message : error));
    }
}

function wrapNpcInteraction(player) {
    var original;

    if(!player || player.__storyCompletionDialogueWrapped || typeof player.onNpcInteract !== 'function') { return false; }
    original = player.npcinteract_callback;
    player.onNpcInteract(function(npc) {
        queueCompletionDialogue(player, npc).catch(function(error) {
            logProgressError(player, error);
        });
        if(original) { original(npc); }
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
            wrapNpcInteraction(player);
        });
    };
    prototype.__storyCompletionDialogueAttached = true;
    return true;
}

exports.resolveGiverProfileId = resolveGiverProfileId;
exports.normalizeObjectiveAmount = normalizeObjectiveAmount;
exports.findCompletionDialogue = findCompletionDialogue;
exports.queueCompletionDialogue = queueCompletionDialogue;
exports.wrapNpcInteraction = wrapNpcInteraction;
exports.attach = attach;
