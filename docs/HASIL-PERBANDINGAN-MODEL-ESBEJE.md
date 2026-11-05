# Perbandingan model AI untuk ESBEJE (Agnes) — 4 Nov 2026

Simulasi lewat `/v1/coach/simulate` di container produksi (data dan model sungguhan, tanpa menulis chat, tanpa membangunkan departemen). Dua skenario: (1) satu produk MU 301 Plasterplus sampai transfer; (2) tiga produk (Semen Gresik 20 sak, MU 200 Skimwall 5 sak, Aquaproof Biru 1 pail), ambil sendiri, sampai bukti transfer.

Catatan: tiap model baru satu sampel per skenario. Biaya belum dihitung (simulator tidak mencetak `usage.cost`). Berkas mentah hasil simulasi sudah hilang (scratchpad sesi lama dibersihkan); ringkasan di bawah adalah catatan yang tersisa. Tidak ada perubahan model di produksi.

## Gemini dan Sonnet gagal karena batas token, bukan kualitas
`src/llm-service.js` memakai `max_tokens = 512` (`this.maxTokens`). Model yang berpikir dulu menghabiskan jatah itu, balasan terpotong (`finish_reason=length`) atau kosong, lalu HTTP 502 "AI tidak menghasilkan balasan".
- gemini-3.7-flash, gemini-2.5-pro: gagal di setiap giliran.
- claude-sonnet-5.5: 6 giliran jalan, 2 gagal.
- Perbaikan yang mungkin (belum dicoba): naikkan `llmMaxTokens` (~2000) atau minta reasoning rendah lewat OpenRouter.

## Hasil per model
| Model | Harga & total | Alur closing | Catatan |
|---|---|---|---|
| gemini-2.5-flash (produksi) | mengarang MU 200 Rp 105.000 (asli 134.000) | "Ongkir: Rp 0" untuk ambil sendiri | paling sering kena guard |
| gpt-5.4-mini | benar | paling lurus: total Rp 3.120.000, rekening, minta bukti | kadang mengulang pertanyaan |
| gpt-4.1 | benar | tak sampai menghitung total | banyak janji kosong |
| claude-haiku-4.5 | benar, rapi | rincian dan rekening lengkap | mengaku "barangnya sudah kami siapkan" (belum), "sampai jumpa besok" |
| claude-sonnet-5.5 | benar | rincian sangat rapi | 2 giliran gagal token; "harga bisa berubah sewaktu-waktu" tak perlu |

Aman di semua model: tak ada yang mengaku uang sudah masuk, tak ada yang mengarang diskon 30 sak, guard menangkap janji kosong.

## Rekomendasi (menunggu persetujuan Hanny)
1. gpt-5.4-mini sebagai model utama.
2. claude-haiku-4.5 sebagai cadangan di `ai_model_chain` (awasi klaim "barang sudah disiapkan").
3. Gemini dan Sonnet dicoba lagi setelah batas token dinaikkan.
"Mix" hanya bisa berupa rantai cadangan; model tidak berganti per giliran. (Cabang ini juga punya fitur eskalasi model per company, 463be8d: giliran bermasalah diulang dengan model lebih kuat; pertimbangkan bersama rantai ini.)

## Permintaan Hanny: AI bingung → "segera kami get back", tanya grup yang tepat
Sudah di-commit di cabang ini (cf3e429), rute di `src/uncertainty-guard.js` (`DEPARTMENT_PATTERNS`):
- transfer → Finance; stok → Gudang lalu Management; ongkir/waktu_kirim → Logistik/Pengiriman lalu Management; diskon → Management lalu Sales; lainnya → Management lalu Admin/Sales.
- Kalimat penutup `ask_department`/`notify_staff`/`handoff`: "Segera kami get back ke kakak ya, …".
- Belum di-push/deploy.

## Sisa pekerjaan (urut prioritas)
1. Jalankan suite tes penuh dengan DB seperti CI (`DATABASE_URL` + `CREDENTIALS_ENCRYPTION_KEY=ci-test-key-not-used-in-prod`) dan pastikan semua lulus, termasuk 1 tes di `test/uncertainty-guard.test.js` yang sempat gagal. Syarat sebelum push.
2. Minta persetujuan Hanny untuk push cabang `feat/closing-jujur` (push ke main = deploy; cek tak ada run CI jalan dan main tak bergeser).
3. Naikkan batas token (`llmMaxTokens`) dan uji ulang Gemini 3.7 Flash, Gemini 2.5 Pro, Sonnet 5.5; hitung biaya per model dari `usage.cost`.
4. Putuskan dengan Hanny model ESBEJE: gpt-5.4-mini utama + Haiku cadangan (atau tetap Gemini naik), lalu ubah `ai_model_chain` ESBEJE. Tidak boleh diubah tanpa persetujuan.
5. Ulang simulasi dengan kode final yang di-deploy (staging lama di `/root/closing-sim` tertinggal dua penyempitan guard) dan tambah sampel per model.
6. Hanny mengisi alamat toko Cisauk di Pengaturan > Lokasi.
7. Perhalus penanganan harga yang tak lewat `cek_harga`: guard harga membuangnya dengan kalimat canggung.

## Putaran ulang 4 Nov (LLM_MAX_TOKENS=2000, kode final live)

Mentah: docs/simulasi-model-esbeje/out-4nov.txt (skrip: sim-esbeje.js, convos.json).
Dengan batas 2000 token, Gemini 3.7 Flash, Gemini 2.5 Pro, dan Sonnet 5.5 membalas normal (0 error HTTP).

Biaya 2 skenario (15 giliran): Gemini 3.7 Flash $0,21 | Gemini 2.5 Pro $0,35 | Sonnet 5.5 $1,35.
gpt-5.4-mini dan Haiku 4.5 tidak terukur: putaran terhenti karena kredit OpenRouter hampir habis.

PERINGATAN: saldo OpenRouter 4 Nov = $275 kredit - $272,35 terpakai = sekitar $2,65. Isi saldo sebelum apa pun.
Sonnet 5.5: jujur, tidak mengarang, tapi menahan total/rekening sampai ketersediaan pasti (terlalu hati-hati), dan sekali memotong rincian.

## Dieksekusi 5 Nov (setelah Hanny: "ok go semua")
- Tes `test/uncertainty-guard.test.js`: 20/20 lulus. Kode guard + wording + eskalasi sudah di main (HEAD 463be8d adalah leluhur origin/main, CI hijau); tak ada yang perlu di-push.
- Produksi `.env`: `LLM_MAX_TOKENS` 512 -> 2000 (cadangan `.env.bak.pre-maxtokens-20261105`), app dibuat ulang, sehat.
- ESBEJE `ai_model_chain` = `{openai/gpt-5.4-mini, anthropic/claude-haiku-4.5}` (sebelumnya kosong = bawaan gemini-2.5-flash). Kembalikan: `update companies set ai_model_chain='{}' where id='fdf4441c-6a15-42d9-84ed-65c85debb660'`.
- BELUM: tes chat nyata ESBEJE dengan rantai baru; biaya gpt-5.4-mini/Haiku belum terukur.
- URGEN: saldo OpenRouter (kunci dipakai semua company) sisa sekitar $2,4 (kredit 275, terpakai 272,59 pada 5 Nov). Harus diisi Hanny sendiri; bila habis, AI semua company berhenti.
