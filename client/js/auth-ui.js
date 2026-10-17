(function() {
    'use strict';

    var state = {
        policy: null,
        session: null,
        mode: 'login'
    };

    window.BQAuthState = state;

    function request(path, options) {
        options = options || {};
        options.credentials = 'same-origin';
        options.headers = Object.assign({'content-type': 'application/json'}, options.headers || {});
        return fetch(path, options).then(function(response) {
            return response.json().catch(function() { return {}; }).then(function(data) {
                if(!response.ok) {
                    var error = new Error(data.error || 'Falha na autenticação.');
                    error.status = response.status;
                    error.code = data.code;
                    throw error;
                }
                return data;
            });
        });
    }

    function element(tag, attrs, text) {
        var node = document.createElement(tag), key;
        attrs = attrs || {};
        for(key in attrs) {
            if(Object.prototype.hasOwnProperty.call(attrs, key)) {
                if(key === 'className') { node.className = attrs[key]; }
                else if(key === 'type') { node.type = attrs[key]; }
                else { node.setAttribute(key, attrs[key]); }
            }
        }
        if(text !== undefined) { node.textContent = text; }
        return node;
    }

    function buildModal() {
        if(document.getElementById('bq-auth-modal')) { return; }

        var modal = element('div', {id: 'bq-auth-modal', hidden: 'hidden'}),
            card = element('div', {id: 'bq-auth-card'}),
            title = element('h2', {id: 'bq-auth-title'}, 'Entrar com conta'),
            description = element('p', {id: 'bq-auth-description'}, 'Use seu usuário e senha para carregar seu personagem do servidor.'),
            tabs = element('div', {id: 'bq-auth-tabs'}),
            loginTab = element('button', {type: 'button', id: 'bq-auth-tab-login', className: 'active'}, 'Entrar'),
            registerTab = element('button', {type: 'button', id: 'bq-auth-tab-register'}, 'Criar conta'),
            userLabel = element('label', {for: 'bq-auth-username'}, 'Usuário'),
            userInput = element('input', {id: 'bq-auth-username', maxlength: '32', autocomplete: 'username'}),
            passLabel = element('label', {for: 'bq-auth-password'}, 'Senha'),
            passInput = element('input', {id: 'bq-auth-password', type: 'password', maxlength: '128', autocomplete: 'current-password'}),
            characterWrap = element('div', {id: 'bq-auth-register-character', hidden: 'hidden'}),
            characterLabel = element('label', {for: 'bq-auth-character'}, 'Nome do personagem'),
            characterInput = element('input', {id: 'bq-auth-character', maxlength: '15', autocomplete: 'off'}),
            actions = element('div', {id: 'bq-auth-actions'}),
            cancel = element('button', {type: 'button', id: 'bq-auth-cancel'}, 'Cancelar'),
            submit = element('button', {type: 'button', id: 'bq-auth-submit'}, 'Entrar'),
            message = element('div', {id: 'bq-auth-message', role: 'status'});

        tabs.appendChild(loginTab);
        tabs.appendChild(registerTab);
        characterWrap.appendChild(characterLabel);
        characterWrap.appendChild(characterInput);
        actions.appendChild(cancel);
        actions.appendChild(submit);

        card.appendChild(title);
        card.appendChild(description);
        card.appendChild(tabs);
        card.appendChild(userLabel);
        card.appendChild(userInput);
        card.appendChild(passLabel);
        card.appendChild(passInput);
        card.appendChild(characterWrap);
        card.appendChild(actions);
        card.appendChild(message);
        modal.appendChild(card);
        document.body.appendChild(modal);

        loginTab.addEventListener('click', function() { setMode('login'); });
        registerTab.addEventListener('click', function() { setMode('register'); });
        cancel.addEventListener('click', function() {
            if(state.policy && state.policy.accessMode === 'account_only' && !state.session) { return; }
            closeModal();
        });
        submit.addEventListener('click', submitAuth);
        passInput.addEventListener('keydown', function(event) {
            if(event.key === 'Enter') { submitAuth(); }
        });
        characterInput.addEventListener('keydown', function(event) {
            if(event.key === 'Enter') { submitAuth(); }
        });
    }

    function setMode(mode) {
        state.mode = mode;
        var register = mode === 'register';
        document.getElementById('bq-auth-tab-login').className = register ? '' : 'active';
        document.getElementById('bq-auth-tab-register').className = register ? 'active' : '';
        document.getElementById('bq-auth-register-character').hidden = !register;
        document.getElementById('bq-auth-title').textContent = register ? 'Criar conta' : 'Entrar com conta';
        document.getElementById('bq-auth-description').textContent = register ?
            'Sua conta e seu personagem serão salvos no servidor.' :
            'Use seu usuário e senha para carregar seu personagem do servidor.';
        document.getElementById('bq-auth-submit').textContent = register ? 'Criar conta' : 'Entrar';
        document.getElementById('bq-auth-password').setAttribute('autocomplete', register ? 'new-password' : 'current-password');
        showMessage('', '');
    }

    function showMessage(message, type) {
        var node = document.getElementById('bq-auth-message');
        if(!node) { return; }
        node.className = type || '';
        node.textContent = message || '';
    }

    function openModal(mode) {
        buildModal();
        setMode(mode || 'login');
        document.getElementById('bq-auth-modal').hidden = false;
        setTimeout(function() {
            var input = document.getElementById('bq-auth-username');
            if(input) { input.focus(); }
        }, 0);
    }

    function closeModal() {
        var modal = document.getElementById('bq-auth-modal');
        if(modal) { modal.hidden = true; }
    }

    function applyAccount(session) {
        state.session = session && session.loggedIn ? session : null;
        var character = state.session && state.session.character,
            nameInput = document.getElementById('nameinput'),
            storedName = document.getElementById('playername');

        if(character) {
            if(nameInput) {
                nameInput.value = character.name;
                nameInput.setAttribute('value', character.name);
                nameInput.readOnly = true;
            }
            if(storedName) { storedName.textContent = character.name; }
            document.body.classList.remove('bq-account-required');
            renderAccountBadge();
            closeModal();
        } else {
            if(nameInput && state.policy && state.policy.accessMode === 'account_only') {
                nameInput.value = '';
                nameInput.setAttribute('value', '');
                nameInput.readOnly = true;
            }
            renderAccountBadge();
        }
    }

    function removeAccountWidgets() {
        ['bq-account-button', 'bq-account-badge'].forEach(function(id) {
            var node = document.getElementById(id);
            if(node && node.parentNode) { node.parentNode.removeChild(node); }
        });
    }

    function widgetHost() {
        return document.querySelector('.parchment-middle') || document.getElementById('intro') || document.body;
    }

    function renderAccountBadge() {
        removeAccountWidgets();
        if(!state.policy || state.policy.accessMode === 'name_only') { return; }

        var host = widgetHost(), wrapper, button, logout;
        if(state.session && state.session.loggedIn) {
            wrapper = element('div', {id: 'bq-account-badge'});
            wrapper.appendChild(document.createTextNode('Conta: ' + state.session.character.name));
            logout = element('button', {type: 'button'}, 'Sair');
            logout.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                request('/api/auth/logout', {method: 'POST', body: '{}'}).then(function() {
                    window.location.reload();
                }).catch(function(error) {
                    alert(error.message);
                });
            });
            wrapper.appendChild(logout);
            host.appendChild(wrapper);
            return;
        }

        wrapper = element('div', {id: 'bq-account-button'});
        button = element('button', {type: 'button'}, state.policy.accessMode === 'account_only' ? 'Entrar' : 'Entrar com conta');
        button.addEventListener('click', function(event) {
            event.preventDefault();
            event.stopPropagation();
            openModal('login');
        });
        wrapper.appendChild(button);
        host.appendChild(wrapper);
    }

    function submitAuth() {
        var username = document.getElementById('bq-auth-username').value,
            password = document.getElementById('bq-auth-password').value,
            characterName = document.getElementById('bq-auth-character').value,
            endpoint = state.mode === 'register' ? '/api/auth/register' : '/api/auth/login',
            payload = {username: username, password: password},
            submit = document.getElementById('bq-auth-submit');

        if(state.mode === 'register') { payload.characterName = characterName; }
        submit.disabled = true;
        showMessage(state.mode === 'register' ? 'Criando conta...' : 'Entrando...', '');
        request(endpoint, {method: 'POST', body: JSON.stringify(payload)}).then(function(session) {
            showMessage('Pronto.', 'ok');
            applyAccount(session);
        }).catch(function(error) {
            showMessage(error.message, 'error');
        }).then(function() {
            submit.disabled = false;
        });
    }

    function protectAccountOnlyClicks() {
        document.addEventListener('click', function(event) {
            if(!state.policy || state.policy.accessMode !== 'account_only' || state.session) { return; }
            var target = event.target;
            if(target && (target.closest ? target.closest('.play') : null)) {
                event.preventDefault();
                event.stopPropagation();
                if(event.stopImmediatePropagation) { event.stopImmediatePropagation(); }
                openModal('login');
            }
        }, true);
    }

    function init() {
        buildModal();
        protectAccountOnlyClicks();
        request('/api/auth/session', {method: 'GET'}).then(function(session) {
            state.policy = {
                accessMode: session.accessMode,
                registrationEnabled: session.registrationEnabled,
                accountsEnabled: session.accessMode !== 'name_only'
            };
            if(!state.policy.registrationEnabled) {
                var registerTab = document.getElementById('bq-auth-tab-register');
                if(registerTab) { registerTab.style.display = 'none'; }
            }
            applyAccount(session);
            if(state.policy.accessMode === 'account_only' && !state.session) {
                document.body.classList.add('bq-account-required');
                openModal('login');
            }
        }).catch(function() {
            request('/api/auth/policy', {method: 'GET'}).then(function(policy) {
                state.policy = policy;
                renderAccountBadge();
            }).catch(function() {
                state.policy = {accessMode: 'name_only', registrationEnabled: false, accountsEnabled: false};
            });
        });
    }

    if(document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
