---
title: Agnee Knowledge Base
version: 1.0.0
language: id-ID
audience: [customer, customer-service, sales, chatbot]
status: draft
---

# Agnee Knowledge Base

Folder ini menjadi sumber pengetahuan chatbot, copilot agent, dan tim sales.
Konten sengaja dipisahkan dari kode agar dapat diindeks, direview, dan diganti
tanpa mengubah MCP.

## Kategori

| Kategori | File | Isi |
| --- | --- | --- |
| Produk | [`faq/product.md`](faq/product.md) | Definisi, kegunaan, dan positioning |
| Fitur | [`faq/features.md`](faq/features.md) | Inbox, FAQ, AI, MCP, dan n8n |
| Integrasi | [`faq/integrations.md`](faq/integrations.md) | WhatsApp, OpenRouter, on-prem, API |
| Harga & onboarding | [`faq/pricing-onboarding.md`](faq/pricing-onboarding.md) | Paket, demo, implementasi |
| Keamanan & batasan | [`faq/security-limitations.md`](faq/security-limitations.md) | Data, unofficial adapter, SLA |
| Sales funnel | [`funnel/sales-funnel.md`](funnel/sales-funnel.md) | Stage, pertanyaan, scoring, handoff |
| Kebijakan jawaban | [`policies/reply-policy.md`](policies/reply-policy.md) | Tone, guardrails, eskalasi |

## Status fakta

- `confirmed`: sudah benar dan dapat dijawab langsung.
- `provisional`: arah produk sudah ada tetapi detail perlu dikonfirmasi manusia.
- `unknown`: jangan ditebak; tanyakan kebutuhan lalu handoff.
- `internal-only`: tidak boleh diungkap sebagai informasi publik.

## Aturan retrieval

1. Ambil hanya bagian yang relevan dengan pertanyaan terbaru.
2. Prioritaskan `confirmed` dibanding `provisional`.
3. Jangan mengarang harga, SLA, timeline, sertifikasi, atau integrasi.
4. Gunakan satu pertanyaan klarifikasi per balasan.
5. Simpan ringkasan lead terstruktur agar histori penuh tidak dikirim ke LLM.
6. Ketika informasi belum pasti, katakan dengan jujur dan tawarkan handoff.

## Format entri FAQ

Setiap entri menggunakan:

- `ID`: identifier stabil untuk analytics;
- `Status`: tingkat kepastian;
- `Intent`: frasa yang dapat memicu retrieval;
- `Jawaban`: fakta inti;
- `Contoh balasan`: versi conversational;
- `Next action`: pertanyaan atau handoff berikutnya.
