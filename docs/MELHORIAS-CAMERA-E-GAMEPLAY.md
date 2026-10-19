# Câmera adaptável e revisão de gameplay

## Mudanças implementadas

- Campo de visão calculado pela proporção da janela, com limites de 14–30 colunas e 10–22 linhas. O celular em paisagem deixa o antigo recorte fixo de 15 × 7; em retrato recebe um campo vertical.
- O frame e os três canvases passam a usar as dimensões reais da câmera, mantendo arte pixelada e a proporção correta. O ajuste usa visualViewport quando disponível.
- Removida a tela que obrigava girar o celular durante a entrada e o jogo. Joystick disponível nas duas orientações.
- Botão de tela cheia quando o navegador oferece a API. A interface acompanha a saída da tela cheia pelo navegador.
- Redimensionamento reposiciona a câmera no personagem, cancela transições antigas e atualiza a zona. Portas deixam de aplicar coordenadas de câmera feitas para a tela móvel antiga.
- Servidor atualiza a associação do jogador aos grupos ao mover e ao caminhar para pegar itens; a área de interesse passa de até 9 para até 25 grupos para cobrir os extremos da câmera maior. Isso aumenta a quantidade potencial de entidades enviadas, devendo ser observado em testes de carga. O limite é fixado pelo servidor, não pelo cliente.
- Divisão do mapa em grupos usa arredondamento para cima, incluindo faixas parciais da última linha/coluna.
- Coleta de itens e abertura de baús exigem distância máxima de um bloco nas coordenadas do servidor.
- Renascimento não permite um segundo HELLO durante a validação pendente.
- Atualizações de HP inválidas são ignoradas pelo cliente. Meta tag atual de suporte a aplicativo móvel adicionada.
- Mantidas as oito correções iniciais descritas em REVISAO-ESTABILIDADE-2026-10-19.md.

## Projetos examinados

- Kaetram/Kaetram-Open, commit f5b6665ef035ba79816458b92cbe77204042a318: packages/client/src/renderer/camera.ts. Referência conceitual para câmera calculada a partir do espaço disponível e limites de blocos. Licença principal examinada: MPL-2.0. https://github.com/Kaetram/Kaetram-Open/blob/f5b6665ef035ba79816458b92cbe77204042a318/packages/client/src/renderer/camera.ts
- Jerenaux/phaserquest, commit 128fe1051cc056dd60b805a1380e7b257b2e04b3: README.md e js/client/main.js. A documentação descreve gerenciamento de interesse e atualizações entre cliente e servidor; main.js ainda inicializa um canvas fixo 980 × 500. Licença examinada: MIT. https://github.com/Jerenaux/phaserquest/tree/128fe1051cc056dd60b805a1380e7b257b2e04b3

A implementação desta revisão é própria. Não foram importados código, dependências, mapas, personagens ou outros assets desses projetos.

## Testes

- npm run check: suíte local completa.
- test/adaptive-viewport-smoke.js: seis proporções de tela, limites da câmera, cobertura dos grupos nas bordas e reposicionamento após resize.
- test/spawn-entry-combat-smoke.js: HP calculado em Node sem globals, proteção/limpeza de alvo, golpes remotos/repetidos, ações de mortos, números inválidos, coleta remota e HELLO duplicado no renascimento.
- test/mobile-controls-chromium-e2e.js: expectativa atualizada para joystick também em retrato.
- test/adaptive-viewport-chromium-e2e.js: servidor real com visitante, entrada pelo cliente público, HP válido, sobrevivência por 11 segundos, desktop/paisagem/retrato, rotação, ausência de erros de execução e screenshots. Integrado ao workflow Sprite Chromium Visual E2E.
- O Chromium não estava instalado neste ambiente; o download falhou com ZIP truncado. O teste visual deve ser confirmado no workflow do PR; não foi apresentado como aprovado localmente.

## Limites atuais

O protocolo legado MOVE informa o destino antes de o cliente percorrer o caminho. Esta revisão não converteu o movimento para simulação autoritativa por passo; validações de distância usam a posição atualmente conhecida do servidor. Portanto, distância de coleta não constitui proteção completa contra teleporte. Essa migração precisa ser coordenada entre cliente/servidor, com correção de posição e testes de latência. O combate também continua dependendo dos pedidos HIT/HURT do cliente.

Não houve implantação na VPS nem acesso ao mapa publicado do editor. A revisão não substitui testes no ambiente de produção e testes de carga da área de interesse ampliada.
