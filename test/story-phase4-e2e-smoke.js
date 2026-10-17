'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    StoryStore = require('../server/admin/story-store').StoryStore,
    WorldStore = require('../server/admin/world-store').WorldStore,
    StoryRuntime = require('../server/story/runtime').StoryRuntime,
    MissionService = require('../server/story/mission-service'),
    MissionCompletion = require('../server/story/mission-completion'),
    ReferenceValidator = require('../server/admin/story-reference-validator');

function storyDefinition(status, target) {
    return {
        id: 'phase4-e2e',
        title: 'Teste completo da Fase 4',
        description: 'Campanha publicada pelo mesmo formato do Story Editor.',
        status: status,
        entryMissionId: 'hunt-rat',
        chapters: [{
            id: 'chapter-one',
            title: 'Capítulo 1',
            missions: [{
                id: 'hunt-rat',
                title: 'Proteja a vila',
                summary: 'Derrote o rato marcado.',
                giverNpc: 'guide-e2e',
                introDialogue: [{speaker: 'Guia', text: 'Derrote o rato.'}],
                completionDialogue: [{speaker: 'Guia', text: 'A vila está segura.'}],
                objective: {type: 'kill', target: target || 'rat-e2e', amount: 1, text: 'Derrote o rato da vila.'},
                rewards: [{type: 'story_flag', value: 'village_safe', amount: 1}],
                nextMissionId: '',
                choices: []
            }]
        }]
    };
}

async function main() {
    var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-phase4-e2e-')),
        storiesPath = path.join(temp, 'stories.json'),
        worldStatePath = path.join(temp, 'world-editor.json'),
        publishedServer = path.join(temp, 'world-server.json'),
        publishedClient = path.join(temp, 'world-client.json'),
        publishedClientJs = path.join(temp, 'world-client.js'),
        versions = path.join(temp, 'versions'),
        world = new WorldStore({
            baseMapPath: path.join(__dirname, '..', 'server', 'maps', 'world_server.json'),
            baseClientMapPath: path.join(__dirname, '..', 'client', 'maps', 'world_client.json'),
            statePath: worldStatePath,
            publishedMapPath: publishedServer,
            publishedClientJsonPath: publishedClient,
            publishedClientJsPath: publishedClientJs,
            versionsDir: versions,
            storiesPath: storiesPath
        }),
        worldState = world.load();

    worldState.npcs.push({
        id: 'guide-e2e', name: 'Guia E2E', baseKind: 'villager', enabled: true,
        dialogue: ['Olá.'], storyId: 'phase4-e2e', missionId: 'hunt-rat', completionMissionId: ''
    });
    worldState.mobs.push({
        id: 'rat-e2e', name: 'Rato E2E', baseKind: 'rat', enabled: true,
        hitPoints: 10, armorLevel: 0, weaponLevel: 1, respawnMs: 5000, aggroDistance: 5, drops: []
    });
    worldState.map.entities.push({id: 'guide-placement', x: 2, y: 2, kind: 'villager', profileType: 'npc', profileId: 'guide-e2e'});
    worldState.map.roamingAreas.push({id: 900001, x: 4, y: 4, width: 4, height: 4, nb: 1, type: 'rat', profileId: 'rat-e2e'});
    world.save(worldState);

    var stories = new StoryStore(storiesPath, {worldStatePath: worldStatePath});
    stories.save(storyDefinition('draft', 'missing-mob'));
    assert.throws(function() {
        stories.save(storyDefinition('published', 'missing-mob'));
    }, function(error) {
        return error && error.code === 'STORY_REFERENCE_VALIDATION' && /invalid_kill_mob|mob real/i.test(error.message);
    }, 'Story Editor publication must reject a kill target that is not a real World Editor mob profile');

    var publishedStory = stories.save(storyDefinition('published', 'rat-e2e'));
    assert.strictEqual(publishedStory.status, 'published');
    assert.ok(publishedStory.publishedAt);

    var badWorld = JSON.parse(JSON.stringify(world.load()));
    badWorld.npcs[0].missionId = 'missing-mission';
    var badWorldRefs = ReferenceValidator.validateWorldStoryReferences(badWorld, stories.getPublishedStories());
    assert.strictEqual(badWorldRefs.ok, false);
    assert.ok(badWorldRefs.errors.some(function(item) { return item.code === 'invalid_npc_mission'; }));

    var worldPublish = world.publish();
    assert.strictEqual(worldPublish.ok, true, 'World Editor must publish after cross-editor references are valid');
    var publishedMap = JSON.parse(fs.readFileSync(publishedServer, 'utf8'));
    assert.strictEqual(publishedMap.editorProfiles.npcs['guide-e2e'].storyId, 'phase4-e2e');
    assert.strictEqual(publishedMap.editorProfiles.npcs['guide-e2e'].missionId, 'hunt-rat');
    assert.strictEqual(publishedMap.editorProfiles.mobs['rat-e2e'].baseKind, 'rat');

    var runtime = new StoryRuntime(stories),
        durable = Object.create(null),
        saves = 0,
        progressStore = {
            save: async function(characterId, storyId, state) {
                saves += 1;
                durable[characterId + ':' + storyId] = JSON.parse(JSON.stringify(state));
                return JSON.parse(JSON.stringify(state));
            },
            list: async function(characterId) {
                return Object.keys(durable).filter(function(key) { return key.indexOf(characterId + ':') === 0; }).map(function(key) {
                    return JSON.parse(JSON.stringify(durable[key]));
                });
            }
        },
        start = await MissionService.startMission({
            runtime: runtime,
            progressStore: progressStore,
            characterId: 77,
            storyId: 'phase4-e2e',
            missionId: 'hunt-rat',
            states: []
        });

    assert.strictEqual(start.changed, true);
    assert.strictEqual(start.state.activeMissionId, 'hunt-rat');

    var progress = await MissionService.progressKillObjectives({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        targetId: 'rat-e2e',
        states: [start.state]
    });
    assert.strictEqual(progress.changed, true);
    assert.strictEqual(progress.updates[0].state.objectiveProgress, 1);

    var completion = await MissionCompletion.completeMission({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 77,
        storyId: 'phase4-e2e',
        missionId: 'hunt-rat',
        giverProfileId: 'guide-e2e',
        states: [progress.updates[0].state]
    });
    assert.strictEqual(completion.changed, true);
    assert.strictEqual(completion.state.activeMissionId, '');
    assert.ok(completion.state.completedMissionIds.indexOf('hunt-rat') >= 0);
    assert.strictEqual(completion.state.flags.village_safe, true, 'published mission reward must be persisted with completion');

    var reconnectRuntime = new StoryRuntime(new StoryStore(storiesPath, {worldStatePath: worldStatePath})),
        reconnectStates = await progressStore.list(77);
    assert.ok(reconnectRuntime.getMission('phase4-e2e', 'hunt-rat'), 'published story must reload in a fresh runtime');
    assert.strictEqual(reconnectStates.length, 1);
    assert.ok(reconnectStates[0].completedMissionIds.indexOf('hunt-rat') >= 0, 'reconnect must recover the completed mission');
    assert.strictEqual(reconnectStates[0].flags.village_safe, true, 'reconnect must recover the reward/progress state');
    assert.ok(saves >= 3, 'accept, objective and completion must each finish in durable progress writes');

    fs.rmSync(temp, {recursive: true, force: true});
    console.log('Story Editor -> publish -> gameplay -> reward -> reconnect Phase 4 E2E smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
