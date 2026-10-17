# Rancangan sistem credit (17 Okt 2026)

> **PERLU PERSETUJUAN PEMILIK.** Semua angka di bagian "Angka usulan" adalah
> usulan, bukan keputusan. Semuanya ada di satu file, `src/credit-plans.js`
> (dan env `CREDIT_*`), jadi mengubahnya tidak butuh perubahan logika.
> Harga paket (Rp99rb / 1,9jt / 3,9jt) dipakai apa adanya dari keputusan pemilik;
> tidak ada harga baru yang dibuat.

## 1. Prinsip

1. **Credit = satuan tagihan, 1 credit = Rp 1 nilai tagihan.** Biaya AI nyata per
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

## 3. Angka usulan (SETUJUI / UBAH)

Dasar biaya nyata (DB `agnee` lokal, 205 panggilan sejak 16 Sep, model tingkat
Medium): balasan otomatis **US$0,0016 ≈ Rp 26**; simulasi Rp 18; ringkasan Rp 7;
broadcast personal Rp 3. Tingkat High/Top memakai model lebih mahal otomatis
karena biaya diambil dari penyedia. **Catatan: data produksi tidak terjangkau
dari sesi ini; sebelum disetujui, jalankan `scripts/credit-cost-sample.sql`
di produksi dan cocokkan angkanya.**

| Parameter | Usulan | Alasan |
|---|---|---|
| Markup credit atas biaya AI | **3,0×** | biaya AI maksimal ⅓ dari credit yang terjual |
| 1 credit | **Rp 1** | top-up Rp X = X credit; tidak ada tarif baru |
| Peringatan saldo rendah | **20%** | |
| Masa tenggang credit paket | **3 hari** | mengantisipasi konfirmasi bayar manual |
| Top-up minimum | **tidak ada** (diatur env) | pemilik yang menentukan |

| | Starter | Growth | Pro | Enterprise |
|---|---|---|---|---|
| Harga/bln (keputusan pemilik) | Rp 99.000 | Rp 1.900.000 | Rp 3.900.000 | custom |
| Credit paket/bln (usulan) | 99.000 | 1.900.000 | 3.900.000 | diatur manual |
| ≈ balasan AI tingkat Medium* | ±1.250 | ±24.000 | ±49.000 | – |
| Pengguna | 1 | 5 | 15 | tak terbatas** |
| Nomor WhatsApp | 1 | 2 | 5 | tak terbatas** |
| Dokumen playbook | 1 | 5 | 15 | tak terbatas** |
| Tingkat model tertinggi | Medium | High | Top-end | Top-end |
| Broadcast | tidak | ya | ya | ya |

\* credit ÷ (Rp 26 × markup 3 = Rp 79 per balasan), tanpa pemakaian internal.
\*\* 0 = tanpa batas, konvensi kolom `max_*` yang sudah ada. Enterprise juga
bisa diubah per company (kolom `max_*`, diskon, credit) dari konsol.

Efek usulan 1 credit : Rp 1 dan markup 3×: bila seluruh credit paket terpakai
habis, biaya AI kita ≈ ⅓ harga paket; sisanya margin dan biaya platform.

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
