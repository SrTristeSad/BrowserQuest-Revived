import fs from 'node:fs';

const path = 'server/js/player.js';
let source = fs.readFileSync(path, 'utf8');
const block = `        if(auth.type === 'account') {\n            // WELCOME stays backward-compatible; existing EQUIP messages synchronize\n            // the account's authoritative PostgreSQL equipment to this client.\n            this.send(this.equip(this.armor).serialize());\n            this.send(this.equip(this.weapon).serialize());\n        }\n`;
const doubled = block + block;
if (!source.includes(doubled)) {
  throw new Error('Expected duplicated account EQUIP block was not found.');
}
source = source.replace(doubled, block);
if ((source.match(/account's authoritative PostgreSQL equipment/g) || []).length !== 1) {
  throw new Error('Expected exactly one authoritative EQUIP sync block after patch.');
}
fs.writeFileSync(path, source);
console.log('Removed duplicate account EQUIP sync block.');
