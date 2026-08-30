---
title: FAQ — Integrasi dan AI
category: integrations
language: id-ID
status: mixed
tags: [whatsapp, mcp, openrouter, llm, n8n, api]
---

# FAQ — Integrasi dan AI

## FAQ-INTEGRATION-001 — Apakah terhubung ke WhatsApp real?

- **Status:** confirmed
- **Intent:** WhatsApp real, QR, linked devices
- **Jawaban:** Ya, MVP terhubung headless melalui `whatsapp-web.js` dan pairing
  Linked Devices. Adapter ini unofficial.
- **Contoh balasan:** “Bisa terhubung ke akun WhatsApp real lewat QR Linked
  Devices. Karena jalurnya unofficial, kami sarankan nomor uji untuk MVP dan API
  resmi saat masuk operasi ber-SLA.”
- **Next action:** Konfirmasi apakah ini pilot atau nomor bisnis utama.

## FAQ-INTEGRATION-002 — Apakah MCP memanggil OpenRouter?

- **Status:** confirmed
- **Intent:** MCP pakai LLM, MCP OpenRouter, model di MCP
- **Jawaban:** Tidak secara otomatis. MCP mengekspos tools. ChatGPT memakai LLM
  miliknya sendiri; app perlu backend AI terpisah untuk memanggil OpenRouter atau
  on-prem LLM.
- **Contoh balasan:** “MCP itu jalur tools, bukan model. Kalau dipakai dari
  ChatGPT, modelnya berada di ChatGPT. Kalau auto-reply dari app, backend baru
  memanggil OpenRouter atau model on-prem.”
- **Next action:** Tanyakan channel AI yang ingin digunakan.

## FAQ-INTEGRATION-003 — Bisakah memakai LLM open source on-premise?

- **Status:** confirmed
- **Intent:** local LLM, open source model, on premise
- **Jawaban:** Secara arsitektur bisa. Backend dapat diarahkan ke model on-prem
  tanpa mengubah UI atau MCP, tetapi server 4 GB saat ini tidak ideal untuk model
  besar.
- **Contoh balasan:** “Bisa, tetapi model perlu server inference yang memadai.
  Untuk MVP murah biasanya OpenRouter lebih ringan; on-prem masuk akal setelah
  volume dan kebutuhan privasi jelas.”
- **Next action:** Tanyakan volume, latency, privasi, dan budget GPU.

## FAQ-INTEGRATION-004 — Bisakah terhubung ke CRM atau aplikasi lain?

- **Status:** provisional
- **Intent:** CRM, ERP, Google Sheets, integration
- **Jawaban:** Backend menyediakan API dan optional inbound webhook. Integrasi
  spesifik belum boleh dijanjikan sebelum API target diperiksa.
- **Contoh balasan:** “Jalur integrasinya tersedia lewat API, webhook, atau n8n.
  Untuk memastikan scope, kami perlu tahu CRM dan aksi apa yang ingin
  disinkronkan.”
- **Next action:** Minta nama sistem, arah data, event, dan requirement auth.

## FAQ-INTEGRATION-005 — Bisa digunakan dari ChatGPT?

- **Status:** confirmed
- **Intent:** ChatGPT connector, MCP ChatGPT
- **Jawaban:** Ya, endpoint MCP publik menggunakan Streamable HTTP dan OAuth
  2.1 + PKCE. Ketersediaan Developer mode bergantung pada akun/workspace ChatGPT.
- **Contoh balasan:** “Bisa. Admin menghubungkan endpoint MCP Agnee dari
  Developer mode ChatGPT, lalu login melalui OAuth Agnee.”
- **Next action:** Pastikan workspace mengizinkan Developer mode/plugins.

