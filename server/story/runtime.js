'use strict';

var CustomHandlers = require('./custom-handler-registry'),
    CustomHandlerRegistry = CustomHandlers.CustomHandlerRegistry,
    parseHandlerId = CustomHandlers.parseHandlerId,
    ChoiceService = require('./choice-service');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function byOrder(a, b) {
    return Number(a && a.order || 0) - Number(b && b.order || 0);
}

function StoryRuntime(store, options) {
    if(!store || typeof store.getPublishedStories !== 'function') {
        throw new Error('StoryRuntime requires a story store with getPublishedStories().');
    }
    options = options || {};
    if(options.customHandlers != null && !(options.customHandlers instanceof CustomHandlerRegistry)) {
        throw new Error('StoryRuntime customHandlers must be a CustomHandlerRegistry.');
    }
    this.store = store;
    this.customHandlers = options.customHandlers || new CustomHandlerRegistry();
    this.stories = new Map();
    this.diagnostics = [];
    this.reload();
}

StoryRuntime.prototype.reload = function() {
    var self = this,
        published = this.store.getPublishedStories();

    this.stories = new Map();
    this.diagnostics = [];

    published.forEach(function(rawStory) {
        if(!rawStory || rawStory.status !== 'published' || !rawStory.id) { return; }

        var story = clone(rawStory),
            chapters = Array.isArray(story.chapters) ? story.chapters.slice().sort(byOrder) : [],
            chapterIndex = new Map(),
            missionIndex = new Map();

        chapters.forEach(function(chapter) {
            if(!chapter || !chapter.id) { return; }
            if(chapterIndex.has(chapter.id)) {
                self._warn(story.id, 'duplicate_chapter', chapter.id, 'Capítulo duplicado ignorado.');
                return;
            }
            chapterIndex.set(chapter.id, chapter);

            var missions = Array.isArray(chapter.missions) ? chapter.missions.slice().sort(byOrder) : [];
            chapter.missions = missions;
            missions.forEach(function(mission) {
                if(!mission || !mission.id) { return; }
                if(missionIndex.has(mission.id)) {
                    self._warn(story.id, 'duplicate_mission', mission.id, 'Missão duplicada ignorada no índice.');
                    return;
                }
                missionIndex.set(mission.id, {storyId: story.id, chapterId: chapter.id, mission: mission});
            });
        });

        story.chapters = chapters;
        self.stories.set(story.id, {
            story: story,
            chapters: chapterIndex,
            missions: missionIndex
        });
    });

    this.stories.forEach(function(entry, storyId) {
        var story = entry.story;
        if(story.entryMissionId && !entry.missions.has(story.entryMissionId)) {
            self._warn(storyId, 'missing_entry_mission', story.entryMissionId, 'Missão inicial não existe nesta história.');
        }

        entry.missions.forEach(function(missionEntry) {
            var mission = missionEntry.mission;
            if(mission.nextMissionId === mission.id) {
                self._warn(storyId, 'self_next_mission', mission.nextMissionId, 'Próxima missão aponta para a própria missão.', mission.id);
            } else if(mission.nextMissionId && !entry.missions.has(mission.nextMissionId)) {
                self._warn(storyId, 'missing_next_mission', mission.nextMissionId, 'Próxima missão não existe nesta história.', mission.id);
            }
            (Array.isArray(mission.choices) ? mission.choices : []).forEach(function(choice) {
                var target = String(choice && choice.nextMissionId || '').trim(),
                    condition = ChoiceService.parseCondition(choice && choice.condition);
                if(target === mission.id) {
                    self._warn(storyId, 'self_choice_mission', target, 'Escolha aponta para a própria missão.', mission.id);
                } else if(target && !entry.missions.has(target)) {
                    self._warn(storyId, 'missing_choice_mission', target, 'Destino de escolha não existe nesta história.', mission.id);
                }
                if(!target) {
                    self._warn(storyId, 'missing_choice_target', '', 'Escolha publicada não possui missão de destino.', mission.id);
                }
                if(!condition.valid) {
                    self._warn(storyId, 'invalid_choice_condition', choice && choice.condition, 'Condição de escolha inválida ou insegura.', mission.id);
                }
            });

            if(mission.objective && mission.objective.type === 'custom') {
                self._checkCustomHandler(storyId, mission.id, 'objective', mission.objective.target);
            }
            (Array.isArray(mission.rewards) ? mission.rewards : []).forEach(function(reward) {
                if(reward && reward.type === 'custom') {
                    self._checkCustomHandler(storyId, mission.id, 'reward', reward.value);
                }
            });
        });
    });

    return this.snapshot();
};

StoryRuntime.prototype._warn = function(storyId, code, target, message, missionId) {
    this.diagnostics.push({
        level: 'warning',
        storyId: storyId,
        missionId: missionId || null,
        code: code,
        target: target || null,
        message: message
    });
};

StoryRuntime.prototype._checkCustomHandler = function(storyId, missionId, kind, rawId) {
    var id = parseHandlerId(rawId),
        label = kind === 'objective' ? 'objetivo' : 'recompensa';
    if(!id) {
        this._warn(storyId, 'invalid_custom_' + kind + '_handler', rawId, 'ID de handler custom inválido para ' + label + '.', missionId);
        return;
    }
    if(!this.customHandlers.has(kind, id)) {
        this._warn(storyId, 'missing_custom_' + kind + '_handler', id, 'Handler custom não registrado no servidor para ' + label + '.', missionId);
    }
};

StoryRuntime.prototype.resolveCustomHandler = function(kind, id) {
    return this.customHandlers.resolve(kind, id);
};

StoryRuntime.prototype.hasCustomHandler = function(kind, id) {
    return this.customHandlers.has(kind, id);
};

StoryRuntime.prototype.listCustomHandlers = function(kind) {
    return this.customHandlers.list(kind);
};

StoryRuntime.prototype.getStory = function(storyId) {
    var entry = this.stories.get(String(storyId || ''));
    return entry ? clone(entry.story) : null;
};

StoryRuntime.prototype.getChapter = function(storyId, chapterId) {
    var entry = this.stories.get(String(storyId || '')),
        chapter = entry && entry.chapters.get(String(chapterId || ''));
    return chapter ? clone(chapter) : null;
};

StoryRuntime.prototype.getMission = function(storyId, missionId) {
    var entry = this.stories.get(String(storyId || '')),
        missionEntry = entry && entry.missions.get(String(missionId || ''));
    return missionEntry ? clone(missionEntry) : null;
};

StoryRuntime.prototype.getEntryMission = function(storyId) {
    var story = this.getStory(storyId);
    if(!story || !story.entryMissionId) { return null; }
    return this.getMission(storyId, story.entryMissionId);
};

StoryRuntime.prototype.listStories = function() {
    var result = [];
    this.stories.forEach(function(entry) {
        result.push({
            id: entry.story.id,
            title: entry.story.title,
            description: entry.story.description || '',
            entryMissionId: entry.story.entryMissionId || '',
            chapterCount: entry.chapters.size,
            missionCount: entry.missions.size,
            publishedAt: entry.story.publishedAt || null
        });
    });
    return result;
};

StoryRuntime.prototype.getDiagnostics = function() {
    return clone(this.diagnostics);
};

StoryRuntime.prototype.snapshot = function() {
    return {
        stories: this.listStories(),
        diagnostics: this.getDiagnostics()
    };
};

exports.StoryRuntime = StoryRuntime;
