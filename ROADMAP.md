# BrowserQuest Revived — Plano Mestre de Desenvolvimento

Este documento é a fonte oficial do que já foi concluído e do que ainda vamos construir no **BrowserQuest Revived**. A prioridade é transformar a base original do BrowserQuest em um jogo administrável, expansível e fácil de instalar em **aaPanel/Node.js**, sem depender de Docker, Redis, MySQL ou serviços externos obrigatórios.

## Regras do projeto

- Preservar o visual, a identidade e a jogabilidade base do BrowserQuest sempre que possível.
- Servidor autoritativo para estado importante: identidade, combate, NPCs/mobs, missões e progresso persistente.
- **Sem Docker.** Implantação principal via Node.js + aaPanel.
- Banco local quando necessário: **SQLite**, sem exigir MySQL/Redis.
- Nenhuma exigência de telefone/SMS para jogadores.
- E-mail também não deve ser obrigatório na primeira versão de contas.
- Toda feature administrativa precisa ser funcional; evitar botões de aparência que não façam nada.
- Mudanças grandes devem manter compatibilidade com o cliente/protocolo legado quando isso não impedir a evolução do projeto.
- Manter testes automatizados para instalação, HTTP, WebSocket, editores, autenticação, Brain System e fluxos críticos.

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

# Fase 1 — Sistema de contas e formas de acesso

**Prioridade máxima.** Antes de empilhar novas features grandes, precisamos definir quem é o jogador e onde o progresso pertence.

## Política de acesso escolhida pelo administrador

Existem **duas formas reais de entrada** no jogo:

1. **Somente nome** — comportamento clássico do BrowserQuest; o jogador informa um nome e entra sem conta.
2. **Conta** — usuário + senha, com personagem e progresso ligados ao servidor.

O administrador poderá configurar:

- [ ] `Somente nome`.
- [ ] `Somente conta`.
- [ ] `Permitir os dois` — não é uma terceira forma de login; apenas libera simultaneamente nome/convidado e conta.
- [ ] Permitir ou bloquear novos cadastros.
- [ ] Reservar nomes pertencentes a contas registradas para impedir impersonação por convidados.
- [ ] Definir inicialmente 1 personagem por conta, deixando estrutura preparada para mais no futuro.

## Persistência SQLite

- [ ] Adicionar SQLite local dentro de `var/`.
- [ ] Tabela de usuários.
- [ ] Tabela de personagens.
- [ ] Tabela de sessões.
- [ ] Tabela de configurações do servidor/admin.
- [ ] Tabela de auditoria administrativa.
- [ ] Status de conta: ativa, suspensa e banida.
- [ ] Migração/compatibilidade da conta atual do dono/admin para a nova camada de persistência sem quebrar instalações existentes.

## Autenticação do jogador

- [ ] Registro com usuário + senha.
- [ ] Login.
- [ ] Logout.
- [ ] Sessão persistente segura.
- [ ] `HttpOnly` cookie.
- [ ] `SameSite` apropriado.
- [ ] `Secure` em HTTPS.
- [ ] Token de sessão aleatório; armazenar apenas hash do token no banco.
- [ ] Senhas com `scrypt` + salt aleatório.
- [ ] Rate limit em login e registro.
- [ ] Nome de usuário normalizado e único.
- [ ] Sem telefone/SMS.
- [ ] Sem e-mail obrigatório.

## Integração com o cliente original

- [ ] Endpoint público com política atual de acesso.
- [ ] Tela clássica permanece intacta no modo `Somente nome`.
- [ ] Tela de login/registro aparece quando contas estiverem habilitadas.
- [ ] Em `Permitir os dois`, oferecer claramente “Entrar com conta” e “Jogar como convidado”.
- [ ] WebSocket identificar automaticamente sessão autenticada pelo cookie.
- [ ] Em `Somente conta`, recusar WebSocket não autenticado.
- [ ] Jogador autenticado não pode falsificar nome/equipamento enviados pelo cliente.
- [ ] Nome e personagem autenticado são definidos pelo servidor.

### Critério de conclusão da Fase 1

Um admin consegue trocar a política de acesso pelo painel sem alterar código; convidados continuam funcionando quando liberados e uma conta registrada consegue entrar, reconectar e manter sua identidade com segurança.

---

# Fase 2 — Progresso persistente do jogador

Depois de existir identidade confiável, mover gradualmente o estado importante do navegador para o servidor.

- [ ] Persistir personagem por conta.
- [ ] Persistir armadura equipada.
- [ ] Persistir arma equipada.
- [ ] Persistir estado necessário de inventário/itens conforme o sistema for evoluindo.
- [ ] Persistir progresso de história/missões.
- [ ] Persistir flags de história.
- [ ] Persistir punições/status da conta.
- [ ] Migrar conquistas importantes do `localStorage` para persistência do servidor.
- [ ] Manter `localStorage` apenas como cache/preferências locais quando houver conta.
- [ ] Convidado continua podendo usar o comportamento legado/local enquanto o admin permitir acesso por nome.
- [ ] Tratar reconexão sem duplicar personagem/estado.

