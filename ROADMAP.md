# BrowserQuest Revived — Plano Mestre de Desenvolvimento

Este documento é a fonte oficial do que já foi concluído e do que ainda vamos construir no **BrowserQuest Revived**. A prioridade é transformar a base original do BrowserQuest em um jogo administrável, expansível e fácil de instalar em **aaPanel/Node.js**, sem Docker.

## Arquitetura de dados escolhida

A arquitetura oficial passa a ser:

- **PostgreSQL (PgSQL)** = fonte de verdade e armazenamento permanente.
- **Redis** = memória rápida/temporária para sessões, rate limit, presença online, cache e eventos efêmeros.
- **Node.js + aaPanel** = implantação principal.
- **Sem Docker/Compose.**

Regra importante: **dados que não podem ser perdidos nunca dependem somente do Redis**. Usuários, personagens, inventário, progresso, histórias, bans, configurações e auditoria pertencem ao PostgreSQL. Se o Redis reiniciar, o servidor pode perder cache/presença/sessões temporárias, mas não o progresso real do jogador.

## Regras do projeto

- Preservar o visual, a identidade e a jogabilidade base do BrowserQuest sempre que possível.
- Servidor autoritativo para identidade, combate, NPCs/mobs, missões e progresso persistente.
- PostgreSQL como banco principal e durável.
- Redis para estado efêmero e aceleração, nunca como banco principal do jogo.
- Nenhuma exigência de telefone/SMS para jogadores.
- E-mail também não deve ser obrigatório na primeira versão de contas.
- Toda feature administrativa precisa ser funcional; evitar botões que apenas aparentam funcionar.
- Mudanças grandes devem manter compatibilidade com o cliente/protocolo legado quando isso não impedir a evolução do projeto.
- Manter testes automatizados para instalação, HTTP, WebSocket, editores, autenticação, PostgreSQL, Redis, Brain System e fluxos críticos.

---

# Estado atual — v0.4.0

## Fundação já concluída

- [x] Projeto original do Mozilla BrowserQuest importado e preservado.
- [x] Modernização para Node.js 24 LTS.
- [x] WebSocket RFC 6455 moderno com `ws`.
- [x] Cliente HTTP e WebSocket servidos pelo mesmo processo/porta.
- [x] `ws://` / `wss://` automático conforme HTTP/HTTPS.
- [x] Endpoints `/status`, `/health` e `/ready`.
- [x] Instalação visual em `/setup`.
- [x] Código de instalação de 6 dígitos exibido nos logs do Node/aaPanel.
- [x] Criação da conta inicial do dono/admin durante o setup.
- [x] Senha administrativa protegida com `scrypt`.
- [x] Painel autenticado em `/admin`.
- [x] Story Editor em `/admin/story-editor`.
- [x] World Editor em `/admin/world-editor`.
- [x] Publicação sincronizada dos dados de mundo do servidor e do cliente.
- [x] Versionamento/snapshots do mundo publicado.
- [x] Brain System v1 para NPCs e mobs.
- [x] Testes de sintaxe, servidor, WebSocket, instalador, admin, Story Editor, World Editor e Brain System.

## Brain System v1 já concluído

- [x] Cérebro compartilhado para NPCs e mobs.
- [x] Percepção simples por distância.
- [x] Memória curta de jogador/ameaça.
- [x] Wander/andar aleatoriamente dentro de raio configurável.
- [x] Patrulha por pontos.
- [x] Seguir jogador.
- [x] NPC fugir de mobs.
- [x] Mob detectar/adquirir jogador.
- [x] Perseguição.
- [x] Fuga com vida baixa.
- [x] Limite territorial/leash.
- [x] Retorno ao ponto de origem.
- [x] Presets de NPC: Aldeão, Comerciante, Guarda e Companheiro.
- [x] Presets de mob: Agressivo, Covarde, Territorial e Passivo.
- [x] Configuração do cérebro persistida pelo World Editor.
- [x] Fallback de animação para NPC legado sem animação de caminhada.

---

# Fase 1 — PostgreSQL + Redis + sistema de contas

**Prioridade máxima.** Antes de empilhar novas features grandes, precisamos definir quem é o jogador, onde o progresso pertence e como o servidor persiste estado.

## Setup de PostgreSQL e Redis

O administrador não precisa conhecer comandos de banco. O `/setup` deve fazer a configuração guiada.

### PostgreSQL

