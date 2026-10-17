---
title: FAQ — Keamanan dan Batasan
category: security
language: id-ID
status: confirmed
tags: [security, privacy, oauth, whatsapp, limitations]
---

# FAQ — Keamanan dan Batasan

## FAQ-SECURITY-001 — Bagaimana akses aplikasi diamankan?

- **Status:** confirmed
- **Intent:** keamanan login, auth app
- **Jawaban:** Login memakai sesi yang ditandatangani dan lalu lintas lewat
  HTTPS. Data tiap perusahaan dipisah di level database, dan permintaan lintas
  perusahaan yang sengaja dibuat untuk menembus sudah diuji dan ditolak. Jangan
  menyebut detail infrastruktur.
- **Contoh balasan:** “Data tiap perusahaan dipisah di level database. Kami sudah
  menguji dengan permintaan lintas perusahaan yang sengaja dibuat untuk menembus,
  dan ditolak.”
- **Next action:** Tanyakan kekhawatiran spesifiknya; serahkan ke tim untuk
  kebutuhan audit atau SSO.

## FAQ-SECURITY-002 — Bagaimana MCP diamankan?

- **Status:** confirmed
- **Intent:** MCP auth, OAuth, token
- **Jawaban:** MCP memakai login OAuth dan token berlingkup, bukan kunci tempel.
- **Contoh balasan:** “Sambungan MCP memakai login OAuth Agnee, bukan kunci yang
  ditempel, dan tokennya divalidasi di setiap permintaan.”
- **Next action:** Untuk kebutuhan keamanan khusus, serahkan ke tim.

## FAQ-SECURITY-003 — Apakah data dipakai melatih model?

- **Status:** unknown
- **Intent:** training data, data AI, privasi model
- **Jawaban:** Jangan menjamin dan jangan menyebut nama penyedia. Serahkan ke
  tim untuk jawaban tertulis.
- **Contoh balasan:** “Soal kebijakan data model, saya tidak mau menjawab asal.
  Saya teruskan ke tim supaya kakak mendapat jawaban yang akurat ya.”
- **Next action:** Serahkan ke tim.

## FAQ-SECURITY-004 — Apa batasan koneksi WhatsApp dan broadcast?

- **Status:** confirmed
- **Intent:** aman tidak, ban, blokir, SLA, broadcast aman
- **Jawaban:** Agnee memakai WhatsApp Web lewat scan QR. Perubahan WhatsApp bisa
  memutus sambungan atau membatasi nomor, dan nomor harus tetap terhubung.
  Broadcast tidak bisa dijanjikan aman dari blokir: risiko selalu ada dan
  WhatsApp yang menentukan. Agnee memasang rem: bawaannya hanya ke customer yang
  pernah membalas, jeda acak, jam kirim, batas harian, dan STOP dihormati. Jangan
  memakai kata "aman", "dijamin", atau "pasti".
- **Contoh balasan:** “Risikonya selalu ada dan WhatsApp yang menentukan. Agnee
  memasang rem: hanya ke customer yang pernah membalas, jeda acak, jam kirim,
  batas harian, dan STOP dihormati.”
- **Next action:** Tanyakan siapa target broadcast-nya.

## FAQ-SECURITY-005 — Apakah mendukung banyak perusahaan, tim, dan peran?

- **Status:** confirmed
- **Intent:** multi tenant, enterprise, RBAC, audit
- **Jawaban:** Data tiap perusahaan terpisah. Tim punya peran supervisor dan
  agent, dan tindakan penting tercatat di jejak audit. Kebutuhan Enterprise
  seperti multi-cabang, white label, atau integrasi kustom dibahas tim.
- **Contoh balasan:** “Tim bisa punya supervisor dan agent, dan tindakan penting
  tercatat. Untuk multi-cabang atau kebutuhan khusus, saya teruskan ke tim
  Agnee.”
- **Next action:** Serahkan ke tim untuk Enterprise.
