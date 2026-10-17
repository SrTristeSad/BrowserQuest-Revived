# PostgreSQL + Redis no BrowserQuest Revived

A partir da fundação v0.5, o projeto passa a usar dois serviços com responsabilidades diferentes:

- **PostgreSQL**: dados permanentes e fonte de verdade do jogo.
- **Redis**: dados rápidos e temporários.

O objetivo do instalador é evitar que o administrador precise conhecer comandos SQL ou Redis para configurar o jogo.

## O que fica no PostgreSQL

PostgreSQL guardará gradualmente:

- contas;
- personagens;
- equipamento e inventário persistente;
- configurações persistentes;
- progresso de história/missões;
- bans/suspensões;
- auditoria administrativa.

Uma reinicialização do servidor não pode apagar esses dados.

## O que fica no Redis

Redis será usado gradualmente para:

- sessões;
- rate limit;
- presença online;
- cache;
- estado temporário que possa ser reconstruído.

**Redis nunca será a única cópia de progresso permanente.** Se o Redis for reiniciado, o máximo aceitável é perder cache/sessão temporária, nunca personagem, inventário ou missão concluída.

## Instalação no mesmo VPS/aaPanel

A configuração mais simples é manter Node.js, PostgreSQL e Redis na mesma VPS.

Nesse caso, normalmente use:

```text
PostgreSQL host: 127.0.0.1
PostgreSQL porta: 5432
Redis host: 127.0.0.1
Redis porta: 6379
```

Crie no PostgreSQL um banco e um usuário exclusivos para o BrowserQuest. Exemplo de nomes:

```text
Banco: browserquest
Usuário: browserquest
Senha: uma senha forte própria do banco
```

Os nomes podem ser diferentes. O importante é preencher no `/setup` exatamente os mesmos dados criados no PostgreSQL.

Para Redis local, o instalador aceita usuário/senha quando o servidor Redis estiver configurado para exigir autenticação. O campo de usuário pode ficar vazio em instalações que não utilizem ACL/usuário Redis.

## Não exponha os bancos na internet sem necessidade

Se Node.js, PostgreSQL e Redis estiverem na mesma VPS, prefira `127.0.0.1` e não abra as portas `5432` e `6379` publicamente apenas para o jogo funcionar.

## Como o `/setup` ajuda

O instalador possui:

- **Testar PostgreSQL**;
- **Testar Redis**;
- validação dos campos;
- migrations automáticas do PostgreSQL;
- criação/atualização da conta owner no PostgreSQL;
- seleção do modo de acesso dos jogadores;
- instalação somente depois que os dois serviços responderem corretamente.

Se um teste falhar, o instalador mostra o erro e não remove o código de instalação.

## Modos de acesso

Durante a instalação o administrador escolhe:

- `Somente nome`;
- `Conta ou convidado`;
- `Somente conta`.

A infraestrutura dessa configuração é criada na v0.5. As telas e APIs completas de conta do jogador são a próxima parte da Fase 1.

## Instalações antigas

Instalações anteriores à v0.5 continuam iniciando em modo legado mesmo sem configuração PostgreSQL/Redis. A migração de uma instalação existente para a nova persistência será tratada separadamente para não apagar dados nem impedir o jogo de subir.

## Segurança

- A senha do administrador nunca é salva em texto puro.
- Credenciais de infraestrutura são gravadas no arquivo privado de configuração (`0600`).
- O instalador não imprime senhas de PostgreSQL/Redis nos logs.
- Queries de dados dinâmicos devem usar parâmetros, nunca concatenação de SQL.
- PostgreSQL é a fonte final de dados permanentes; Redis é descartável/reconstruível.