- [ ] Campos no setup: host, porta, database, usuário, senha e SSL quando necessário.
- [ ] Botão/teste automático de conexão antes de concluir a instalação.
- [ ] Criar schema/tabelas automaticamente por migrations.
- [ ] Mostrar erro legível quando credenciais, host ou permissões estiverem incorretos.
- [ ] Nunca gravar senha do PostgreSQL em logs.
- [ ] Health check do PostgreSQL em `/health`/painel.

### Redis

- [ ] Campos no setup: host, porta, usuário quando aplicável, senha e TLS quando necessário.
- [ ] Teste automático com `PING` antes de concluir instalação.
- [ ] Prefixo de chaves próprio do BrowserQuest para evitar colisão com outros sistemas.
- [ ] Health check do Redis em `/health`/painel.
- [ ] Nunca gravar senha do Redis em logs.
- [ ] TTL obrigatório para dados temporários.

### Responsabilidades

**PostgreSQL:**

- usuários;
- personagens;
- equipamento/inventário persistente;
- progresso de história/missões;
- conquistas persistentes;
- bans/suspensões;
- configurações permanentes do servidor;
- auditoria administrativa;
- metadados persistentes de conteúdo quando aplicável.

**Redis:**

- sessões de usuário/admin;
- rate limit;
- presença online;
- cache de consultas frequentes;
- locks curtos quando necessários;
- eventos/pub-sub efêmeros se futuramente houver mais de um processo;
- estado transitório que pode ser reconstruído.

## Política de acesso escolhida pelo administrador

Existem **duas formas reais de entrada** no jogo:

1. **Somente nome** — comportamento clássico do BrowserQuest; o jogador informa um nome e entra sem conta.
2. **Conta** — usuário + senha, com personagem e progresso ligados ao servidor.

O administrador poderá configurar:

- [ ] `Somente nome`.
- [ ] `Somente conta`.
- [ ] `Permitir os dois` — libera simultaneamente convidado e conta.
- [ ] Permitir ou bloquear novos cadastros.
- [ ] Reservar nomes pertencentes a contas registradas para impedir impersonação por convidados.
- [ ] Definir inicialmente 1 personagem por conta, deixando estrutura preparada para mais no futuro.

## Schema inicial PostgreSQL

- [ ] `users`.
- [ ] `characters`.
- [ ] `settings`.
- [ ] `admin_audit_log`.
- [ ] `moderation_actions`/bans/suspensões.
- [ ] tabelas de progresso de história/missão.
- [ ] migrations versionadas desde a primeira implantação.
- [ ] índices para username, personagem, status e buscas administrativas.
- [ ] foreign keys e transações onde necessário.
- [ ] migration/compatibilidade da conta atual do dono/admin sem quebrar instalações existentes.

## Sessões e autenticação

- [ ] Registro com usuário + senha.
- [ ] Login.
- [ ] Logout.
- [ ] Sessões armazenadas no Redis com TTL.
- [ ] `HttpOnly` cookie.
- [ ] `SameSite` apropriado.
- [ ] `Secure` em HTTPS.
- [ ] Token de sessão criptograficamente aleatório; Redis recebe identificador/hash apropriado, nunca senha.
- [ ] Senhas com `scrypt` + salt aleatório.
- [ ] Rate limit de login/registro usando Redis.
- [ ] Nome de usuário normalizado e único no PostgreSQL.
- [ ] Ban/status sempre confirmado no PostgreSQL; cache Redis pode acelerar, mas não é a fonte final.
- [ ] Sem telefone/SMS.
- [ ] Sem e-mail obrigatório.

## Integração com o cliente original

- [ ] Endpoint público com política atual de acesso.
- [ ] Tela clássica permanece intacta no modo `Somente nome`.
- [ ] Tela de login/registro aparece quando contas estiverem habilitadas.
- [ ] Em `Permitir os dois`, oferecer claramente “Entrar com conta” e “Jogar como convidado”.
- [ ] WebSocket identificar automaticamente sessão autenticada.
- [ ] Em `Somente conta`, recusar WebSocket não autenticado.
- [ ] Jogador autenticado não pode falsificar nome/equipamento enviados pelo cliente.
- [ ] Nome e personagem autenticado são definidos pelo servidor.
- [ ] Presença online pode ser mantida no Redis com TTL/heartbeat.

### Critério de conclusão da Fase 1

Uma instalação nova consegue configurar PostgreSQL + Redis pelo navegador; migrations são aplicadas automaticamente; o admin consegue escolher a política de acesso; convidados funcionam quando liberados e contas registradas entram/reconectam com identidade segura.

---

# Fase 2 — Progresso persistente do jogador

Depois de existir identidade confiável, mover gradualmente o estado importante do navegador para PostgreSQL.

