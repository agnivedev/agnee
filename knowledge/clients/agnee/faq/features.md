---
title: FAQ — Fitur Agnee
category: features
language: id-ID
status: confirmed
tags: [inbox, ai, handoff, followup, broadcast, laporan, mcp]
---

# FAQ — Fitur Agnee

## FAQ-FEATURE-001 — Fitur apa yang sudah tersedia?

- **Status:** confirmed
- **Intent:** fitur sekarang, sudah bisa apa
- **Jawaban:** Sudah ada: hubungan WhatsApp lewat scan QR, balasan AI dari
  playbook perusahaan, serah-terima ke CS dan ambil alih kapan saja, follow-up
  lead yang diam dengan pengaman jam dan jumlah, broadcast dengan rem
  (hanya ke customer yang pernah membalas, jeda acak, jam kirim, batas harian,
  STOP dihormati), pipeline kanban, tugas dengan SLA, komentar samping chat dan
  mention rekan, laporan berkala ke supervisor, integrasi lead Mayar, serta API
  dan MCP. Bertanda segera (belum bisa dipakai): mode agent (sales, CS, operasi
  antar-departemen), impor Excel atau CSV, laporan performa per human agent,
  alat MCP untuk laporan, alasan serah-terima terstruktur dengan ringkasan
  otomatis, mention satu departemen sekaligus, dan chat internal antar pengguna.
  Fitur segera tidak boleh ditawarkan sebagai sudah ada dan tanpa tanggal.
- **Contoh balasan:** “Yang sudah jalan: AI menjawab dari playbook bisnis kakak,
  serah-terima ke CS, menyusul lead yang diam, broadcast, dan laporan ke
  supervisor. Bagian mana yang paling kakak butuhkan?”
- **Next action:** Cocokkan satu fitur dengan masalah customer.

## FAQ-FEATURE-002 — Apakah sudah bisa menjawab FAQ otomatis?

- **Status:** confirmed
- **Intent:** auto reply, FAQ otomatis, chatbot AI
- **Jawaban:** Ya. AI menjawab dari playbook yang dilatih lewat ngobrol atau
  unggah dokumen, tanpa menulis prompt. Balasan bisa diuji dulu sebelum live,
  tiap balasan tercatat penulisnya, dan CS bisa mengambil alih kapan saja. Jangan
  menjanjikan AI tidak pernah salah.
- **Contoh balasan:** “Bisa. AI menjawab dari playbook bisnis kakak dan bisa
  diuji dulu sebelum live. Kalau CS mulai mengetik, AI minggir. Pertanyaan apa
  yang paling sering masuk di chat kakak?”
- **Next action:** Tanyakan pertanyaan yang paling sering masuk.

## FAQ-FEATURE-003 — Apakah bisa kualifikasi lead?

- **Status:** confirmed
- **Intent:** qualification, lead scoring, funnel
- **Jawaban:** AI menggali kebutuhan bertahap, satu pertanyaan per giliran, dan
  tahap lead terlihat di pipeline kanban. Definisi lead siap beli mengikuti
  playbook perusahaan.
- **Contoh balasan:** “Bisa. AI menggali kebutuhan bertahap dan tahap leadnya
  terlihat di pipeline. Menurut kakak, lead seperti apa yang sudah siap
  diteruskan ke sales?”
- **Next action:** Tanyakan definisi lead yang siap diteruskan.

## FAQ-FEATURE-004 — Apakah agent bisa mengambil alih chat?

- **Status:** confirmed
- **Intent:** human handoff, ambil alih, assign sales
- **Jawaban:** Bisa kapan saja. Saat AI menyerahkan chat, riwayat dan catatan
  alasannya tersimpan sehingga CS tidak mulai dari nol. Kalau CS diam 30 menit,
  chat kembali ke AI. Alasan serah-terima dengan pilihan tetap dan ringkasan
  otomatis masih segera.
- **Contoh balasan:** “Bisa kapan saja. Riwayat dan catatan alasannya ikut, jadi
  CS tidak mulai dari nol dan customer tidak mengulang cerita.”
- **Next action:** Tanyakan berapa orang CS yang memegang chat.

## FAQ-FEATURE-005 — Apakah n8n wajib?

- **Status:** confirmed
- **Intent:** perlu n8n, workflow n8n, tanpa n8n
- **Jawaban:** Tidak. Agnee bekerja tanpa n8n. Untuk menyambung ke aplikasi lain
  tersedia API dan integrasi lead Mayar; integrasi khusus dibahas dengan tim.
- **Contoh balasan:** “Tidak wajib. Kalau ada aplikasi yang perlu disambungkan,
  kita lihat caranya bersama tim. Aplikasi apa yang kakak maksud?”
- **Next action:** Tanyakan aplikasi yang perlu disambungkan.
