'use strict';

var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    StoryStore = require('../server/admin/story-store').StoryStore,
    StoryRuntime = require('../server/story/runtime').StoryRuntime;

function main() {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-story-runtime-')),
        store = new StoryStore(path.join(dir, 'stories.json'));

    try {
        store.save({
            id: 'draft-story',
            title: 'Rascunho',
            status: 'draft',
            entryMissionId: 'draft-mission',
            chapters: [{id: 'draft-chapter', missions: [{id: 'draft-mission', title: 'Não carregar'}]}]
        });

        store.save({
            id: 'main-story',
            title: 'História Publicada',
            status: 'published',
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
            status: 'published',
            entryMissionId: 'does-not-exist',
            chapters: [{id: 'only-chapter', missions: []}]
        });

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

        console.log('Story runtime loader smoke test passed.');
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
}

try { main(); }
catch(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
}
