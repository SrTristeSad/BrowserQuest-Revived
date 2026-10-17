'use strict';

var MissionService = require('./mission-service'),
    Progress = require('./progress-store'),
    normalizeStoryProgress = Progress.normalizeStoryProgress,
    strictId = Progress.strictId;

var MAX_CONDITION_CLAUSES = 8;

function choiceError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function parseCondition(raw) {
    var text = String(raw == null ? '' : raw).trim(), clauses;
    if(!text) { return {valid: true, clauses: []}; }
    if(text.length > 300) { return {valid: false, clauses: []}; }
    clauses = text.split('&&').map(function(part) { return part.trim(); }).filter(Boolean);
    if(!clauses.length || clauses.length > MAX_CONDITION_CLAUSES) { return {valid: false, clauses: []}; }

    var parsed = [];
    for(var i = 0; i < clauses.length; i += 1) {
        var match = clauses[i].match(/^(!)?(flag|completed):([A-Za-z0-9_-]{1,120})(?:=([A-Za-z0-9_-]{1,120}))?$/);
        if(!match) { return {valid: false, clauses: []}; }
        if(match[2] === 'completed' && match[4] != null) { return {valid: false, clauses: []}; }
        if(!strictId(match[3], 120)) { return {valid: false, clauses: []}; }
        parsed.push({
            negate: !!match[1],
            type: match[2],
            key: match[3],
            value: match[4] == null ? null : match[4]
        });
    }
    return {valid: true, clauses: parsed};
}

function clauseMatches(clause, state) {
    var matched = false,
        value;
    if(clause.type === 'completed') {
        matched = state.completedMissionIds.indexOf(clause.key) >= 0;
    } else if(clause.type === 'flag') {
        value = state.flags[clause.key];
        if(clause.value === null) {
            matched = value === true || value === 1 || value === '1' || value === 'true';
        } else {
            matched = String(value) === clause.value;
        }
    }
    return clause.negate ? !matched : matched;
}

function evaluateCondition(raw, state) {
    var parsed = parseCondition(raw), current = normalizeStoryProgress(state);
    if(!parsed.valid) { return false; }
    for(var i = 0; i < parsed.clauses.length; i += 1) {
        if(!clauseMatches(parsed.clauses[i], current)) { return false; }
    }
    return true;
}

function resolveChoice(runtime, storyId, missionId, state, choice, index) {
    var nextMissionId = strictId(choice && choice.nextMissionId, 120), target;
    if(!choice || !String(choice.text || '').trim() || !nextMissionId) { return null; }
    if(!parseCondition(choice.condition).valid) { return null; }
    if(!evaluateCondition(choice.condition, state)) { return null; }
    if(nextMissionId === missionId || state.completedMissionIds.indexOf(nextMissionId) >= 0) { return null; }
    target = runtime.getMission(storyId, nextMissionId);
    if(!target || !target.mission || target.storyId !== storyId || String(target.mission.id || '') !== nextMissionId) { return null; }
    return {
        index: index,
        text: String(choice.text || '').trim().slice(0, 300),
        nextMissionId: nextMissionId,
        mission: target
    };
}

function getAvailableChoices(runtime, storyId, missionId, state) {
    var missionEntry = runtime && runtime.getMission ? runtime.getMission(storyId, missionId) : null,
        mission = missionEntry && missionEntry.mission,
        current = normalizeStoryProgress(state, storyId),
        result = [];
    if(!mission || current.pendingChoiceMissionId !== missionId) { return result; }
    (Array.isArray(mission.choices) ? mission.choices : []).slice(0, 12).forEach(function(choice, index) {
        var resolved = resolveChoice(runtime, storyId, missionId, current, choice, index);
        if(resolved) { result.push(resolved); }
    });
    return result;
}

async function selectChoice(options) {
    options = options || {};
    var runtime = options.runtime,
        progressStore = options.progressStore || null,
        characterId = Number(options.characterId) || 0,
        storyId = strictId(options.storyId, 120),
        missionId = strictId(options.missionId, 120),
        choiceIndex = Number(options.choiceIndex),
        current = MissionService.findStoryState(options.states, storyId),
        available,
        selected,
        now,
        state;

    if(!runtime || typeof runtime.getMission !== 'function') { throw choiceError('STORY_RUNTIME_UNAVAILABLE', 'Story Runtime indisponível.'); }
    if(!storyId || !missionId || !Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex > 11) {
        throw choiceError('INVALID_STORY_CHOICE', 'Escolha de história inválida.');
    }
    if(!current) { throw choiceError('STORY_STATE_NOT_FOUND', 'Progresso da história não encontrado.'); }
    current = normalizeStoryProgress(current, storyId);
    if(current.pendingChoiceMissionId !== missionId || current.completedMissionIds.indexOf(missionId) < 0) {
        throw choiceError('STORY_CHOICE_NOT_PENDING', 'Esta missão não está aguardando uma escolha.');
    }

    available = getAvailableChoices(runtime, storyId, missionId, current);
    selected = available.find(function(choice) { return choice.index === choiceIndex; });
    if(!selected) { throw choiceError('STORY_CHOICE_UNAVAILABLE', 'Esta escolha não está disponível para o estado atual da história.'); }

    now = new Date().toISOString();
    state = normalizeStoryProgress({
        version: current.version,
        storyId: storyId,
        activeMissionId: selected.nextMissionId,
        pendingChoiceMissionId: '',
        objectiveProgress: 0,
        completedMissionIds: current.completedMissionIds,
        flags: current.flags,
        startedAt: now,
        updatedAt: now
    }, storyId);

    if(progressStore) {
        if(!characterId) { throw choiceError('CHARACTER_REQUIRED', 'Personagem autenticado é obrigatório para persistir escolha.'); }
        state = await progressStore.save(characterId, storyId, state);
    }

    return {
        changed: true,
        storyId: storyId,
        completedMissionId: missionId,
        choiceIndex: choiceIndex,
        nextMissionId: selected.nextMissionId,
        nextMission: selected.mission,
        state: state
    };
}

exports.MAX_CONDITION_CLAUSES = MAX_CONDITION_CLAUSES;
exports.parseCondition = parseCondition;
exports.evaluateCondition = evaluateCondition;
exports.getAvailableChoices = getAvailableChoices;
exports.selectChoice = selectChoice;
