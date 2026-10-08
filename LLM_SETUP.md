# Auto-Reply LLM Setup Guide

## Overview

Agnee now supports auto-reply dari LLM untuk FAQ, funneling, dan lead qualification.

**Status:** Ready for testing ✓

## Files Created

```
src/
  ├── knowledge-loader.js    — Baca FAQ & funneling dari /knowledge
  └── llm-service.js         — OpenRouter LLM integration

scripts/
  └── test-openrouter-models.js  — Test berbagai model untuk harga/kualitas

.env.example
  — Added LLM configuration
```

## Setup Steps

### 1. Get OpenRouter API Key

1. Go to https://openrouter.ai/settings/keys
2. Login dengan agnivedev@gmail.com
3. Generate atau copy existing API key
4. Paste ke `.env`:

```bash
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxxxxxxxxxxxxx
```

### 2. Test Models (Recommended)

Cek model mana yang cheap + ok quality:

```bash
OPENROUTER_API_KEY=sk-or-xxx npm run test-openrouter
```

Output akan show:
- Model mana yang available
- Sample reply
- Token usage (input/output)
- Recommendations

### 3. Configure Model

Edit `.env`:

```bash
# Recommended cheap models:
OPENROUTER_MODEL=grok-2-1212          # xAI Grok — paling murah
# OPENROUTER_MODEL=qwen-2.5-72b       # Alibaba Qwen — affordable, sangat capable
# OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct  # Budget Llama
```

### 4. Enable Auto-Reply

```bash
LLM_ENABLED=true
```

### 5. Test Locally

```bash
npm start
# Open http://127.0.0.1:4100
# Send WhatsApp message (or demo mode)
# Check auto-reply response
```

## Knowledge Base

Auto-reply menggunakan knowledge dari `/knowledge`:

- `faq/*.md` — FAQ entries dengan intent keywords
- `funnel/sales-funnel.md` — Staging rules, scoring, handoff triggers
- `policies/reply-policy.md` — Tone, truthfulness, privacy guidelines

Format file sudah defined di `knowledge/README.md`.

## How Auto-Reply Works

1. **User sends message to WhatsApp**
2. **Backend receives event**
3. **Knowledge loader finds relevant FAQ** (if any)
4. **LLM generates reply** with context:
   - Relevant FAQ answers
   - Funneling rules (stage, scoring)
   - Reply policy (tone, truthfulness)
   - Conversation history
5. **Reply is sent back** to customer

## Context Flow

```
User Message
    ↓
Knowledge Loader (find relevant FAQ)
    ↓
Lead Context (if available)
    ↓
LLM Service (generate reply using:
  - System prompt (reply policy + funneling)
  - Relevant FAQ
  - Conversation history
  - Lead fields
)
    ↓
Auto-Reply sent to customer
```

## Token-Efficient Approach

Tidak mengirim seluruh chat history ke LLM setiap kali. Hanya:

1. Pesan terbaru customer
2. Ringkas conversation state (stage, known fields)
3. Relevant FAQ (max 3)
4. Funneling rules untuk stage saat ini

Ini keep token usage rendah dan biaya murah.

## Recommended Models for Cost

| Model | Provider | Price/1M tokens | Quality | Notes |
|-------|----------|-----------------|---------|-------|
| grok-2-1212 | xAI | ~$1 | Good | Termurah, decent quality |
| grok-3 | xAI | ~$3 | Excellent | Lebih expensive tapi lebih baik |
| qwen-2.5-72b | Alibaba | ~$2 | Excellent | Affordable, very capable |
| llama-3.1-8b | Meta | ~$0.05 | Good | Budget-friendly |
| claude-3.5-haiku | Anthropic | ~$0.8 | Excellent | Mahal tapi reference |

**Rekomendasi untuk Agnee:**
- **Development:** grok-2-1212 (termurah, test banyak)
- **Production:** grok-3 atau qwen-2.5-72b (balance harga-kualitas)

## Testing Script

```bash
# Test multiple models
OPENROUTER_API_KEY=sk-or-xxx npm run test-openrouter

# Or manually test satu model
node -e "
const LLM = require('./src/llm-service');
const llm = new LLM({ apiKey: process.env.OPENROUTER_API_KEY, model: 'grok-2-1212' });
llm.generateReply('Apa itu Agnee?', {
  systemPrompt: 'Jawab singkat.'
}).then(r => console.log(r.text));
"
```

## Debugging

**LLM tidak generate reply:**

1. Check `.env` punya `OPENROUTER_API_KEY`
2. Check `LLM_ENABLED=true`
3. Check knowledge base loaded: `ls knowledge/faq/*.md`
4. Check logs di browser console atau server stdout

**Reply terlalu panjang:**

Edit `.env`:
```bash
LLM_MAX_TOKENS=256  # Reduce dari 512
```

**Harga terlalu mahal:**

Ganti model ke xAI Grok atau Llama yg lebih murah.

## Next Phase

Fase berikutnya yang planned:

- [ ] Human approval sebelum auto-reply
- [ ] Lead state persistence (database)
- [ ] Conversation context history storage
- [ ] Analytics & quality metrics
- [ ] A/B testing berbagai model
- [ ] Fine-tuning FAQ berdasarkan customer feedback

## Nama model tidak tampil ke pelanggan

Pelanggan tidak boleh melihat nama model, vendor, atau harganya. Settings AI
menampilkan tingkatan (Low-end A/B/C, Medium-end A/B/C/D, High-end, Top-end AI
model). Klien dan API bertukar kunci tingkatan (`low-a` sampai `top`, ditambah
`custom` untuk id lama di luar daftar); pemetaan ke id OpenRouter ada di
`src/model-tiers.js`, dan urutan serta kuncinya harus sama dengan
`web/src/features/settings/models.ts`. Menambah model baru berarti menambah satu
baris di kedua file, satu label tingkatan, dan memverifikasi id-nya hidup di
OpenRouter. Field `model` di respons non-superhuman otomatis diganti label
tingkatan oleh hook `onSend`; konsol `/superhuman` menampilkan id asli. Tabel
harga di atas hanya untuk operator, jangan disalin ke UI.

## Balasan terputus dan jendela riwayat

- OpenRouter bisa mengembalikan isi setengah jadi dengan `finish_reason`
  `error` (penyedia model terputus) atau `length` (batas `LLM_MAX_TOKENS`
  habis). `src/llm-service.js` tidak lagi menganggapnya balasan sah: `error`
  diulang sekali pada model yang sama, lalu model berikutnya di chain; `length`
  langsung pindah model. Kalau semua gagal, tidak ada balasan otomatis dan
  percakapan jatuh ke manusia. Diukur 8 Oktober 2026 dengan
  `google/gemini-2.5-flash`: 2 sampai 3 dari sekitar 35 panggilan per putaran
  simulasi terputus.
- Model hanya menerima 5 pesan riwayat terakhir. Pemanggil yang butuh lebih
  panjang (template KS berjenjang memakai 12) mengisi `historyLimit`
  (maksimal 30).

