# Agnee — Setup dan Operations Runbook

Dokumen ini adalah sumber utama untuk setup lokal, deployment Radmond,
WhatsApp Web, MCP, OAuth, reverse proxy, pengujian, dan operasi harian Agnee.
Dokumen ini tidak menyimpan password, API key, bearer token, QR, atau session
WhatsApp.

## 1. Ruang lingkup

Agnee saat ini merupakan MVP single-workspace untuk:

- inbox WhatsApp internal;
- membaca dan membalas percakapan;
- menangani FAQ serta kualifikasi lead;
- handoff lead ke sales;
- membuka kemampuan backend sebagai MCP tools;
- menerima workflow tambahan melalui webhook atau n8n secara opsional.

Adapter WhatsApp menggunakan `whatsapp-web.js` yang bersifat unofficial. Gunakan
nomor uji yang diizinkan, hindari bulk messaging, dan gunakan WhatsApp Business
Platform resmi ketika produk membutuhkan SLA.

## 2. Domain dan tanggung jawab

| Hostname | Fungsi | Kondisi sekarang |
| --- | --- | --- |
| `agnee.agnive.co` | Landing page produk | Sementara redirect ke app |
| `app.agnee.agnive.co` | UI, login, inbox, dan API | Aktif |
| `mcp.agnee.agnive.co` | MCP Streamable HTTP dan OAuth | Aktif |

Semua DNS mengarah ke Radmond `94.237.73.190`. Port aplikasi tidak dibuka
langsung ke internet; Nginx menerima trafik HTTPS lalu meneruskannya ke port
loopback.

## 3. Arsitektur

```mermaid
flowchart LR
    Agent[Customer service / sales] --> UI[Agnee web app]
    UI --> API[Fastify backend]
    ChatGPT[ChatGPT / MCP client] --> OAuth[OAuth 2.1 + PKCE]
    OAuth --> MCP[MCP gateway]
    MCP --> API
    API <--> WA[WhatsApp Web adapter]
    WA <--> Phone[WhatsApp account]
    API -. optional .-> Hook[n8n / webhook]
    API -. future .-> LLM[OpenRouter / on-prem LLM]
    LLM -. retrieval .-> KB[Markdown knowledge]
```

Prinsip utamanya:

- UI dan MCP adalah dua pintu menuju backend yang sama.
- MCP tidak memiliki LLM di dalamnya; MCP hanya mengekspos tools.
- ChatGPT membawa LLM sendiri ketika memakai MCP.
- Untuk auto-reply dari app, backend perlu memanggil OpenRouter atau LLM on-prem.
- n8n tidak wajib. Gunakan hanya untuk orkestrasi lintas aplikasi.

## 4. Struktur repository

```text
.
├── assets/brand/            Aset brand Agnee
├── deploy/nginx/            Bootstrap HTTP dan virtual host TLS
├── docs/                    Runbook teknis
├── knowledge/               FAQ, funnel, dan kebijakan jawaban
├── public/                  Frontend browser
├── scripts/                 Helper lokal, server, deploy, dan smoke test
├── src/
│   ├── server.js            UI/API, auth, SSE, dan WhatsApp adapter
│   ├── mcp-auth.mjs         OAuth 2.1, PKCE, DCR, dan token validation
│   ├── mcp-http.mjs         Remote MCP Streamable HTTP
│   ├── mcp-server.mjs       Definisi MCP tools
│   └── mcp-stdio.mjs        Local stdio MCP
├── test/                    Node test suite
├── compose.yml
├── Dockerfile
└── .env.example
```

## 5. Persyaratan

### Lokal

- macOS atau Linux;
- Node.js 22+;
- npm;
- Chrome/Chromium untuk WhatsApp real;
- nomor WhatsApp uji untuk pairing.

### Radmond

- SSH root dengan key `~/.ssh/id_ed25519_agnive_vps_new`;
- Docker dan Docker Compose;
- Nginx;
- Certbot;
- DNS ketiga hostname mengarah ke server.

## 6. Environment variables

Salin `.env.example` menjadi `.env`. Jangan commit `.env`.

