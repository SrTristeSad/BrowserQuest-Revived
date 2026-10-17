/* BrowserQuest account access overlay. Original parchment and game layout remain unchanged. */
(function () {
  'use strict';
  var policyUrl = '/api/auth/policy';
  function request(path, method, body) {
    return fetch(path, {method: method || 'GET', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) { throw new Error(data.error || 'Falha na autenticação.'); }
        return data;
      });
    });
  }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (text !== undefined) { node.textContent = text; }
    return node;
  }
  function boot() {
    var parchment = document.getElementById('parchment');
    if (!parchment) { return; }
    request(policyUrl).then(function (policy) {
      if (!policy.accountsEnabled) { return; }
      var panel = el('section', {id:'bq-account-access', 'aria-label':'Conta do jogador'});
      panel.style.cssText = 'box-sizing:border-box;max-width:480px;margin:12px auto;padding:12px 18px;background:#f3e5c5;color:#3d2b19;border:2px solid #9a7040;border-radius:5px;font:14px Georgia,serif;text-align:center;position:relative;z-index:5';
      var title = el('strong', {}, 'Conta do jogador');
      var status = el('p', {role:'status'}, 'Carregando sessão...');
      var fields = el('div', {});
      var actions = el('div', {});
      function field(label, type, key) {
        var wrap=el('label', {}), caption=el('span', {}, label+' ');
        var input=el('input', {type:type, 'data-field':key, autocomplete:key==='password'?'current-password':'off'});
        input.style.cssText='display:block;box-sizing:border-box;width:100%;margin:5px 0 10px;padding:8px;border:1px solid #987e5b;background:#fffdf4;color:#332';
        wrap.appendChild(caption);wrap.appendChild(input);fields.appendChild(wrap);
        return input;
      }
      function button(label, handler) {
        var b=el('button', {type:'button'},label);
        b.style.cssText='margin:4px;padding:8px 12px;cursor:pointer;background:#71512e;color:white;border:0;border-radius:3px';
        b.addEventListener('click',handler);actions.appendChild(b);return b;
      }
      function setMessage(message) {status.textContent=message;}
      function showForm(register) {
        fields.replaceChildren();actions.replaceChildren();
        var username=field('Usuário','text','username');
        var character=register?field('Nome do personagem','text','character'):null;
        var password=field('Senha','password','password');
        button(register?'Criar conta':'Entrar',function () {
          var payload={username:username.value,password:password.value};
          if(register){payload.characterName=character.value;}
          setMessage('Aguarde...');
          request('/api/auth/'+(register?'register':'login'),'POST',payload).then(showSession).catch(function(e){setMessage(e.message);});
        });
        if(policy.registrationEnabled){button(register?'Já tenho conta':'Criar conta',function(){showForm(!register);});}
        if(policy.accessMode==='mixed'){button('Jogar como convidado',function(){panel.style.display='none';});}
      }
      function showSession(session) {
        if(!session.loggedIn){showForm(false);setMessage(policy.accessMode==='account_only'?'Entre para jogar.':'Entre ou jogue como convidado.');return;}
        fields.replaceChildren();actions.replaceChildren();
        var nameInput=document.getElementById('nameinput');
        if(nameInput && session.character){nameInput.value=session.character.name;nameInput.readOnly=true;nameInput.dispatchEvent(new Event('input',{bubbles:true}));}
        setMessage('Conectado como '+session.character.name+'.');
        button('Sair da conta',function(){request('/api/auth/logout','POST').then(function(){window.location.reload();}).catch(function(e){setMessage(e.message);});});
      }
      panel.appendChild(title);panel.appendChild(status);panel.appendChild(fields);panel.appendChild(actions);
      parchment.parentNode.insertBefore(panel,parchment.nextSibling);
      request('/api/auth/session').then(showSession).catch(function(e){setMessage(e.message);showForm(false);});
    }).catch(function () { /* Legacy installations have no account API. */ });
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot);}else{boot();}
}());
