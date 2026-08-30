---
title: FAQ — Fitur Agnee
category: features
language: id-ID
status: mixed
tags: [inbox, faq, ai, mcp, funnel, handoff]
---

# FAQ — Fitur Agnee

## FAQ-FEATURE-001 — Fitur apa yang sudah tersedia?

- **Status:** confirmed
- **Intent:** fitur sekarang, sudah bisa apa, MVP
- **Jawaban:** Login, pairing QR, inbox real, pencarian, lazy-loaded history,
  text/media/call log, quoted reply, pinned chat/message, delivery status, SSE
  realtime, lead context MVP, dan empat MCP tools WhatsApp.
- **Contoh balasan:** “Versi MVP sudah bisa dipakai untuk menghubungkan WhatsApp,
  membaca chat real, membalas, melihat media dan status pesan, serta mengakses
  fungsi utamanya dari MCP.”
- **Next action:** Cocokkan fitur dengan use case customer.

## FAQ-FEATURE-002 — Apakah sudah bisa menjawab FAQ otomatis?

- **Status:** provisional
- **Intent:** auto reply, FAQ otomatis, chatbot AI
- **Jawaban:** Knowledge FAQ dan rancangan flow sudah tersedia, tetapi loop LLM
  production, retrieval, approval, dan persistence belum menjadi fitur final.
- **Contoh balasan:** “Knowledge dan alur FAQ-nya sudah disiapkan. Untuk auto-reply
  production, kami masih perlu menghubungkan retrieval dan model sesuai tingkat
  approval yang Anda inginkan.”
- **Next action:** Tanyakan apakah customer ingin suggestion-only, approval, atau
  auto-reply untuk kategori tertentu.

## FAQ-FEATURE-003 — Apakah bisa kualifikasi lead?

- **Status:** provisional
- **Intent:** qualification, lead scoring, funnel
- **Jawaban:** Funnel, pertanyaan discovery, scoring, dan handoff sudah
  didefinisikan sebagai knowledge. Persistence database dan automation engine
  masih tahap berikutnya.
- **Contoh balasan:** “Flow kualifikasinya sudah ada dan bisa dipakai sebagai
  panduan chatbot. Untuk dashboard funnel permanen, tahap berikutnya adalah
  menyimpan stage dan assignment ke database.”
- **Next action:** Tanyakan definisi qualified lead milik customer.

## FAQ-FEATURE-004 — Apakah agent bisa mengambil alih chat?

- **Status:** confirmed
- **Intent:** human handoff, ambil alih, assign sales
- **Jawaban:** UI memiliki lead context dan handoff/assignment MVP. Persistence
  multi-user dan role-based assignment belum final.
- **Contoh balasan:** “Bisa diarahkan ke manusia dari customer desk. Untuk tim
  besar, assignment permanen, role, dan audit trail perlu dikonfigurasi pada fase
  production.”
- **Next action:** Tanyakan jumlah agent dan pola pembagian lead.

## FAQ-FEATURE-005 — Apakah n8n wajib?

- **Status:** confirmed
- **Intent:** perlu n8n, workflow n8n, tanpa n8n
- **Jawaban:** Tidak. App, backend, WhatsApp, dan MCP dapat bekerja tanpa n8n.
  n8n berguna untuk workflow eksternal seperti CRM, email, spreadsheet, atau
  notifikasi.
- **Contoh balasan:** “n8n sifatnya opsional. Kita tambahkan kalau ada workflow
  lintas aplikasi; inbox dan MCP-nya sendiri tidak bergantung pada n8n.”
- **Next action:** Tanyakan aplikasi eksternal yang perlu disambungkan.

