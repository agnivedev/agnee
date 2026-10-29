# Hasil tes Agnes ESBEJE: harga → ongkir → total → proforma → invoice → cek transfer

29 Okt 2026. Tiga customer disimulasikan lewat jalur pesan masuk WhatsApp yang sama dengan produksi (`handleInboundMessage` → `generateAutoReply`, alat pesanan + tanya departemen aktif), model AI asli (gemini-2.5-flash), data ESBEJE asli (katalog DealPOS 10.902 barang, rekening BCA, departemen, playbook) yang disalin baca-saja dari produksi. Screenshot: `docs/simulasi-agnes-29okt/kasusN-*.png`, transkrip mentah `kasusN.json`, harness `harness/` (butuh `esbeje.json` hasil `dump.js` di container produksi).

**Ditiru:** WhatsApp, penulisan dokumen DealPOS (Estimate/Invoice), tarif dan order Lalamove (tarif tiruan, ESBEJE masih sandbox), jawaban grup Management/Finance. **Diandaikan menyala** (di produksi masih mati): `ai_orders_enabled`, outlet/tag/pajak DealPOS, Lalamove production, kontak toko Cisauk. Tidak ada data produksi yang diubah.

## Hasil putaran 2 (yang di screenshot)

| Kasus | Alur | Grand total | Bukti transfer |
|---|---|---|---|
| 1 Pak Rudi: MU 301 x12, mau tambah MU 200 x4 | harga → tawaran → ongkir (Management: pick up, Rp 94.700) → rincian → proforma → invoice + kurir → rekening | Rp 1.878.700 | cocok (flag `nominal_lebih` karena tebakan tagihan salah, lihat T4) |
| 2 Bu Sari: Semen Jakarta 10 sak, tolak tawaran | idem (ongkir Rp 161.800) | Rp 611.800 | cocok |
| 3 Mas Andi: Penguin TB110 1050L, tolak tawaran | idem (ongkir Rp 149.700) | Rp 2.768.700 | tidak cocok, `nominal_kurang` (transfer Rp 2.718.700); Finance konfirmasi, Agnes minta kekurangan Rp 50.000 |

Lulus: harga semua cocok DealPOS (B5 toren TB110 kini ketemu); ongkir kendaraan ditentukan Management lalu dihitung; hitungan AI yang salah dibetulkan alat (`koreksi`); cross-sell satu kali dan tidak diulang setelah ditolak; proforma → persetujuan → permintaan nama/HP penerima → invoice + order Lalamove; rekening hanya dari data; foto bukti dibaca, tidak pernah dinyatakan lunas, Finance ditanya dan jawabannya diteruskan.

## Cacat yang ditemukan (urut prioritas)

1. **Kode barang di `buat_proforma` meleset (putaran 1: gagal 3 dari 3 kasus).** Agnes menulis "MU-301", "Toren Penguin 1050L", "UNKNOWN" → `barang_tidak_dikenal`. Akibatnya Agnes bilang ke customer "kode barang tidak ada di daftar harga", berkali-kali tanya kode ke Management, dan akhirnya memberi rekening tanpa proforma/invoice (di kasus 3 buntu 6 giliran). Putaran 2 lolos hanya karena AI menulis nama persis. Perbaikan: `resolveItems` harus mencocokkan nama fuzzy/longgar (atau memakai kode dari hasil `cek_harga` di giliran yang sama), dan jangan pernah menyuruh Agnes tanya kode ke Management.
2. **Harga di `susun_rincian` tidak dicocokkan dengan daftar.** Toren yang disebut Rp 2.619.000 muncul di rincian Rp 1.750.000 (putaran 1) dan lolos. Samakan dengan `harga_beda` di proforma: harga satuan rincian harus sama dengan hasil `cek_harga`.
3. **"Ongkir: GRATIS" muncul sendiri** (AI mengisi `ongkir: 0`; kasus 1 putaran 1). Tanpa promo dan tanpa `cek_ongkir`, nol harus ditolak.
4. **Tebakan total tagihan di pemeriksa bukti salah** (`guessExpectedAmount` membaca "Total produk", bukan GRAND TOTAL; kasus 1 putaran 2 → flag `nominal_lebih`). Utamakan angka invoice/proforma terakhir, baru teks chat.
5. **Jawaban Management "motor ga muat, pakai pick up" ditolak** `vehicle_lebih_dari_satu` (disebut dua kendaraan). Putaran 1 kasus 2 buntu karenanya: balasan Agnes jatuh ke angka ongkir karangan customer. Perlu aturan "kendaraan yang dipilih = yang terakhir/tanpa 'tidak'", atau minta Management memilih ulang dan AI tidak boleh memakai angka ongkir dari customer.
6. **Label kendaraan Inggris bocor ke proforma:** "PICK_UP_TRUCK (Ideal for large goods with special handling & mover)". Pakai nama Indonesia ("Pick-up").
7. **Sebelum customer transfer, invoice sudah memesan kurir Lalamove.** Perlu keputusan Hanny: kurir dipesan saat invoice, atau setelah Finance mengonfirmasi dana masuk.
8. Kecil: Agnes kadang menjawab "Baik kak, saya pastikan dulu" padahal tak ada pertanyaan baru; menanyakan stok ke Management di giliran pertama bila "ada"-nya tak perlu (kasus 2 putaran 2); `nama_penerima` proforma jatuh ke "Customer 62813..." bila belum diberi nama.

