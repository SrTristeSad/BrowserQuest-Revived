# BrowserQuest Revived — Plano Mestre de Desenvolvimento

Este documento é a fonte oficial do estado atual e da evolução planejada do **BrowserQuest Revived**. O objetivo é transformar a base original do BrowserQuest em um jogo administrável, expansível e fácil de instalar em **aaPanel/Node.js**, preservando a identidade visual e o gameplay clássico sempre que possível.

## Arquitetura oficial

- **Node.js + aaPanel** = implantação principal.
- **PostgreSQL (PgSQL)** = fonte de verdade e armazenamento permanente.
- **Redis** = sessões, rate limit, presença, cache e estado efêmero.
- **Sem Docker/Compose.**
- Dados importantes nunca dependem somente do Redis.
- Servidor autoritativo para identidade, equipamento, combate, histórias, progresso e Brain System.
- Sem telefone/SMS obrigatório e sem e-mail obrigatório na primeira versão de contas.

## Regras do projeto

- Preservar o visual, a identidade e a jogabilidade base do BrowserQuest sempre que possível.
- Toda feature administrativa deve ser funcional; evitar botões que apenas aparentam funcionar.
- Mudanças grandes devem manter compatibilidade com o cliente/protocolo legado quando isso não impedir a evolução.
- PostgreSQL é o armazenamento durável para contas, personagens, progresso, histórias, moderação, configurações e auditoria.
- Redis pode acelerar e coordenar estado temporário, mas nunca é a única fonte de progresso permanente.
- Manter testes automatizados para instalação, HTTP, WebSocket, autenticação, persistência, editores, Story Runtime, administração e Brain System.
- Cada fase só fecha com CI verde e teste do fluxo crítico.

---

# Estado atual — v0.5.0

## Status consolidado de execução

- [x] **Fase 1 — PostgreSQL + Redis + contas + política de acesso** — concluída na #6.
- [x] **Fase 2 — Progresso persistente do jogador** — concluída na #15.
- [x] **Fase 3 — Painel administrativo completo** — concluída na #21.
- [x] **Fase 4 — Story Runtime** — concluída na #46.
- [ ] **Fase 5 — World Editor completo** — próxima fase oficial; já possui editor lógico, publicação e snapshots como fundação.
- [ ] **Fase 6 — Importador de sprites/animações**.
- [ ] **Fase 7 — Brain System v2** — Brain System v1 já concluído e será a fundação.
- [ ] **Fase 8 — Backups e restauração** — snapshots básicos do mundo já existem, mas o sistema integral ainda não.
- [ ] **Fase 9 — Robustez, desempenho e testes finais** — várias suítes já existem antecipadamente, mas a fase formal ainda não está concluída.
- [ ] **Fase 10 — Release instalável/upgrade seguro** — setup/aaPanel/migrations/health já existem como fundação.

## Fundação já concluída

- [x] Projeto original do Mozilla BrowserQuest importado e preservado.
- [x] Modernização para Node.js 24 LTS.
- [x] WebSocket RFC 6455 moderno com `ws`.
- [x] Cliente HTTP e WebSocket servidos pelo mesmo processo/porta.
- [x] `ws://` / `wss://` automático conforme HTTP/HTTPS.
- [x] Endpoints `/status`, `/health` e `/ready`.
- [x] Instalação visual em `/setup`.
- [x] Código de instalação de 6 díitos exibido nos logs do Node/aaPanel.
- [x] Criação da conta inicial do dono/admin durante o setup.
- [x] Senha administrativa protegida com `scrypt`.
- [x] Painel autenticado em `/admin`.
- [x] Story Editor em `/admin/story-editor`.
- [x] World Editor em `/admin/world-editor`.
- [x] Publicação sincronizada dos dados de mundo do servidor e do cliente.
- [x] Versionamento/snapshots básicos do mundo publicado.
- [x] Brain System v1 para NPCs e mobs.
- [x] Testes de sintaxe, servidor, WebSocket, instalador, admin, Story Editor, World Editor, persistência e Brain System.

## Brain System v1 concluído

- [x] Cérebro compartilhado para NPCs e mobs.
- [x] Percepção simples por distância.
- [x] Memória curta de jogador/ameaça.
- [x] Wander dentro de raio configurável.
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

# Fase 1 — PostgreSQL + Redis + sistema de contas — CONCLUÍDA

Implementação detalhada e critérios de conclusão estão registrados na issue **#6**.