- [ ] Persistir personagem por conta.
- [ ] Persistir armadura equipada.
- [ ] Persistir arma equipada.
- [ ] Persistir inventário/itens conforme o sistema evoluir.
- [ ] Persistir progresso de história/missões.
- [ ] Persistir flags de história.
- [ ] Persistir punições/status da conta.
- [ ] Migrar conquistas importantes do `localStorage` para PostgreSQL.
- [ ] Manter `localStorage` apenas como cache/preferências locais quando houver conta.
- [ ] Convidado continua podendo usar o comportamento legado/local enquanto o admin permitir acesso por nome.
- [ ] Tratar reconexão sem duplicar personagem/estado.
- [ ] Redis pode cachear leituras frequentes, mas toda alteração permanente deve terminar salva no PostgreSQL.

### Critério de conclusão da Fase 2

Uma conta consegue trocar de navegador/dispositivo, fazer login e recuperar personagem e progresso essencial sem depender do `localStorage` antigo ou de dados efêmeros do Redis.

---

# Fase 3 — Painel administrativo completo

O `/admin` deve virar o centro operacional do servidor.

## Dashboard

- [ ] Status do servidor.
- [ ] Uptime.
- [ ] Número total de jogadores online.
- [ ] Jogadores por mundo.
- [ ] Estado HTTP/WebSocket.
- [ ] Estado PostgreSQL.
- [ ] Estado Redis.
- [ ] Latência simples de conexão aos serviços.
- [ ] Limite de jogadores por mundo.
- [ ] Indicadores de saúde úteis.

## Jogadores online

- [ ] Lista de jogadores online.
- [ ] Mostrar se é conta ou convidado.
- [ ] Mundo atual.
- [ ] Nome/ID.
- [ ] Tempo de conexão/presença usando dados efêmeros do Redis.
- [ ] Kick com motivo.
- [ ] Mute quando o sistema de chat/moderação suportar isso.

## Contas

- [ ] Pesquisar/listar contas no PostgreSQL.
- [ ] Ver personagem/progresso básico.
- [ ] Suspender.
- [ ] Banir.
- [ ] Remover suspensão/ban.
- [ ] Encerrar sessões no Redis.
- [ ] Invalidar todas as sessões de uma conta.

## Configurações

- [ ] Alternar `Somente nome`, `Somente conta` ou `Permitir os dois`.
- [ ] Liberar/bloquear registros.
- [ ] Reservar nomes registrados.
- [ ] Configurar número de mundos.
- [ ] Configurar limite de jogadores.
- [ ] Mostrar claramente quando alteração exige reinício.

## Comunicação e auditoria

- [ ] Anúncio global do administrador.
- [ ] Log de ações administrativas no PostgreSQL.
- [ ] Registrar quem executou kick/ban/suspensão/configuração.
- [ ] Não registrar senhas, tokens ou secrets.

## Segurança

- [ ] Proteção de origem/CSRF para ações administrativas.
- [ ] Limite de tamanho do body HTTP.
- [ ] Rate limit do setup, login e APIs usando Redis.
- [ ] Headers básicos de segurança.
- [ ] SQL sempre parametrizado/prepared statements.
- [ ] Conteúdo dinâmico do painel escapado corretamente.
- [ ] Princípio de menor privilégio no usuário PostgreSQL usado pelo jogo.

### Critério de conclusão da Fase 3

Um dono consegue operar o servidor pelo navegador sem editar JSON nem abrir shell para tarefas normais.

---

# Fase 4 — Story Editor virando gameplay real

O editor visual e armazenamento já existem. Falta o runtime que consome histórias publicadas.

- [ ] Carregar histórias publicadas no servidor.
- [ ] Criar estado de missão por jogador/conta no PostgreSQL.
- [ ] Iniciar missão conversando com NPC vinculado.
- [ ] Objetivo `talk`.
- [ ] Objetivo `kill`.
- [ ] Objetivo `collect`.
- [ ] Objetivo `visit`.
- [ ] Objetivo `interact`.
- [ ] Suporte seguro a objetivos `custom` sem execução arbitrária de código.
- [ ] Quantidades/progresso parcial.
- [ ] Diálogo de início.
- [ ] Diálogo de conclusão.
- [ ] Entrega de recompensa.
- [ ] Recompensa de item.
- [ ] Recompensa de conquista.
- [ ] Recompensa/flag de história.
- [ ] Próxima missão linear.
- [ ] Escolhas do jogador.
- [ ] Ramificações condicionais.
- [ ] Tela/tracker de missões no cliente.
- [ ] Persistir missão atual/progresso.
- [ ] Vincular NPC do World Editor a histórias/missões reais.
- [ ] Vincular objetivo `kill` ao perfil correto de mob.
- [ ] Validar referências quebradas antes de publicar uma história.
- [ ] Redis opcionalmente cacheia definição de história publicada; PostgreSQL/arquivos persistentes continuam sendo fonte durável.
- [ ] Teste ponta a ponta: publicar -> aceitar -> cumprir -> receber recompensa -> reiniciar -> progresso permanece.

