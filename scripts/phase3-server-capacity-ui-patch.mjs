import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

const path = 'server/admin/public/settings.html';
let source = fs.readFileSync(path, 'utf8');

source = replaceOnce(
  source,
  'select{width:100%;background:#120d09;color:#f5e8c8;border:1px solid #725333;border-radius:6px;padding:11px;font:inherit}',
  'select,input[type=number]{width:100%;background:#120d09;color:#f5e8c8;border:1px solid #725333;border-radius:6px;padding:11px;font:inherit}',
  'number input style'
);
source = replaceOnce(
  source,
  '.small{font-size:13px}.logout{background:#3d3021}',
  '.small{font-size:13px}.notice{margin-top:12px;padding:11px 12px;border-radius:7px;border:1px solid #8c6a29;background:#2c2212;color:#e8c66f}.notice.ok{border-color:#326c43;background:#14271a;color:#86d79a}.capacity-state{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.logout{background:#3d3021}',
  'capacity styles'
);
source = replaceOnce(
  source,
  '@media(max-width:760px){.layout{grid-template-columns:1fr}',
  '@media(max-width:760px){.layout{grid-template-columns:1fr}',
  'media anchor no-op'
);
source = source.replace('.grid,.status{grid-template-columns:1fr}', '.grid,.status,.capacity-state{grid-template-columns:1fr}');

const cardsAnchor = `    <section class="card">\n      <h2>Infraestrutura</h2>\n      <div class="status">\n        <div class="pill" id="pg"><span class="dot"></span><strong>PostgreSQL</strong><div class="muted small">Verificando...</div></div>\n        <div class="pill" id="redis"><span class="dot"></span><strong>Redis</strong><div class="muted small">Verificando...</div></div>\n      </div>\n      <p class="muted small" id="sessionStorage"></p>\n      <div class="actions"><button class="secondary" id="refresh">Atualizar status</button></div>\n    </section>\n  </div>\n`;
const cardsReplacement = `    <section class="card">\n      <h2>Infraestrutura</h2>\n      <div class="status">\n        <div class="pill" id="pg"><span class="dot"></span><strong>PostgreSQL</strong><div class="muted small">Verificando...</div></div>\n        <div class="pill" id="redis"><span class="dot"></span><strong>Redis</strong><div class="muted small">Verificando...</div></div>\n      </div>\n      <p class="muted small" id="sessionStorage"></p>\n      <div class="actions"><button class="secondary" id="refresh">Atualizar status</button></div>\n    </section>\n    <section class="card">\n      <h2>Capacidade do servidor</h2>\n      <div class="field"><label for="worlds">Mundos</label><input id="worlds" type="number" min="1" max="20" step="1"></div>\n      <div class="field"><label for="playersPerWorld">Jogadores por mundo</label><input id="playersPerWorld" type="number" min="1" max="1000" step="1"></div>\n      <div class="capacity-state"><div class="pill"><strong>Configurado</strong><div class="muted small" id="configuredCapacity">—</div></div><div class="pill"><strong>Ativo agora</strong><div class="muted small" id="activeCapacity">—</div></div></div>\n      <div id="restartNotice" class="notice ok">Nenhum reinício pendente.</div>\n      <div class="actions"><button id="saveCapacity">Salvar capacidade</button></div>\n      <div id="capacityMessage" role="status"></div>\n      <p class="muted small">Alterar estes valores não derruba o processo atual. Quando necessário, reinicie o Projeto Node.js no aaPanel para aplicar.</p>\n    </section>\n  </div>\n`;
source = replaceOnce(source, cardsAnchor, cardsReplacement, 'capacity card');

const scriptStart = `const mode=document.getElementById('mode'),registration=document.getElementById('registration'),message=document.getElementById('message'),save=document.getElementById('save');\n`;
const scriptReplacement = `const mode=document.getElementById('mode'),registration=document.getElementById('registration'),message=document.getElementById('message'),save=document.getElementById('save'),worlds=document.getElementById('worlds'),playersPerWorld=document.getElementById('playersPerWorld'),saveCapacity=document.getElementById('saveCapacity'),capacityMessage=document.getElementById('capacityMessage'),restartNotice=document.getElementById('restartNotice');\n`;
source = replaceOnce(source, scriptStart, scriptReplacement, 'capacity dom refs');

const settingsAnchor = `async function loadSettings(){try{const d=await api('/admin/api/settings/access');mode.value=d.accessMode;registration.checked=!!d.registrationEnabled}catch(e){message.className='errmsg';message.textContent=e.message}}\n`;
const settingsReplacement = `${settingsAnchor}function capacityText(value){return String(value.worlds)+' mundo'+(Number(value.worlds)===1?'':'s')+' / '+String(value.playersPerWorld)+' jogadores por mundo'}\nfunction renderCapacity(d){worlds.value=d.configured.worlds;playersPerWorld.value=d.configured.playersPerWorld;document.getElementById('configuredCapacity').textContent=capacityText(d.configured);document.getElementById('activeCapacity').textContent=capacityText(d.active);restartNotice.className='notice'+(d.restartRequired?'':' ok');restartNotice.textContent=d.restartRequired?'Alterações salvas. Reinicie o Projeto Node.js no aaPanel para aplicar os novos valores.':'Nenhum reinício pendente.'}\nasync function loadCapacity(){try{renderCapacity(await api('/admin/api/settings/server'))}catch(e){capacityMessage.className='errmsg';capacityMessage.textContent=e.message}}\n`;
source = replaceOnce(source, settingsAnchor, settingsReplacement, 'capacity load');

const saveAnchor = `save.onclick=async()=>{save.disabled=true;message.className='';message.textContent='Salvando...';try{const d=await api('/admin/api/settings/access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessMode:mode.value,registrationEnabled:registration.checked})});message.className='okmsg';message.textContent='Salvo. Novas conexões já usam esta política.';mode.value=d.accessMode;registration.checked=d.registrationEnabled}catch(e){message.className='errmsg';message.textContent=e.message}finally{save.disabled=false}};\n`;
const saveReplacement = `${saveAnchor}saveCapacity.onclick=async()=>{const worldCount=Number(worlds.value),playerLimit=Number(playersPerWorld.value);if(!Number.isInteger(worldCount)||worldCount<1||worldCount>20){capacityMessage.className='errmsg';capacityMessage.textContent='Mundos deve ficar entre 1 e 20.';return}if(!Number.isInteger(playerLimit)||playerLimit<1||playerLimit>1000){capacityMessage.className='errmsg';capacityMessage.textContent='Jogadores por mundo deve ficar entre 1 e 1000.';return}saveCapacity.disabled=true;capacityMessage.className='';capacityMessage.textContent='Salvando...';try{const d=await api('/admin/api/settings/server',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({worlds:worldCount,playersPerWorld:playerLimit})});renderCapacity(d);capacityMessage.className='okmsg';capacityMessage.textContent=d.restartRequired?'Salvo. Reinicie o Projeto Node.js no aaPanel para aplicar.':'Salvo. Os valores já correspondem ao processo atual.'}catch(e){capacityMessage.className='errmsg';capacityMessage.textContent=e.message}finally{saveCapacity.disabled=false}};\n`;
source = replaceOnce(source, saveAnchor, saveReplacement, 'capacity save');

source = replaceOnce(source, 'loadSettings();loadHealth();', 'loadSettings();loadHealth();loadCapacity();', 'capacity startup');

fs.writeFileSync(path, source);
console.log('Server capacity UI patch applied.');
