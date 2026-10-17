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
  'input{width:100%;background:#120d09;color:#f5e8c8;border:1px solid #725333;border-radius:6px;padding:10px;font:inherit}',
  'input,textarea{width:100%;background:#120d09;color:#f5e8c8;border:1px solid #725333;border-radius:6px;padding:10px;font:inherit}textarea{resize:vertical;min-height:74px}.announcement-compose{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.announcement-meta{display:flex;justify-content:space-between;gap:12px;margin-top:6px}.announcement-status.ok{color:#80d496}.announcement-status.error{color:#f28a80}',
  'announcement composer styles'
);
source = replaceOnce(
  source,
  '@media(max-width:760px){.layout{grid-template-columns:1fr}',
  '@media(max-width:760px){.announcement-compose{grid-template-columns:1fr}.layout{grid-template-columns:1fr}',
  'announcement mobile layout'
);

const metrics = `  </section>\n\n  <div class="grid">\n`;
const composer = `  </section>\n\n  <section class="card sectiongap" aria-labelledby="announcementTitle">\n    <h2 id="announcementTitle">Anúncio global</h2>\n    <div class="announcement-compose">\n      <div>\n        <textarea id="announcementMessage" maxlength="300" placeholder="Mensagem que aparecerá para todos os jogadores online"></textarea>\n        <div class="announcement-meta small muted"><span id="announcementStatus" class="announcement-status">Nenhum anúncio enviado nesta sessão.</span><span><span id="announcementCount">0</span>/300</span></div>\n      </div>\n      <button id="sendAnnouncement" type="button">Enviar anúncio</button>\n    </div>\n  </section>\n\n  <div class="grid">\n`;
source = replaceOnce(source, metrics, composer, 'announcement composer markup');

const statusPill = `function statusPill(status){const span=document.createElement('span');span.className='pill '+String(status||'');span.textContent=status||'desconhecido';return span}\n`;
const sendFn = `async function sendAnnouncement(){const input=$('announcementMessage'),button=$('sendAnnouncement'),status=$('announcementStatus'),message=input.value.trim();if(!message){status.textContent='Digite uma mensagem antes de enviar.';status.className='announcement-status error';input.focus();return}button.disabled=true;status.textContent='Enviando...';status.className='announcement-status';try{const result=await api('/admin/api/announcements',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:message})});status.textContent='Enviado para '+result.delivered+' jogador(es) online.';status.className='announcement-status ok';input.value='';$('announcementCount').textContent='0'}catch(e){status.textContent=e.message;status.className='announcement-status error'}finally{button.disabled=false}}\n`;
source = replaceOnce(source, statusPill, statusPill + sendFn, 'announcement send function');

const listeners = `$('refresh').onclick=refresh;$('searchButton').onclick=loadAccounts;$('search').addEventListener('keydown',e=>{if(e.key==='Enter')loadAccounts()});$('logout').onclick=async()=>{try{await api('/admin/api/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})}finally{location.href='/admin/login'}};\n`;
const newListeners = `$('refresh').onclick=refresh;$('searchButton').onclick=loadAccounts;$('search').addEventListener('keydown',e=>{if(e.key==='Enter')loadAccounts()});$('sendAnnouncement').onclick=sendAnnouncement;$('announcementMessage').addEventListener('input',e=>{$('announcementCount').textContent=String(e.target.value.length)});$('logout').onclick=async()=>{try{await api('/admin/api/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})}finally{location.href='/admin/login'}};\n`;
source = replaceOnce(source, listeners, newListeners, 'announcement event listeners');

fs.writeFileSync(path, source);
console.log('Announcement Dashboard UI patch applied.');
