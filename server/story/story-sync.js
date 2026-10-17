'use strict';

var StoryProtocol = require('../../shared/js/storyprotocol'),
    MissionService = require('./mission-service'),
    MissionCompletion = require('./mission-completion'),
    ChoiceService = require('./choice-service'),
    normalizeStoryProgress = require('./progress-store').normalizeStoryProgress,
    Utils = require('../js/utils'),
    Types = require('../../shared/js/gametypes');

function safeText(value, max) {
    return Utils.sanitize(String(value == null ? '' : value)).substr(0, max || 500);
}

function objectiveLabel(objective) {
    objective = objective || {};
    if(objective.text) { return safeText(objective.text, 500); }
    var target = safeText(objective.target || objective.locationId || '', 120),
        labels = {
            talk: 'Fale com',
            kill: 'Derrote',
            collect: 'Colete',
            visit: 'Visite',
            interact: 'Interaja com',
            custom: 'Objetivo'
        };
    return (labels[objective.type] || 'Objetivo') + (target ? ': ' + target : '');
}

function missionPayload(runtime, state) {
    var current = normalizeStoryProgress(state),
        entry,
        story,
        mission,
        amount;
    if(!current.storyId || !current.activeMissionId || !runtime || typeof runtime.getMission !== 'function') { return null; }
    entry = runtime.getMission(current.storyId, current.activeMissionId);
    if(!entry || !entry.mission) { return null; }
    story = typeof runtime.getStory === 'function' ? runtime.getStory(current.storyId) : null;
    mission = entry.mission;
    amount = MissionCompletion.normalizeObjectiveAmount(mission.objective || {});
    return {
        storyId: current.storyId,
        storyTitle: safeText(story && story.title || current.storyId, 180),
        missionId: current.activeMissionId,
        title: safeText(mission.title || current.activeMissionId, 160),
        summary: safeText(mission.summary || '', 500),
        objective: objectiveLabel(mission.objective),
        progress: Math.min(amount, Math.max(0, Number(current.objectiveProgress) || 0)),
        amount: amount
    };
}

function choicePayload(runtime, state) {
    var current = normalizeStoryProgress(state),
        missionId = current.pendingChoiceMissionId,
        entry,
        story,
        choices;
    if(!missionId || !runtime || typeof runtime.getMission !== 'function') { return null; }
    entry = runtime.getMission(current.storyId, missionId);
    if(!entry || !entry.mission) { return null; }
    story = typeof runtime.getStory === 'function' ? runtime.getStory(current.storyId) : null;
    choices = ChoiceService.getAvailableChoices(runtime, current.storyId, missionId, current).map(function(choice) {
        return {index: choice.index, text: safeText(choice.text, 300)};
    });
    return {
        storyId: current.storyId,
        storyTitle: safeText(story && story.title || current.storyId, 180),
        missionId: missionId,
        missionTitle: safeText(entry.mission.title || missionId, 160),
        choices: choices
    };
}

function buildClientState(player) {
    var runtime = player && player.storyRuntime,
        states = Array.isArray(player && player.storyState) ? player.storyState : [],
        missions = [],
        choices = [];
    states.forEach(function(state) {
        var mission = missionPayload(runtime, state), pending = choicePayload(runtime, state);
        if(mission) { missions.push(mission); }
        if(pending && pending.choices.length) { choices.push(pending); }
    });
    missions.sort(function(a, b) { return (a.storyId + '\u0000' + a.missionId).localeCompare(b.storyId + '\u0000' + b.missionId); });
    choices.sort(function(a, b) { return (a.storyId + '\u0000' + a.missionId).localeCompare(b.storyId + '\u0000' + b.missionId); });
    return {version: 1, missions: missions, choices: choices};
}

function sendPlayerState(player) {
    if(!player || typeof player.send !== 'function') { return false; }
    player.send([StoryProtocol.STORY_STATE, buildClientState(player)]);
    return true;
}

function shouldSyncResult(result) {
    if(!result || typeof result !== 'object') { return false; }
    if(result.changed === true || result.completed === true) { return true; }
    if(Array.isArray(result.updates) && result.updates.length) { return true; }
    if(Array.isArray(result.results) && result.results.some(shouldSyncResult)) { return true; }
    return false;
}

function sanitizeDialogue(dialogue) {
    return (Array.isArray(dialogue) ? dialogue : []).slice(0, 100).map(function(line) {
        return safeText(line && line.text || '', 2000);
    }).filter(Boolean);
}

function handleChoice(player, storyId, missionId, choiceIndex) {
    if(!player || typeof player.queueStoryOperation !== 'function') {
        return Promise.reject(new Error('Player Story Runtime indisponível.'));
    }
    return player.queueStoryOperation(function() {
        return ChoiceService.selectChoice({
            runtime: player.storyRuntime,
            progressStore: player.storyProgress,
            characterId: player.characterId,
            storyId: storyId,
            missionId: missionId,
            choiceIndex: choiceIndex,
            states: player.storyState
        }).then(function(result) {
            var lines;
            player.storyState = MissionService.upsertStoryState(player.storyState, result.state);
            lines = sanitizeDialogue(result.nextMission && result.nextMission.mission && result.nextMission.mission.introDialogue);
            if(lines.length) {
                player.send([Types.Messages.STORY_DIALOGUE, 0, lines]);
            }
            return result;
        });
    });
}

function logStoryError(player, error) {
    if(typeof log !== 'undefined' && log && typeof log.error === 'function') {
        log.error('Story sync failed for ' + ((player && (player.name || player.id)) || 'player') + ': ' + (error && error.message ? error.message : error));
    }
}

function attachPlayer(player) {
    var originalQueue,
        originalMessage;
    if(!player || player.__storySyncAttached || typeof player.queueStoryOperation !== 'function' || typeof player.onMessage !== 'function') { return false; }

    originalQueue = player.queueStoryOperation.bind(player);
    player.queueStoryOperation = function(operation) {
        return originalQueue(function() {
            return Promise.resolve().then(operation).then(function(result) {
                if(shouldSyncResult(result)) { sendPlayerState(player); }
                return result;
            });
        });
    };

    originalMessage = player.message_callback;
    player.onMessage(function(message) {
        if(Array.isArray(message) && message[0] === StoryProtocol.STORY_CHOICE_SELECT) {
            handleChoice(player, message[1], message[2], message[3]).catch(function(error) {
                logStoryError(player, error);
                sendPlayerState(player);
            });
            return;
        }
        if(originalMessage) { originalMessage(message); }
    });

    player.__storySyncAttached = true;
    setImmediate(function() {
        if(player.hasEnteredGame) { sendPlayerState(player); }
    });
    return true;
}

function attach(WorldServer) {
    var prototype, originalOnPlayerEnter;
    if(!WorldServer || !WorldServer.prototype) { return false; }
    prototype = WorldServer.prototype;
    if(prototype.__storySyncAttached) { return true; }
    if(typeof prototype.onPlayerEnter !== 'function') { return false; }
    originalOnPlayerEnter = prototype.onPlayerEnter;
    prototype.onPlayerEnter = function(callback) {
        return originalOnPlayerEnter.call(this, function(player) {
            callback(player);
            attachPlayer(player);
        });
    };
    prototype.__storySyncAttached = true;
    return true;
}

exports.safeText = safeText;
exports.objectiveLabel = objectiveLabel;
exports.buildClientState = buildClientState;
exports.sendPlayerState = sendPlayerState;
exports.shouldSyncResult = shouldSyncResult;
exports.handleChoice = handleChoice;
exports.attachPlayer = attachPlayer;
exports.attach = attach;