| Variable | Kegunaan | Rahasia |
| --- | --- | --- |
| `PORT`, `HOST` | Listener app, default `4100` | Tidak |
| `API_KEY` | Backend server-to-server | Ya |
| `SESSION_SECRET` | Penandatangan session UI | Ya |
| `ADMIN_EMAIL` | Akun admin single-workspace | Internal |
| `ADMIN_PASSWORD` | Login UI dan consent OAuth | Ya |
| `POSTGRES_PASSWORD` | Password PostgreSQL untuk Docker Compose | Ya |
| `DATABASE_URL` | Koneksi PostgreSQL saat menjalankan Node langsung | Ya |
| `DATABASE_POOL_MAX` | Batas koneksi pool aplikasi | Tidak |
| `DATABASE_SSL` | Wajibkan TLS PostgreSQL remote | Tidak |
| `WA_SESSION_PATH` | Lokasi persisted WhatsApp profile | Sensitif |
| `WA_CLIENT_ID` | Nama profile WhatsApp | Tidak |
| `WA_DEFAULT_COUNTRY_CODE` | Normalisasi nomor, default `62` | Tidak |
| `WA_STARTUP_ENABLED` | Menyalakan adapter real | Tidak |
| `WA_DEMO_MODE` | Dataset aman tanpa send real | Tidak |
| `MCP_PORT`, `MCP_HOST` | Listener MCP, default `4200` | Tidak |
| `MCP_BEARER_TOKEN` | Inspector/smoke test internal | Ya |
| `MCP_PUBLIC_URL` | URL canonical MCP publik | Tidak |
| `MCP_OAUTH_SIGNING_SECRET` | Menandatangani access token | Ya |
| `MCP_OAUTH_STATE_PATH` | Persisted OAuth client state | Sensitif |
| `MCP_RATE_LIMIT_PER_MINUTE` | Batas request per IP | Tidak |
| `INBOUND_WEBHOOK_URL` | Endpoint n8n/service internal | Internal |
| `INBOUND_WEBHOOK_SECRET` | Auth webhook | Ya |
| `WA_ACK_ENABLED`, `WA_ACK_TEXT` | Acknowledgement prototype | Tidak |

Gunakan secret acak berbeda minimal 32 byte. `scripts/server.sh init` membuat
secret secara otomatis dan memberi permission `600` pada `.env`.

## 7. Setup lokal

### 7.1 Install

```bash
npm install
npm run check
npm test
```

### 7.2 Demo aman

```bash
cp .env.example .env
# Isi POSTGRES_PASSWORD, lalu set WA_STARTUP_ENABLED=false dan WA_DEMO_MODE=true.
docker compose up --build
```

Buka `http://127.0.0.1:4100`. Demo tidak mengirim WhatsApp real.

PostgreSQL tersedia hanya di loopback `127.0.0.1:5432`. Migration dijalankan
otomatis ketika app start. Untuk menjalankan Node tanpa Compose, isi
`DATABASE_URL`, misalnya `postgresql://agnee:password@127.0.0.1:5432/agnee`.

Jika memakai PostgreSQL Homebrew lokal:

```bash
createdb agnee
echo 'DATABASE_URL=postgresql://USER_MAC@127.0.0.1:5432/agnee' >> .env
node --env-file=.env src/server.js
```

### 7.3 WhatsApp real

```bash
cp .env.example .env
# Isi seluruh secret dan credential.
npm start
```

Setelah login ke UI:

1. Klik status koneksi atau **Hubungkan WhatsApp**.
2. Di ponsel buka WhatsApp → Linked Devices.
3. Scan QR yang tampil.
4. Tunggu status `Connected` atau phase backend `ready`.

Session disimpan di `WA_SESSION_PATH`. Jangan menjalankan dua Chromium headless
dengan profile yang sama secara bersamaan.

## 8. Backend dan UI

### Autentikasi

- Browser menggunakan signed HttpOnly cookie `agnee_session`.
- Integrasi internal menggunakan header `x-api-key`.
- Production menolak default credential yang tidak aman.

### Endpoint utama

```text
GET  /health
POST /v1/auth/login
POST /v1/auth/logout
GET  /v1/auth/session
GET  /v1/whatsapp/status
GET  /v1/whatsapp/qr
GET  /v1/events
GET  /v1/chats?limit=20&offset=0&q=&filter=all
GET  /v1/chats/:chatId/messages?limit=30
GET  /v1/chats/:chatId/pinned
GET  /v1/chats/:chatId/lead
POST /v1/chats/:chatId/assign
GET  /v1/chats/:chatId/avatar
GET  /v1/messages/:messageId/media
POST /v1/messages/send
```

Setiap send harus membawa `clientRequestId` stabil ketika request di-retry.
Backend menyimpan receipt untuk mencegah pesan ganda.

## 9. MCP

### Tools

