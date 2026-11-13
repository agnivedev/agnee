# Kebutuhan ESBEJE / Agnes — kumpulan dari semua sesi

Dikumpulkan 13 Nov 2026 dari 28 transkrip sesi (permintaan Hanny 23 Okt–11 Nov),
`docs/PROGRESS.md` (10 Nov), `docs/HASIL-TES-AGNES-ESBEJE-29OKT.md`,
`docs/ESBEJE-DATA-KOSONG.md`, dan memori proyek. Status dicocokkan ke `git log origin/main`.

Tanda status: **LIVE** = sudah di main dan produksi · **LIVE, belum diuji WA** = jalan di
kode/simulator tapi belum terbukti di chat WhatsApp asli · **SEBAGIAN** · **BELUM**.

## Profil singkat

- ESBEJE = "Bestseller" = dulu Super Bangun Jaya (SBJ). Toko bahan bangunan, toko Cisauk.
  Company slug `esbeje`. Persona AI: **Agnes** (sejak 27 Okt).
- Akun: owner `esbeje.media@gmail.com` (menggantikan superbjmedia, 26 Okt), supervisor
  spv1 (Venny) dan spv2 (Fera), agent cs1 dan cs2. Superhuman: hnnystwn, ferasogmedia, esbeje.media.
- Departemen: Management (grup WA "Manajemen Bestseller") dan Finance (grup tanya transferan).
- Merek unggulan: triplek, toren Penguin + Mpoin, Semen Jakarta, mortar Mortar Utama (MU xxx)
  + Jakarta, pipa Rucika, cat Danapaint/Jotun/Mowilex/Nippon/Propan/Bital Asia/Penta.
- VK = volume kecil, VB = volume besar (ambang 5 jt dari SOP mereka). Semen Jakarta = merek.

## Kebutuhan per tema

### 1. Playbook dan gaya bicara

| Kebutuhan Hanny | Status |
|---|---|
| Playbook bestseller (toren, triplek, semen, mortar, cat, pipa); satu playbook umum | LIVE 23 Okt (fcc89ab), dirapikan 26 Okt (5c0ba9f) |
| Funnel: 3–5 chat langsung arahkan ke closing, sopan tapi sharp, nuansa salesy | LIVE 27 Okt (08eb7e0, aec7df0), belum diuji WA |
| Jangan terlalu banyak bertanya; lebih banyak menyarankan, kecuali butuh keputusan urgent | LIVE 29 Okt (playbook + aturan umum) |
| Cross-selling dan up-selling (MU 301→MU 200, keramik→nat, toren→pipa) | LIVE 28 Okt (7f12b97) |
| Hitungan material tidak boleh ditunda ke tim; tetap bertanya, tapi hitungannya harus diberikan | LIVE 4 Nov (4829e36 `hitung_kebutuhan`, 1810280, b1f00a3) |
| Fakta produk per satu satuan (1 pail cat = berapa m²) | LIVE 4 Nov (554238d) |
| Angka hitungan material di playbook (SNI bata/plester) | Dimuat 11 Nov, **angka belum dicek Management** |
| Aturan bawaan "diam lebih baik daripada berputar" dihapus; kalau ragu lempar ke Management | LIVE 28 Okt |

### 2. Harga

| Kebutuhan | Status |
|---|---|
| Harga diambil dari DealPOS (SellingPrice), bukan dari tim | LIVE 27 Okt |
| Tidak boleh ada harga selain dari DealPOS/playbook/katalog | LIVE 28–29 Okt (3bda841 `cek_harga`, f61c0dc) |
| Cek DealPOS dulu, baru tanya Management kalau tidak yakin | LIVE 29 Okt (2d1f093) |
| Varian dan UOM dari DealPOS (dus, pail, piece), jangan ditebak | LIVE 29 Okt |
| Ada pilihan warna → langsung tawarkan pilihannya | LIVE 29 Okt |
| Pencarian produk lewat LLM + kategori DealPOS (istilah lapangan "paralon 4 inch") | LIVE 9 Nov (a97e8ca) |
| Permintaan penawaran kantor (PPN, DP 30%, faktur pajak) dijawab satu pertanyaan lengkap ke tim | LIVE 4 Nov (bb23ab0) |
| **Penjaga harga mengikat angka ke barangnya** (MU 301 "Rp 62.000" lolos, asli 104.000) | Selesai di branch `fix/harga-terikat-barang` 13 Nov, **belum deploy** |
| Aturan diskon volume ("30 sak bisa lebih murah?") | **BELUM**, butuh aturan dari ESBEJE |

### 3. Ongkir dan alamat