Entregue:

- [x] PostgreSQL + Redis configuráveis pelo `/setup`.
- [x] Teste de conexão antes de instalar e migrations versionadas.
- [x] Contas, personagens, settings e auditoria no PostgreSQL.
- [x] Políticas `name_only`, `mixed` e `account_only`.
- [x] Registro, login e logout.
- [x] Sessões de jogador/admin no Redis com TTL.
- [x] Cookies `HttpOnly`, `SameSite` e `Secure` em HTTPS.
- [x] Rate limit Redis.
- [x] Nomes registrados reservados.
- [x] Identidade/equipamento inicial de conta definidos pelo servidor.
- [x] Integração da conta com o cliente original e WebSocket.
- [x] Health de PostgreSQL/Redis.
- [x] Sem telefone/SMS e sem e-mail obrigatório.
- [x] Restart/flush do Redis testado sem perda de conta/personagem.

---

# Fase 2 — Progresso persistente do jogador — CONCLUÍDA

Implementação detalhada e critérios de conclusão estão registrados na issue **#15**.

Entregue:

- [x] Personagem persistente por conta.
- [x] Arma e armadura equipadas no PostgreSQL.
- [x] Checkpoint seguro persistente.
- [x] `character_progress` genérico para progresso e flags.
- [x] Conquistas e contadores importantes no servidor.
- [x] `localStorage` apenas como cache/importação legada controlada para contas.
- [x] Debounce, retry e flush no disconnect.
- [x] Flush gracioso em `SIGTERM`/`SIGINT`.
- [x] Reconexão e restart completo do Node preservam estado.
- [x] Redis pode ser perdido/reiniciado sem apagar progresso permanente.

---

# Fase 3 — Painel administrativo completo — CONCLUÍDA

Implementação detalhada e critérios de conclusão estão registrados na issue **#21**.

Entregue:

- [x] Dashboard operacional.
- [x] Saúde PostgreSQL/Redis, uptime, população e capacidade.
- [x] Jogadores online e identificação conta/convidado.
- [x] Kick com flush persistente.
- [x] Mute.
- [x] Suspensão, ban e reativação.
- [x] Revogação de sessões Redis.
- [x] Pesquisa/listagem de contas PostgreSQL.
- [x] Anúncio global no jogo.
- [x] Histórico de auditoria.
- [x] Configurações de acesso, registros, mundos e capacidade.
- [x] Aviso de restart no aaPanel.
- [x] Proteção de origem e teste central de segurança das mutações administrativas.

---

# Fase 4 — Story Editor virando gameplay real — CONCLUÍDA

Implementação detalhada, entregas PR a PR e critérios de conclusão estão registrados na issue **#46**.

## Runtime e persistência

- [x] Carregar somente histórias publicadas no servidor.
- [x] Normalizar/indexar histórias, capítulos e missões com lookup seguro.
- [x] Estado de missão por personagem/conta no PostgreSQL via `character_progress`.
- [x] Progresso carregado no `HELLO` e preservado em reconnect/restart.
- [x] Convidado mantém Story Runtime apenas em memória.
- [x] Reload ao vivo do runtime após mutações de história no Admin.

## Fluxo de missão

- [x] Iniciar missão conversando com NPC realmente vinculado.
- [x] Objetivo `talk`.
- [x] Objetivo `kill`.
- [x] Objetivo `collect`.
- [x] Objetivo `visit`.
- [x] Objetivo `interact`.
- [x] Objetivo `custom` somente via registry server-side seguro; nunca `eval`.
- [x] Quantidades e progresso parcial.
- [x] Diálogo de início.
- [x] Diálogo de conclusão.
- [x] Conclusão idempotente.

## Recompensas e narrativa

- [x] Recompensa de item.
- [x] Arma/armadura unitária entregue e persistida.
- [x] Posse persistente de consumíveis/objetos e equipamento em quantidade maior que 1.
- [x] Achievement persistente e idempotente.
- [x] Story flag persistente e segura.
- [x] Recompensa `custom` limitada a efeitos declarativos revalidados pelo servidor.
- [x] Próxima missão linear atômica.
- [x] Diálogo de conclusão antigo seguido pelo intro da próxima missão já persistida.
- [x] Escolhas do jogador persistentes.
- [x] Ramificações condicionais com gramática segura (`flag:`, `completed:`, `!`, `&&`).
- [x] Fallback linear quando nenhuma escolha é elegível.

