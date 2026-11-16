# Uji model murah — status

**Diperbarui 16 Nov: uji kecil (≤US$1) SUDAH dijalankan; hasil di `HASIL.md`.** Isi di bawah adalah riwayat sebelum saldo diisi.

Awalnya: pengukuran ditunda karena saldo OpenRouter di bawah ambang aman.

## Saldo (dibaca dari `GET /api/v1/credits` dengan kunci produksi, dua kali, 16 Nov)
- `total_credits` 280,00; `total_usage` 279,76 → **sisa ≈ US$0,23–0,24** (ambang aman tugas ini: US$5).
- Pemakaian produksi ±US$0,21/hari (`usage_daily` kunci) → saldo habis kira-kira dalam 1 hari, lalu AI semua tenant diam lagi (lihat insiden 10–11 Nov). Ini lebih mendesak daripada uji ini. Isi saldo hanya oleh Hanny.

## Siap dipakai
- `kasus.json` — 32 kasus (144 giliran), 10 tahan-uji, dari chat nyata ESBEJE, sudah dianonimkan.
- `rubrik.md` — rubrik, penilai, aturan variasi/pemenang (ditulis sebelum ada hasil).
- `scripts/uji-model-murah/run.js` — pelaksana (jalan di container app). Kabel sudah diuji TANPA biaya (`BLOCK_LLM=1`, 2 kasus): login supervisor via pembungkus, rantai model dipaksa, semua penulisan DB dibuang. Yang ditangkap: `setPresence` dan 9 `UPDATE companies SET plan_status='suspended'` (penyapu kedaluwarsa trial yang berjalan saat app start; tanpa pembungkus ini uji menulis ke produksi).

Belum ditulis (bergantung pada bentuk keluaran sungguhan): pemeriksa otomatis, juri, pembuat laporan. Tarik katalog ESBEJE baca-saja untuk pemeriksa harga.

## Temuan awal tanpa biaya
1. `max_tokens=512` MASIH berlaku di main: `src/llm-service.js:68` (`config.maxTokens || 512`), `src/server.js:181` (`LLM_MAX_TOKENS` bawaan 512). Hanya jalur eskalasi (`server.js:2795`) memakai 2000. Uji memakai `LLM_MAX_TOKENS=2000` lewat env, tanpa mengubah kode.
2. Rantai model ESBEJE di DB kosong (`getAiSettings(...).modelChain = []`); bawaan = `OPENROUTER_MODEL` env produksi = `google/gemini-2.5-flash`. Pemakaian 12 hari terakhir ESBEJE: Gemini 2.5 Flash 168 balasan @ US$0,0038; Haiku 5.5 99 balasan @ US$0,0038 (rata-rata 602 token keluar); Sonnet 5.5 (simulate) US$0,070/balasan = ±18×.
3. Semua purpose (`price_match`, `product_detect`, `group_match`, `knowledge_check`, `judge`, dll.) memakai `companyAi.modelChain` yang sama dengan `auto_reply`. Eskalasi (`AI_ESCALATION_CHAIN`) dan fallback tanpa-alat (`OPENROUTER_TOOL_FALLBACK_MODELS`, bawaan gpt-4o-mini/deepseek) memakai model lain; uji mematikan/mengunci keduanya.
4. Penjaga non-customer (`isAutomatedSender`) ada di `generateAutoReply` (jalur WhatsApp), bukan di `/v1/coach/simulate`; kasus tagihan (K17, K18) harus dinilai terpisah.
5. `/v1/coach/simulate` memang menulis: `recordSimulationRun`, `recordAiUsage`, `chargeCredit`. Tanpa `chatId` tidak ada chat yang tertulis, tetapi tiga penulisan itu tetap terjadi, sehingga pembungkus read-only wajib.

## Estimasi biaya (dari `ai_usage_logs` ESBEJE, bukan tebakan)
- Pembangkitan: 864 giliran (3 model × 2 run × 144) × ±US$0,004 + price_match/penjaga ≈ **US$3,5–4**.
- Juri Sonnet 5.5, 64 panggilan (32 kasus × 2 run, 3 model berdampingan) ≈ **US$3–4**.
- Total ≈ **US$7–8** (lebih dari perkiraan awal ~US$3, karena juri). Tanpa juri Sonnet (juri Haiku) ≈ US$4,5, tapi juri harus lebih kuat dari yang diuji, jadi tidak disarankan.
- Sonnet 5.5 sebagai peserta: 288 giliran × US$0,07 ≈ **US$20** → melewati batas US$5; tidak dijalankan.
- Saldo yang dibutuhkan: ≥ US$5 (lantai) + ±US$8 = **isi minimal US$15**, lebih nyaman US$20.

## Melanjutkan
Setelah saldo diisi: sync `kasus.json` + `run.js` ke `/root/uji` di server, jalankan dengan `MODELS`, `RUNS=2`, `LLM_MAX_TOKENS=2000`, `AI_ESCALATION_CHAIN=`, `OPENROUTER_TOOL_FALLBACK_MODELS=<model>` per model (satu proses per model), `MAX_BUDGET_USD` sebagai rem biaya. Lalu tulis pemeriksa + juri + `HASIL.md`.
