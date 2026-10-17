'use strict';

var ChoiceService = require('../story/choice-service'),
    ItemRewards = require('../story/item-reward-store'),
    StateRewards = require('../story/state-reward-service'),
    AchievementCatalog = require('../persistence/account-progress').ACHIEVEMENT_IDS,
    Types = require('../../shared/js/gametypes');

function indexById(list) {
    var out = Object.create(null);
    (Array.isArray(list) ? list : []).forEach(function(item) {
        if(item && item.id) { out[String(item.id)] = item; }
    });
    return out;
}

function missionIndex(story) {
    var out = Object.create(null), duplicates = [];
    (story && story.chapters || []).forEach(function(chapter) {
        (chapter.missions || []).forEach(function(mission) {
            if(out[mission.id]) { duplicates.push(mission.id); }
            else { out[mission.id] = mission; }
        });
    });
    return {items: out, duplicates: duplicates};
}

function checkpointIds(worldState) {
    var out = Object.create(null), map = worldState && worldState.map || {};
    (Array.isArray(map.checkpoints) ? map.checkpoints : []).forEach(function(checkpoint) {
        if(checkpoint && checkpoint.id != null) { out['checkpoint:' + String(checkpoint.id)] = true; }
    });
    return out;
}

function add(errors, code, path, message) {
    errors.push({code: code, path: path, message: message});
}

function validateStoryReferences(story, worldState, options) {
    options = options || {};
    var errors = [],
        npcs = indexById(worldState && worldState.npcs),
        mobs = indexById(worldState && worldState.mobs),
        checkpoints = checkpointIds(worldState),
        missions = missionIndex(story),
        runtime = options.storyRuntime || null;

    if(!story || !story.id) {
        add(errors, 'invalid_story', 'story', 'História inválida.');
        return {ok: false, errors: errors};
    }
    if(!story.entryMissionId || !missions.items[story.entryMissionId]) {
        add(errors, 'invalid_entry_mission', 'entryMissionId', 'A missão inicial precisa apontar para uma missão real desta história.');
    }
    missions.duplicates.forEach(function(id) {
        add(errors, 'duplicate_mission_id', 'mission:' + id, 'IDs de missão precisam ser únicos dentro da história.');
    });

    Object.keys(missions.items).forEach(function(missionId) {
        var mission = missions.items[missionId],
            prefix = 'mission:' + missionId,
            objective = mission.objective || {};

        if(!mission.giverNpc || !npcs[mission.giverNpc]) {
            add(errors, 'invalid_giver_npc', prefix + '.giverNpc', 'O NPC que entrega a missão precisa existir no World Editor.');
        }

        if(mission.nextMissionId) {
            if(mission.nextMissionId === missionId) {
                add(errors, 'self_next_mission', prefix + '.nextMissionId', 'A próxima missão não pode ser a própria missão.');
            } else if(!missions.items[mission.nextMissionId]) {
                add(errors, 'missing_next_mission', prefix + '.nextMissionId', 'A próxima missão não existe nesta história.');
            }
        }

        (mission.choices || []).forEach(function(choice, index) {
            var choicePath = prefix + '.choices[' + index + ']';
            if(!choice.nextMissionId || !missions.items[choice.nextMissionId]) {
                add(errors, 'missing_choice_mission', choicePath + '.nextMissionId', 'O destino da escolha não existe nesta história.');
            } else if(choice.nextMissionId === missionId) {
                add(errors, 'self_choice_mission', choicePath + '.nextMissionId', 'A escolha não pode apontar para a própria missão.');
            }
            if(!ChoiceService.parseCondition(choice.condition).valid) {
                add(errors, 'invalid_choice_condition', choicePath + '.condition', 'Condição inválida. Use somente flag:, completed:, ! e &&.');
            }
        });

        if(objective.type === 'talk' && (!objective.target || !npcs[objective.target])) {
            add(errors, 'invalid_talk_npc', prefix + '.objective.target', 'Objetivo talk precisa apontar para um perfil de NPC real do World Editor.');
        }
        if(objective.type === 'kill' && (!objective.target || !mobs[objective.target])) {
            add(errors, 'invalid_kill_mob', prefix + '.objective.target', 'Objetivo kill precisa apontar para um perfil de mob real do World Editor.');
        }
        if(objective.type === 'collect') {
            var kind = Types.getKindFromString(String(objective.target || '').toLowerCase());
            if(!kind || !Types.isItem(kind)) {
                add(errors, 'invalid_collect_item', prefix + '.objective.target', 'Objetivo collect precisa apontar para um item canônico do jogo.');
            }
        }
        if(objective.type === 'visit' && (!objective.locationId || !checkpoints[objective.locationId])) {
            add(errors, 'invalid_visit_checkpoint', prefix + '.objective.locationId', 'Objetivo visit precisa apontar para um checkpoint real do World Editor (checkpoint:ID).');
        }
        if(objective.type === 'interact' && objective.target) {
            var npcMatch = String(objective.target).match(/^npc:([A-Za-z0-9_-]{1,120})$/);
            if(npcMatch && !npcs[npcMatch[1]]) {
                add(errors, 'invalid_interact_npc', prefix + '.objective.target', 'O NPC usado em interact não existe no World Editor.');
            } else if(!npcMatch && !/^chest:-?\d+:-?\d+$/.test(String(objective.target))) {
                add(errors, 'invalid_interact_target', prefix + '.objective.target', 'Interact aceita npc:ID ou chest:X:Y.');
            }
        }
        if(objective.type === 'custom' && runtime && typeof runtime.hasCustomHandler === 'function' && !runtime.hasCustomHandler('objective', objective.target)) {
            add(errors, 'missing_custom_objective_handler', prefix + '.objective.target', 'Handler custom de objetivo não está registrado no servidor.');
        }

        (mission.rewards || []).forEach(function(reward, index) {
            var rewardPath = prefix + '.rewards[' + index + ']';
            if(reward.type === 'item') {
                var resolved = ItemRewards.resolveItemReward(reward, index);
                if(!resolved || !resolved.valid) { add(errors, 'invalid_item_reward', rewardPath, 'Recompensa de item inválida ou não entregável.'); }
            } else if(reward.type === 'achievement') {
                var achievementId = Number(reward.value);
                if(!Number.isInteger(achievementId) || AchievementCatalog.indexOf(achievementId) < 0) {
                    add(errors, 'invalid_achievement_reward', rewardPath, 'ID de conquista inválido.');
                }
            } else if(reward.type === 'story_flag') {
                var flag = StateRewards.resolveStoryFlagReward(reward, index);
                if(!flag || !flag.valid) { add(errors, 'invalid_story_flag_reward', rewardPath, 'Chave de story flag inválida.'); }
            } else if(reward.type === 'custom' && runtime && typeof runtime.hasCustomHandler === 'function' && !runtime.hasCustomHandler('reward', reward.value)) {
                add(errors, 'missing_custom_reward_handler', rewardPath, 'Handler custom de recompensa não está registrado no servidor.');
            }
        });
    });

    return {ok: errors.length === 0, errors: errors};
}