## Cliente

- [x] Tracker discreto de missão integrado ao HUD original sem redesign.
- [x] Título, objetivo e progresso atual/necessário.
- [x] Atualização em tempo real após mudanças de Story Runtime.
- [x] Sincronização no login/reconnect.
- [x] Choices integradas ao tracker.
- [x] Cliente não recebe flags internas nem expressões/condições de branch.
- [x] Conteúdo de história renderizado com `textContent`, sem `innerHTML` para dados narrativos.

## Integração Story Editor ↔ World Editor

- [x] NPC do World Editor resolve `storyId`/`missionId` real.
- [x] Giver publicado precisa existir e estar vinculado à mesma história/missão.
- [x] Objetivo `kill` exige perfil de mob real do World Editor.
- [x] Objetivos `talk`, `visit`, `collect` e `interact` têm referências revalidadas.
- [x] `nextMissionId`, choices e condições são validados antes de publicar.
- [x] Recompensas de item/achievement/story flag são revalidadas editorialmente.
- [x] World Editor bloqueia publicação quando NPC aponta para história/missão publicada inexistente.
- [x] Rascunhos continuam livres para edição incompleta.
- [x] Runtime permanece defensivo ao carregar dados antigos/publicados quebrados.

## Testes de conclusão

- [x] Story Editor/World Editor -> publicar -> runtime -> aceitar -> cumprir objetivo -> recompensa -> novo runtime/reconnect -> progresso permanece.
- [x] Persistência real PostgreSQL/restart coberta pelos E2E anteriores da Fase 2 e fundação da Fase 4.
- [x] PR final #76 passou **9/9 workflows** incluindo instalador, PostgreSQL, Redis, admin, Story Editor e World Editor integrados.

### Critério de conclusão da Fase 4

**Concluído.** Uma campanha criada no Story Editor pode usar referências reais do World Editor, ser publicada, jogada, ramificada, recompensada e persistida sem editar código fonte.

> Redis não é requisito para armazenar definições publicadas de história nesta fase. A fonte durável continua nos arquivos persistentes/estado autoritativo, enquanto o PostgreSQL mantém o progresso dos personagens. Cache de definição em Redis permanece uma otimização opcional futura, não um requisito funcional da Fase 4.

---

# Fase 5 — World Editor completo

O editor lógico atual já fornece rascunho/publicação, colisões, entidades, áreas de mobs, perfis NPC/mob, Brain v1, sincronização cliente/servidor e snapshots. A fase 5 expandirá isso para edição visual completa do mundo.

## Mapa/terreno

- [ ] Pintura real de tiles usando o tileset do BrowserQuest.
- [ ] Camadas visuais do mapa.
- [ ] Ferramenta de seleção/pincel completa.
- [ ] Colisão integrada à pintura de terreno.
- [ ] Checkpoints editáveis visualmente.
- [ ] Portas.
- [ ] Teleportes/destinos.
- [ ] Spawns.
- [ ] Baús.
- [ ] Itens estáticos.
- [x] Áreas de nascimento/roaming de mobs — fundação já disponível.
- [x] Formato publicado gera/sincroniza mapa do cliente + servidor — fundação já disponível.

## Workflow editorial

- [x] Rascunho.
- [x] Publicação.
- [x] Snapshot/versões básicas.
- [x] Validação de vínculos Story/World antes de publicar — fundação da Fase 4.
- [ ] Restaurar versão anterior pelo painel.
- [ ] Validação completa do terreno/portas/teleportes/spawns antes de publicar.
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

A v1 já resolveu movimentação e reações básicas. A v2 adicionará comportamento social e rotina sem rede neural pesada.

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
- [x] Timers distribuídos/jitter — fundação presente no Brain v1.
- [x] Presets configuráveis no World Editor — fundação presente no Brain v1.
- [x] Entidade pode ter cérebro habilitado/desabilitado — fundação presente no Brain v1.
- [ ] Redis poderá ajudar em coordenação efêmera no futuro, mas decisão autoritativa permanece no servidor de jogo.

### Critério de conclusão da Fase 7

NPCs parecem habitantes do mundo e reagem ao contexto sem scripts específicos espalhados pelo servidor.

---

# Fase 8 — Backups, restauração e operação

