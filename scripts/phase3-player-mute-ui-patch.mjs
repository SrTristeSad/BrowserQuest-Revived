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
  '.kickbtn,.sessionbtn,.suspendbtn,.banbtn,.reactivatebtn{padding:6px 9px;font-size:12px;white-space:nowrap}',
  '.kickbtn,.mutebtn,.sessionbtn,.suspendbtn,.banbtn,.reactivatebtn{padding:6px 9px;font-size:12px;white-space:nowrap}',
  'mute button style'
);

const anchor = `async function kickPlayer(player,button){const reason=window.prompt('Motivo para expulsar '+(player.name||'este jogador')+':','Expulso pelo administrador.');if(reason===null)return;button.disabled=true;try{await api('/admin/api/players/'+encodeURIComponent(player.id)+'/kick',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reason:reason})});await Promise.all([loadPlayers(),loadDashboard()])}catch(e){window.alert(e.message)}finally{button.disabled=false}}\n`;
const block = `${anchor}async function mutePlayer(player,button){const rawDuration=window.prompt('Silenciar '+(player.name||'este jogador')+' por quantos minutos? (1 a 1440)','15');if(rawDuration===null)return;const durationMinutes=Number(rawDuration);if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>1440){window.alert('Informe um número inteiro entre 1 e 1440 minutos.');return}const reason=window.prompt('Motivo do mute:','Spam no chat.');if(reason===null)return;button.disabled=true;try{const result=await api('/admin/api/players/'+encodeURIComponent(player.id)+'/mute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({durationMinutes:durationMinutes,reason:reason})});const persistence=result.player&&result.player.persistent?'O mute continuará se a conta reconectar.':'Este convidado ficará mutado apenas nesta conexão.';window.alert('Jogador silenciado por '+durationMinutes+' min. '+persistence)}catch(e){window.alert(e.message)}finally{button.disabled=false}}\n`;
source = replaceOnce(source, anchor, block, 'mute function');

const renderAnchor = `function renderPlayers(players){const body=$('playersBody');clear(body);players=Array.isArray(players)?players:[];$('playersEmpty').style.display=players.length?'none':'block';players.forEach(p=>{const tr=document.createElement('tr');cell(tr,p.name||'Sem nome');const type=cell(tr,'');const badge=document.createElement('span');badge.className='pill '+(p.type==='account'?'account':'guest');badge.textContent=p.type==='account'?'Conta':'Convidado';type.appendChild(badge);cell(tr,p.world||('world'+p.worldIndex));cell(tr,p.username||'—');const action=cell(tr,'');const button=document.createElement('button');button.className='danger kickbtn';button.type='button';button.textContent='Expulsar';button.title='Expulsar '+(p.name||'jogador')+' desta sessão';button.onclick=()=>kickPlayer(p,button);action.appendChild(button);body.appendChild(tr)})}\n`;
const renderReplacement = `function renderPlayers(players){const body=$('playersBody');clear(body);players=Array.isArray(players)?players:[];$('playersEmpty').style.display=players.length?'none':'block';players.forEach(p=>{const tr=document.createElement('tr');cell(tr,p.name||'Sem nome');const type=cell(tr,'');const badge=document.createElement('span');badge.className='pill '+(p.type==='account'?'account':'guest');badge.textContent=p.type==='account'?'Conta':'Convidado';type.appendChild(badge);cell(tr,p.world||('world'+p.worldIndex));cell(tr,p.username||'—');const action=cell(tr,''),actions=document.createElement('div');actions.className='actions';const mute=document.createElement('button');mute.className='warning mutebtn';mute.type='button';mute.textContent='Silenciar';mute.title='Impedir este jogador de enviar mensagens no chat';mute.onclick=()=>mutePlayer(p,mute);const kick=document.createElement('button');kick.className='danger kickbtn';kick.type='button';kick.textContent='Expulsar';kick.title='Expulsar '+(p.name||'jogador')+' desta sessão';kick.onclick=()=>kickPlayer(p,kick);actions.append(mute,kick);action.appendChild(actions);body.appendChild(tr)})}\n`;
source = replaceOnce(source, renderAnchor, renderReplacement, 'render mute button');

fs.writeFileSync(path, source);
console.log('Player mute UI patch applied.');
