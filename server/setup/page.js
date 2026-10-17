'use strict';

function render() {
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BrowserQuest Revived - Instalação</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#efe3c2;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#332819;padding:24px}.card{width:min(900px,100%);margin:auto;background:#fffaf0;border:4px solid #49351e;box-shadow:0 12px 0 #c8ab72;padding:28px;border-radius:12px}h1{margin:0 0 6px;font-size:30px}h2{font-size:19px;margin:0}.sub{margin:0 0 24px;color:#6e5a3c}.badge{display:inline-block;background:#49351e;color:#fff7df;padding:5px 9px;border-radius:6px;font-size:12px;font-weight:800;letter-spacing:.06em}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{margin-top:14px}.full{grid-column:1/-1}label{display:block;font-weight:800;margin-bottom:6px}input,select{width:100%;border:2px solid #bda77b;background:#fff;padding:12px;border-radius:8px;font:inherit;outline:none}input:focus,select:focus{border-color:#6b4e2d}fieldset{border:1px solid #cfba8c;border-radius:9px;margin:20px 0 0;padding:16px}legend{font-weight:900;padding:0 6px}.check{display:flex;align-items:center;gap:8px;margin-top:16px}.check input{width:auto}.actions{display:flex;gap:10px;flex-wrap:wrap}.actions button{flex:1;min-width:180px}.primary{background:#704a24}.test{background:#4f6d43}button{margin-top:18px;border:0;border-radius:8px;color:white;padding:13px 18px;font-weight:900;font-size:15px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.note{margin-top:18px;padding:12px 14px;background:#f5e8c8;border-radius:8px;font-size:13px}.status{margin-top:10px;min-height:20px;font-weight:700}.ok{color:#20743a}.err{color:#aa2c22}.muted{color:#76664c;font-size:13px}@media(max-width:640px){.grid{grid-template-columns:1fr}.full{grid-column:auto}.card{padding:18px}.actions{display:block}.actions button{width:100%}}
</style>
</head>
<body><main class="card">
<span class="badge">PRIMEIRA INSTALAÇÃO</span>
<h1>BrowserQuest Revived</h1>
<p class="sub">Node.js + PostgreSQL + Redis. O instalador testa os serviços antes de salvar a instalação.</p>
<form id="setup">
<div class="grid">
<div class="field full"><label for="code">Código de instalação</label><input id="code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="Veja em Projeto Node.js → Logs" required></div>
<div class="field"><label for="worlds">Mundos</label><input id="worlds" type="number" min="1" max="20" value="5" required></div>
<div class="field"><label for="players">Jogadores por mundo</label><input id="players" type="number" min="1" max="1000" value="200" required></div>
<div class="field full"><label for="accessMode">Como jogadores entram</label><select id="accessMode"><option value="name_only">Somente nome</option><option value="mixed" selected>Conta ou convidado</option><option value="account_only">Somente conta</option></select><div class="muted">A política poderá ser alterada depois pelo painel administrativo.</div></div>
</div>

<fieldset><legend>PostgreSQL — dados permanentes</legend>
<div class="grid">
<div class="field"><label for="pgHost">Host</label><input id="pgHost" value="127.0.0.1" required></div>
<div class="field"><label for="pgPort">Porta</label><input id="pgPort" type="number" min="1" max="65535" value="5432" required></div>
<div class="field"><label for="pgDatabase">Banco</label><input id="pgDatabase" value="browserquest" required></div>
<div class="field"><label for="pgUser">Usuário</label><input id="pgUser" value="browserquest" required></div>
<div class="field full"><label for="pgPassword">Senha</label><input id="pgPassword" type="password" autocomplete="new-password" required></div>
</div>
<label class="check"><input id="pgSsl" type="checkbox"> Usar SSL no PostgreSQL</label>
<div class="actions"><button class="test" id="testPg" type="button">Testar PostgreSQL</button></div>
<div id="pgStatus" class="status"></div>
</fieldset>

<fieldset><legend>Redis — sessões, cache e presença</legend>
<div class="grid">
<div class="field"><label for="redisHost">Host</label><input id="redisHost" value="127.0.0.1" required></div>
<div class="field"><label for="redisPort">Porta</label><input id="redisPort" type="number" min="1" max="65535" value="6379" required></div>
<div class="field"><label for="redisUsername">Usuário (opcional)</label><input id="redisUsername" autocomplete="off"></div>
<div class="field"><label for="redisDatabase">Database</label><input id="redisDatabase" type="number" min="0" max="15" value="0" required></div>
<div class="field full"><label for="redisPassword">Senha (opcional se o Redis local não exigir)</label><input id="redisPassword" type="password" autocomplete="new-password"></div>
</div>
<label class="check"><input id="redisTls" type="checkbox"> Usar TLS no Redis</label>
<div class="actions"><button class="test" id="testRedis" type="button">Testar Redis</button></div>
<div id="redisStatus" class="status"></div>
</fieldset>

<fieldset><legend>Conta do dono / administrador</legend>
<div class="grid">
<div class="field full"><label for="adminUsername">Usuário administrativo</label><input id="adminUsername" minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" value="admin" autocomplete="username" required></div>
<div class="field"><label for="adminPassword">Senha</label><input id="adminPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></div>
<div class="field"><label for="adminPasswordConfirm">Confirmar senha</label><input id="adminPasswordConfirm" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></div>
</div></fieldset>
<button class="primary" id="install" type="submit" style="width:100%">Testar tudo, instalar e iniciar</button>
</form>
<div class="note">PostgreSQL é a fonte de verdade. Redis guarda somente dados rápidos/temporários. Se o Redis reiniciar, progresso permanente não é perdido.</div>
<div id="result" class="status" role="status"></div>
</main>
<script>
const $=id=>document.getElementById(id);
function payload(){return {code:$('code').value,worlds:Number($('worlds').value),players:Number($('players').value),accessMode:$('accessMode').value,pgHost:$('pgHost').value,pgPort:Number($('pgPort').value),pgDatabase:$('pgDatabase').value,pgUser:$('pgUser').value,pgPassword:$('pgPassword').value,pgSsl:$('pgSsl').checked,redisHost:$('redisHost').value,redisPort:Number($('redisPort').value),redisUsername:$('redisUsername').value,redisPassword:$('redisPassword').value,redisDatabase:Number($('redisDatabase').value),redisTls:$('redisTls').checked,adminUsername:$('adminUsername').value,adminPassword:$('adminPassword').value,adminPasswordConfirm:$('adminPasswordConfirm').value};}
async function post(url,data){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Falha');return d;}
$('testPg').onclick=async()=>{const b=$('testPg'),s=$('pgStatus');b.disabled=true;s.className='status';s.textContent='Testando...';try{const d=await post('/setup/test-postgres',payload());s.className='status ok';s.textContent='PostgreSQL conectado — '+(d.version||'OK')+' / banco '+(d.database||'');}catch(e){s.className='status err';s.textContent=e.message}finally{b.disabled=false}};
$('testRedis').onclick=async()=>{const b=$('testRedis'),s=$('redisStatus');b.disabled=true;s.className='status';s.textContent='Testando...';try{const d=await post('/setup/test-redis',payload());s.className='status ok';s.textContent='Redis conectado'+(d.version?' — '+d.version:' — OK');}catch(e){s.className='status err';s.textContent=e.message}finally{b.disabled=false}};
$('setup').addEventListener('submit',async e=>{e.preventDefault();const p=payload(),btn=$('install'),out=$('result');if(p.adminPassword!==p.adminPasswordConfirm){out.className='status err';out.textContent='As senhas administrativas não conferem.';return}btn.disabled=true;out.className='status';out.textContent='Testando PostgreSQL e Redis, criando tabelas e finalizando instalação...';try{await post('/setup/install',p);out.className='status ok';out.textContent='Instalação concluída. Abrindo o jogo...';setTimeout(()=>location.href='/',1800)}catch(err){out.className='status err';out.textContent=err.message;btn.disabled=false}});
</script></body></html>`;
}

exports.render = render;
