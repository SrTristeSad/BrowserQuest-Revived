'use strict';

var MissionService = require('./mission-service'),
    StorySync = require('./story-sync'),
    StoryVisitProgress = require('./visit-progress'),
    StoryInteractProgress = require('./interact-progress'),
    StoryCompletionDialogue = require('./completion-dialogue'),
    Types = require('../../shared/js/gametypes');

function resolveMobTarget(mob) {
    var profileId;

    if(!mob) { return ''; }
    profileId = mob.editorData ? String(mob.editorData.id || '').trim() : '';
    if(profileId) { return profileId; }
    if(mob.kind == null) { return ''; }
    return String(Types.getKindAsString(mob.kind) || '').trim();
}

function progressKill(attacker, mob) {
    var targetId = resolveMobTarget(mob);

    if(!attacker || attacker.type !== 'player' || !targetId || typeof attacker.queueStoryOperation !== 'function') {
        return Promise.resolve({changed: false, updates: []});
    }

    return attacker.queueStoryOperation(function() {
        return MissionService.progressKillObjectives({
            runtime: attacker.storyRuntime,
            progressStore: attacker.storyProgress,
            characterId: attacker.characterId,
            targetId: targetId,
            states: attacker.storyState
        }).then(function(result) {
            (result.updates || []).forEach(function(update) {
                attacker.storyState = MissionService.upsertStoryState(attacker.storyState, update.state);
            });
            return result;
        });
    });
}

function attach(WorldServer) {
    var prototype,
        original;

    if(!WorldServer || !WorldServer.prototype) { return false; }
    StorySync.attach(WorldServer);
    StoryVisitProgress.attach(WorldServer);
    StoryInteractProgress.attach(WorldServer);
    StoryCompletionDialogue.attach(WorldServer);
    prototype = WorldServer.prototype;
    if(prototype.__storyKillProgressAttached) { return true; }
    if(typeof prototype.handleHurtEntity !== 'function') { return false; }

    original = prototype.handleHurtEntity;
    prototype.handleHurtEntity = function(entity, attacker, damage) {
        if(entity && entity.type === 'mob' && entity.hitPoints <= 0 && attacker && attacker.type === 'player') {
            progressKill(attacker, entity).catch(function(error) {
                if(typeof log !== 'undefined' && log && typeof log.error === 'function') {
                    log.error('Story kill progress failed for ' + (attacker.name || attacker.id) + ': ' + (error && error.message ? error.message : error));
                }
            });
        }
        return original.call(this, entity, attacker, damage);
    };
    prototype.__storyKillProgressAttached = true;
    return true;
}

exports.resolveMobTarget = resolveMobTarget;
exports.progressKill = progressKill;
exports.attach = attach;