function validateWorldStoryReferences(worldState, stories) {
    var errors = [], storyIndex = Object.create(null);
    (Array.isArray(stories) ? stories : []).forEach(function(story) {
        storyIndex[story.id] = missionIndex(story).items;
    });
    (worldState && worldState.npcs || []).forEach(function(npc) {
        if(!npc || npc.enabled === false) { return; }
        var storyId = String(npc.storyId || '').trim(), missionId = String(npc.missionId || '').trim(), completionId = String(npc.completionMissionId || '').trim();
        if(!storyId && !missionId && !completionId) { return; }
        if(!storyId || !storyIndex[storyId]) {
            add(errors, 'invalid_npc_story', 'npc:' + npc.id + '.storyId', 'NPC referencia uma história inexistente.');
            return;
        }
        if(!missionId || !storyIndex[storyId][missionId]) {
            add(errors, 'invalid_npc_mission', 'npc:' + npc.id + '.missionId', 'NPC referencia uma missão inexistente nessa história.');
        }
        if(completionId && !storyIndex[storyId][completionId]) {
            add(errors, 'invalid_npc_completion_mission', 'npc:' + npc.id + '.completionMissionId', 'Missão de conclusão do NPC não existe nessa história.');
        }
    });
    return {ok: errors.length === 0, errors: errors};
}

function buildReferenceCatalog(storyStore, worldState) {
    var stories = [], npcs = [], mobs = [], checkpoints = [];
    if(storyStore && typeof storyStore.list === 'function' && typeof storyStore.get === 'function') {
        storyStore.list().forEach(function(summary) {
            var full = storyStore.get(summary.id), missions = [];
            (full && full.chapters || []).forEach(function(chapter) {
                (chapter.missions || []).forEach(function(mission) {
                    missions.push({id: mission.id, title: mission.title, chapterId: chapter.id, chapterTitle: chapter.title});
                });
            });
            stories.push({id: summary.id, title: summary.title, status: summary.status, missions: missions});
        });
    }
    (worldState && worldState.npcs || []).forEach(function(npc) { npcs.push({id: npc.id, name: npc.name, enabled: npc.enabled !== false}); });
    (worldState && worldState.mobs || []).forEach(function(mob) { mobs.push({id: mob.id, name: mob.name, baseKind: mob.baseKind, enabled: mob.enabled !== false}); });
    ((worldState && worldState.map && worldState.map.checkpoints) || []).forEach(function(cp) {
        if(cp && cp.id != null) { checkpoints.push({id: 'checkpoint:' + String(cp.id), label: 'Checkpoint ' + String(cp.id)}); }
    });
    return {stories: stories, npcs: npcs, mobs: mobs, checkpoints: checkpoints};
}

exports.validateStoryReferences = validateStoryReferences;
exports.validateWorldStoryReferences = validateWorldStoryReferences;
exports.buildReferenceCatalog = buildReferenceCatalog;