- [ ] Backup do PostgreSQL pelo painel/processo de operação.
- [ ] Backup das configurações e conteúdos persistentes.
- [ ] Histórias.
- [x] Snapshots básicos do mundo publicado — fundação já existente.
- [ ] Assets importados.
- [ ] Download/exportação de backup.
- [ ] Restauração validada.
- [ ] Snapshot antes de operações destrutivas importantes.
- [ ] Histórico de versões do World Editor acessível pelo painel.
- [ ] Histórico de versões do Story Editor.
- [x] Diagnóstico básico aaPanel (`doctor:aapanel`) — fundação já existente.
- [ ] Procedimento documentado de atualização sem perder dados.
- [x] Redis não é fonte final de progresso e pode ser reconstruído/reconectado sem perda permanente.

---

# Fase 9 — Robustez, desempenho e testes

Vários testes foram implementados antecipadamente durante as Fases 1–4. A fase 9 fecha lacunas de escala, falhas e desempenho.

- [x] Testes PostgreSQL/migrations — fundação já coberta.
- [x] Testes Redis/conexão/TTL/restart — fundação já coberta.
- [x] Testes de registro/login/logout/sessão — fundação já coberta.
- [x] Três políticas administrativas de acesso testadas.
- [x] Reserva de nomes registrados testada.
- [x] Conta banida/suspensa testada no HTTP/WebSocket.
- [x] Persistência de personagem/restart testada.
- [x] Story Runtime funcional e E2E de domínio testado.
- [x] Queda/restart do Redis sem perda de progresso permanente testada.
- [x] Reconexão do Redis testada.
- [x] Reconexão WebSocket testada.
- [x] CI em Node.js 24.
- [ ] Testar publicação/restauração completa de mapas.
- [ ] Testar importador de sprites inválidos/válidos quando a Fase 6 existir.
- [ ] Brain System com várias entidades simultâneas/benchmark.
- [ ] Falha temporária do PostgreSQL com comportamento seguro/readiness=false em cenários abrangentes.
- [ ] Revisar connection pooling PostgreSQL sob carga.
- [ ] Limites/ticks sob carga elevada.
- [ ] Verificar vazamentos de timers/sessões/conexões em soak test.
- [ ] Benchmarks de WebSocket/Story Runtime/Brain/World Editor em escala.

---

# Fase 10 — Release instalável/upgrade seguro

Há fundação de instalação, mas a fase só termina quando existir fluxo seguro de release e atualização.

- [x] Setup configura owner/admin + PostgreSQL + Redis + política de acesso.
- [x] Migrations automáticas e versionadas.
- [x] Instalação/fluxo principal validado em CI compatível com aaPanel.
- [x] Botões `Testar PostgreSQL` e `Testar Redis` antes de instalar.
- [x] `/health` e `/ready` existem e consultam infraestrutura.
- [x] Funcionamento atrás de HTTP/HTTPS com WebSocket automático preparado.
- [x] Nenhuma dependência de Docker.
- [x] `doctor:aapanel` como fundação de diagnóstico.
- [ ] Tela/documentação final ensinando exatamente quais dados copiar do PostgreSQL e Redis do aaPanel.
- [ ] Atualização de instalação existente sem perder conteúdo persistente.
- [ ] Rollback/recuperação de upgrade falho.
- [ ] Backup recomendado/automatizado antes de upgrade.
- [ ] README final de instalação e atualização de release.
- [ ] Pacote/tag de release instalável com procedimento de upgrade validado.

---

# Ordem recomendada de execução

1. ~~PostgreSQL + Redis + contas + política de acesso.~~ ✅
2. ~~Persistência do jogador.~~ ✅
3. ~~Administração/moderação completa.~~ ✅
4. ~~Story Runtime.~~ ✅
5. **World Editor completo/tiles.** ← próxima fase oficial
6. **Importador de sprites/animações.**
7. **Brain System v2.**
8. **Backups/restauração.**
9. **Hardening, desempenho e testes finais.**
10. **Release instalável/upgrade seguro.**

A ordem existe para evitar retrabalho. Missões persistentes dependem de identidade; administração depende da camada de contas; Story Runtime depende de progresso persistente; e as fases visuais/Brain ficam mais úteis sobre essa base estável.

---

# Definição de pronto para qualquer fase

Uma fase só deve ser marcada como concluída quando:

- [ ] funciona no servidor real, não apenas no editor;
- [ ] tem interface utilizável quando for recurso administrativo/cliente;
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

A arquitetura oficial permanece **Node.js + PostgreSQL + Redis**, com servidor autoritativo e implantação principal via aaPanel.
