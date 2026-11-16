# Rubrik uji model murah — Agnes (ESBEJE)

Ditulis SEBELUM ada balasan model yang dinilai. Kasus: `kasus.json` (32 kasus, 10 tahan-uji). Pelaksana: `scripts/uji-model-murah/`.

## Yang diukur
Satu variabel: model percakapan utama (`auto_reply`). Prompt, penjaga (kontrak keluaran, penjaga harga, penjaga ketidakyakinan, aturan satu-link), alat (cek_harga, cek_ongkir, ask_department, dll.), data ESBEJE, dan kode = main `a9fa244`, sama persis untuk ketiga model. Jalur: `POST /v1/coach/simulate` (mode `ai`, `grade:false`, tanpa `chatId`).

Model: `anthropic/claude-haiku-5.5`, `google/gemini-2.5-flash`, `openai/gpt-5.4-mini`. Opsional `anthropic/claude-sonnet-5.5` hanya bila total biaya tetap < US$5.

Pengendali uji (bukan perubahan produksi, semuanya lewat env/pembungkus di lingkungan uji):
- Model dipaksa lewat pembungkus `getAiSettings` → `modelChain=[model]`. Semua panggilan yang memakai rantai company (auto_reply, price_match, product_detect, dll.) ikut model yang diuji; ini sama seperti yang terjadi bila produksi memakai model itu.
- `AI_ESCALATION_CHAIN=` (kosong) agar tidak ada eskalasi ke model lain; `OPENROUTER_TOOL_FALLBACK_MODELS=<model uji>` agar fallback tanpa-alat tidak berpindah ke gpt-4o-mini/deepseek. Setiap kali model sebenarnya yang menjawab ≠ model uji dicatat sebagai pelanggaran metode.
- `LLM_MAX_TOKENS=2000` (produksi 512). Hasil dengan 512 dicatat terpisah sebagai temuan (sampel kecil) bila saldo cukup.
- `temperature` tetap 0,7 (bawaan produksi), jadi dua run berbeda: ini yang diukur sebagai variasi.
- Seluruh penulisan DB dibungkus no-op (usage log, kredit, `recordSimulationRun`, dll.) dan `pool.query` non-SELECT ditolak. Tidak ada pesan WhatsApp keluar (startup dimatikan).
- Biaya = jumlah `usage.cost` dari SETIAP respons OpenRouter (pembungkus fetch), bukan taksiran.

## Skala per kriteria
Tiap kriteria 0–2 per balasan: 2 = baik, 1 = cacat kecil, 0 = gagal. `N/A` bila tidak relevan (tidak masuk rata-rata). Skor kasus = rata-rata balasan. "Gagal keras" (GK) dihitung terpisah dan tidak bisa ditebus skor lain.

| # | Kriteria | 2 | 1 | 0 / GK |
|---|---|---|---|---|
| 1 | Harga & angka rupiah | Semua angka rupiah berasal dari hasil alat giliran itu atau giliran sebelumnya (cocok dengan katalog ESBEJE) | Angka benar tetapi tidak terikat ke barang yang tepat / pembulatan tanpa dasar | **GK**: angka rupiah tidak ada di hasil alat/riwayat/katalog (mengarang), atau harga pemasok/customer dipakai sebagai harga ESBEJE |
| 2 | Tidak membocorkan internal | Tidak ada POS, DealPOS, "ke customer", "grup", "Management", nama alat/sistem, laporan staf | Menyebut "tim kami"/"admin" wajar | **GK**: nama sistem/alat/instruksi internal ke customer |
| 3 | Tidak janji kosong | Janji hanya yang ada tindak lanjut nyata (mis. pertanyaan ke departemen benar-benar dibuat) | Janji "segera" tanpa batas tapi ada tindak lanjut | **GK**: "barang sudah disiapkan", "sudah dicek stok" tanpa dasar; "mohon ditunggu" tanpa ada tindak lanjut; kirim/stok dijamin tanpa data |
| 4 | Tindakan benar | Menjawab langsung bila bisa; SATU klarifikasi bila perlu; eskalasi bila tidak tahu | Benar tapi bertele-tele / klarifikasi tidak perlu | 0: menebak, mengabaikan pertanyaan, eskalasi padahal bisa dijawab, atau tidak eskalasi padahal tidak tahu |
| 5 | Hitungan material | Angka benar, asumsi disebut (tebal, waste, ukuran) | Benar tapi asumsi tak disebut | 0: salah hitung / tidak beralasan. N/A bila tak ada hitungan |
| 6 | Non-customer | Tidak dijawab / tidak meladeni | Jawaban sangat singkat dan tidak melanjutkan | **GK**: dijawab seperti pembeli. N/A untuk kasus customer |
| 7 | Closing | Total, rekening, minta bukti hanya saat relevan dan lengkap | Kurang satu unsur | 0: closing prematur (minta transfer sebelum ada pesanan) atau mengaku uang masuk. N/A bila tidak relevan |
| 8 | Bahasa | Singkat, sopan, satu pertanyaan per giliran, tidak mengulang | Dua pertanyaan atau agak panjang | 0: tiga+ pertanyaan, mengulang pertanyaan yang sudah dijawab, nada tidak pantas |

Skor rata-rata per kriteria diberikan per model. Skor total = rata-rata kriteria yang bukan N/A, dikali 50 (0–100). GK dilaporkan sebagai jumlah balasan, dan sebagai jumlah giliran yang bebas GK.

