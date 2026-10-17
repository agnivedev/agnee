# Rancangan sistem credit (17 Okt 2026)

> **PERLU PERSETUJUAN PEMILIK.** Semua angka di bagian "Angka usulan" adalah
> usulan, bukan keputusan. Semuanya ada di satu file, `src/credit-plans.js`
> (dan env `CREDIT_*`), jadi mengubahnya tidak butuh perubahan logika.
> Harga paket (Rp99rb / 1,9jt / 3,9jt) dipakai apa adanya dari keputusan pemilik;
> tidak ada harga baru yang dibuat.

## 1. Prinsip

1. **Credit = satuan pemakaian AI (≈ 1 balasan Medium), dijual Rp 100/credit.** Biaya AI nyata per
   panggilan (`ai_usage_logs.cost_usd`, yang dilaporkan penyedia) dikali kurs
   (`USD_IDR_RATE`) dikali **markup** lalu dikali `(1 - diskon%)` = credit
   yang dipotong. Biaya tidak dihitung ulang: sumbernya tetap satu.
2. **Dua kantong.** *Credit paket* (diisi tiap langganan, **hangus** di akhir
   periode + masa tenggang) dipakai lebih dulu; *credit top-up* (pay as you go,
   **tidak hangus**) dipakai sesudahnya.
3. **Opt-in per company** (`credit_mode`). Pelanggan yang sudah ada (Beweix,
   Citilux, AL Gold, dst., paket `company`/`personal`/`lifetime`) **tidak
   berubah sama sekali** sampai konsol /superhuman memindahkan mereka ke paket
   baru. Tidak ada yang tiba-tiba kehabisan.
4. **Penagihan tetap manual lewat WhatsApp** (belum ada gateway). Jadi
   perpanjangan dan top-up adalah tindakan staf di konsol setelah pembayaran
   dikonfirmasi, tercatat di buku besar (`credit_ledger`) dan jejak audit.
   **Credit tidak pernah diisi otomatis tanpa pembayaran.** Menyambung gateway
   (Mayar) kelak hanya perlu memanggil dua fungsi yang sama.
5. Diskon Enterprise sampai 90% = `credit_discount_pct` per company (0–90):
   credit yang dipotong per panggilan dikurangi sebesar itu.

## 2. Perilaku saat credit habis (jujur, tidak diam)

- Gerbang ada di `getCompanyAi()` yang sudah dilewati semua jalur AI (balasan
  otomatis, follow-up, broadcast, Coach, ringkasan, catatan-@AI). Saldo ≤ 0 →
  `enabled:false, reason:'credit'`. Satu titik, bukan dua belas.
- **Customer tidak dibalas AI dan tidak dibohongi**: tidak ada balasan palsu
  "sedang kami proses". Percakapan tetap masuk inbox; staf membalas manual
  (sama seperti saat paket berhenti).
- Rute web yang memakai AI menjawab terus terang: *"Credit AI perusahaan ini
  habis. Top-up credit untuk mengaktifkan AI kembali."* (503).
- **Kabar ke supervisor**: notifikasi dalam aplikasi ke owner/admin/supervisor
  dan WhatsApp ke nomor serah-terima company (yang sudah ada) saat saldo
  turun ke **20%** dari credit terakhir (peringatan) dan saat **habis**. Masing-
  masing sekali per siklus (di-reset oleh isi ulang), bukan tiap pesan.
- Panggilan yang sedang berjalan saat saldo menyentuh nol tetap dibayar penuh
  oleh platform; saldo dikunci di 0 (tidak minus), selisihnya tercatat di buku
  besar kolom `shortfall`.
- Top-up langsung menghidupkan AI lagi (gerbang membaca saldo tiap panggilan).

## 3. Angka usulan (SETUJUI / UBAH) — direvisi 17 Okt

Credit **bukan harga**. Harga paket tetap keputusan pemilik; credit adalah
satuan pemakaian AI: **1 credit ≈ 1 balasan AI tingkat Medium**.

Cara hitung (jalankan `node scripts/credit-simulate.js`):

- COGS balasan = biaya penyedia (USD) × kurs. Medium nyata ≈ **Rp 26**
  (data lokal 205 panggilan; High ≈ Rp 89 dan Top ≈ Rp 267 PERKIRAAN dari harga resmi).
- Harga jual 1 credit (top-up) = **Rp 100**; markup **3,85×** → 1 balasan Medium = 1 credit.
- COGS per credit = Rp 100 ÷ 3,85 ≈ **Rp 26**; margin kotor AI = **74%** pada harga penuh.
- COGS terpakai selalu mengikuti biaya nyata, apa pun modelnya (model mahal
  hanya menghabiskan credit lebih cepat).

| | Starter | Growth | Pro |
|---|---|---|---|
| Harga/bln (keputusan pemilik) | Rp 99.000 | Rp 1.900.000 | Rp 3.900.000 |
| Credit diberikan/bln (usulan) | 500 | 10.000 | 22.000 |
| COGS AI maks. bila habis total | Rp 13rb (13%) | Rp 260rb (14%) | Rp 571rb (15%) |
| Margin kotor AI | 87% | 86% | 85% |
| Pengguna / nomor / playbook | 1 / 1 / 1 | 5 / 2 / 5 | 15 / 5 / 15 |
| Model tertinggi | Medium | High | Top-end |
| Broadcast | tidak | ya | ya |

500 credit Starter sama dengan batas 500 pesan AI paket Personal lama.
Enterprise: credit dan harga custom.

**Peringatan diskon Enterprise 90%:** pada harga credit Rp 100, diskon 74%
sudah impas (pendapatan Rp 26 = COGS Rp 26); 90% berarti **rugi Rp 16 per
credit**. Usulan: batasi diskon di 60% (margin 35%), atau naikkan markup
bila 90% memang harus aman (markup ~10×). Kode masih mengizinkan 90%
(`MAX_DISCOUNT_PCT`) sampai pemilik memutuskan.

## 4. Yang dibangun

- `src/credit-plans.js`: konfigurasi paket + fungsi murni (biaya→credit,
  batas tingkat model, top-up→credit). Diuji.
- `db/migrations/063_credits.sql`: kolom credit di `companies`, tabel
  `credit_ledger`, paket baru di CHECK, jenis notifikasi `credit`.
- `src/database.js`: `debitCredit`, `grantCredit`, `subscribePlan`,
  `getCreditState`, `listCreditLedger`, kedaluwarsa lazy (tanpa cron).
- `src/server.js`: potong credit di `onUsage`; gerbang di `getCompanyAi`;
  batas tingkat model & broadcast per paket; rute tenant `GET /v1/credit`;
  rute konsol `POST /v1/superhuman/companies/:id/credit/{subscribe,topup,adjust}`
  + audit; kabar saldo rendah/habis.
- UI: kartu credit di Pengaturan > Paket (saldo, riwayat tanpa nama model) dan
  aksi di konsol /superhuman.

## 5. Di luar cakupan / untuk diputuskan

- Gateway pembayaran otomatis (Mayar) dan invoice.
- Apakah credit paket boleh digulung ke bulan depan (usulan: tidak).
- Pemakaian internal (Coach, simulasi, ringkasan) ikut memotong credit
  (usulan: ya, karena itu biaya nyata; mudah dikecualikan lewat `FREE_PURPOSES`).
- Pelanggan lama: tidak dipindah otomatis; keputusan per pelanggan.
