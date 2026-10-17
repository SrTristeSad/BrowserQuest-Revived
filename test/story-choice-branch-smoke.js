'use strict';

var assert = require('assert'),
    MissionCompletion = require('../server/story/mission-completion'),
    ChoiceService = require('../server/story/choice-service'),
    Progress = require('../server/story/progress-store'),
    StoryRuntime = require('../server/story/runtime').StoryRuntime;

function mission(id, giver, options) {
    options = options || {};
    return {
        storyId: 'branch-story',
        chapterId: 'chapter',
        mission: {
            id: id,
            title: options.title || id,
            giverNpc: giver,
            objective: {type: 'talk', target: giver, amount: 1},
            rewards: options.rewards || [],
            nextMissionId: options.nextMissionId || '',
            choices: options.choices || [],
            introDialogue: options.introDialogue || []
        }
    };
}

async function expectCode(factory, code) {
    await assert.rejects(factory, function(error) { return error && error.code === code; });
}

async function main() {
    var entries = {
            fork: mission('fork', 'guide', {
                nextMissionId: 'fallback',
                rewards: [{type: 'story_flag', value: 'path_open', amount: 1}],
                choices: [
                    {text: 'Seguir pela ponte', nextMissionId: 'bridge', condition: 'flag:path_open&&completed:fork'},
                    {text: 'Voltar pela floresta', nextMissionId: 'forest', condition: '!flag:path_open'},
                    {text: 'Destino inválido', nextMissionId: 'missing', condition: ''}
                ]
            }),
            bridge: mission('bridge', 'captain', {introDialogue: [{text: 'Você escolheu a ponte.'}]}),
            forest: mission('forest', 'ranger'),
            fallback: mission('fallback', 'guide')
        },
        runtime = {
            getMission: function(storyId, missionId) {
                return storyId === 'branch-story' ? (entries[missionId] || null) : null;
            },
            getStory: function(storyId) {
                return storyId === 'branch-story' ? {id: storyId, title: 'História Ramificada'} : null;
            }
        },
        saves = [],
        progressStore = {
            save: async function(characterId, storyId, state) {
                saves.push({characterId: characterId, storyId: storyId, state: state});
                return state;
            }
        },
        initial = {
            version: 1,
            storyId: 'branch-story',
            activeMissionId: 'fork',
            objectiveProgress: 1,
            completedMissionIds: [],
            flags: {},
            startedAt: '2026-10-17T12:00:00.000Z'
        },
        completed = await MissionCompletion.completeMission({
            runtime: runtime,
            progressStore: progressStore,
            characterId: 55,
            storyId: 'branch-story',
            missionId: 'fork',
            giverProfileId: 'guide',
            states: [initial]
        });

    assert.strictEqual(completed.changed, true);
    assert.strictEqual(completed.awaitingChoice, true, 'missions with published choices must pause for a server-authoritative choice');
    assert.strictEqual(completed.nextMissionId, '', 'linear fallback must not auto-run when choices exist');
    assert.strictEqual(completed.state.activeMissionId, '');
    assert.strictEqual(completed.state.pendingChoiceMissionId, 'fork');
    assert.ok(completed.state.completedMissionIds.indexOf('fork') >= 0);
    assert.strictEqual(completed.state.flags.path_open, true, 'completion rewards must be applied before evaluating post-completion choices');
    assert.strictEqual(saves.length, 1, 'completion while awaiting a choice must persist exactly once');

    var reconnectState = Progress.normalizeStoryProgress(JSON.parse(JSON.stringify(completed.state)));
    assert.strictEqual(reconnectState.pendingChoiceMissionId, 'fork', 'pending choice must survive reconnect normalization');

    var available = ChoiceService.getAvailableChoices(runtime, 'branch-story', 'fork', reconnectState);
    assert.strictEqual(available.length, 1, 'only choices with valid targets and satisfied conditions are exposed');
    assert.strictEqual(available[0].index, 0);
    assert.strictEqual(available[0].nextMissionId, 'bridge');

    var selected = await ChoiceService.selectChoice({
        runtime: runtime,
        progressStore: progressStore,
        characterId: 55,
        storyId: 'branch-story',
        missionId: 'fork',
        choiceIndex: 0,
        states: [reconnectState]
    });
    assert.strictEqual(selected.changed, true);
    assert.strictEqual(selected.nextMissionId, 'bridge');
    assert.strictEqual(selected.state.activeMissionId, 'bridge');
    assert.strictEqual(selected.state.pendingChoiceMissionId, '');
    assert.strictEqual(selected.state.objectiveProgress, 0);
    assert.strictEqual(saves.length, 2, 'choice transition must persist exactly once');

    await expectCode(function() {
        return ChoiceService.selectChoice({
            runtime: runtime,
            progressStore: progressStore,
            characterId: 55,
            storyId: 'branch-story',
            missionId: 'fork',
            choiceIndex: 0,
            states: [selected.state]
        });
    }, 'STORY_CHOICE_NOT_PENDING');
    assert.strictEqual(saves.length, 2, 'retry after a selected branch must not write again');

    assert.strictEqual(ChoiceService.parseCondition('flag:a&&completed:b').valid, true);
    assert.strictEqual(ChoiceService.parseCondition('!flag:a').valid, true);
    assert.strictEqual(ChoiceService.parseCondition('flag:a=yes').valid, true);
    assert.strictEqual(ChoiceService.parseCondition('process.exit()').valid, false);
    assert.strictEqual(ChoiceService.parseCondition('flag:a||flag:b').valid, false);
    assert.strictEqual(ChoiceService.parseCondition('completed:a=yes').valid, false);
    assert.strictEqual(ChoiceService.evaluateCondition('flag:path_open&&completed:fork', reconnectState), true);
    assert.strictEqual(ChoiceService.evaluateCondition('!flag:path_open', reconnectState), false);

    var diagnosticRuntime = new StoryRuntime({
        getPublishedStories: function() {
            return [{
                id: 'diagnostic-story', status: 'published', entryMissionId: 'start', chapters: [{id: 'c', missions: [{
                    id: 'start', giverNpc: 'guide', objective: {type: 'talk', target: 'guide', amount: 1}, rewards: [],
                    nextMissionId: '', choices: [
                        {text: 'Loop', nextMissionId: 'start', condition: ''},
                        {text: 'Broken', nextMissionId: 'missing', condition: 'process.exit()'}
                    ]
                }]}]
            }];
        }
    });
    var codes = diagnosticRuntime.getDiagnostics().map(function(item) { return item.code; });
    assert.ok(codes.indexOf('self_choice_mission') >= 0);
    assert.ok(codes.indexOf('missing_choice_mission') >= 0);
    assert.ok(codes.indexOf('invalid_choice_condition') >= 0);

    console.log('Persistent conditional story choices smoke test passed.');
}

main().catch(function(error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