| Kebutuhan | Status |
|---|---|
| Ongkir dari Lalamove: titik toko + lokasi customer (Google Maps / share location) | LIVE 27 Okt (`cek_ongkir`) |
| Jenis kendaraan ditanya ke Management | LIVE 28 Okt (6a3f8b2); `vehicle_mode` ESBEJE masih `management` |
| Ongkir jangan palsu, tidak perlu menjelaskan kendaraan cocok untuk apa | LIVE 29 Okt |
| Minta alamat lengkap dengan format WA (kelurahan, kecamatan, kota, provinsi) | LIVE 29 Okt |
| **Lalamove ESBEJE masih sandbox** → `cek_ongkir` MATI di chat WA asli | **BELUM** — tunggu kunci production dari Hanny |
| Promo gratis ongkir (sesama Cisauk "yes", BSD gratis) | Fitur Promo LIVE; aturan ESBEJE **belum diisi** |

### 4. Closing, invoice, pembayaran

| Kebutuhan | Status |
|---|---|
| Format WA rapi: total produk + ongkir, garis, grand total | LIVE 28 Okt (`susun_rincian`) |
| Customer deal → proforma invoice dari DealPOS | Kode LIVE 28 Okt; **mati di ESBEJE** (`ai_orders_enabled` false) |
| Customer setuju → invoice DealPOS + ongkir Lalamove | Kode LIVE; **mati di ESBEJE** |
| Bukti transfer dibaca, tapi tetap dicek ke grup Finance | LIVE 28 Okt (97 migrasi); **rekening ESBEJE kosong** |
| Kurir dipesan setelah dana masuk (bukan saat invoice) | LIVE 29 Okt (72f8353) |
| Order kurir Lalamove sukses | **Belum teruji** (wallet sandbox kosong, 402) |

### 5. Departemen dan grup WhatsApp

| Kebutuhan | Status |
|---|---|
| CS/AI bertanya ke grup dan/atau orang (stok, transferan) | LIVE 23 Okt |
| Kalau AI bingung: "segera kami get back ke kakak", lalu tanya Management (umum) atau grup terkait | LIVE 4 Nov (cf3e429) |
| Label customer = Nama WA + nomor HP asli, bukan id @lid | LIVE 4 Nov (1b7fda9, 20e86ee) |
| Jawaban grup yang bukan jawaban ("ga jadi") tak menutup pertanyaan | LIVE 4 Nov (3a2a6bf) |
| Jawaban staf lewat DM diteruskan; customer dikabari bila 12 jam tak terjawab | LIVE 4 Nov (bee60c0) |
| Pengingat dihitung jam kerja/jam buka, tidak dini hari | LIVE 5 Nov (5f06016, f11b2da) |
| "kosong kosong kosong" / pertanyaan kembar mengganggu staf | LIVE 10 Nov (1ddce48) |
| Jawaban staf tanpa reply/#kode tetap tertangkap (LLM) | LIVE 11 Nov (d36b1ea, 971c50b), belum diuji WA |
| Semua perilaku departemen di atas diuji di grup asli | **BELUM** |

### 6. AI belajar

| Kebutuhan | Status |
|---|---|
| Belajar dari obrolan customer → usulan knowledge, supervisor lihat simulasi, lalu setuju | LIVE 28 Okt (f2e8510), **saklar mati** |
| Belajar dari jawaban Management/Finance, kasus jelas + link ke chat sumber | LIVE 28 Okt (9967fa8), **saklar mati** |
| Tombol terima / biar AI putuskan / tolak pada usulan perbaikan | LIVE 28 Okt |

### 7. Lampiran, gambar, dokumen

| Kebutuhan | Status |
|---|---|
| Baca isi file dan gambar di chat (bukti transfer, foto produk, screenshot Tokopedia dengan watermark) | LIVE 3 Nov (4647974) |
| Latih AI bisa baca md, pdf, doc | LIVE 27 Okt |

### 8. Katalog, lokasi, jam buka

| Kebutuhan | Status |
|---|---|
| Katalog: versi tabel, filter/sort/search, unit dari UOM, ribbon | LIVE 27 Okt |
| Tombol kategorikan otomatis (Promo, Best Seller, Featured) | LIVE 27 Okt (766a863) |
| Jam buka per hari dengan pilihan 24 jam / tutup | LIVE 28 Okt (38d9ad6) |
| Tidak membocorkan "jam buka belum diisi" secara kaku | LIVE 28 Okt |
| Alamat toko Cisauk dan kontak penanggung jawab | **BELUM diisi** (Hanny) |
| Ribbon "Perekat Keramik" (MU 420) | **BELUM** |

### 9. WhatsApp dan paket

| Kebutuhan | Status |
|---|---|
| Satu nomor tak boleh dipakai dua CS; sebut company dengan masking *** | LIVE 26 Okt |
| Inbox multi-nomor (tab); ESBEJE paket max 5 | LIVE 27 Okt |
| Putuskan semua WA + tombol putus di samping badge Connected | LIVE 3 Nov (540effa) |
| Chat non-customer (tagihan, OTP, teman) tidak dijawab AI | LIVE 9 Nov (a97e8ca) |

