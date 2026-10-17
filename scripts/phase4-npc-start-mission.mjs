import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

const path = 'server/js/worldserver.js';
let source = fs.readFileSync(path, 'utf8');
source = replaceOnce(
  source,
  '            player.onMove(move_callback);\n            player.onLootMove(move_callback);\n            \n            player.onZone(function() {',
  '            player.onMove(move_callback);\n            player.onLootMove(move_callback);\n\n            player.onNpcInteract(function(npc) {\n                var story = npc && npc.editorData ? String(npc.editorData.storyId || \'\').trim() : \'\',\n                    mission = npc && npc.editorData ? String(npc.editorData.missionId || \'\').trim() : \'\';\n                if(!story || !mission) { return; }\n\n                player.startStoryMission(story, mission).then(function(result) {\n                    if(result && result.changed) {\n                        log.info(player.name + \' started story mission \' + story + \'/\' + mission + \' via NPC \' + npc.id);\n                    }\n                }).catch(function(error) {\n                    if(error && (error.code === \'MISSION_ALREADY_ACTIVE\' || error.code === \'MISSION_NOT_FOUND\')) {\n                        log.debug(\'NPC mission start ignored for \' + player.name + \': \' + error.code);\n                        return;\n                    }\n                    log.error(\'NPC mission start failed for \' + player.name + \': \' + (error && error.message ? error.message : error));\n                });\n            });\n            \n            player.onZone(function() {',
  'validated NPC mission callback'
);
fs.writeFileSync(path, source);
console.log('NPC mission start patch applied.');