### Critério de conclusão da Fase 4

Uma campanha inteira criada no Story Editor pode ser jogada e persistida sem editar código fonte.

---

# Fase 5 — World Editor completo

O editor lógico atual é a base. A evolução planejada permitirá editar quase todo o mundo.

## Mapa/terreno

- [ ] Pintura real de tiles usando o tileset do BrowserQuest.
- [ ] Camadas visuais do mapa.
- [ ] Ferramenta de seleção/pincel.
- [ ] Colisão integrada à pintura.
- [ ] Checkpoints.
- [ ] Portas.
- [ ] Teleportes/destinos.
- [ ] Spawns.
- [ ] Baús.
- [ ] Itens estáticos.
- [ ] Áreas de nascimento/roaming de mobs.
- [ ] Manter formato-mestre e gerar automaticamente mapa do cliente + servidor.

## Workflow editorial

- [x] Rascunho.
- [x] Publicação.
- [x] Snapshot/versões básicas.
- [ ] Restaurar versão anterior pelo painel.
- [ ] Validação forte antes de publicar.
- [ ] Preview/teste do mundo antes de ativá-lo.

### Critério de conclusão da Fase 5

O administrador consegue construir/modificar uma área completa visualmente e publicar cliente + servidor sincronizados.

---

# Fase 6 — Importador de sprites e animações

Hoje custom NPCs/mobs reutilizam arte existente. O próximo passo visual é permitir conteúdo novo.

- [ ] Upload/importação de PNG.
- [ ] Validar dimensão e formato da spritesheet.
- [ ] Preview visual antes de salvar.
- [ ] Modelo de NPC estático/simples.
- [ ] Modelo de NPC animado.
- [ ] Modelo de mob.
- [ ] Mapear `idle`.
- [ ] Mapear caminhada.
- [ ] Mapear ataque.
- [ ] Mapear morte.
- [ ] Suporte às direções usadas pelo BrowserQuest.
- [ ] Reutilizar spritesheet importada em múltiplos perfis.
- [ ] Detectar animações ausentes e usar fallback seguro.
- [ ] Não limitar artificialmente a 16x16/32x32/64x64; validar tamanho real do frame e organização da folha.
- [ ] Não permitir que upload inválido quebre o cliente global.

### Critério de conclusão da Fase 6

Um admin importa um PNG, define frames/animações, cria NPC/mob e publica sem alterar arquivos manualmente.

---

# Fase 7 — Brain System v2: mundo mais vivo

A v1 resolveu movimentação e reações básicas. A v2 adicionará comportamento social e rotina sem rede neural pesada.

- [ ] Percepção de outros NPCs.
- [ ] Memória curta com expiração explícita.
- [ ] Prioridades/utility score.
- [ ] Guarda proteger aldeão/NPC próximo.
- [ ] NPC reagir a combate nas proximidades.
- [ ] NPC parar/olhar para jogador próximo.
- [ ] NPC conversar/interagir com outro NPC quando configurado.
- [ ] Rotinas simples por pontos/horários/estado do mundo.
- [ ] Trabalho/atividade configurável.
- [ ] Reações ligadas a missão/flag de história.
- [ ] Pathfinding A* quando necessário, mantendo custo controlado.
- [ ] Timers distribuídos/jitter para evitar todos os cérebros pensando no mesmo instante.
- [ ] Presets editáveis no World Editor.
- [ ] Entidade explicitamente fixa/sem cérebro apenas quando o criador desejar.
- [ ] Redis poderá ajudar em coordenação efêmera no futuro, mas decisão autoritativa permanece no servidor de jogo.

### Critério de conclusão da Fase 7

NPCs parecem habitantes do mundo e reagem ao contexto sem scripts específicos espalhados pelo servidor.

---

# Fase 8 — Backups, restauração e operação

