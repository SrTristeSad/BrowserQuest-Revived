# Auditoria de runtime após o PR #113

Base: main, commit 5d339a8b8e9c9bab44638ac530067ea43ab912fb.

## Defeitos confirmados e corrigidos

1. MOVE colocava o jogador diretamente no destino, antes de percorrer o caminho. O cliente passa a informar cada bloco concluído, inclusive ao parar e ao seguir um alvo. O servidor exige passo cardinal adjacente, tile transitável e crédito de tempo compatível com 120 ms por bloco. Há tolerância limitada de até quatro passos para agrupamento de pacotes; movimentos rejeitados recebem correção de posição, consumida pelo próprio cliente.
2. LOOTMOVE podia ser usado para chegar imediatamente a qualquer item. Agora registra somente intenção, sem alterar a posição, e exige que as coordenadas correspondam ao item. Coleta e baús continuam exigindo proximidade na posição validada.
3. TELEPORT aceitava qualquer destino transitável. Agora exige que a posição atual e o destino correspondam exatamente a uma porta publicada no mapa.
4. CHECK permitia salvar um checkpoint arbitrário. Agora exige presença dentro de sua área.
5. Mensagens JSON null ou objetos provocavam exceção antes de passar pelo validador. O código da ação só é lido após identificar um array.
6. Tipos de entidade desconhecidos provocavam exceção nas funções isArmor/isWeapon e outras classificações compartilhadas. Agora a classificação retorna tipo ausente; equipamento inválido de visitantes recebe os padrões válidos, com HP finito.
7. Uma consulta assíncrona de entrada podia terminar depois da desconexão e adicionar um jogador fantasma. O fechamento é registrado na conexão e no jogador; a entrada pendente não registra o personagem após o fechamento. Seleção assíncrona de mundo também verifica a conexão.
8. Motivos de fechamento com caracteres multibyte ultrapassavam o limite WebSocket de 123 bytes, mesmo após corte em 123 caracteres. O limite agora é calculado em UTF-8, preservando caracteres completos.
9. Baús usavam underscore global ausente; monstros e roaming usavam Utils global ausente. As dependências agora são importadas explicitamente. Baús importam também Item diretamente.
10. Uma busca de posição em área totalmente bloqueada podia travar o event loop indefinidamente. A busca agora é finita e retorna null quando não há posição; seus consumidores lidam com a ausência.
11. A busca de posição ao lado de um alvo também podia rodar indefinidamente se cercado. Agora testa as quatro direções e retorna null.
12. Remover uma entidade ausente de uma área executava splice(-1,1), apagando a última entidade existente. Agora não modifica a área nesse caso.
13. O retorno de um monstro ao ponto inicial podia disparar depois da morte, emitindo movimento de uma entidade removida. O timer é cancelado na morte e o callback não move monstros mortos. Novos retornos substituem o timer anterior.
14. Respawn de áreas registrava o mesmo monstro duas vezes no mundo. Removido o segundo registro.
15. Poções de fogo consecutivas mantinham timers sobrepostos, permitindo restauração antecipada da aparência. A nova poção substitui o timer anterior.
16. WHO aceitava IDs de entidades fora da área de interesse do jogador e repetia respostas para IDs duplicados. Agora exige associação ao grupo visível e elimina duplicatas.
17. Duas gravações de um mesmo personagem podiam executar em paralelo, fazendo uma atualização antiga terminar depois da nova e sobrescrevê-la. As gravações agora são sequenciais por personagem.
18. flushAll ignorava gravações já em curso e parava ao primeiro erro. Agora aguarda pendentes e operações em andamento, tenta todos os personagens e comunica as falhas agregadas.
19. Mensagens com quantidades excessivas de parâmetros/strings não tinham limite no validador. Adicionados limites compatíveis com o cliente: até 4096 parâmetros e strings de até 2048 caracteres, além do limite de payload WebSocket existente.
20. A construção da grade de colisões pesquisava toda a lista de colisões a cada tile. Um Set mantém o mesmo resultado com custo linear no tamanho da grade e da lista.

## Compatibilidade de cliente e atualização

MOVE mantém o número e o formato da mensagem, mas passa a significar posição de um passo concluído. É necessário atualizar servidor e cliente juntos e recarregar clientes antigos. O servidor rejeitará saltos de clientes que continuem enviando destinos distantes.

O teste de persistência por gameplay foi atualizado para percorrer um caminho transitável, no ritmo normal, antes de coletar a arma. O comportamento anterior desse teste dependia do defeito de LOOTMOVE.

## Validação

- test/audit-runtime-smoke.js: colisão, adjacência, ritmo, portas, loot sem salto, checkpoints, classificação/equipamento inválido, mensagens malformadas, fechamento UTF-8, término de entrada após desconexão, baús, leash, buscas bloqueadas, remoção de área, timers e ordem de persistência.
- Teste Chrome existente ampliado para caminhar com o teclado e verificar mensagens reais de passos, sem correções indevidas do servidor. Mantém desktop, paisagem, retrato, rotação, HP e canvas dentro da tela.
- Suíte local npm run check e workflows do PR devem ser usados como referência para o resultado final da revisão.

## Limitações explícitas

A revisão reduz defeitos confirmados; não certifica ausência de todos os bugs. O servidor valida os passos informados, mas ainda não simula sozinho todo o movimento. O combate ainda depende de pedidos HIT/HURT do cliente; uma migração para dano totalmente calculado em ticks do servidor exige trabalho e testes próprios. Não houve acesso nem implantação na VPS. Mapas publicados do editor, latência de redes reais, número elevado de jogadores e dispositivos físicos precisam de validação no ambiente do usuário.