## Belum bisa di produksi (prasyarat)
`ai_orders_enabled` + outlet/tag/pajak DealPOS; Lalamove production + pickup contact Cisauk; kunci uji Lalamove asli; notifikasi serah-terima (nomor kosong); fix kode barang (butir 1) wajib sebelum saklar pesanan AI dinyalakan.

---

# Putaran 2 (29 Okt, sore): perbaikan 5 aturan Hanny + cacat putaran 1

Dikerjakan di worktree `.claude/worktrees/agnes-flow` (branch `fix/agnes-flow`, dari main 2d01f1f), BELUM commit. Screenshot: `docs/simulasi-agnes-29okt/putaran2/`. **Beda dari putaran 1: tarif dan order Lalamove adalah panggilan ASLI ke sandbox Lalamove (kunci sandbox ESBEJE), bukan tarif tiruan.** DealPOS tulis dokumen tetap ditiru.

## 5 aturan dari Hanny
1. **Harga cek DealPOS dulu, tanya Management hanya bila tak yakin.** Playbook + GUIDE `cek_harga`; kode barang tak lagi ditanyakan ke Management.
2. **Ongkir cukup Lalamove, tanpa penjelasan kendaraan, tanpa angka palsu.** Teks "kendaraan cocok buat apa" dibuang dari playbook/GUIDE; label rincian/proforma jadi `Ongkir (Lalamove)`; `susun_rincian` menolak ongkir yang tak berasal dari `cek_ongkir` di chat itu (ingatan per chat `src/chat-memory.js`); proforma memakai kendaraan dan angka yang sama dengan rincian. Kendaraan dipilih KODE dari berat di nama barang ("40KG" x jumlah), dengan pilihan model dibatasi pick-up; area tak dilayani satu kendaraan otomatis mencoba yang lebih besar.
3. **Alamat: format WhatsApp** "Alamat lengkap / Kelurahan / Kabupaten / Kota / Provinsi" (playbook + `normalizeFormatted` + pencarian bertahap). Proforma menerima alamat ketikan (≥3 bagian) sebagai tujuan kurir; "Kembangan, Jakarta Barat" saja ditolak.
4. **Warna/varian langsung disebut semua + harga** (GUIDE `cek_harga`); rincian/proforma menolak varian yang belum dipilih (`varian_ambigu`).
5. **UOM dari DealPOS** (`satuan` di hasil `cek_harga`, dipaksa di rincian/proforma): zak, pcs, bukan tebakan sak/unit/kardus.

## Cacat putaran 1 yang ditutup
Kode barang proforma (pencocokan longgar dijaga harga + barang yang sudah ditunjukkan + field `nama`); harga rincian dicocokkan ke DealPOS; ongkir GRATIS karangan; tebakan tagihan bukti transfer ("Total produk" diabaikan); jawaban Management "motor ga muat, pakai pick up" dibaca benar; label kendaraan Inggris; nama penerima "kak".

## Hasil (3 kasus, model asli + Lalamove sandbox asli)
| Kasus | Hasil |
|---|---|
| 1 MU 301 x12 + MU 200 x4 | harga zak, alamat format, ongkir TRUCK175 Rp 74.700 (pick-up ditolak sandbox → naik kendaraan), rincian = proforma = invoice Rp 1.858.700, bukti cocok |
| 2 Semen Jakarta x10 (tolak tawaran) | VAN Rp 130.400 (400 kg), total Rp 580.400, proforma → invoice, bukti cocok, Finance konfirmasi |
| 3 Toren TB110 (6 pilihan warna ditampilkan langsung) | total Rp 2.728.800 konsisten, bukti kurang Rp 50.000 → ditandai tidak cocok, Finance menjawab, Agnes minta kekurangan |

Tes: `test/agnes-flow.test.js` (13 baru) + penyesuaian tes lama; `npm test` penuh dengan DB + `CREDENTIALS_ENCRYPTION_KEY`: 1272 lulus.

## Masih terbuka
1. **Order kurir Lalamove sandbox ditolak HTTP 402 "saldo tidak cukup" (top-up wallet sandbox)**: jalur "invoice sebagian, tim pesan manual" teruji, order sukses belum.
2. **Agnes sekali menyebut harga karangan** (MU 301 "Rp 62.000", asli 104.000; kasus 2 putaran 5): penjaga harga hanya memeriksa angka ada di prompt, bukan milik barang yang disebut.
3. **Penjaga "tidak yakin" (main 2d01f1f) kadang positif palsu** ("mungkin" memicu tanya Management) dan bisa membuat Agnes macet di "ditunggu" bila jawaban Management tak relevan.
4. Gemini kadang membalas kosong setelah alat (balasan darurat "teruskan konteks ke tim").
5. Produksi ESBEJE: Lalamove masih sandbox (alat ongkir tidak hidup di chat nyata), `vehicle_mode` masih `management` (setel `ai` di UI Integrasi bila mau tanpa tanya Management), saklar pesanan AI + outlet/tag/pajak DealPOS, kontak Cisauk Store, rekening sudah ada.
6. Alamat ketikan memakai pencarian OpenStreetMap: titik bisa meleset; kurir tetap menelepon penerima. Pantau di produksi.
