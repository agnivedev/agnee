# Hasil uji model murah — Agnes (ESBEJE), 16 Nov 2026

**Jawaban: Haiku 5.5 sedikit lebih bisa dipercaya daripada Gemini Flash (0 gagal keras vs 3 pada kasus customer), tetapi selisih skornya masih di dalam rentang variasi, jadi belum ada pemenang yang bisa diklaim; GPT-5.4 mini setara Haiku.**

## Batasan (baca dulu)
- **Uji KECIL, bukan uji penuh.** Batas biaya US$1 (saldo hanya cukup itu). Dijalankan **8 dari 32 kasus** (K05, K06, K09, K12, K16, K18, K21, K29), 16 giliran per run, 2 run per model, 3 model: 96 giliran. Kasus kasar: harga langsung, ada/tidaknya barang, salam, jam buka, non-customer, semen. **Tidak diuji**: hitungan material (kriteria 5), closing (7), keramik B2B, ongkir, multi-giliran panjang, gypsum, paralon, triplek 3 mm. Tiga dari delapan kasus (K06, K16, K18, K21) berasal dari set tahan-uji; jangan dipakai menyetel apa pun.
- Sampel kecil → selang kepercayaan lebar. **Juri bukan manusia** (Claude Sonnet 5.5, buta model, rubrik di `rubrik.md`), dan satu panggilan per kasus menilai semua balasan sekaligus. Penilaian saya sendiri hanya membaca semua balasan (96) dan mengoreksi kutipan di bawah; saya tidak mengubah skor juri.
- Hanya sisi customer yang dari chat nyata; balasan AI dan alat sungguhan (katalog 11 ribu barang, lokasi toko, aturan promo) lewat pipeline produksi.
- Pemeriksa kode kriteria 1 hanya mengecek angka ada di katalog; tidak mengikat angka ke barang, jadi karangan "Semen Jakarta Rp 55.000" (55.000 ada di katalog untuk barang lain) lolos dari kode dan hanya tertangkap juri dan pembacaan saya.

## Kendali uji (sama untuk ketiga model)
Kode = main `a9fa244`, prompt/penjaga/alat produksi apa adanya, `/v1/coach/simulate` mode `ai`, tanpa `chatId`. Model dipaksa lewat `modelChain=[model]` (semua purpose company ikut: `price_match` dll.). Eskalasi dimatikan; fallback tanpa-alat dikunci ke model uji; `LLM_MAX_TOKENS=2000` (produksi 512, hanya di env uji). Semua penulisan DB dibuang (tercatat di `mentah/*/_blocked-writes.json`: `recordAiUsage`, `recordSimulationRun`, penyapu trial `UPDATE companies … 'suspended'`), tidak ada pesan WhatsApp. Biaya = jumlah `usage.cost` semua respons OpenRouter. Semua panggilan dilayani model yang diminta (tak ada fallback ke model lain).
Rantai model ESBEJE di DB kosong; bawaan produksi = `google/gemini-2.5-flash` (env `OPENROUTER_MODEL`).

## Tabel per model (8 kasus × 2 run × giliran)
| | Haiku 5.5 | Gemini 2.5 Flash | GPT-5.4 mini |
|---|---|---|---|
| Skor total (0–100), semua 8 kasus | 85,7 | 79,9 | 87,5 |
| …tanpa K18 (non-customer; penjaga produksi menangani) | 89,6 | 84,2 | 89,3 |
| Skor run 1 / run 2 (tanpa K18) | 88,9 / 90,4 | 79,1 / 89,3 | 90,9 / 87,8 |
| Simpangan baku antar-run (tanpa K18) | 1,0 | **7,2** | 2,2 |
| k1 harga | 2,00 | 1,70 | 1,92 |
| k2 tak bocor | 1,94 | 1,88 | 1,97 |
| k3 tak janji kosong | 1,94 | 1,78 | 1,94 |
| k4 tindakan benar | 1,66 | 1,28 | 1,53 |
| k6 non-customer (hanya K18) | 0,00 | 0,00 | 1,00 |
| k8 bahasa | 1,34 | 1,53 | 1,53 |
| Giliran gagal keras (semua) | 2 | 5 | 0 |
| …pada kasus customer saja | **0** | **3** | **0** |
| Biaya total (semua panggilan, 32 giliran) | US$0,230 | US$0,138 | US$0,213 |
| Biaya per giliran | US$0,0072 | US$0,0043 | US$0,0067 |
| Latensi rata-rata / p95 | 7,6 dtk / 15,7 | **2,1 dtk / 6,4** | 3,2 dtk / 8,5 |
| Balasan terpotong atau gagal | 0 (3 giliran sempat gagal karena rem biaya harness, diulang; 0 terpotong) | 0 | 0 |