### Critério de conclusão da Fase 2

Uma conta consegue trocar de navegador/dispositivo, fazer login e recuperar personagem e progresso essencial sem depender do `localStorage` antigo.

---

# Fase 3 — Painel administrativo completo

O `/admin` deve deixar de ser apenas porta para os editores e virar o centro operacional do servidor.

## Dashboard

- [ ] Status do servidor.
- [ ] Uptime.
- [ ] Número total de jogadores online.
- [ ] Jogadores por mundo.
- [ ] Estado HTTP/WebSocket.
- [ ] Limite de jogadores por mundo.
- [ ] Indicadores de saúde simples e úteis.

## Jogadores online

- [ ] Lista de jogadores online.
- [ ] Mostrar se é conta ou convidado.
- [ ] Mundo atual.
- [ ] Nome/ID.
- [ ] Kick com motivo.
- [ ] Mute quando o sistema de chat/moderação suportar isso.

## Contas

- [ ] Pesquisar/listar contas.
- [ ] Ver personagem/progresso básico.
- [ ] Suspender.
- [ ] Banir.
- [ ] Remover suspensão/ban.
- [ ] Encerrar sessões ativas.

## Configurações

- [ ] Alternar `Somente nome`, `Somente conta` ou `Permitir os dois`.
- [ ] Liberar/bloquear registros.
- [ ] Reservar nomes registrados.
- [ ] Configurar número de mundos.
- [ ] Configurar limite de jogadores.
- [ ] Mostrar claramente quando uma alteração exige reinício.

## Comunicação e auditoria

- [ ] Anúncio global do administrador.
- [ ] Log de ações administrativas.
- [ ] Registrar quem executou kick/ban/suspensão/configuração.
- [ ] Não registrar senhas ou tokens sensíveis.

## Segurança

- [ ] Proteção de origem/CSRF para ações administrativas.
- [ ] Limite de tamanho do body HTTP.
- [ ] Rate limit do setup de 6 dígitos.
- [ ] Rate limit de login administrativo.
- [ ] Headers básicos de segurança.
- [ ] SQL sempre parametrizado/prepared statements.
- [ ] Conteúdo dinâmico do painel inserido com `textContent`/escape correto.

### Critério de conclusão da Fase 3

Um dono consegue operar o servidor pelo navegador sem precisar editar JSON manualmente nem abrir shell para tarefas normais de administração.

---

# Fase 4 — Story Editor virando gameplay real

O editor visual e armazenamento já existem. Falta o runtime que consome histórias publicadas.

- [ ] Carregar histórias publicadas no servidor.
- [ ] Criar estado de missão por jogador/conta.
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
- [ ] Testes ponta a ponta: publicar história -> entrar no jogo -> aceitar -> cumprir -> receber recompensa.

### Critério de conclusão da Fase 4

Uma campanha inteira criada no Story Editor pode ser jogada sem editar código fonte.

---

# Fase 5 — World Editor completo

O editor lógico atual é a base. A evolução planejada é permitir editar de fato quase todo o mundo.

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
- [ ] Manter um formato-mestre e gerar automaticamente mapa do cliente + servidor.

## Workflow editorial

- [x] Rascunho.
- [x] Publicação.
- [x] Snapshot/versões básicas.
- [ ] Restaurar uma versão anterior pelo painel.
- [ ] Validação forte antes de publicar.
- [ ] Preview/teste do mundo antes de torná-lo ativo.

### Critério de conclusão da Fase 5

O administrador consegue construir/modificar uma área completa do jogo visualmente e publicar cliente + servidor sincronizados.

---

# Fase 6 — Importador de sprites e animações

Hoje custom NPCs/mobs reutilizam arte já existente. O próximo passo visual já discutido é permitir conteúdo novo.

- [ ] Upload/importação de PNG.
- [ ] Validar dimensão e formato da spritesheet.
- [ ] Preview visual antes de salvar.
- [ ] Modelo de NPC estático/simples.
- [ ] Modelo de NPC animado.
- [ ] Modelo de mob.
- [ ] Mapear linhas/frames de `idle`.
- [ ] Mapear caminhada.
- [ ] Mapear ataque.
- [ ] Mapear morte.
- [ ] Suporte às direções usadas pelo BrowserQuest.
- [ ] Reutilizar uma spritesheet importada em múltiplos perfis.
- [ ] Detectar animações ausentes e usar fallback seguro.
- [ ] Não permitir que um upload inválido quebre o carregamento global do cliente.

### Critério de conclusão da Fase 6

Um admin importa um PNG, define suas animações, cria um NPC/mob com essa arte e o publica sem alterar arquivos manualmente.

---

# Fase 7 — Brain System v2: mundo mais vivo

A v1 resolveu movimentação e reações básicas. A v2 adicionará comportamento social e rotina sem transformar o projeto em um sistema pesado de IA.

