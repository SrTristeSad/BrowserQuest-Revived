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
  '.kickbtn,.sessionbtn,.suspendbtn{padding:6px 9px;font-size:12px;white-space:nowrap}',
  '.kickbtn,.sessionbtn,.suspendbtn,.banbtn{padding:6px 9px;font-size:12px;white-space:nowrap}',
  'button css'
);

const suspendFn = "async function suspendAccount(account,button){if(account.status!=='active')return;if(!window.confirm('Suspender a conta '+account.username+'? Ela será desconectada e não poderá entrar novamente até ser reativada.'))return;const reason=window.prompt('Motivo da suspensão:','Conta suspensa pelo administrador.');if(reason===null)return;button.disabled=true;try{const result=await api('/admin/api/accounts/'+encodeURIComponent(account.id)+'/suspend',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:reason})});window.alert('Conta suspensa. Sessões encerradas: '+result.sessionsRevoked+'. Conexões fechadas: '+result.connectionsClosed+'.');await Promise.all([loadAccounts(),loadPlayers(),loadDashboard()])}catch(e){window.alert(e.message)}finally{button.disabled=false}}\n";

const banFn = "async function banAccount(account,button){if(account.status==='banned')return;if(!window.confirm('Banir a conta '+account.username+'? Ela será desconectada e ficará bloqueada até remoção administrativa do ban.'))return;const reason=window.prompt('Motivo do banimento:','Conta banida pelo administrador.');if(reason===null)return;button.disabled=true;try{const result=await api('/admin/api/accounts/'+encodeURIComponent(account.id)+'/ban',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:reason})});window.alert('Conta banida. Sessões encerradas: '+result.sessionsRevoked+'. Conexões fechadas: '+result.connectionsClosed+'.');await Promise.all([loadAccounts(),loadPlayers(),loadDashboard()])}catch(e){window.alert(e.message)}finally{button.disabled=false}}\n";

source = replaceOnce(source, suspendFn, suspendFn + banFn, 'ban function');

const oldRender = "function renderAccounts(accounts){const body=$('accountsBody');clear(body);accounts=Array.isArray(accounts)?accounts:[];$('accountsEmpty').style.display=accounts.length?'none':'block';accounts.forEach(a=>{const tr=document.createElement('tr');cell(tr,a.username);cell(tr,a.character?a.character.name:'—');const st=cell(tr,'');st.appendChild(statusPill(a.status));cell(tr,a.character?('arma '+a.character.weaponKind+' / armadura '+a.character.armorKind):'—');cell(tr,a.character&&a.character.checkpointId!==null?a.character.checkpointId:'—');cell(tr,a.lastLoginAt?new Date(a.lastLoginAt).toLocaleString():'Nunca');const action=cell(tr,'');const actions=document.createElement('div');actions.className='actions';const sessionButton=document.createElement('button');sessionButton.className='secondary sessionbtn';sessionButton.type='button';sessionButton.textContent='Encerrar sessões';sessionButton.title='Invalidar sessões e exigir novo login';sessionButton.onclick=()=>revokeSessions(a,sessionButton);actions.appendChild(sessionButton);if(a.status==='active'){const suspendButton=document.createElement('button');suspendButton.className='warning suspendbtn';suspendButton.type='button';suspendButton.textContent='Suspender';suspendButton.title='Bloquear esta conta até reativação administrativa';suspendButton.onclick=()=>suspendAccount(a,suspendButton);actions.appendChild(suspendButton)}action.appendChild(actions);body.appendChild(tr)})}\n";

const newRender = "function renderAccounts(accounts){const body=$('accountsBody');clear(body);accounts=Array.isArray(accounts)?accounts:[];$('accountsEmpty').style.display=accounts.length?'none':'block';accounts.forEach(a=>{const tr=document.createElement('tr');cell(tr,a.username);cell(tr,a.character?a.character.name:'—');const st=cell(tr,'');st.appendChild(statusPill(a.status));cell(tr,a.character?('arma '+a.character.weaponKind+' / armadura '+a.character.armorKind):'—');cell(tr,a.character&&a.character.checkpointId!==null?a.character.checkpointId:'—');cell(tr,a.lastLoginAt?new Date(a.lastLoginAt).toLocaleString():'Nunca');const action=cell(tr,'');const actions=document.createElement('div');actions.className='actions';const sessionButton=document.createElement('button');sessionButton.className='secondary sessionbtn';sessionButton.type='button';sessionButton.textContent='Encerrar sessões';sessionButton.title='Invalidar sessões e exigir novo login';sessionButton.onclick=()=>revokeSessions(a,sessionButton);actions.appendChild(sessionButton);if(a.status==='active'){const suspendButton=document.createElement('button');suspendButton.className='warning suspendbtn';suspendButton.type='button';suspendButton.textContent='Suspender';suspendButton.title='Bloquear esta conta até reativação administrativa';suspendButton.onclick=()=>suspendAccount(a,suspendButton);actions.appendChild(suspendButton)}if(a.status!=='banned'){const banButton=document.createElement('button');banButton.className='danger banbtn';banButton.type='button';banButton.textContent='Banir';banButton.title='Bloquear permanentemente esta conta até remoção administrativa do ban';banButton.onclick=()=>banAccount(a,banButton);actions.appendChild(banButton)}action.appendChild(actions);body.appendChild(tr)})}\n";

source = replaceOnce(source, oldRender, newRender, 'render accounts');
fs.writeFileSync(path, source);
console.log('Ban account UI patch applied.');