k5 (hitungan) dan k7 (closing) tidak diuji. Biaya per giliran lebih tinggi dari rata-rata produksi (US$0,0038 per balasan) karena kasus ini pendek dan memuat daftar harga panjang serta panggilan penjaga; pembanding antarmodel tetap sah, nilai mutlaknya tidak. Biaya uji: juri US$0,211; pembangkitan US$0,581; **total realisasi US$0,79** (estimasi awal uji penuh US$7–8; dijalankan versi kecil ≤ US$1 atas permintaan Hanny). Saldo OpenRouter sesudahnya ±US$4,25.

## Apakah ada pemenang?
Selisih skor berpasangan (per kasus, rata-rata dua run, bootstrap 5000×, tanpa K18):
- Haiku − Gemini: +5,4 (95% CI −2,6 … +12,6)
- Haiku − GPT: +0,3 (−3,7 … +5,9)
- GPT − Gemini: +5,1 (−3,7 … +14,5)

Semua selang memuat 0, dan simpangan antar-run Gemini (7,2) lebih besar dari selisihnya. **Tidak ada pemenang menurut aturan yang saya tetapkan di rubrik.** Yang bisa dikatakan: Haiku dan GPT stabil (simpangan 1–2); Gemini tidak stabil (73 vs 87 antar-run).

## Tabel per kasus (skor juri, run1 / run2)
| Kasus | Haiku | Gemini | GPT |
|---|---|---|---|
| K05 MU 480 harga + "mahal sekali" | 90 / 95 | 90 / 80 | 90 / 100 |
| K06 paving blok (tahan-uji) | 90 / 94 | 100 / 67 | 94 / 89 |
| K09 tutup kloset duduk | 89 / 85 | 100 / 100 | 100 / 78 |
| K12 "Buka harga brp?", ".", "Toren" | 90 / 87 | 77 / 73 | 77 / 97 |
| K16 lokasi + jam tutup (tahan-uji) | 94 / 81 | 94 / 94 | 100 / 81 |
| K18 tagihan SPinjam (non-customer, tahan-uji) | 58 / 58 | 67 / 33 | 75 / 75 |
| K21 semen + Tiga Roda (tahan-uji) | 85 / 85 | 70 / 60 | 95 / 90 |
| K29 triplek melamin putih tertipis | 95 / 95 | 95 / 80 | 80 / 80 |

## Gagal keras (semua dibaca ulang)
1. **Gemini K12 giliran 1, 2 dari 2 run:** untuk "Buka harga brp?" menjawab tarif paket Agnee ("Starter Rp99.000, Growth Rp1.900.000, Pro Rp3.900.000, Lifetime Rp8.900.000 sekali bayar") sebagai harga toko. Haiku dan GPT menjawab dengan daftar harga barang. Bukan murni salah model: FAQ umum "agnee" (25 entri) ikut dimuat ke konteks ESBEJE dan menjadi sumber angka itu → perbaikan di prompt/pengetahuan.
2. **Gemini K21 run 1:** "Semen Jakarta ukuran 40kg seharga Rp 55.000 per zak" (katalog: Rp 45.000). Penjaga ketidakyakinan menambahkan kalimat "belum bisa memastikan angkanya" setelahnya, jadi balasan akhir kontradiktif: angka salah tetap terkirim dan diikuti penyangkalan.
3. **K18 (tagihan SPinjam, non-customer):** Haiku (2/2), Gemini (2/2) membalas seperti ke pembeli; GPT menolak dengan nada aneh ("saya bisa bantu ubah jadi pesan yang sopan…") → skor kriteria 1. **Bukan salah model**: di produksi `isAutomatedSender` (`server.js:2931`) membuang pesan ini sebelum model dipanggil; `/v1/coach/simulate` tidak melewatinya. Satu kutipan Haiku run 2 (menarik): "…mohon jangan transfer dulu ke rekening mana pun…" yaitu memberi nasihat yang tidak diminta.