### 10. Model dan biaya

| Kebutuhan | Status |
|---|---|
| Uji model lebih kuat / campuran Gemini, ChatGPT, Claude | Selesai 4–5 Nov ([HASIL-PERBANDINGAN-MODEL-ESBEJE.md](HASIL-PERBANDINGAN-MODEL-ESBEJE.md)) |
| Eskalasi model untuk giliran bermasalah, saklar per company | LIVE (bb80748, 8099758) |
| Harga jual per token minimal 2–3x biaya; biaya per client sampai closing | Ditanya 5 Nov; **jawaban tidak tercatat di repo/memori** |
| Ringkasan saldo ESBEJE per hari dan per orang (1–2 minggu) | Ditanya 10 Nov; **tidak tercatat di repo/memori** |
| Alert saldo OpenRouter + staf diberi tahu saat AI gagal | LIVE 11 Nov (2f78a38); kanal WA gagal karena nomor Beweix perlu scan QR, SMTP kosong |

## Outstanding gabungan

### A. Menunggu isian atau keputusan Hanny / ESBEJE

1. **Saldo OpenRouter** — habis 10–11 Nov (AI semua tenant diam >24 jam). Pastikan terisi.
2. **Kunci Lalamove production** + kontak Cisauk Store + pickup lat/lng → tanpa ini ongkir mati di WA asli.
3. **Rekening ESBEJE** di Pengaturan > Paket & Pembayaran → cek bukti transfer belum jalan.
4. **DealPOS order outlet/tag/tax type**, lalu nyalakan `ai_orders_enabled` → proforma/invoice.
5. **Model ESBEJE**: gpt-5.4-mini utama + claude-haiku-4.5 cadangan? (belum diputuskan).
6. **`LLM_MAX_TOKENS`** tetap 2000 atau kembali 512.
7. **Aturan diskon volume** dan **promo gratis ongkir** (Cisauk, BSD) diisi di Pengaturan > Promo.
8. **Angka hitungan material** di playbook dicek Management.
9. **Daftar keramik pengganti** yang ready (Sincere/Infinity/Art Keramik kosong di pabrik); Cat Eco Clean masuk DealPOS saat datang.
10. Saklar **belajar dari chat** dan **belajar dari departemen**: nyalakan atau belum.
11. `vehicle_mode`: tetap tanya Management atau AI yang pilih.

### B. Pekerjaan kode

1. ~~Penjaga harga mengikat angka ke nama barang~~ — dikerjakan 13 Nov di branch `fix/harga-terikat-barang` (belum deploy). Replay 84 balasan asli: tertangkap Semen Jakarta 40KG Rp 57.500 (harga 50KG), MU 420 Rp 100.000 (asli 118.000), MU 408 Rp 35.000, triplek "UTILITY" yang tak ada di katalog.
2. Penjaga "tidak yakin" positif palsu pada kata "mungkin" + macet di "ditunggu".
3. Gemini kadang membalas kosong setelah alat.
4. Sisa fix audit 9 Nov (5–11): playbook ongkir/salam, gambar/PDF, operasional.
5. Ribbon "Perekat Keramik" untuk MU 420.
6. Alamat ketikan via OpenStreetMap bisa meleset; pertimbangkan Google Geocoding.

### C. Uji di WhatsApp asli (semua belum pernah)

Funnel closing 3–5 chat, rute departemen "get back", penjaga ketidakyakinan, pencegahan
pertanyaan kembar, jawaban grup tanpa reply, pagar non-customer, link Maps asli,
cek_ongkir dengan kunci asli, proforma → invoice → bukti transfer → kurir.

### D. Bersih-bersih

Worktree `agnes-flow`, `esbeje-funnel`, `ai-harga-ongkir` dan DB uji lokal
(`agnee_agnes_test`, `agnee_knowledge_test`); skrip WIP `scripts/esbeje-*.sh`,
`scripts/setup-esbeje-sisa.sh` di checkout utama.

## Sesi sumber

Setup akun (8f97c696) · Playbook bestseller (a42e362b) · Belajar dari chat + funnel + model
(e4f0f4b9 / 61143370) · Nomor sama beda CS (64e0c895) · Backlog 27 Okt + katalog
(9686e2c4, 0bcbda25) · Closing invoice (f37cc46e, bb42a6cc) · Skenario tes (9ad25914) ·
Review playbook common (b4ac68a0) · Flow harga DealPOS (9f4b73df) · Terlalu banyak bertanya
(aab12ed6) · Putus WA (8e05bfcc) · Grup Management + label customer (8b9baa52) · Case
hitungan semen (fe4cb7d9, e6ff93ec) · Audit chat 9 Nov (f2c9077c) · Audit grup + saldo 11 Nov (40d1c0ad).