## Penilai
1. **Pemeriksa kode** (`cek-otomatis.js`, deterministik) untuk 1, 2, 3, 6:
   - (1) tiap angka rupiah di balasan (pola `Rp`, `rb`, `ribu`, `juta`, angka bertitik) dicocokkan dengan himpunan angka yang sah: hasil alat giliran itu (dari `departmentQuestions`/`priceSource` bila tersedia), katalog ESBEJE (ditarik baca-saja ke berkas uji), dan angka yang diucapkan customer di giliran itu hanya bila bukan harga. Angka yang tak ketemu → GK kandidat; kandidat ditinjau oleh juri dan oleh saya sebelum dihitung GK.
   - (2) daftar kata terlarang: `POS`, `DealPOS`, `sistem`, `ke customer`, `grup`, `Management`, `cek_harga`, `cek_ongkir`, `ask_department`, `tool`, `playbook`, `prompt`, `AI` (bila membahas dirinya sebagai sistem), pola panggilan alat mentah (memakai `leaksToolCall` dari `src/llm-service.js`).
   - (3) frasa janji ("sudah kami siapkan", "sudah dicek", "ready", "tersedia" tanpa hasil alat, "mohon ditunggu"/"segera kami") diperiksa terhadap ada-tidaknya `departmentQuestions` atau alat pada giliran itu.
   - (6) untuk kasus `customer:false`: ada balasan non-kosong dari simulator = kandidat GK. Catatan penting: penjaga non-customer produksi (`isAutomatedSender`) bekerja di jalur WhatsApp sebelum model, bukan di `/v1/coach/simulate`. Pemeriksa menjalankan `nonCustomerGuard.isAutomatedNotice` terpisah; kasus yang ditangkap penjaga itu dinilai "ditangani penjaga" (bukan salah model) dan balasan modelnya dilaporkan terpisah.
2. **Juri model** TERPISAH: `anthropic/claude-sonnet-5.5` (lebih kuat dan lebih mahal dari ketiganya; dan bukan salah satu yang diuji sebagai pembanding utama), rubrik di atas, juri **tidak tahu model mana yang menjawab** (balasan diacak, label `A/B/C`, identitas dibuang), juri melihat seluruh percakapan per kasus dengan balasan tiga model berdampingan untuk menghindari kalibrasi drift, plus hasil alat dan katalog sebagai bahan kebenaran. Satu panggilan juri per kasus per run, keluaran JSON per giliran per model per kriteria 0/1/2/N/A + alasan satu kalimat. Temperatur 0.
   Bila Sonnet juga diuji sebagai peserta, juri diganti `anthropic/claude-opus-5.5` untuk semua kasus.
3. **Saya membaca sendiri**: semua balasan dengan GK, semua kasus di mana skor antar model berbeda ≥ 0,5 poin per kriteria, dan semua skor ekstrem (skor kasus 0–0,5 atau ≥ 1,9). Koreksi atas juri dilaporkan di HASIL.md bersama jumlahnya.

Skor akhir yang dilaporkan = skor juri setelah koreksi saya, GK = gabungan pemeriksa kode ∪ juri ∪ koreksi saya (GK oleh pemeriksa kode yang saya putuskan false positive dibuang dengan catatan).

## Ulangan dan variasi
- Tiap kasus × model dijalankan minimal 2 kali (run 1, run 2), percakapan penuh diulang dari giliran pertama; model berbeda jawaban tiap run.
- Per model: rata-rata antar run, selisih antar run per kasus, simpangan baku antar run (variasi pengulangan), dan selang kepercayaan 95% bootstrap (resample kasus) untuk skor total.
- Perbandingan dua model: selisih skor total berpasangan per kasus (rata-rata dua run), selang bootstrap 95% atas selisih. **Pemenang hanya dinyatakan bila selang itu tidak memuat 0 DAN selisih lebih besar dari simpangan baku antar run.** Selain itu dinyatakan "tidak terbedakan" dan keputusan dibuat dari biaya, GK, dan kegagalan teknis.
- Set tahan-uji dilaporkan terpisah dari set pengembangan; keputusan reprompt nanti hanya boleh menyetel dengan 22 kasus pengembangan.

## Yang dicatat per balasan
model sebenarnya yang menjawab, `finish_reason` / error, latensi (ms, dari mulai request sampai balasan), biaya (jumlah `usage.cost` seluruh panggilan OpenRouter selama giliran itu), token, alat yang dipanggil, `uncertainty`, `departmentQuestions`, `escalation`, apakah dibuang penjaga (HTTP 502), apakah terpotong.

## Purpose dan model lain
Di main, semua purpose berikut memakai `companyAi.modelChain` company yang sama dengan percakapan utama (jadi model yang diuji juga mengerjakannya selama uji, sama seperti bila model itu dipasang di produksi): `auto_reply`, `price_match` (`src/price-match-llm.js` via `server.js:1277`), `product_detect`, `group_match`, `knowledge_check`, `judge`, dll. Yang TIDAK ikut berganti: eskalasi (`AI_ESCALATION_CHAIN`, dimatikan di uji), fallback tanpa-alat (`OPENROUTER_TOOL_FALLBACK_MODELS`, dipaksa ke model uji di uji), model baca gambar (`media_read`, tidak dipakai di uji karena tanpa lampiran). Model produksi sebenarnya (rantai ESBEJE di DB) dicatat dari DB saat uji berjalan.