| Tool | Mode | Fungsi |
| --- | --- | --- |
| `whatsapp_status` | Read | Melihat status adapter |
| `list_conversations` | Read | Daftar chat dan preview |
| `read_conversation` | Read | Membaca pesan terbaru |
| `send_whatsapp_message` | Write | Mengirim pesan teks |

Aturan client:

1. Baca percakapan sebelum membalas.
2. Pastikan penerima dan isi final benar.
3. Minta konfirmasi sebelum pesan promosi atau konsekuensial.
4. Gunakan `clientRequestId` yang sama saat mengulang send.

### Menjalankan MCP lokal

```bash
MCP_BEARER_TOKEN=dev-mcp-token npm run mcp:http
```

Endpoint: `http://127.0.0.1:4200/mcp`.

### Smoke test

```bash
MCP_BEARER_TOKEN=dev-mcp-token npm run test:mcp
```

Smoke test memeriksa OAuth challenge, metadata, tool discovery, status, daftar
chat, dan sampel pesan secara read-only. Test tidak memanggil send tool.

## 10. OAuth MCP

MCP customer data tidak dibuat anonymous. Implementasi saat ini menyediakan:

- OAuth protected-resource metadata;
- authorization-server discovery;
- Dynamic Client Registration;
- Authorization Code + PKCE `S256`;
- access token bertanda tangan;
- rotating refresh token;
- admin login dan consent screen;
- scope `whatsapp:read` dan `whatsapp:write`.

Endpoint discovery:

```text
GET  /.well-known/oauth-protected-resource
GET  /.well-known/oauth-authorization-server
POST /oauth/register
GET  /oauth/authorize
POST /oauth/authorize
POST /oauth/token
```

OAuth client registration persisten di volume `mcp-state`. Refresh grant masih
in-memory; restart MCP dapat meminta user login ulang.

## 11. Menghubungkan ChatGPT

1. ChatGPT Settings → Security and login → Developer mode.
2. Buka Plugins lalu tekan `+`.
3. Nama: `Agnee WhatsApp`.
4. Connection URL: `https://mcp.agnee.agnive.co/mcp`.
5. Selesaikan login admin Agnee pada halaman OAuth.
6. Periksa empat tools yang ditemukan.
7. Jalankan prompt read-only sebelum mencoba send.

Contoh prompt uji:

```text
Cek status WhatsApp Agnee. Jangan kirim pesan apa pun.
```

```text
Tampilkan tiga percakapan terbaru dan ringkas pesan terakhir. Read-only.
```

## 12. Docker Compose

```bash
chmod +x scripts/server.sh
./scripts/server.sh check
./scripts/server.sh init
./scripts/server.sh up
./scripts/server.sh status
```

Port binding:

- `127.0.0.1:4100` → app/API;
- `127.0.0.1:4200` → MCP.
- `127.0.0.1:5432` → PostgreSQL lokal.

Compose memiliki health check, restart policy, resource limit, non-root user,
persisted WhatsApp session, volume PostgreSQL, dan persisted OAuth client state.

## 13. Deployment Radmond

Deployment standar dari Mac:

```bash
./scripts/deploy-radmond.sh
```

Script tersebut:

1. rsync source ke `/opt/agnee` tanpa `.env`, data, atau session lokal;
2. membuat `.env` hanya jika belum ada;
3. build dan menjalankan Compose;
4. memasang exact Nginx virtual hosts;
5. melakukan bootstrap ACME;
6. menerbitkan TLS ketiga domain bila sertifikat belum ada;
7. memvalidasi dan reload Nginx.

Nilai default:

```text
SSH host: root@94.237.73.190
SSH key:  ~/.ssh/id_ed25519_agnive_vps_new
Remote:   /opt/agnee
```

Mengambil credential admin secara lokal:

```bash
ssh -i ~/.ssh/id_ed25519_agnive_vps_new root@94.237.73.190 \
  "grep '^ADMIN_' /opt/agnee/.env"
```

Jangan menempelkan output tersebut ke issue, commit, screenshot publik, atau
knowledge base.

## 14. Nginx dan TLS

File source:

- `deploy/nginx/agnee-bootstrap.conf` untuk ACME HTTP challenge;
- `deploy/nginx/agnee.conf` untuk HTTPS app dan MCP.

Routing:

```text
agnee.agnive.co      -> redirect sementara ke app
app.agnee.agnive.co  -> http://127.0.0.1:4100
mcp.agnee.agnive.co  -> http://127.0.0.1:4200
```

MCP proxy menonaktifkan buffering agar Streamable HTTP/SSE bekerja. Sertifikat
Certbot diperbarui melalui scheduled renewal server.

