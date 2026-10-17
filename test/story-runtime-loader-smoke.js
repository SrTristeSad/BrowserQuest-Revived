'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    StoryStore = require('../server/admin/story-store').StoryStore,
    StoryRuntime = require('../server/story/runtime').StoryRuntime,
    startMission = require('../server/story/mission-service').startMission;

function forcePublished(storiesPath, ids) {
    var data = JSON.parse(fs.readFileSync(storiesPath, 'utf8')),
        wanted = Object.create(null),
        now = new Date().toISOString();
    ids.forEach(function(id) { wanted[id] = true; });
    data.stories.forEach(function(story) {
        if(wanted[story.id]) {
            story.status = 'published';
            story.publishedAt = story.publishedAt || now;
            story.updatedAt = now;
        }
    });
    fs.writeFileSync(storiesPath, JSON.stringify(data, null, 2) + '\n', {mode: 0o600});
}

async function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-story-runtime-')),
        storiesPath = path.join(dir, 'stories.json'),
        store = new StoryStore(storiesPath);

    try {
        store.save({
            id: 'draft-story',
            title: 'Rascunho',
            status: 'draft',
            entryMissionId: 'draft-mission',
            chapters: [{id: 'draft-chapter', missions: [{id: 'draft-mission', title: 'Não carregar'}]}]
        });

        // These fixtures intentionally bypass the modern pre-publication validator.
        // The runtime must remain defensive when loading legacy/corrupted published data.
        store.save({
            id: 'main-story',
            title: 'História Publicada',
            status: 'draft',
            entryMissionId: 'm1',
            chapters: [
                {
                    id: 'chapter-2',
                    order: 2,
                    title: 'Segundo',
                    missions: [
                        {id: 'm3', order: 1, title: 'Terceira', objective: {type: 'custom', target: 'safe-data-only'}}
                    ]
                },
                {
                    id: 'chapter-1',
                    order: 1,
                    title: 'Primeiro',
                    missions: [
                        {id: 'm2', order: 2, title: 'Segunda', nextMissionId: 'missing-next'},
                        {id: 'm1', order: 1, title: 'Primeira', nextMissionId: 'm2', choices: [{text: 'Ir', nextMissionId: 'missing-choice'}]},
                        {id: 'm1', order: 3, title: 'Duplicada'}
                    ]
                }
            ]
        });

        store.save({
            id: 'broken-entry',
            title: 'Entrada quebrada',
            status: 'draft',
            entryMissionId: 'does-not-exist',
            chapters: [{id: 'only-chapter', missions: []}]
        });
        forcePublished(storiesPath, ['main-story', 'broken-entry']);

        var runtime = new StoryRuntime(store),
            list = runtime.listStories(),
            story = runtime.getStory('main-story'),
            entry = runtime.getEntryMission('main-story'),
            custom = runtime.getMission('main-story', 'm3'),
            diagnostics = runtime.getDiagnostics();

        assert.strictEqual(list.length, 2, 'only published stories must enter runtime');
        assert.strictEqual(runtime.getStory('draft-story'), null, 'draft story must never enter runtime');
        assert.strictEqual(story.chapters[0].id, 'chapter-1', 'chapters must be sorted by order');
        assert.strictEqual(story.chapters[0].missions[0].id, 'm1', 'missions must be sorted by order');
        assert.strictEqual(entry.mission.id, 'm1');
        assert.strictEqual(entry.chapterId, 'chapter-1');
        assert.strictEqual(custom.mission.objective.type, 'custom');
        assert.strictEqual(custom.mission.objective.target, 'safe-data-only');
        assert.strictEqual(runtime.getMission('main-story', 'missing'), null);
        assert.strictEqual(runtime.getEntryMission('broken-entry'), null);

        assert.ok(diagnostics.some(function(item) { return item.code === 'duplicate_mission' && item.target === 'm1'; }));
        assert.ok(diagnostics.some(function(item) { return item.code === 'missing_next_mission' && item.target === 'missing-next'; }));
        assert.ok(diagnostics.some(function(item) { return item.code === 'missing_choice_mission' && item.target === 'missing-choice'; }));
        assert.ok(diagnostics.some(function(item) { return item.code === 'missing_entry_mission' && item.storyId === 'broken-entry'; }));

        story.title = 'Mutado fora';
        story.chapters[0].missions[0].title = 'Mutada fora';
        assert.strictEqual(runtime.getStory('main-story').title, 'História Publicada', 'getStory must return a clone');
        assert.strictEqual(runtime.getMission('main-story', 'm1').mission.title, 'Primeira', 'getMission must return a clone');

        var published = store.getPublishedStories();
        published[0].title = 'Mutado';
        assert.notStrictEqual(store.getPublishedStories()[0].title, 'Mutado', 'store must return defensive copies');

        store.save({
            id: 'live-story',
            title: 'Publicada sem reiniciar',
            status: 'draft',
            entryMissionId: 'live-m1',
            chapters: [{id: 'live-chapter', missions: [{id: 'live-m1', title: 'Nova missão'}]}]
        });
        forcePublished(storiesPath, ['live-story']);
        assert.strictEqual(runtime.getStory('live-story'), null, 'runtime snapshot must not mutate until reload');
        runtime.reload();
        assert.strictEqual(runtime.getStory('live-story').title, 'Publicada sem reiniciar', 'reload must index newly published stories');
        assert.strictEqual(runtime.getEntryMission('live-story').mission.id, 'live-m1');
        assert.strictEqual(store.remove('live-story'), true);
        runtime.reload();
        assert.strictEqual(runtime.getStory('live-story'), null, 'reload must remove deleted stories from live runtime');

        var savedCalls = [],
            progressStore = {
                save: async function(characterId, storyId, state) {
                    savedCalls.push({characterId: characterId, storyId: storyId, state: state});
                    return Object.assign({}, state, {updatedAt: '2026-10-17T09:00:00.000Z'});
                }
            },
            started = await startMission({
                runtime: runtime,
                progressStore: progressStore,
                characterId: 7,
                storyId: 'main-story',
                missionId: 'm1',
                states: [{storyId: 'main-story', activeMissionId: '', completedMissionIds: ['old'], flags: {met_guard: true}}]
            });

        assert.strictEqual(started.changed, true);
        assert.strictEqual(started.mission.mission.id, 'm1');
        assert.strictEqual(started.state.storyId, 'main-story');
        assert.strictEqual(started.state.activeMissionId, 'm1');
        assert.strictEqual(started.state.objectiveProgress, 0);
        assert.deepStrictEqual(started.state.completedMissionIds, ['old']);
        assert.strictEqual(started.state.flags.met_guard, true);
        assert.strictEqual(savedCalls.length, 1);
        assert.strictEqual(savedCalls[0].characterId, 7);

        var sameMission = await startMission({
            runtime: runtime,
            progressStore: progressStore,
            characterId: 7,
            storyId: 'main-story',
            missionId: 'm1',
            states: [started.state]
        });
        assert.strictEqual(sameMission.changed, false, 'starting the active mission again must be idempotent');
        assert.strictEqual(savedCalls.length, 1, 'idempotent start must not write again');

        await assert.rejects(function() {
            return startMission({runtime: runtime, storyId: 'draft-story', missionId: 'draft-mission', states: []});
        }, function(error) { return error && error.code === 'MISSION_NOT_FOUND'; });

        await assert.rejects(function() {
            return startMission({runtime: runtime, storyId: 'main-story', missionId: 'm2', states: [started.state]});
        }, function(error) { return error && error.code === 'MISSION_ALREADY_ACTIVE'; });

        await assert.rejects(function() {
            return startMission({runtime: runtime, progressStore: progressStore, storyId: 'main-story', missionId: 'm2', states: []});
        }, function(error) { return error && error.code === 'CHARACTER_REQUIRED'; });

        var guestStart = await startMission({runtime: runtime, storyId: 'main-story', missionId: 'm2', states: []});
        assert.strictEqual(guestStart.changed, true);
        assert.strictEqual(guestStart.state.activeMissionId, 'm2');

        var root = path.join(__dirname, '..'),
            bootstrap = fs.readFileSync(path.join(root, 'server', 'bootstrap.js'), 'utf8'),
            mainServer = fs.readFileSync(path.join(root, 'server', 'js', 'main.js'), 'utf8'),
            player = fs.readFileSync(path.join(root, 'server', 'js', 'player.js'), 'utf8'),
            adminHttp = fs.readFileSync(path.join(root, 'server', 'admin', 'http.js'), 'utf8');

        assert.ok(bootstrap.indexOf("StoryStore = require('./admin/story-store').StoryStore") !== -1, 'bootstrap must require StoryStore');
        assert.ok(bootstrap.indexOf("StoryRuntime = require('./story/runtime').StoryRuntime") !== -1, 'bootstrap must require StoryRuntime');
        assert.ok(bootstrap.indexOf("storyRuntime = new StoryRuntime(new StoryStore(path.join(configDir, 'stories.json')))" ) !== -1, 'bootstrap must instantiate the published Story Runtime');
        assert.ok(bootstrap.indexOf('story_runtime: storyRuntime') !== -1, 'bootstrap must inject Story Runtime into game config');
        assert.ok(bootstrap.indexOf('storyRuntime: storyRuntime') !== -1, 'bootstrap must share Story Runtime with admin mutations');
        assert.ok(mainServer.indexOf('connection.storyRuntime = config.story_runtime || null;') !== -1, 'game connections must receive Story Runtime');
        assert.ok(player.indexOf('this.storyRuntime = connection.storyRuntime || null;') !== -1, 'Player must retain Story Runtime reference');
        assert.ok(adminHttp.indexOf('storyRuntime = options.storyRuntime || null') !== -1, 'admin handler must receive Story Runtime');
        assert.ok(adminHttp.indexOf('reloadStoryRuntime = function()') !== -1, 'admin handler must define a safe reload helper');
        assert.ok(adminHttp.indexOf('var savedStory = stories.save(body);\n                reloadStoryRuntime();') !== -1, 'saving/publishing a story must reload the live runtime');
        assert.ok(adminHttp.indexOf("if(stories.remove(match[1])) {\n                reloadStoryRuntime();") !== -1, 'deleting a story must reload the live runtime');

        console.log('Story runtime loader, live reload and mission start smoke test passed.');
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
