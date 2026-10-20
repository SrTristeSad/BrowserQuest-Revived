# Auditoria de combate, câmera e sincronização — 19/10/2026

## Escopo e limites
Revisão do fluxo que liga IA de mobs, seleção de alvo, registros de atacante,
validação de dano, animação de golpes, atualização da câmera, renderização
Canvas2D e controles responsivos. Foram examinados também os mecanismos de
regeneração, entradas no mundo, versões de assets e testes de regressão.
O código do repositório e os testes automatizados **não substituem o teste
na VPS com o mapa realmente publicado**, e este documento não afirma que
todos os subsistemas não relacionados foram auditados exaustivamente.

## Diagnóstico: causas concretas

| Prioridade | Falha anterior | Consequência | Intervenção |
|---|---|---|---|
| Crítica | O ramo de IA de aquisição usava diretamente `entity.setTarget(player)` quando a lista de ódio já continha o jogador | Mob persegue sem figurar em `player.attackers`; `CombatGuard` rejeita todo dano | Toda aquisição e reparo passam por `world.handleMobHate()` / `chooseMobTarget()`, que registram os dois lados |
| Alta | `chooseMobTarget` verificava somente `mob.id in player.attackers`, sem comparar o objeto do atacante nem confirmar `mob.target` | Vínculos órfãos/stale não se recuperam e alvos podem ficar inconsistentes | Repara vinculações incompletas; exige mob vivo, objeto ativo no mundo e jogador registrado |
| Alta | Pacotes `HURT` legados do cliente ainda acionavam `Player.applyMobHit` | Uma mensagem enviada pelo navegador podia adiantar golpes dentro do cooldown, mesmo após introduzir o timer servidor no PR #119 | `HURT` passa a ser ignorado; somente `world.updateMobCombat` aplica dano |
| Alta | `Camera.forEachVisiblePosition` e `isVisiblePosition` percorriam exatamente `gridW × gridH` tiles completos sem levar em conta a fração de scroll | Coluna e linha visíveis na direita/baixo não eram desenhadas ou consideradas visíveis durante acompanhamento suave | Bounds calculados por `floor/ceil` das coordenadas reais em pixels, com margens simétricas |
| Média | `Updater.updateZoning` (transição por telas) ainda rodava em cada frame, junto com o follow render-time | Dois sistemas podiam disputar a câmera e criar trabalho de renderização desnecessário | Desativa transição legada no loop ativo; o renderer faz a única sincronização por frame |
| Média | `Game.tick` executava follow além do `Renderer.renderFrame` (introduzido no PR #119) | Dupla passagem de centragem e possível repintura de fundo redundante | Remove a chamada antecipada; mantém o renderer como proprietário da câmera |

## Critérios de segurança mantidos
- Monstro morto, removido, sem alvo válido ou fora do alcance nunca causa dano.
- O jogador continua protegido na área de nascimento e durante o período inicial de invulnerabilidade.
- Dano e cooldown são calculados no servidor; cliente apenas exibe as animações e recebe o HP atualizado.
- A política de regeneração fora de combate continua vigente.
- As atualizações de movimento continuam passando pela validação de tile do servidor.
- Mapas privados, contas, personagem, checkpoints e configurações publicadas não são substituídos.

## Testes e regressões
- `test/combat-link-integrity-smoke.js`: executa `Brain`, `World`,
  `Player`, `CombatGuard` e o tick de ataque do servidor; testa
  aquisição com ódio prévio, perda parcial de vínculos, restauração
  bidirecional, ausência de notificações duplicadas, dano real, spawn seguro
  e objetos inválidos.
- `test/audit-camera-visibility-smoke.js`: testa viewport alinhado,
  scroll sub-tile, colunas/linhas parciais, margens e overscroll nas bordas,
  além de verificar ausência de ZONE e HURT no fluxo visual.
- Ajustados testes anteriores para não exigir mais o protocolo cliente
  `HURT` nem dois cálculos de câmera por frame.
- Testes integrados a `npm run test:gameplay`, `npm run test:canvas`,
  `npm run check`. Permanecem as suítes de IA, persistência, mundo e
  navegador Chromium.

## Publicação operacional
1. Validar o PR e o estado de `main` no GitHub.
2. Na VPS, rodar `node scripts/atualizar-vps-ssh.mjs --check`, depois `--apply`.
3. Rodar `npm run test:gameplay`, `npm run test:brain`, `npm run test:canvas`.
4. **Reiniciar Node.js no aaPanel** para ativar as alterações do servidor.
5. No navegador, Ctrl+Shift+R e confirmar a versão de cliente. A presença de código atualizado no disco não demonstra que o processo reiniciou nem que um browser deixou de usar cache antigo.
6. Em uma sessão real e **fora da zona segura**, conferir HP antes e depois de receber um golpe de mob, perseguição quando o mob se desloca, ausência de regeneração em combate e posicionamento do herói no centro da área jogável, inclusive durante scroll parcial e resize.

## Pontos que ainda dependem de ambiente real
- Consistência entre mapa de produção preservado pelo atualizador e os arquivos versionados, sobretudo zonas seguras e áreas de mobs.
- Logs reais do processo Node.js, estado de `/ready`, cache de proxy/browser e qual PID do aaPanel responde às conexões.
- Qualidade visual do sprite no centro (centro matemático do tile vs. percepção do corpo desenhado), que deve ser avaliada por captura após atualização.
- Combate com vários jogadores e mobs: carga, lag de rede e persistência em condições de produção.
