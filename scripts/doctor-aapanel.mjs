import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const checks = [
  ['Node.js >= 22', Number(process.versions.node.split('.')[0]) >= 22],
  ['app.js', fs.existsSync(path.join(root, 'app.js'))],
  ['package-lock.json', fs.existsSync(path.join(root, 'package-lock.json'))],
  ['cliente BrowserQuest', fs.existsSync(path.join(root, 'client', 'index.html'))],
  ['mapa do servidor', fs.existsSync(path.join(root, 'server', 'maps', 'world_server.json'))],
  ['configuração padrão', fs.existsSync(path.join(root, 'server', 'config.json'))]
];

let ok = true;
for (const [label, passed] of checks) {
  console.log(`${passed ? '✓' : '✗'} ${label}`);
  if (!passed) ok = false;
}

console.log(`\nPORT=${process.env.PORT || '8000 (padrão)'}`);
console.log(`HOST=${process.env.HOST || '127.0.0.1 (padrão)'}`);
console.log(`Estado=${fs.existsSync(path.join(root, 'var', 'config', 'browserquest.json')) ? 'instalado' : 'aguardando /setup'}`);

process.exitCode = ok ? 0 : 1;
