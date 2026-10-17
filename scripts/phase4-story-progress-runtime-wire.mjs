import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

{
  const path = 'server/bootstrap.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    "    CharacterStore = require('./persistence/character-store').CharacterStore,\n    GracefulShutdown = require('./lifecycle/graceful-shutdown');",
    "    CharacterStore = require('./persistence/character-store').CharacterStore,\n    StoryProgressStore = require('./story/progress-store').StoryProgressStore,\n    GracefulShutdown = require('./lifecycle/graceful-shutdown');",
    'bootstrap require'
  );
  source = replaceOnce(
    source,
    "        characterStore = null,\n        adminRuntime = {startedAt: Date.now(), server: null, config: null},",
    "        characterStore = null,\n        storyProgressStore = null,\n        adminRuntime = {startedAt: Date.now(), server: null, config: null},",
    'bootstrap variable'
  );
  source = replaceOnce(
    source,
    "        characterStore = new CharacterStore({postgres: services.postgres});\n        playerAuthHandler = PlayerAuthHttp.createPlayerAuthHandler({auth: playerAuth});",
    "        characterStore = new CharacterStore({postgres: services.postgres});\n        storyProgressStore = new StoryProgressStore({postgres: services.postgres});\n        playerAuthHandler = PlayerAuthHttp.createPlayerAuthHandler({auth: playerAuth});",
    'bootstrap instantiate'
  );
  source = replaceOnce(
    source,
    "        player_auth_service: playerAuth,\n        player_persistence: characterStore,",
    "        player_auth_service: playerAuth,\n        player_persistence: characterStore,\n        story_progress: storyProgressStore,",
    'bootstrap config'
  );
  fs.writeFileSync(path, source);
}

{
  const path = 'server/js/main.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    "            connection.playerAuthService = config.player_auth_service || null;\n            connection.characterPersistence = config.player_persistence || null;\n            selectWorldAndConnect(connection);",
    "            connection.playerAuthService = config.player_auth_service || null;\n            connection.characterPersistence = config.player_persistence || null;\n            connection.storyProgress = context.type === 'account' ? (config.story_progress || null) : null;\n            selectWorldAndConnect(connection);",
    'main authenticated connection'
  );
  source = replaceOnce(
    source,
    "            connection.authContext = {allowed: true, type: 'guest', accessMode: 'name_only'};\n            connection.characterPersistence = null;\n            selectWorldAndConnect(connection);",
    "            connection.authContext = {allowed: true, type: 'guest', accessMode: 'name_only'};\n            connection.characterPersistence = null;\n            connection.storyProgress = null;\n            selectWorldAndConnect(connection);",
    'main guest connection'
  );
  fs.writeFileSync(path, source);
}

{
  const path = 'server/js/player.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    "        this.connection = connection;\n        this.characterPersistence = connection.characterPersistence || null;",
    "        this.connection = connection;\n        this.characterPersistence = connection.characterPersistence || null;\n        this.storyProgress = connection.storyProgress || null;",
    'player store reference'
  );
  fs.writeFileSync(path, source);
}

console.log('Story progress runtime wiring patch applied.');
