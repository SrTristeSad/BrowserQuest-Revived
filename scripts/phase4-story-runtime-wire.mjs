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
  source = replaceOnce(source,
    "    CharacterStore = require('./persistence/character-store').CharacterStore,\n    StoryProgressStore = require('./story/progress-store').StoryProgressStore,",
    "    CharacterStore = require('./persistence/character-store').CharacterStore,\n    StoryStore = require('./admin/story-store').StoryStore,\n    StoryRuntime = require('./story/runtime').StoryRuntime,\n    StoryProgressStore = require('./story/progress-store').StoryProgressStore,",
    'bootstrap story runtime requires');
  source = replaceOnce(source,
    "        characterStore = null,\n        storyProgressStore = null,",
    "        characterStore = null,\n        storyRuntime = null,\n        storyProgressStore = null,",
    'bootstrap story runtime variable');
  source = replaceOnce(source,
    "        characterStore = new CharacterStore({postgres: services.postgres});\n        storyProgressStore = new StoryProgressStore({postgres: services.postgres});",
    "        characterStore = new CharacterStore({postgres: services.postgres});\n        storyRuntime = new StoryRuntime(new StoryStore(path.join(configDir, 'stories.json')));\n        storyProgressStore = new StoryProgressStore({postgres: services.postgres});",
    'bootstrap instantiate story runtime');
  source = replaceOnce(source,
    "        player_persistence: characterStore,\n        story_progress: storyProgressStore,",
    "        player_persistence: characterStore,\n        story_runtime: storyRuntime,\n        story_progress: storyProgressStore,",
    'bootstrap story runtime config');
  fs.writeFileSync(path, source);
}

{
  const path = 'server/js/main.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
    "            connection.playerAuthService = config.player_auth_service || null;\n            connection.characterPersistence = config.player_persistence || null;\n            connection.storyProgress = context.type === 'account' ? (config.story_progress || null) : null;",
    "            connection.playerAuthService = config.player_auth_service || null;\n            connection.characterPersistence = config.player_persistence || null;\n            connection.storyRuntime = config.story_runtime || null;\n            connection.storyProgress = context.type === 'account' ? (config.story_progress || null) : null;",
    'main authenticated story runtime');
  source = replaceOnce(source,
    "            connection.characterPersistence = null;\n            connection.storyProgress = null;",
    "            connection.characterPersistence = null;\n            connection.storyRuntime = config.story_runtime || null;\n            connection.storyProgress = null;",
    'main guest story runtime');
  fs.writeFileSync(path, source);
}

{
  const path = 'server/js/player.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(source,
    "        this.characterPersistence = connection.characterPersistence || null;\n        this.storyProgress = connection.storyProgress || null;",
    "        this.characterPersistence = connection.characterPersistence || null;\n        this.storyRuntime = connection.storyRuntime || null;\n        this.storyProgress = connection.storyProgress || null;",
    'player story runtime reference');
  fs.writeFileSync(path, source);
}

console.log('Story Runtime wiring patch applied.');
