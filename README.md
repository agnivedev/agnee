# Agnee MVP

Dokumentasi lengkap tersedia di:

- [PROJECT.md](./PROJECT.md) — tujuan produk, arsitektur, alur data, AI, deployment,
  keamanan, dan roadmap.
- [CHANGELOG.md](./CHANGELOG.md) — histori perubahan per versi.
- [docs/SETUP.md](./docs/SETUP.md) — runbook setup lokal, Radmond, WhatsApp,
  MCP, OAuth, Nginx, testing, dan troubleshooting.
- [docs/WORK_HISTORY.md](./docs/WORK_HISTORY.md) — ringkasan perjalanan desain,
  implementasi, integrasi, dan migrasi proyek.
- [knowledge/README.md](./knowledge/README.md) — indeks FAQ, funneling sales, dan
  kebijakan jawaban yang siap dipakai sebagai knowledge chatbot.

One small deployment containing:

- responsive login and WhatsApp inbox UI;
- Fastify backend with signed-cookie login and API-key access;
- PostgreSQL persistence for lead state and Auto Reply Playground history;
- unofficial headless WhatsApp Web adapter;
- remote Streamable HTTP MCP and local stdio MCP;
- demo mode for safe local testing without scanning a real WhatsApp account.

> `whatsapp-web.js` is unofficial and can break when WhatsApp Web changes. Use
> an opt-in test number, never bulk-send, and move production traffic to the
> official WhatsApp Business Platform when the product needs an SLA.

## Local demo

```bash
npm install
cp .env.example .env
# Set POSTGRES_PASSWORD and the other required secrets.
docker compose up --build
```

Open <http://127.0.0.1:4100> and use:

```text
admin@agnee.local
agnee-demo
```

The demo inbox can list, read, and send in-memory messages. No real WhatsApp
message is sent.

## Real WhatsApp pairing

```bash
cp .env.example .env
# Set every required secret shown in .env.example.
npm start
```

Open the UI, sign in, click the connection status in the chat header, and scan
the QR from WhatsApp → Linked Devices. The session is persisted under
`WA_SESSION_PATH`.

## Backend API

Browser requests use the signed `agnee_session` cookie. Server-to-server calls
use `x-api-key`.

```text
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/auth/session
GET  /v1/whatsapp/status
GET  /v1/whatsapp/qr
GET  /v1/events
GET  /v1/admin/config
GET  /v1/admin/playground/runs
POST /v1/admin/playground/auto-reply
GET  /v1/chats?limit=20&offset=0&q=&filter=all
GET  /v1/chats/:chatId/messages?limit=30
GET  /v1/chats/:chatId/avatar
GET  /v1/messages/:messageId/media
POST /v1/messages/send
```

Send a direct message:

```bash
curl -X POST http://127.0.0.1:4100/v1/messages/send \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"to":"081234567890","text":"Halo dari Agnee","clientRequestId":"unique-request-id-123"}'
```

Gunakan `clientRequestId` yang sama saat mengulang request yang statusnya tidak
jelas. Backend akan mengembalikan receipt sebelumnya agar pesan tidak terkirim
dua kali.

## MCP

The MCP deliberately exposes only four tools:

```text
whatsapp_status
list_conversations
read_conversation
send_whatsapp_message
```

Run the remote Streamable HTTP endpoint:

```bash
MCP_BEARER_TOKEN=dev-mcp-token npm run mcp:http
# endpoint: http://127.0.0.1:4200/mcp
```

Smoke-test it while the app and MCP processes are running:

```bash
MCP_BEARER_TOKEN=dev-mcp-token npm run test:mcp
```

For a local MCP host that launches child processes:

```bash
API_KEY=dev-api-key npm run mcp
```

The remote endpoint supports OAuth 2.1 Authorization Code + PKCE for ChatGPT
and a separate static bearer token for MCP Inspector/smoke tests. Never paste
the smoke-test bearer into ChatGPT; ChatGPT discovers OAuth automatically from
the protected-resource metadata.

### Connect from ChatGPT

1. Open ChatGPT Settings → Security and login → Developer mode.
2. Open ChatGPT Plugins, press `+`, then add `Agnee WhatsApp`.
3. Use `https://mcp.agnee.agnive.co/mcp` as the connection URL.
4. Complete the Agnee admin login when ChatGPT opens the OAuth page.
5. Review the four discovered tools. Sending remains a write action and should
   only be approved after checking the recipient and final message.

## Docker / server

```bash
chmod +x scripts/server.sh
./scripts/server.sh check
./scripts/server.sh init
./scripts/server.sh up
./scripts/server.sh status
```

The Compose stack binds both services to loopback:

- `127.0.0.1:4100` → app and API;
- `127.0.0.1:4200` → MCP endpoint.

Reverse-proxy `app.agnee.agnive.co` to port `4100` and
`mcp.agnee.agnive.co` to port `4200`. Keep both container ports closed to the
public internet; TLS and hostname routing belong at the reverse proxy.

Deploy to the current Radmond server (defaults are already set in the script):

```bash
./scripts/deploy-radmond.sh
MCP_URL=https://mcp.agnee.agnive.co/mcp \
  MCP_BEARER_TOKEN="$(ssh -i ~/.ssh/id_ed25519_agnive_vps_new root@94.237.73.190 "sed -n 's/^MCP_BEARER_TOKEN=//p' /opt/agnee/.env")" \
  npm run test:mcp
```

## Tests

```bash
npm run check
npm test
npm run test:mcp
```
