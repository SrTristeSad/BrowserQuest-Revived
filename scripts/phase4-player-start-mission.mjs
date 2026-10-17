import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

const path = 'server/js/player.js';
let source = fs.readFileSync(path, 'utf8');
source = replaceOnce(
  source,
  '    check = require("./format").check,\n    Types = require("../../shared/js/gametypes");',
  '    check = require("./format").check,\n    MissionService = require("../story/mission-service"),\n    Types = require("../../shared/js/gametypes");',
  'player mission service require'
);
source = replaceOnce(
  source,
  '    schedulePersistence: function(patch) {\n        if(this.characterPersistence && this.characterId) {',
  '    startStoryMission: function(storyId, missionId) {\n        var self = this;\n        return MissionService.startMission({\n            runtime: this.storyRuntime,\n            progressStore: this.storyProgress,\n            characterId: this.characterId,\n            storyId: storyId,\n            missionId: missionId,\n            states: this.storyState\n        }).then(function(result) {\n            self.storyState = MissionService.upsertStoryState(self.storyState, result.state);\n            return result;\n        });\n    },\n\n    schedulePersistence: function(patch) {\n        if(this.characterPersistence && this.characterId) {',
  'player startStoryMission method'
);
fs.writeFileSync(path, source);
console.log('Player mission start patch applied.');