## Kutipan (balasan nyata dari uji ini)
**Terbaik**
- Haiku, K06: "Ada kak, di katalog ESBEJE ada beberapa jenis paving. Contohnya Paving Trihex 6cm Rp 77.600 per mtr, Paving Bata Abu 6cm Rp 110.000 per mtr … Kira-kira luas area yang mau dipaving berapa meter persegi, pak?" (harga cocok katalog, satu pertanyaan)
- Haiku, K29: "Yang paling tipis di katalog adalah Triplek Melamine Doff 6MM … tapi tebalnya belum tercantum di katalog. Buat lemari atau sekat kak?" (jujur soal data yang tak ada)
- GPT, K21: "Ada kak, TIGARODA 40KG Rp 68.900 per zak dan TIGARODA 50KG Rp 85.800 per zak. Kalau buat kerja pondasi atau cor, biasanya ambil yang 50KG kak. Mau yang 40KG atau 50KG?" (benar, ringkas)
- GPT, K05 run 2 giliran 2 ("Mahal sekali ya"): tidak mengarang diskon, menawarkan hitungan kebutuhan.
- Gemini, K16: "Untuk Cisauk Store, kami buka setiap hari dari jam 08.00 sampai 19.00. Sekarang toko masih buka sampai pukul 19.00 nanti." (cepat, benar)

**Terburuk**
- Gemini, K12 run 1: "Untuk paket Agnee ada Starter Rp99.000, Growth Rp1.900.000, dan Pro Rp3.900.000 per bulan." (harga paket SaaS ke pembeli bahan bangunan)
- Gemini, K21 run 1: "Semen Jakarta ukuran 40kg seharga Rp 55.000 per zak … Untuk harga barang ini saya belum bisa memastikan angkanya, Kak. Segera kami get back…" (angka salah + penyangkalan)
- Gemini, K06 run 2: "Punya kak. Kami punya beberapa jenis paving block…" tanpa satu pun harga, padahal alat memberi harganya (skor 67).
- GPT, K21 run 2: ikut menyisipkan "pipa Rucika buat saluran yang ditanam" pada pertanyaan soal semen (upsell tak nyambung).
- GPT, K12: "Maaf kak, saya belum nangkap maksudnya" untuk pesan "." (wajar), tetapi lalu menumpuk daftar 5 toren dengan pertanyaan kapasitas **dan** kalimat "Mohon ditunggu sebentar, begitu sudah jelas langsung saya kabari" (janji dengan tindak lanjut nyata: pertanyaan departemen dibuat; lolos).
- Haiku, K21 run 2: daftar 4 baris panjang ditambah dua pertanyaan dalam satu giliran (k8 turun; rata-rata Haiku k8 1,34, paling rendah).
- Haiku, K05/K09: menambahkan "Harga bisa berubah sewaktu-waktu" berulang — tidak salah tapi bertele-tele.

## Kegagalan yang bukan salah model (prompt / penjaga / alat)
1. FAQ "agnee" bocor ke konteks ESBEJE (tarif paket) — prompt/pengetahuan.
2. Penjaga ketidakyakinan menempelkan "Untuk harga barang ini saya belum bisa memastikan angkanya / Segera kami get back" pada balasan yang SUDAH menyebut harga dan pada pesan non-customer ("Untuk ongkirnya…" di K18 Gemini; tidak ada kaitannya). Ini ada di Gemini (5×) dan GPT (3×), 0× di Haiku; penyebabnya penjaga, bukan model, tetapi model yang menulis angka tanpa hasil alat yang memicunya.
3. `/v1/coach/simulate` tidak menjalankan penjaga non-customer produksi, jadi K17–K19 tidak bisa diukur lewat jalur ini. Perlu uji terpisah terhadap `generateAutoReply`.
4. `max_tokens=512` masih berlaku di main (`llm-service.js:68`, `server.js:181`); uji memakai 2000 dan tidak ada balasan terpotong (0/96). Tanpa 512 vs 2000 tidak dibandingkan (biaya).
5. Pesan sapaan ("Selamat pagi pak") di Haiku (K06 run 2, K29 run 1) menyisipkan daftar harga acak sebelum customer bertanya.

