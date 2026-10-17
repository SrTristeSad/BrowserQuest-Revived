import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

const path = 'server/admin/public/dashboard.html';
let source = fs.readFileSync(path, 'utf8');

source = replaceOnce(
  source,
  '.actions{display:flex;gap:6px;flex-wrap:wrap}',
  '.actions{display:flex;gap:6px;flex-wrap:wrap}.audit-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.audit-details{max-width:420px;white-space:pre-wrap;word-break:break-word;color:#cdbb99;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.audit-action{font-weight:800;color:#e3c790}.audit-more{margin-top:12px;width:100%}',
  'audit styles'
);

const sectionAnchor = `  <section class="card sectiongap">\n    <div class="toolbar"><div style="flex:1"><h2 style="margin:0">Contas de jogadores</h2></div><input id="search" maxlength="64" placeholder="Buscar usuário ou personagem"><button class="secondary" id="searchButton">Buscar</button></div>\n    <div class="tablewrap"><table><thead><tr><th>Usuário</th><th>Personagem</th><th>Status</th><th>Equipamento</th><th>Checkpoint</th><th>Último login</th><th>Ação</th></tr></thead><tbody id="accountsBody"></tbody></table></div>\n    <div class="empty" id="accountsEmpty">Nenhuma conta encontrada.</div>\n  </section>\n`;
const auditSection = `${sectionAnchor}\n  <section class="card sectiongap" aria-labelledby="auditTitle">\n    <div class="audit-toolbar"><div><h2 id="auditTitle" style="margin:0">Histórico administrativo</h2><div class="muted small">Ações recentes registradas no servidor.</div></div><button class="secondary" id="auditRefresh" type="button">Atualizar histórico</button></div>\n    <div class="tablewrap"><table><thead><tr><th>Horário</th><th>Administrador</th><th>Ação</th><th>Alvo</th><th>Detalhes</th></tr></thead><tbody id="auditBody"></tbody></table></div>\n    <div class="empty" id="auditEmpty">Nenhuma ação administrativa registrada.</div>\n    <button class="secondary audit-more" id="auditMore" type="button" style="display:none">Carregar mais</button>\n  </section>\n`;
source = replaceOnce(source, sectionAnchor, auditSection, 'audit section');

const jsAnchor = `async function loadAccounts(){const q=$('search').value.trim();const d=await api('/admin/api/accounts'+(q?'?q='+encodeURIComponent(q):''));renderAccounts(d.accounts)}\n`;
const auditJs = `let auditNextBefore=null;\nfunction auditMetadataText(metadata){if(!metadata||typeof metadata!=='object'||!Object.keys(metadata).length)return '—';try{return JSON.stringify(metadata)}catch(e){return '[detalhes indisponíveis]'}}\nfunction renderAudit(entries,append){const body=$('auditBody');if(!append)clear(body);entries=Array.isArray(entries)?entries:[];entries.forEach(entry=>{const tr=document.createElement('tr');cell(tr,entry.createdAt?new Date(entry.createdAt).toLocaleString():'—');cell(tr,entry.actorUsername?entry.actorUsername+(entry.actorRole?' ('+entry.actorRole+')':''):'Usuário removido');const action=cell(tr,entry.action||'—');action.className='audit-action';cell(tr,entry.target||'—');const details=cell(tr,'');const pre=document.createElement('div');pre.className='audit-details';pre.textContent=auditMetadataText(entry.metadata);details.appendChild(pre);body.appendChild(tr)});$('auditEmpty').style.display=body.children.length?'none':'block'}\nasync function loadAudit(reset){const button=$('auditMore'),refreshButton=$('auditRefresh');if(reset){auditNextBefore=null;refreshButton.disabled=true}else{button.disabled=true}try{const url='/admin/api/audit?limit=25'+(!reset&&auditNextBefore?'&before='+encodeURIComponent(auditNextBefore):'');const d=await api(url);renderAudit(d.entries,!reset);auditNextBefore=d.nextBefore||null;button.style.display=auditNextBefore?'block':'none'}catch(e){window.alert(e.message)}finally{button.disabled=false;refreshButton.disabled=false}}\n${jsAnchor}`;
source = replaceOnce(source, jsAnchor, auditJs, 'audit javascript');

source = replaceOnce(
  source,
  `async function refresh(){try{await Promise.all([loadDashboard(),loadPlayers(),loadAccounts()])}catch(e){console.error(e)}}`,
  `async function refresh(){try{await Promise.all([loadDashboard(),loadPlayers(),loadAccounts(),loadAudit(true)])}catch(e){console.error(e)}}`,
  'refresh audit'
);

source = replaceOnce(
  source,
  `$('refresh').onclick=refresh;$('searchButton').onclick=loadAccounts;`,
  `$('refresh').onclick=refresh;$('auditRefresh').onclick=()=>loadAudit(true);$('auditMore').onclick=()=>loadAudit(false);$('searchButton').onclick=loadAccounts;`,
  'audit event handlers'
);

fs.writeFileSync(path, source);
console.log('Audit history UI patch applied.');
