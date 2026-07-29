# InPlastic Kanban Interno

Kanban interno com dois quadros:

- **Diretoria**: Backlog estratégico → Em análise → Aprovado / em execução → Concluído.
- **Colaboradores**: A fazer → Em andamento → Em revisão → Concluído.

Arquitetura: **Node.js + Express + SQLite + HTML/CSS/JS puro**.

## Melhorias já aplicadas nesta versão

- Sessão persistente em SQLite usando `better-sqlite3`, não MemoryStore.
- `SESSION_SECRET` obrigatório e forte.
- `helmet` para headers básicos de segurança.
- Rate limit no login.
- Cookie `httpOnly`, `sameSite=lax` e opção `COOKIE_SECURE=true` em HTTPS.
- Validação de permissão também na coluna destino ao mover cartões.
- Bloqueio contra mover cartão entre quadros por API.
- Auditoria básica em `card_activity` para criação, edição, movimentação e exclusão.
- Script de criação/atualização de usuários via terminal.

## Instalação

```bash
cd /root/workspace/inplastic-kanban
npm install
cp .env.example .env
openssl rand -hex 32
# cole o valor gerado em SESSION_SECRET no .env
npm run seed
npm start
```

Para teste local rápido:

```bash
PORT=3010 SESSION_SECRET=<cole-aqui-um-segredo-gerado-com-openssl-rand-hex-32> COOKIE_SECURE=false npm start
```

## Usuários iniciais após seed

| usuário | senha | papel |
|---|---|---|
| `wagner` | `mudar123` | diretoria |
| `diretor` | `mudar123` | diretoria |
| `colaborador` | `mudar123` | colaborador |

Trocar antes de produção.

## Criar ou atualizar usuário

```bash
npm run create-user
```

## Produção recomendada

- Rodar atrás de Nginx com HTTPS.
- Definir `NODE_ENV=production`.
- Definir `COOKIE_SECURE=true` depois de ativar HTTPS.
- Usar PM2:

```bash
npm install -g pm2
pm2 start server.js --name inplastic-kanban
pm2 save
pm2 startup
```

## Backup

O banco fica em `data/kanban.db` e as sessões em `data/sessions.sqlite`.

```bash
mkdir -p backups
cp data/kanban.db backups/kanban-$(date +%F).db
```
