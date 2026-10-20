# Validação para voltar ao World Editor — 20/10/2026

Este roteiro cobre a etapa de jogabilidade a validar antes de editar o mundo em produção. A conclusão dos testes automatizados no GitHub não equivale à confirmação em um celular real ou na VPS.

## Antes de atualizar a VPS

- Salvar backup externo das configurações privadas, dados persistentes, arquivos de mundo publicados e banco de dados. Nunca substituir dados de runtime pelos arquivos padrão do GitHub.
- Conferir se o Pull Request de joystick flutuante foi integrado ao `main` e se o CI passou.
- No diretório raiz do projeto aaPanel, executar:
  ```bash
  node scripts/atualizar-vps-ssh.mjs --check
  ```
- Verificar a lista de alterações. Para aplicar a versão integrada do `main`, executar:
  ```bash
  node scripts/atualizar-vps-ssh.mjs --apply
  npm run test:gameplay
  npm run test:canvas
  npm run test:brain
  ```
- Reiniciar manualmente o processo Node.js pelo aaPanel; o atualizador **não reinicia** o processo.
- No navegador, recarregar sem cache (desktop: Ctrl+Shift+R) e conferir `window.BROWSERQUEST_CLIENT_BUILD` pelo console.

## Celular — controles

- [ ] Abrir em Android e, se possível, iOS, em retrato e paisagem.
- [ ] Ao tocar no mapa, o círculo de controle aparece **na coordenada do dedo**, inclusive fora do canto esquerdo.
- [ ] Soltar sem arrastar chama uma única ação de jogo: tocar para andar, atacar um mob, coletar um item ou interagir com NPC.
- [ ] Arrastar acima da zona morta movimenta em uma das quatro direções; nenhum clique de mundo é disparado ao soltar.
- [ ] Mudar o arrasto da direita para cima interrompe o segmento anterior na próxima casa segura e muda de direção.
- [ ] Segundo dedo consegue tocar um mob/item enquanto o primeiro mantém o direcional, sem reposicionar a base.
- [ ] Soltar, cancelar gesto, girar tela, trocar de aba ou perder foco não deixa movimento nem direcional presos.
- [ ] Chat, tutorial, conquistas, equipamentos e o botão de tela cheia continuam funcionando e recebem os próprios toques.
- [ ] Conferir que o joystick **não fica fixo** cobrindo o canto esquerdo depois do gesto.
- [ ] Verificar que arrastar sobre o mapa não desloca/rola a página e não distorce a pixel art.

## Câmera e combate

- [ ] Em desktop e celular, caminhar continuamente: jogador permanece no centro visível, inclusive perto da borda do mapa.
- [ ] Verificar scroll entre tiles, movimento próximo aos limites do mapa, redimensionamento e rotação do aparelho.
- [ ] Confirmar que clicar em um mob durante scroll parcial seleciona o mob realmente tocado.
- [ ] Em área fora da zona de proteção, esperar passar a invulnerabilidade de entrada; registrar HP e receber um golpe.
- [ ] Confirmar que os golpes dos mobs subtraem HP no servidor, sem depender de evento HURT do cliente.
- [ ] Observar mob aproximando-se lateralmente ao chegar diagonal e golpeando somente em casa ortogonal adjacente.
- [ ] Conferir que HP não se regenera enquanto o combate estiver ativo; depois de sair de combate, aplicar a política de recuperação gradual.
- [ ] Confirmar morte e respawn sem perda indevida de contas ou progresso persistido.

## Critério de aceite

Abrir o World Editor em produção somente após a suíte automática verde **e** as verificações manuais de câmera, controles e combate na versão de servidor efetivamente executada pelo aaPanel. Não substituir mapas publicados para fazer esta validação.