- [ ] Backup do PostgreSQL pelo painel/processo de operação.
- [ ] Backup das configurações e conteúdos de `var/`.
- [ ] Histórias.
- [ ] Mundo publicado.
- [ ] Assets importados.
- [ ] Download/exportação de backup.
- [ ] Restauração validada.
- [ ] Snapshot antes de operações destrutivas importantes.
- [ ] Histórico de versões do World Editor acessível pelo painel.
- [ ] Histórico de versões do Story Editor.
- [ ] Diagnóstico aaPanel mostrando Node, PostgreSQL, Redis, permissões e configuração.
- [ ] Procedimento documentado de atualização sem perder dados.
- [ ] Redis não precisa de backup para preservar progresso; deve poder ser reconstruído a partir do PostgreSQL/estado atual.

---

# Fase 9 — Robustez, desempenho e testes

- [ ] Testes PostgreSQL/migrations.
- [ ] Testes Redis/conexão/TTL.
- [ ] Testes de registro/login/logout/sessão.
- [ ] Testar os três estados administrativos de acesso: nome, conta, ambos.
- [ ] Testar reserva de nomes registrados.
- [ ] Testar conta banida/suspensa no HTTP e WebSocket.
- [ ] Testar persistência de personagem.
- [ ] Testar Story Runtime ponta a ponta.
- [ ] Testar publicação/restauração de mapas.
- [ ] Testar importador de sprites inválidos/válidos.
- [ ] Testar Brain System com várias entidades simultâneas.
- [ ] Testar queda do Redis: nenhum progresso permanente pode ser perdido.
- [ ] Testar reconexão do Redis e invalidação/recriação de cache.
- [ ] Testar queda temporária do PostgreSQL com comportamento seguro/readiness=false.
- [ ] Connection pooling PostgreSQL com limites adequados.
- [ ] Limites para impedir centenas de ticks desnecessários.
- [ ] Verificar vazamentos de timers/sessões/conexões.
- [ ] Testes de reconexão WebSocket.
- [ ] Teste de reinício e recuperação dos dados persistidos.
- [ ] Manter CI em Node.js 24.

---

# Fase 10 — Release instalável/upgrade seguro

- [ ] Setup cria/configura owner/admin + PostgreSQL + Redis + política de acesso de forma atômica.
- [ ] Migrations automáticas e versionadas.
- [ ] Instalação limpa testada no aaPanel.
- [ ] Tela do setup ensina exatamente quais dados copiar do PostgreSQL e Redis do aaPanel.
- [ ] Botões `Testar PostgreSQL` e `Testar Redis` antes de instalar.
- [ ] Atualização de instalação existente sem perder conteúdo de `var/`.
- [ ] README com instalação e atualização.
- [ ] ROADMAP mantido atualizado.
- [ ] `/health` e `/ready` refletem falhas reais do PostgreSQL/Redis.
- [ ] Funcionar atrás de proxy HTTPS do aaPanel.
- [ ] Nenhuma dependência de Docker.
- [ ] Backup recomendado antes de upgrade.

---

# Ordem recomendada de execução

1. **PostgreSQL + Redis + contas + política de acesso.**
2. **Persistência do jogador.**
3. **Administração/moderação completa.**
4. **Story Runtime.**
5. **World Editor completo/tiles.**
6. **Importador de sprites/animações.**
7. **Brain System v2.**
8. **Backups/restauração.**
9. **Hardening, desempenho e testes finais.**
10. **Release instalável/upgrade seguro.**

A ordem existe para evitar retrabalho. Missões persistentes dependem de identidade; administração de contas depende da camada de contas; e histórias/Brain System ficam mais úteis quando mundo, personagem e progresso têm identidade estável.

---

# Definição de pronto para qualquer fase

Uma fase só deve ser marcada como concluída quando:

- [ ] funciona no servidor real, não apenas no editor;
- [ ] tem interface utilizável quando for recurso administrativo;
- [ ] dados importantes sobrevivem ao reinício;
- [ ] queda do Redis nunca destrói progresso permanente;
- [ ] não quebra o fluxo clássico quando compatibilidade for esperada;
- [ ] possui validação de entrada;
- [ ] possui smoke/integration test do fluxo crítico;
- [ ] CI fica verde;
- [ ] documentação é atualizada.

---

# Fora do plano por enquanto

Para manter o projeto controlável, não faz parte do plano atual:

- Docker/Compose;
- Kubernetes;
- MySQL como banco principal;
- SQLite como banco principal de produção;
- rede neural/modelo pesado de IA para NPCs;
- telefone/SMS obrigatório para conta;
- infraestrutura distribuída complexa antes de existir necessidade real.

A arquitetura oficial passa a ser **Node.js + PostgreSQL + Redis**, com servidor autoritativo e implantação principal via aaPanel.