## 15. Verifikasi deployment

```bash
curl -fsSI https://app.agnee.agnive.co
curl -fsS https://mcp.agnee.agnive.co/health
curl -fsS https://mcp.agnee.agnive.co/.well-known/oauth-protected-resource
```

Remote MCP read-only smoke:

```bash
REMOTE_TOKEN="$(ssh -i ~/.ssh/id_ed25519_agnive_vps_new root@94.237.73.190 \
  "sed -n 's/^MCP_BEARER_TOKEN=//p' /opt/agnee/.env")"

MCP_URL=https://mcp.agnee.agnive.co/mcp \
MCP_BEARER_TOKEN="$REMOTE_TOKEN" \
npm run test:mcp
```

## 16. Operasi harian

```bash
# Status
ssh -i ~/.ssh/id_ed25519_agnive_vps_new root@94.237.73.190 \
  'cd /opt/agnee && ./scripts/server.sh status'

# Log
ssh -i ~/.ssh/id_ed25519_agnive_vps_new root@94.237.73.190 \
  'cd /opt/agnee && ./scripts/server.sh logs'

# Restart
ssh -i ~/.ssh/id_ed25519_agnive_vps_new root@94.237.73.190 \
  'cd /opt/agnee && ./scripts/server.sh restart'
```

Sebelum restart saat ada agent aktif, beri tahu pengguna internal karena inbox
dan session SSE akan terputus sebentar.

## 17. Backup dan recovery

Yang perlu dilindungi:

- `/opt/agnee/.env`;
- Docker volume WhatsApp session;
- Docker volume `mcp-state`;
- database ketika persistence funnel ditambahkan.

Backup harus terenkripsi dan aksesnya dibatasi. Jangan meng-copy WhatsApp
profile ke dua container aktif. Setelah restore, pastikan tidak ada Chromium
lama yang masih memakai profile yang sama.

## 18. Troubleshooting

### UI terbuka tetapi chat kosong

- cek `GET /v1/whatsapp/status`;
- pastikan phase `ready`, bukan `waiting_for_qr`;
- bila QR tersedia, lakukan pairing;
- cek log container `app`.

### QR tidak muncul

- tunggu beberapa detik untuk Chromium startup;
- cek `WA_STARTUP_ENABLED=true` dan `WA_DEMO_MODE=false`;
- cek endpoint `/v1/whatsapp/qr` setelah login;
- cek log browser process.

### Chromium profile locked

Versi sekarang membersihkan stale `SingletonLock`, `SingletonCookie`, dan
`SingletonSocket` sebelum session restore. Jangan menghapus seluruh session
volume karena itu memaksa pairing ulang.

### MCP 401

- ChatGPT: periksa OAuth discovery dan lakukan login ulang;
- Inspector: periksa `MCP_BEARER_TOKEN`;
- jangan memakai backend `API_KEY` sebagai bearer MCP.

### MCP hidup tetapi backend Unauthorized

- pastikan app dan MCP memakai `.env` yang sama;
- pastikan `MCP_API_BASE_URL=http://app:4100` di Compose;
- jalankan smoke test karena test akan gagal eksplisit pada API key mismatch.

### Pesan terlihat gagal tetapi sebenarnya terkirim

- jangan langsung retry dengan ID baru;
- gunakan `clientRequestId` yang sama;
- refresh chat dan lakukan reconciliation;
- cek acknowledgement WhatsApp.

## 19. Security checklist

- [ ] `.env` permission `600` dan tidak masuk Git.
- [ ] Port 4100/4200 hanya bind ke loopback.
- [ ] TLS valid untuk seluruh hostname.
- [ ] OAuth aktif untuk customer-specific MCP.
- [ ] Bearer smoke test tidak dibagikan ke ChatGPT.
- [ ] Send tool selalu memerlukan review penerima dan isi.
- [ ] Tidak ada bulk-send atau scraping tanpa consent.
- [ ] Session WhatsApp dan backup terenkripsi.
- [ ] Dependency audit diperiksa sebelum release.
- [ ] Migrasi ke API WhatsApp resmi sebelum SLA production.

## 20. Release checklist

```bash
npm run check
npm test
npm run test:mcp
```

Kemudian:

1. perbarui `CHANGELOG.md`;
2. deploy;
3. cek health app dan MCP;
4. cek OAuth metadata;
5. cek status WhatsApp;
6. lakukan read-only smoke test;
7. baru lakukan send test ke nomor uji dengan persetujuan eksplisit.
