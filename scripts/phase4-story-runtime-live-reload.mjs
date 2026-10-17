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
    "    adminHandler = AdminHttp.createAdminHandler({configDir: configDir, infrastructure: services, runtime: adminRuntime, playerAuth: playerAuth});",
    "    adminHandler = AdminHttp.createAdminHandler({configDir: configDir, infrastructure: services, runtime: adminRuntime, playerAuth: playerAuth, storyRuntime: storyRuntime});",
    'bootstrap admin story runtime option'
  );
  fs.writeFileSync(path, source);
}

{
  const path = 'server/admin/http.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    "        playerAuth = options.playerAuth || null,\n        processStartedAt = Date.now(),",
    "        playerAuth = options.playerAuth || null,\n        storyRuntime = options.storyRuntime || null,\n        processStartedAt = Date.now(),",
    'admin story runtime option'
  );
  source = replaceOnce(
    source,
    "        stories = new StoryStore(storiesPath),\n        world = new WorldStore({",
    "        stories = new StoryStore(storiesPath),\n        reloadStoryRuntime = function() {\n            if(storyRuntime && typeof storyRuntime.reload === 'function') {\n                return storyRuntime.reload();\n            }\n            return null;\n        },\n        world = new WorldStore({",
    'admin story reload helper'
  );
  source = replaceOnce(
    source,
    "            try { json(response, 200, stories.save(body)); }\n            catch(error) { json(response, 400, {error: error.message}); }",
    "            try {\n                var savedStory = stories.save(body);\n                reloadStoryRuntime();\n                json(response, 200, savedStory);\n            }\n            catch(error) { json(response, 400, {error: error.message}); }",
    'story save reload'
  );
  source = replaceOnce(
    source,
    "            if(stories.remove(match[1])) { json(response, 200, {ok: true}); }\n            else { json(response, 404, {error: 'História não encontrada.'}); }",
    "            if(stories.remove(match[1])) {\n                reloadStoryRuntime();\n                json(response, 200, {ok: true});\n            }\n            else { json(response, 404, {error: 'História não encontrada.'}); }",
    'story delete reload'
  );
  fs.writeFileSync(path, source);
}

console.log('Story Runtime live reload patch applied.');
