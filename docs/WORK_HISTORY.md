# Agnee Work History

Dokumen ini merangkum pekerjaan dan keputusan penting selama pengembangan awal
Agnee. Detail perubahan teknis per versi tetap dicatat di [`../CHANGELOG.md`](../CHANGELOG.md).

## 1. Arah produk

- Agnee diposisikan sebagai chatbot customer service dan sales berbasis WhatsApp.
- Domain dibagi menjadi `agnee.agnive.co` untuk landing page,
  `app.agnee.agnive.co` untuk aplikasi, dan `mcp.agnee.agnive.co` untuk endpoint MCP.
- Arsitektur dibuat sederhana untuk dikelola satu developer: frontend, backend,
  adapter WhatsApp, dan MCP berada dalam satu deployment terlebih dahulu.
- LLM bukan bagian wajib dari MCP. Backend dapat memilih OpenRouter atau model
  on-premise ketika fitur auto-reply dan analisis lead diaktifkan.
- n8n bersifat opsional untuk workflow dan integrasi; alur inti tidak bergantung
  kepadanya.

## 2. Brand dan pengalaman pengguna

- Identitas Agnee dikembangkan dari logo Agnive dengan positioning chatbot dan
  attribution “by Beweix”.
- UI customer desk memakai visual business glassmorphic yang tetap mengutamakan
  keterbacaan, responsive layout, dan navigasi yang familiar.
- Pola penggunaan WhatsApp Desktop dijadikan referensi: daftar percakapan,
  composer tetap, panel konteks lead, reply, status pesan, media viewer, call log,
  pinned/replied message navigation, dan lazy loading.
- Enter mengirim pesan; Shift+Enter membuat baris baru.
- Panel kiri dan kanan tetap, sedangkan area pesan menjadi area scroll utama.

## 3. WhatsApp dan percakapan nyata

- Login WhatsApp memakai QR dari linked devices dan status koneksi realtime.
- Inbox membaca chat, pesan, foto profil, media, quoted message, call event, serta
  status pending, sent, delivered, read, dan failed bila tersedia dari adapter.
- Media viewer mencakup popup, download, zoom, pan, dan dukungan gesture.
- Data sesi WhatsApp disimpan sebagai runtime data dan tidak dimasukkan ke Git.

## 4. Backend, MCP, dan keamanan

- Backend menyediakan API aplikasi, SSE untuk pembaruan UI, dan adapter WhatsApp.
- MCP mengekspos tools terkontrol untuk membaca percakapan, mengirim pesan, dan
  operasi lain yang diizinkan backend.
- OAuth 2.1 Authorization Code + PKCE disiapkan untuk client eksternal seperti
  ChatGPT, dengan discovery metadata, dynamic client registration, access token,
  dan rotating refresh token.
- Reverse proxy menangani HTTPS, domain routing, dan penerusan request ke service
  internal tanpa mengekspos port aplikasi langsung.

## 5. FAQ, funnel, dan penggunaan token

- Knowledge dipisahkan ke Markdown per kategori agar mudah direview dan diindeks.
- Retrieval hanya mengambil bagian relevan, bukan mengirim seluruh histori chat.
- Ringkasan lead, stage funnel, tags, dan structured facts digunakan untuk
  mengurangi token serta menjaga konsistensi jawaban.
- Guardrail melarang bot mengarang harga, SLA, timeline, atau kemampuan produk.
- Handoff ke sales dilakukan ketika lead siap, meminta manusia, atau pertanyaan
  berada di luar knowledge yang terkonfirmasi.

## 6. Deployment dan konsolidasi repository

- Target server adalah Radmond/Agnive, menggantikan referensi Hostinger lama.
- Runbook lokal dan server tersedia di [`SETUP.md`](SETUP.md).
- Pada 30 Agustus 2026, pekerjaan dari `Code/geeneeus-beweix` dikonsolidasikan ke
  repository canonical `Code/agnive/agnee`.
- Git history dan kode terbaru di repository canonical dipertahankan. Dokumen,
  knowledge, dan histori kerja yang belum ada dimigrasikan tanpa menimpa `.env`
  atau sesi WhatsApp aktif.

## Referensi

- [`../README.md`](../README.md) — cara mulai dan navigasi dokumentasi.
- [`../PROJECT.md`](../PROJECT.md) — arsitektur serta ruang lingkup produk.
- [`SETUP.md`](SETUP.md) — setup lokal, server, OAuth, MCP, dan troubleshooting.
- [`../knowledge/README.md`](../knowledge/README.md) — FAQ, funnel, dan reply policy.
- [`../CHANGELOG.md`](../CHANGELOG.md) — perubahan teknis per versi.
