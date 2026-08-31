---
title: FAQ — Keamanan dan Batasan
category: security
language: id-ID
status: confirmed
tags: [security, privacy, oauth, whatsapp, limitations]
---

# FAQ — Keamanan dan Batasan

## FAQ-SECURITY-001 — Bagaimana akses app diamankan?

- **Status:** confirmed
- **Intent:** keamanan login, auth app
- **Jawaban:** UI memakai signed HttpOnly session cookie. Integrasi internal
  memakai API key. Port backend hanya loopback di server dan publik melewati TLS
  Nginx.
- **Contoh balasan:** “Akses UI memakai session login, sedangkan service internal
  memakai key terpisah. Backend tidak dibuka langsung ke internet dan trafik
  publik melewati HTTPS.”
- **Next action:** Untuk enterprise, eskalasi pembahasan RBAC, SSO, dan audit.

## FAQ-SECURITY-002 — Bagaimana MCP diamankan?

- **Status:** confirmed
- **Intent:** MCP auth, OAuth, token
- **Jawaban:** MCP customer data memakai OAuth 2.1 Authorization Code + PKCE,
  token scope, TLS, request limit, dan rate limiting. Bearer statis hanya untuk
  Inspector/smoke test internal.
- **Contoh balasan:** “Koneksi ChatGPT tidak memakai API key tempel. Pengguna
  login melalui OAuth Agnee, lalu MCP memvalidasi token pada setiap request.”
- **Next action:** Untuk multi-tenant, eskalasi ke technical review.

## FAQ-SECURITY-003 — Apakah data dipakai melatih model?

- **Status:** unknown
- **Intent:** training data, data AI, privasi model
- **Jawaban:** Jawaban bergantung pada provider LLM dan kontrak yang dipilih.
  Jangan menjamin sebelum provider dan konfigurasi final ditetapkan.
- **Contoh balasan:** “Itu bergantung pada model/provider yang dipakai. Kami bisa
  desain opsi OpenRouter atau on-prem, lalu dokumentasikan kebijakan data yang
  berlaku sebelum production.”
- **Next action:** Tanyakan requirement data residency dan provider policy.

## FAQ-SECURITY-004 — Apa batasan WhatsApp unofficial?

- **Status:** confirmed
- **Intent:** aman tidak, ban, unofficial, SLA
- **Jawaban:** Perubahan WhatsApp Web dapat memutus kompatibilitas, logout
  session, atau memicu restriction. Tidak cocok untuk bulk-send dan belum layak
  dijanjikan sebagai SLA production.
- **Contoh balasan:** “Untuk pilot, adapter ini cepat dan murah. Untuk nomor utama
  dan SLA, kami menyarankan migrasi ke WhatsApp Business Platform resmi.”
- **Next action:** Bedakan pilot dengan deployment production.

## FAQ-SECURITY-005 — Apakah sudah multi-tenant dan enterprise-ready?

- **Status:** confirmed
- **Intent:** multi tenant, enterprise, RBAC, audit
- **Jawaban:** Belum. Versi saat ini single-workspace. Database tenant, RBAC,
  audit trail, persistence funnel, dan official WhatsApp adapter ada di roadmap.
- **Contoh balasan:** “MVP saat ini ditujukan untuk satu workspace. Jika kebutuhan
  Anda multi-cabang atau banyak role, kami perlu scope fase production untuk
  tenant isolation, RBAC, dan audit trail.”
- **Next action:** Handoff ke technical sales.

