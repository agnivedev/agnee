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

## 7. September sampai Oktober 2026

Ringkasan jalur besar. Rinciannya ada di [`../CHANGELOG.md`](../CHANGELOG.md).

- 14 September: frontend dipindah ke React/Vite (`web/`), migrasi database
  sampai 022. Insiden follow-up spam melahirkan tiga pengaman tindak lanjut.
- 16 sampai 17 September: insiden riwayat percakapan kosong (AI mengulang
  pertanyaan yang sama) dan nyaris mundurnya playbook produksi oleh seed;
  keduanya ditutup dengan penjaga di kode.
- 21 September: audit keamanan 12 temuan (enam Wajib dan Penting selesai),
  halaman `/privasi` dan `/ketentuan`, SLA tugas, dan insiden produksi berjalan
  16 jam tanpa database (kini produksi menolak start tanpa database).
- 22 September: jejak audit untuk tindakan yang akibatnya keluar dari Agnee, dan
  perbaikan Rotasi nomor.
- 3 Oktober: audit tuntas dan live (akun takeover ditutup, konsol Admin
  dibubarkan, Coach menjadi satu-satunya simulator).
- 7 Oktober: playbook per produk dan setelan identitas AI per company (Beweix
  memakai dua produk), Broadcast, jeda balasan dengan indikator mengetik,
  company AL Gold FX, insiden Postgres produksi hilang sekitar 4,5 jam (lihat
  [`SETUP.md`](SETUP.md), Troubleshooting), dan disk VPS penuh dua kali.
- 8 Oktober: foto customer masuk riwayat AI, balasan model yang terputus tidak
  lagi terkirim, dan Knowledge Source: paket template percakapan dengan
  simulasi sebagai gerbang aktivasi ([`knowledge-source.md`](knowledge-source.md)).
  Keputusan: tingkat penawaran ditentukan AI (bukan mesin status di kode),
  katalog paket kelak di Expertz dengan backend Node.
- 8 Oktober (sore): nama model, vendor, dan harga AI disembunyikan dari
  pelanggan. Settings AI memakai tingkatan (Low/Medium/High/Top-end), API
  bertukar kunci tingkatan alih-alih id OpenRouter, field `model` disaring di
  semua respons non-superhuman, pesan error tidak lagi menyebut
  `OPENROUTER_API_KEY`, dan halaman Privasi tidak menyebut OpenRouter/UpCloud.
  Commit `4991eaf`, live; dua deploy berikutnya gagal disk penuh dan satu gagal
  label jaringan `agnee_net3`, server tetap sehat dan kini di `13a92d6`.
- 8 Oktober (sore, lanjutan): copy landing page memakai suara halaman masuk app
  ("Kamu offline. AI tetap online.", `5f97f60`, tanpa klaim 24x7). Saat
  deploy-nya, build Agnee dan Insight bersamaan menghabiskan disk sampai 0 byte
  dan produksi down ~12 menit (Postgres mati, endpoint jaringan hantu).
  Dipulihkan dengan menuntaskan deploy Insight, membuang image/cache lama,
  menyalakan Postgres, dan memindah stack ke `agnee_net3`; data utuh.
  Pencegahan: concurrency group `deploy-production` (`13a92d6`) dan pagar
  build-lain/sisa-disk di `deploy/remote-deploy.sh`.
- 8 Oktober, broadcast: daftar penerima Beweix hanya 2 nama karena Agnee baru
  mencatat 3 lawan bicara (rancangan, bukan kerusakan); dua bug yang ikut
  menyempitkan (nomor `@lid` tampil sebagai digit samaran, saringan 30 hari
  membuang chat tanpa catatan masuk) diperbaiki. Lalu impor chat WhatsApp ke
  Lead List dengan kategori dan broadcast per kelompok, live malam harinya
  (migrasi `049`). Impor pertama di Beweix menunggu login supervisor.
- 8 Oktober, copy landing page: hero dan band fitur disamakan dengan layar masuk
  app ("Kamu offline. AI tetap online."), `Ga ada yang kelewat` diganti `Ga ada
  chat yang dibiarin nganggur`, commit `5f97f60`. Deploy run itu gagal dua kali
  (`npm ci` ECONNRESET, lalu `Disk quota exceeded`) dan akhirnya ikut ter-deploy
  lewat run `4991eaf`, dicek langsung di `agnee.agnive.co/landing`. Malamnya
  disk server diperiksa: 87% (sisa 2,7 GB), `docker builder prune -af` hanya
  melepas sekitar 0,5 GB, jadi ruang kosong cuma cukup untuk satu build.
- 8 Oktober, alert biaya AI: kanal WhatsApp ditambahkan di samping email
  (`ff10f54`), dikerjakan di sesi yang kehabisan kuota lalu diselesaikan di sesi
  lain bersama pagar disk deploy (`fecf0c5`). Dinyalakan di produksi dengan
  `beweix-digital` sebagai pengirim dan nomor Beweix sendiri sebagai penerima
  (nomor supervisor tidak ada di database); `.env` lama dicadangkan di
  `/opt/agnee/.env.bak-wa`. App di-restart dengan `up -d --no-deps app`
  (sehat dalam 26 detik). Belum ada alert sungguhan yang terkirim.

## Referensi

- [`../README.md`](../README.md) — cara mulai dan navigasi dokumentasi.
- [`../PROJECT.md`](../PROJECT.md) — arsitektur serta ruang lingkup produk.
- [`SETUP.md`](SETUP.md) — setup lokal, server, OAuth, MCP, dan troubleshooting.
- [`../knowledge/README.md`](../knowledge/README.md) — FAQ, funnel, dan reply policy.
- [`../CHANGELOG.md`](../CHANGELOG.md) — perubahan teknis per versi.
- [`knowledge-source.md`](knowledge-source.md) — Knowledge Source: paket template percakapan.
