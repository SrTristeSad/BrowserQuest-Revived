'use strict';

var fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    ReferenceValidator = require('./story-reference-validator');

var OBJECTIVE_TYPES = ['talk', 'kill', 'collect', 'visit', 'interact', 'custom'],
    REWARD_TYPES = ['item', 'achievement', 'story_flag', 'custom'];

function StoryStore(filepath, options) {
    options = options || {};
    this.filepath = filepath;
    this.worldStatePath = options.worldStatePath || path.join(path.dirname(filepath), 'world-editor.json');
    this.storyRuntime = options.storyRuntime || null;
    fs.mkdirSync(path.dirname(filepath), {recursive: true, mode: 0o700});
    if(!fs.existsSync(filepath)) {
        this._write({version: 1, stories: []});
    }
}

StoryStore.prototype._read = function() {
    try {
        var data = JSON.parse(fs.readFileSync(this.filepath, 'utf8'));
        if(!data || !Array.isArray(data.stories)) {
            throw new Error('Invalid story store');
        }
        return data;
    } catch(error) {
        throw new Error('Could not read story store: ' + error.message);
    }
};

StoryStore.prototype._readWorldState = function() {
    try {
        return JSON.parse(fs.readFileSync(this.worldStatePath, 'utf8'));
    } catch(error) {
        return null;
    }
};

StoryStore.prototype._write = function(data) {
    var temp = this.filepath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', {mode: 0o600});
    fs.renameSync(temp, this.filepath);
    fs.chmodSync(this.filepath, 0o600);
};

StoryStore.prototype.list = function() {
    return this._read().stories.map(function(story) {
        return {
            id: story.id,
            title: story.title,
            description: story.description || '',
            status: story.status,
            createdAt: story.createdAt,
            updatedAt: story.updatedAt,
            publishedAt: story.publishedAt || null,
            chapterCount: story.chapters.length,
            missionCount: story.chapters.reduce(function(total, chapter) {
                return total + chapter.missions.length;
            }, 0)
        };
    });
};

StoryStore.prototype.get = function(id) {
    return this._read().stories.find(function(story) {
        return story.id === id;
    }) || null;
};

StoryStore.prototype.getPublishedStories = function() {
    return this._read().stories.filter(function(story) {
        return story && story.status === 'published';
    }).map(function(story) {
        return JSON.parse(JSON.stringify(story));
    });
};

StoryStore.prototype.validateForPublication = function(story) {
    var worldState = this._readWorldState(), result, error;
    // Runtime/unit stores can exist without the admin World Editor. The real admin
    // constructs WorldStore alongside StoryStore, and WorldStore materializes the
    // base state immediately, so every editor publication still receives the full
    // cross-editor validation below.
    if(!worldState) {
        return {ok: true, skippedWorldValidation: true, errors: []};
    }
    result = ReferenceValidator.validateStoryReferences(story, worldState, {storyRuntime: this.storyRuntime});
    if(!result.ok) {
        error = new Error('Referências inválidas: ' + result.errors.slice(0, 6).map(function(item) {
            return item.path + ' — ' + item.message;
        }).join(' | '));
        error.code = 'STORY_REFERENCE_VALIDATION';
        error.details = result.errors;
        throw error;
    }
    return result;
};

StoryStore.prototype.save = function(input) {
    var data = this._read(),
        now = new Date().toISOString(),
        normalized = normalizeStory(input),
        index;

    if(normalized.status === 'published') {
        this.validateForPublication(normalized);
    }

    index = data.stories.findIndex(function(story) {
        return story.id === normalized.id;
    });

    if(index >= 0) {
        normalized.createdAt = data.stories[index].createdAt;
        normalized.updatedAt = now;
        if(normalized.status === 'published' && data.stories[index].status !== 'published') {
            normalized.publishedAt = now;
        } else {
            normalized.publishedAt = data.stories[index].publishedAt || null;
        }
        data.stories[index] = normalized;
    } else {
        normalized.createdAt = now;
        normalized.updatedAt = now;
        normalized.publishedAt = normalized.status === 'published' ? now : null;
        data.stories.push(normalized);
    }

    this._write(data);
    return normalized;
};

StoryStore.prototype.remove = function(id) {
    var data = this._read(),
        before = data.stories.length;

    data.stories = data.stories.filter(function(story) {
        return story.id !== id;
    });

    if(data.stories.length === before) {
        return false;
    }

    this._write(data);
    return true;
};

function cleanText(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
}

