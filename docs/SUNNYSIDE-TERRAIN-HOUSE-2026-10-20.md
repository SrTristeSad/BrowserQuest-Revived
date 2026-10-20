# Sunnyside World 16×16 — primeira integração (20/10/2026)

## Origem e direitos
- Artista/pacote: Daniel Diggle — [Sunnyside World V2.1](https://danieldiggle.itch.io/sunnyside).
- Os dois PNGs em `client/img/sunnyside` são pequenos **recortes** necessários ao jogo, retirados exclusivamente do ZIP fornecido pelo proprietário do projeto. **Não** são o ZIP do artista, nem um pacote de redistribuição de assets.
- A arte mantém a licença própria do autor. A licença MPL-2.0 do código não altera os direitos dessa arte. Não tratar as imagens como CC0, nem como recursos para revenda isolada ou treinamento de IA.
- O responsável pelo projeto deve conservar a autorização/licença do pacote antes de redistribuir os recortes em versões derivadas públicas.

## Integração executada
- Grama de base: tiles antigos 15, 16, 35, 36, 155, 156, 175, 176.
- Água de base: tiles antigos 179, 180, 199, 200. **Validar visualmente a classificação** antes da expansão; os IDs foram selecionados para um primeiro protótipo. Não alteram as coordenadas, colisões ou biomas salvos.
- Primeira casa: porta exterior `(51,205)` para `(154,143)` e porta de saída correspondente — par que já existe nos 84 links originais do mapa.
- Piso do interior usa parte dos IDs 1487, 1488, 1507, 1508 apenas no retângulo `x=150..158, y=135..142`.
- Mobília desenhada no piso: cama em (152,138), armário em (156,139), tapete em (154,140). A cama e armário bloqueiam **somente suas células**, iguais no cliente (worker/JSON) e no servidor. Tapete é caminhável.
- As imagens entram na renderização de terreno de 8×8 células e mantêm pixels 16×16 sem suavização. Renderizadores sem o atlas usam o tile original.
- Os mapas completos e outras 83 ligações de porta **não foram regravados**, evitando perda de progresso, colisões de cenário e configurações do World Editor.

## Limites desta etapa
- O protótipo apenas mobília **uma casa preexistente**, não todas as edificações.
- Não converte automaticamente todas as árvores, paredes, telhados, monstros, animações nem NPCs.
- O recorte de móveis é pixel art de 16×16; objetos grandes ou multiquadros devem ganhar layout, quadros e colisões próprias antes de instalar.
- A correspondência de água e grama precisa ser conferida em jogo real, incluindo zonas de transição e animações; o build automatizado cobre consistência técnica, não avaliação artística.
- O World Editor ainda não possui ferramenta dedicada de mobília Sunnyside; nesta fase o template é fixo e condicionado à presença do par exato de portas. Se o mundo for reformado e as portas mudarem, o template não entra em vigor.

## Testes
`npm run test:canvas`, `npm run test:gameplay`, `npm run test:world-editor` e `npm run check`.

Após publicar no VPS: reiniciar Node.js 24 no aaPanel, limpar cache do navegador e conferir as transições, os móveis, água, grama e os dois controles.