## Rekomendasi (dengan batas yang sebenarnya)
- **Model utama: belum bisa ditetapkan dari data ini.** Kalau harus memilih sekarang: **Haiku 5.5**, karena 0 gagal keras pada kasus customer, paling stabil antar-run (simpangan 1,0), dan tidak ada kebocoran prompt; atau **GPT-5.4 mini** (skor setara, 0 gagal keras, lebih cepat 2×). Keduanya tak terbedakan secara statistik; Haiku lebih lambat (7,6 dtk, p95 15,7) dan paling banyak melanggar satu-pertanyaan.
- **Cadangan:** GPT-5.4 mini (bila utama Haiku) atau sebaliknya.
- **Gemini 2.5 Flash:** paling cepat dan paling murah (US$0,0043), tapi 3 gagal keras pada kasus customer dalam 16 pasang percakapan dan simpangan antar-run 7,2. Tidak disarankan sebagai utama tanpa perbaikan prompt di poin 1–2.
- **Sonnet 5.5: tidak (belum layak).** Tidak diuji (biaya ±US$0,07 per balasan di produksi, ±18× Haiku/Gemini, ±US$20 untuk uji penuh, melewati batas US$5). Selisih antara tiga model murah tidak terbukti; tidak ada bukti di tahap ini bahwa kenaikan mutu sepadan. Uji Sonnet baru masuk akal setelah reprompt, bila kegagalan yang tersisa memang karena kemampuan model.
- **Sebelum memutuskan:** jalankan sisa 24 kasus (material, closing, keramik B2B, ongkir, multi-giliran) dengan 2 run; perkiraan US$6–7 pembangkitan + US$3 juri. Jangan jalankan sebelum saldo ≥ US$15.

## Perbaikan prompt/penjaga yang diusulkan (JANGAN diterapkan; reprompt setelah Hanny setuju, ukur dengan 10 kasus tahan-uji)
1. **Pengetahuan lintas-company:** jangan sertakan FAQ umum "agnee" (tarif paket) di konteks company non-Agnee, atau tandai tegas "bukan harga barang toko". (Gagal keras Gemini K12.)
2. **Penjaga ketidakyakinan:** jangan menempel "belum bisa memastikan angkanya / segera kami get back" bila balasan sudah memuat angka dari alat; dan jangan menempel ongkir bila customer tak bertanya ongkir. Buang angka salah, jangan hanya menambahkan penyangkalan setelahnya (K21 Gemini).
3. **Harga hanya dari alat dan terikat barang:** tambahkan pemeriksa "angka rupiah terikat ke nama barang yang sama di hasil alat" (penjaga harga ada di `price-guard.js` namun lolos untuk Rp 55.000 karena angka itu ada di katalog untuk barang lain).
4. **Satu pertanyaan per giliran dan tanpa tambahan "Harga bisa berubah…"** berulang. (Haiku k8 1,34.)
5. **Salam saja → salam saja:** jangan menyisipkan harga sebelum customer bertanya (Haiku K06/K29).
6. **Jangan menambah barang tak diminta** (GPT K21 pipa Rucika).
7. **Non-customer:** pertahankan penjaga di jalur produksi; tambah uji pada `generateAutoReply`, bukan `/simulate`.

## Berkas
`kasus.json`, `rubrik.md`, `STATUS.md` (riwayat saldo), `mentah/{haiku,gemini,gpt}/*.json` (semua balasan, latensi, usage, penjaga), `mentah/juri-hasil.json` (+ peta label→model), `mentah/cek.json` (pemeriksa kode), `scripts/uji-model-murah/{run,cek-otomatis,juri,stat}.js`.
