# Autenticação e persistência — Fase 1

Este documento descreve a arquitetura de autenticação do **BrowserQuest Revived** depois da adoção de PostgreSQL + Redis.

## Responsabilidades

### PostgreSQL
É a fonte de verdade para dados que não podem ser perdidos:

- usuários;
- personagens;
- senha em hash `scrypt`;
- função/role e status da conta;
- nome reservado do personagem;
- configurações administrativas, incluindo política de acesso;
- auditoria administrativa.

### Redis
Armazena apenas estado temporário:

- sessão do jogador;
- sessão administrativa;
- rate limit de login/cadastro;
- futuramente presença/cache e outros dados reconstruíveis.

Perder o conteúdo do Redis pode derrubar sessões, mas **não pode apagar contas, personagens ou progresso permanente**.

## Modos de acesso

O setting `access_mode` aceita:

- `name_only`: experiência clássica; não exige conta;
- `mixed`: permite conta ou entrada clássica por nome;
- `account_only`: exige sessão de conta válida antes de o WebSocket entrar no mundo.

O setting `registration_enabled` controla se novas contas podem ser criadas.

As configurações são lidas do PostgreSQL e podem ser alteradas pelo painel sem reiniciar o processo. A mudança vale para novas conexões; jogadores já conectados não são expulsos automaticamente.

## Conta e personagem

Nesta fase cada conta de jogador possui um personagem.

No cadastro:

1. o username é normalizado para minúsculas;
2. a senha recebe salt aleatório e hash `scrypt`;
3. é criada uma linha em `users` com role `player`;
4. é criado o personagem inicial em `characters`;
5. o nome de personagem possui unicidade case-insensitive;
6. é criada uma sessão no Redis.

O modelo já permite evolução futura sem confiar no cliente para identidade.

## Sessão de jogador

Cookie:

- nome: `bq_player_session`;
- `HttpOnly`;
- `SameSite=Lax`;
- `Secure` automaticamente quando servido por HTTPS;
- TTL padrão: 8 horas.

O valor cru do token fica somente no cookie. O Redis usa uma chave derivada por SHA-256, de forma que o token não seja armazenado diretamente como nome da chave.

O JavaScript do cliente consulta `/api/auth/session`, mas nunca recebe o token.

## WebSocket autoritativo

A autorização ocorre **antes** de criar o `Player` e antes de escolher um mundo.

Para uma conta autenticada:

- nome vem do personagem no PostgreSQL;
- equipamento inicial vem do personagem no PostgreSQL;
- nome/equipamento enviados pelo pacote legado `HELLO` não são confiáveis;
- tentativa de falsificação no `HELLO` não altera a identidade.

Para convidado:

- o protocolo clássico continua funcionando;
- nomes pertencentes a personagens registrados são bloqueados.

O protocolo `HELLO/WELCOME` foi preservado para manter compatibilidade com o cliente BrowserQuest.

## API pública de autenticação

- `GET /api/auth/policy`
- `GET /api/auth/session`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Registro e login possuem rate limit armazenado no Redis.

## Administração

Instalações com PostgreSQL/Redis usam:

- credencial administrativa validada pela linha correspondente em `users`;
- sessões administrativas no Redis;
- rate limit administrativo no Redis;
- auditoria de login, logout e alterações de configuração em `admin_audit_log`;
- `/admin/settings` para política de acesso e status da infraestrutura;
- `/admin/api/health` para PostgreSQL/Redis;
- `/admin/api/settings/access` para leitura/alteração de `access_mode` e `registration_enabled`.

Instalações antigas sem infraestrutura ainda podem usar `admin.json` e sessão em memória como caminho de compatibilidade até migração.

## Regras de segurança atuais

- SQL parametrizado nas operações com valores externos;
- senhas nunca são persistidas em texto puro;
- sessão do jogador/admin usa token aleatório de 256 bits;
- cookies de sessão são `HttpOnly`;
- endpoints administrativos mutáveis validam a origem quando o navegador envia `Origin`;
- conta suspensa/banida é recusada pelo autorizador;
- dados permanentes nunca dependem exclusivamente do Redis.

## Testes

O CI usa PostgreSQL e Redis reais, sem Docker, e valida:

- migrations;
- cadastro/login/logout;
- sessão e TTL;
- perda do estado do Redis sem perda da conta/personagem;
- os três modos de acesso;
- reserva de nome;
- autenticação pelo cookie do WebSocket;
- tentativa de spoofing do `HELLO`;
- sessão administrativa Redis;
- instalador, admin, editores e protocolo legado.
