# Revisão de estabilidade — 19/10/2026

Base examinada: 8a9e22ac09487b3313850bbb2b55b60cbffa14af.

## Problemas encontrados e corrigidos

1. Vida inicial inválida: gametypes.js usava underscore global sem importá-lo no Node. O cálculo dos níveis de equipamento falhava, gerando HP NaN, serializado como null no WELCOME. Reproduzido com servidor e WebSocket reais; corrigida a importação CommonJS. O cliente compara HP <= 0 e null pode provocar a morte na primeira sincronização.
2. Proteção inicial incompleta: durante os 10 segundos sem dano, monstros ainda podiam adquirir e perseguir o jogador. Isso permitia que inimigos se aproximassem antes do primeiro dano válido. A IA e os dois caminhos de seleção de alvo agora respeitam a proteção temporal. Alvos antigos protegidos também perdem os vínculos de perseguição e ódio. É uma causa possível compatível com o relato; não foi confirmada na VPS do usuário.
3. HIT confiava no ID recebido: era possível causar dano à distância e chamar métodos de monstro em entidades de outro tipo. Agora exige monstro vivo, adjacência e intervalo mínimo de 450 ms entre golpes do jogador.
4. ATTACK aceitava entidades que não eram monstros. Agora restringe a monstros vivos.
5. AGGRO aceitava entidades de tipos incorretos e podia chamar métodos inexistentes. Agora valida os tipos de jogador e monstro.
6. Personagens mortos ainda podiam enviar ações de jogo. Agora só o HELLO de renascimento passa nesse estado; ações também são bloqueadas enquanto o handshake está pendente.
7. LOOTMOVE alterava a posição antes de validar o destino e o item. Agora valida a posição e a existência de uma entidade do tipo item antes de mover.
8. O validador de protocolo aceitava frações e números não seguros como coordenadas e IDs; a chamada direta com objeto/nulo também falhava. Agora exige mensagens em array, código inteiro e parâmetros numéricos inteiros seguros.

## Validação

- npm ci --ignore-scripts: instalação concluída usando o lockfile existente.
- npm run check: suíte geral existente passou antes e depois das correções.
- node test/spawn-entry-combat-smoke.js: teste adicional passou, cobrindo aquisição e limpeza de alvos protegidos, retomada após a proteção, HIT remoto/adjacente/duplicado, personagem morto e números inválidos.
- WebSocket real no mapa versionado: antes da correção, WELCOME continha HP null; depois, HP 80 e conexão permaneceu aberta por 15 segundos, ultrapassando a proteção inicial sem morte. Esse teste de protocolo não executa a renderização nem o combate do navegador.
- git diff --check: passou.

## Limites e pendências

- A VPS, seus logs e o mapa publicado pelo editor não foram acessados. A configuração publicada pode diferir do mapa versionado. É necessário validar o caso relatado após aplicar o PR.
- Os testes de PostgreSQL/Redis, reinício de persistência e navegador real não foram executados nesta revisão. A suíte geral usa seus testes locais disponíveis.
- O combate ainda usa mensagens HIT/HURT do cliente. As validações adicionais não substituem uma simulação completa de combate pelo servidor.
- MOVE e LOOTMOVE ainda não possuem validação de velocidade/caminho, e coleta ainda precisa de uma revisão própria de distância/autorização. Não considerar o protocolo integralmente protegido contra clientes modificados.
- Nenhuma atualização indiscriminada de dependências foi feita: a instalação e os testes passaram com as versões fixadas atuais.
- Esta revisão não garante ausência de todos os bugs. Publicação na VPS e merge não foram realizados.