- [ ] Percepção de outros NPCs, não apenas jogador/mob.
- [ ] Memória curta com expiração mais explícita.
- [ ] Prioridades/utility score para escolher entre ações concorrentes.
- [ ] Guarda proteger aldeão/NPC próximo.
- [ ] NPC reagir a combate nas proximidades.
- [ ] NPC parar/olhar para jogador próximo.
- [ ] NPC conversar/interagir com outro NPC quando configurado.
- [ ] Rotinas simples por pontos/horários/estado do mundo.
- [ ] Trabalho/atividade configurável.
- [ ] Reações ligadas a missão/flag de história.
- [ ] Melhorar pathfinding para A* quando necessário, mantendo custo controlado.
- [ ] Evitar decisões simultâneas desnecessárias com timers distribuídos/jitter.
- [ ] Presets editáveis no World Editor.
- [ ] Entidade pode ser explicitamente configurada como fixa/sem cérebro quando o criador realmente quiser isso.

### Critério de conclusão da Fase 7

NPCs parecem habitantes do mundo e conseguem reagir ao contexto sem scripts específicos espalhados pelo servidor.

---

# Fase 8 — Backups, restauração e operação

- [ ] Backup simples de `var/` pelo painel.
- [ ] Incluir SQLite, histórias, mundo publicado e configurações.
- [ ] Download/exportação de backup.
- [ ] Restauração validada.
- [ ] Snapshot antes de operações destrutivas importantes.
- [ ] Histórico de versões do World Editor acessível pelo painel.
- [ ] Histórico de versões do Story Editor.
- [ ] Diagnóstico aaPanel mostrando permissões, arquivos e configuração essenciais.
- [ ] Procedimento documentado de atualização sem perder dados.

---

# Fase 9 — Robustez, desempenho e testes

- [ ] Testes de registro/login/logout/sessão.
- [ ] Testar os três estados administrativos de acesso: nome, conta, ambos.
- [ ] Testar reserva de nomes registrados.
- [ ] Testar conta banida/suspensa no HTTP e WebSocket.
- [ ] Testar persistência de personagem.
- [ ] Testar Story Runtime ponta a ponta.
- [ ] Testar publicação/restauração de mapas.
- [ ] Testar importador de sprites inválidos/válidos.
- [ ] Testar Brain System com várias entidades simultâneas.
- [ ] Limites para impedir que configuração de admin gere centenas de ticks desnecessários.
- [ ] Verificar vazamentos de timers/sessões/conexões.
- [ ] Testes de reconexão WebSocket.
- [ ] Teste de reinício do processo e recuperação dos dados persistidos.
- [ ] Manter CI em Node.js 24.

---

# Fase 10 — Preparação para uma versão realmente instalável

- [ ] Setup novo cria dono/admin + SQLite + política inicial de acesso de forma atômica.
- [ ] Instalação limpa testada no aaPanel.
- [ ] Atualização de instalação existente sem perder `var/`.
- [ ] README com instalação e atualização.
- [ ] ROADMAP mantido atualizado.
- [ ] `/health` e `/ready` refletindo falhas reais de dependências internas.
- [ ] Garantir que o jogo funciona atrás de proxy HTTPS do aaPanel.
- [ ] Nenhuma dependência de Docker.
- [ ] Nenhuma dependência obrigatória de MySQL/Redis.
- [ ] Backup recomendado antes de upgrade.

---

# Ordem recomendada de execução

1. **Contas + SQLite + política de acesso.**
2. **Persistência do jogador.**
3. **Administração/moderação completa.**
4. **Story Runtime.**
5. **World Editor completo/tiles.**
6. **Importador de sprites/animações.**
7. **Brain System v2.**
8. **Backups/restauração.**
9. **Hardening, desempenho e testes finais.**
10. **Release instalável/upgrade seguro.**

A ordem existe para evitar retrabalho. Por exemplo: missões persistentes dependem de identidade do jogador; administração de contas depende da camada de contas; e histórias/Brain System ficam muito mais úteis depois que mundo, personagem e progresso têm identidade estável.

---

# Definição de pronto para qualquer fase

Uma fase só deve ser marcada como concluída quando:

- [ ] funciona no servidor real, não apenas no editor;
- [ ] tem interface utilizável quando for recurso administrativo;
- [ ] dados importantes sobrevivem ao reinício;
- [ ] não quebra o fluxo clássico quando a compatibilidade for esperada;
- [ ] possui validação de entrada;
- [ ] possui pelo menos smoke/integration test do fluxo crítico;
- [ ] CI fica verde;
- [ ] documentação é atualizada.

---

# Fora do plano por enquanto

Para manter o projeto leve e compatível com a VPS/aaPanel, não faz parte do plano atual:

- Docker/Compose;
- Kubernetes;
- Redis obrigatório;
- MySQL obrigatório;
- rede neural/modelo de IA para NPCs;
- telefone/SMS obrigatório para conta;
- infraestrutura distribuída antes de existir necessidade real.

O objetivo é continuar com **Node.js + armazenamento local + servidor autoritativo**, evoluindo a arquitetura somente quando uma limitação real justificar isso.
