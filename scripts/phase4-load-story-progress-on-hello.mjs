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
  "        this.characterId = null;\n        this.mutedUntil = 0;",
  "        this.characterId = null;\n        this.storyState = [];\n        this.mutedUntil = 0;",
  'storyState init'
);
source = replaceOnce(
  source,
  "            this.accountUserId = auth.user ? auth.user.id : null;\n            this.characterId = auth.character.id || null;\n            armor = Number(auth.character.armorKind);",
  "            this.accountUserId = auth.user ? auth.user.id : null;\n            this.characterId = auth.character.id || null;\n            if(this.storyProgress && this.characterId) {\n                try {\n                    this.storyState = await this.storyProgress.list(this.characterId);\n                } catch(error) {\n                    this.storyState = [];\n                    log.error('Falha ao carregar progresso de história do personagem ' + this.characterId + ': ' + error.message);\n                }\n            }\n            armor = Number(auth.character.armorKind);",
  'storyState load'
);
fs.writeFileSync(path, source);
console.log('Story progress HELLO load patch applied.');
