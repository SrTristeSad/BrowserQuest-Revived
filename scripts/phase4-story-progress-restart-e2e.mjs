import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

{
  const path = 'server/js/player.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    "                    this.storyState = await this.storyProgress.list(this.characterId);\n                } catch(error) {",
    "                    this.storyState = await this.storyProgress.list(this.characterId);\n                    if(this.storyState.length) {\n                        log.info('Story progress loaded for character ' + this.characterId + ': ' + this.storyState.length + ' storie(s).');\n                    }\n                } catch(error) {",
    'story progress diagnostic log'
  );
  fs.writeFileSync(path, source);
}

{
  const path = '.github/workflows/account-persistence-restart.yml';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    "          PGPASSWORD=browserquest_test psql -h 127.0.0.1 -U browserquest -d browserquest -tAc \\\n            \"SELECT weapon_kind || ':' || armor_kind || ':' || checkpoint_id FROM characters c JOIN users u ON u.id=c.user_id WHERE u.username='$USERNAME'\" | grep -q \"$AXE:$ARMOR:$CHECKPOINT\"\n\n          COOKIE=\"$(awk '$6==\"bq_player_session\" {print $6\"=\"$7}' /tmp/player-before.cookies | tail -1)\"",
    "          PGPASSWORD=browserquest_test psql -h 127.0.0.1 -U browserquest -d browserquest -tAc \\\n            \"SELECT weapon_kind || ':' || armor_kind || ':' || checkpoint_id FROM characters c JOIN users u ON u.id=c.user_id WHERE u.username='$USERNAME'\" | grep -q \"$AXE:$ARMOR:$CHECKPOINT\"\n\n          PGPASSWORD=browserquest_test psql -h 127.0.0.1 -U browserquest -d browserquest -v ON_ERROR_STOP=1 \\\n            -c \"INSERT INTO character_progress(character_id, namespace, key, value) SELECT c.id, 'story', 'restart-story', '{\\\"version\\\":1,\\\"storyId\\\":\\\"restart-story\\\",\\\"activeMissionId\\\":\\\"mission-restart\\\",\\\"objectiveProgress\\\":2,\\\"completedMissionIds\\\":[],\\\"flags\\\":{\\\"before_restart\\\":true}}'::jsonb FROM characters c JOIN users u ON u.id=c.user_id WHERE u.username='$USERNAME' ON CONFLICT(character_id, namespace, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()\"\n\n          COOKIE=\"$(awk '$6==\"bq_player_session\" {print $6\"=\"$7}' /tmp/player-before.cookies | tail -1)\"",
    'insert story progress'
  );
  source = replaceOnce(
    source,
    "            node test/account-persistence-websocket-smoke.js\n\n          kill -TERM \"$APP_PID\"",
    "            node test/account-persistence-websocket-smoke.js\n          grep -q 'Story progress loaded for character .*: 1 storie(s).' /tmp/browserquest-account-restart.log\n\n          kill -TERM \"$APP_PID\"",
    'verify before restart load'
  );
  source = replaceOnce(
    source,
    "            node test/account-persistence-websocket-smoke.js\n\n          curl --fail --silent http://127.0.0.1:8012/status | grep -q '^\\['\n          echo 'Account equipment/checkpoint survived a complete Node restart.'",
    "            node test/account-persistence-websocket-smoke.js\n          test \"$(grep -c 'Story progress loaded for character .*: 1 storie(s).' /tmp/browserquest-account-restart.log)\" -ge 2\n          PGPASSWORD=browserquest_test psql -h 127.0.0.1 -U browserquest -d browserquest -tAc \\\n            \"SELECT value->>'activeMissionId' || ':' || value->>'objectiveProgress' FROM character_progress cp JOIN characters c ON c.id=cp.character_id JOIN users u ON u.id=c.user_id WHERE u.username='$USERNAME' AND cp.namespace='story' AND cp.key='restart-story'\" | grep -q 'mission-restart:2'\n\n          curl --fail --silent http://127.0.0.1:8012/status | grep -q '^\\['\n          echo 'Account equipment/checkpoint and story progress survived a complete Node restart.'",
    'verify after restart story load'
  );
  fs.writeFileSync(path, source);
}

console.log('Story progress restart E2E patch applied.');