function id(value, prefix) {
    var candidate = cleanText(value, 80).replace(/[^a-zA-Z0-9_-]/g, '');
    return candidate || (prefix + '-' + crypto.randomUUID());
}

function normalizeDialogue(dialogue) {
    if(!Array.isArray(dialogue)) {
        return [];
    }

    return dialogue.slice(0, 100).map(function(line) {
        return {
            speaker: cleanText(line && line.speaker, 80),
            text: cleanText(line && line.text, 2000)
        };
    }).filter(function(line) {
        return line.text;
    });
}

function normalizeObjective(objective) {
    objective = objective || {};
    var type = OBJECTIVE_TYPES.indexOf(objective.type) >= 0 ? objective.type : 'custom',
        amount = Number(objective.amount || 1);

    if(!Number.isFinite(amount) || amount < 1) {
        amount = 1;
    }

    return {
        type: type,
        target: cleanText(objective.target, 120),
        amount: Math.min(Math.floor(amount), 100000),
        locationId: cleanText(objective.locationId, 120),
        text: cleanText(objective.text, 500)
    };
}

function normalizeRequirements(requirements) {
    if(!Array.isArray(requirements)) {
        return [];
    }

    return requirements.slice(0, 30).map(function(requirement) {
        return {
            type: cleanText(requirement && requirement.type, 60),
            key: cleanText(requirement && requirement.key, 120),
            value: cleanText(requirement && requirement.value, 250)
        };
    }).filter(function(requirement) {
        return requirement.type && requirement.key;
    });
}

function normalizeRewards(rewards) {
    if(!Array.isArray(rewards)) {
        return [];
    }

    return rewards.slice(0, 30).map(function(reward) {
        var type = REWARD_TYPES.indexOf(reward && reward.type) >= 0 ? reward.type : 'custom',
            amount = Number(reward && reward.amount || 1);

        if(!Number.isFinite(amount) || amount < 1) {
            amount = 1;
        }

        return {
            type: type,
            value: cleanText(reward && reward.value, 160),
            amount: Math.min(Math.floor(amount), 100000)
        };
    }).filter(function(reward) {
        return reward.value;
    });
}

function normalizeChoices(choices) {
    if(!Array.isArray(choices)) {
        return [];
    }

    return choices.slice(0, 12).map(function(choice) {
        return {
            text: cleanText(choice && choice.text, 300),
            nextMissionId: cleanText(choice && choice.nextMissionId, 120),
            condition: cleanText(choice && choice.condition, 300)
        };
    }).filter(function(choice) {
        return choice.text;
    });
}

function normalizeMission(mission, order) {
    mission = mission || {};
    return {
        id: id(mission.id, 'mission'),
        order: Number.isInteger(mission.order) ? mission.order : order,
        title: cleanText(mission.title, 160) || ('Missão ' + (order + 1)),
        summary: cleanText(mission.summary, 1000),
        giverNpc: cleanText(mission.giverNpc, 120),
        introDialogue: normalizeDialogue(mission.introDialogue),
        completionDialogue: normalizeDialogue(mission.completionDialogue),
        objective: normalizeObjective(mission.objective),
        requirements: normalizeRequirements(mission.requirements),
        rewards: normalizeRewards(mission.rewards),
        nextMissionId: cleanText(mission.nextMissionId, 120),
        choices: normalizeChoices(mission.choices)
    };
}

function normalizeChapter(chapter, order) {
    chapter = chapter || {};
    var missions = Array.isArray(chapter.missions) ? chapter.missions : [];

    return {
        id: id(chapter.id, 'chapter'),
        order: Number.isInteger(chapter.order) ? chapter.order : order,
        title: cleanText(chapter.title, 160) || ('Capítulo ' + (order + 1)),
        description: cleanText(chapter.description, 1500),
        missions: missions.slice(0, 100).map(normalizeMission)
    };
}

function normalizeStory(story) {
    story = story || {};
    var chapters = Array.isArray(story.chapters) ? story.chapters : [],
        status = story.status === 'published' ? 'published' : 'draft';

    return {
        id: id(story.id, 'story'),
        title: cleanText(story.title, 180) || 'Nova história',
        description: cleanText(story.description, 2000),
        status: status,
        entryMissionId: cleanText(story.entryMissionId, 120),
        chapters: chapters.slice(0, 100).map(normalizeChapter)
    };
}

exports.StoryStore = StoryStore;
exports.normalizeStory = normalizeStory;
exports.OBJECTIVE_TYPES = OBJECTIVE_TYPES;
exports.REWARD_TYPES = REWARD_TYPES;
