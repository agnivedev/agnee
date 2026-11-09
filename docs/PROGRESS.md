# Progress dan Outstanding Agnee (ESBEJE / Agnes)

Diperbarui 10 Nov 2026. Mencatat sesi utama dan semua sub sesi sejak 28 Okt.
Detail teknis per perubahan ada di [`../CHANGELOG.md`](../CHANGELOG.md); catatan
per fitur ada di memori proyek.

## Selesai dan LIVE

| Tanggal | Pekerjaan | Commit / bukti |
|---|---|---|
| 28 Okt | Ongkir: kendaraan Lalamove ditentukan Management (migrasi 100) | 6a3f8b2 |
| 28 Okt | AI belajar dari jawaban departemen (grup/web), migrasi 101, saklar belum dinyalakan | 9967fa8 (run 40684115105) |
| 29 Okt | Penjaga "AI tidak menebak" (produk/order/transfer/ongkir): tanya customer, departemen, atau staf; saklar per company, migrasi 102. Dikerjakan sub sesi `confidence-rendah` | 2d01f1f |
| 29 Okt | Kurir dipesan saat staf menerima bukti transfer, bukan saat invoice | 72f8353 |
| 4 Nov | Simulasi customer ESBEJE (2 skenario: satu produk sampai transfer; tiga produk ambil sendiri) lewat `/v1/coach/simulate`. Temuan: janji kosong ("saya cek dulu" tanpa tindakan), bukti transfer yang tak pernah masuk dianggap ada, "sudah diproses" tanpa pesanan | 836f5ca |
| 4 Nov | Saat AI ragu, balasan ditutup "Segera kami get back ke kakak ya" dan pertanyaan dirutekan: transfer ke Finance, stok ke Gudang, ongkir dan waktu kirim ke Logistik lalu Management, diskon ke Management lalu Sales, lainnya ke Management | cf3e429 (run 41778178061) |
| 4-5 Nov | Perbandingan model untuk ESBEJE. Penyebab Gemini 3.7, Gemini 2.5 Pro, dan Sonnet 5.5 terpotong: batas `max_tokens` 512. Dengan 2000 ketiganya normal. Dokumen dan skrip simulasi masuk repo. Dikerjakan sub sesi `pantau-hasil-perbandingan` | 2ecd175, [HASIL-PERBANDINGAN-MODEL-ESBEJE.md](HASIL-PERBANDINGAN-MODEL-ESBEJE.md) |
| 9 Nov | Audit chat ESBEJE (skor 3,0/5, 0 closing): pagar chat non-customer, relay departemen, `cek_harga` dipastikan LLM, satu pertanyaan per topik, penutupan pertanyaan saudara | a97e8ca (run 42585544692) |
| 10 Nov | Pertanyaan kembar ke grup Management: keluhan staf ("udah dijawab, nanya lagi") bukan jawaban, keluhan menutup pertanyaan kembar yang saudaranya sudah terjawab, barang yang sudah dijawab dalam 3 jam dipakai ulang tanpa bertanya lagi. Disatukan dengan `sameTopic` dari a97e8ca | cabang `fix/dept-dedupe` (lihat status deploy di bawah) |

## Hasil perbandingan model (4 Nov, dua skenario, 15 giliran)

| Model | Biaya | Catatan |
|---|---|---|
| gemini-2.5-flash (bawaan produksi) | | paling sering mengarang harga (MU 200 jadi Rp 105.000, aslinya 134.000) |
| gemini-3.7-flash | $0,21 | harga benar; butuh `max_tokens` > 512 |
| gemini-2.5-pro | $0,35 | butuh `max_tokens` > 512 |
| claude-sonnet-5.5 | $1,35 | jujur, tapi menahan total dan rekening sampai stok pasti (terlalu hati-hati) |
| gpt-5.4-mini | belum terukur | terbaik di putaran pertama: harga tak dikarang, total benar, alur ke transfer paling lurus |
| claude-haiku-4.5 | belum terukur | cadangan yang disarankan |

Putaran ulang berhenti karena kredit OpenRouter hampir habis.

## Perubahan produksi di luar kode (jangan terlewat)

- `LLM_MAX_TOKENS=2000` di `.env` server (sebelumnya 512), aktif untuk semua company.
  Cadangan lama: `.env.bak.pre-maxtokens-20261105`. Batas besar ikut mereservasi
  kredit OpenRouter per permintaan.
- Rantai model ESBEJE (`ai_model_chain`) sempat diubah saat uji lalu dikembalikan
  kosong, jadi ESBEJE memakai model bawaan.
- Push ke main memakai akun `agnivedev`; akun aktif `hannyfx20` ditolak 403.

## Outstanding

Urut prioritas.

1. **Saldo OpenRouter.** Pada 4-5 Nov tinggal sekitar $2,4 (kredit $275, terpakai
   $272,35, pemakaian harian sekitar $2,8). Cek ulang lewat `/api/v1/credits` dari
   container app dan isi sebelum habis; kalau habis, AI semua company berhenti.
2. **Putuskan `LLM_MAX_TOKENS`:** tetap 2000 atau kembali 512 dari cadangan
   (2000 memperbesar reservasi kredit; 512 memotong model thinking).
3. **Putuskan model ESBEJE:** gpt-5.4-mini utama dengan claude-haiku-4.5 cadangan di
   `ai_model_chain`, dipertimbangkan bersama fitur eskalasi model (463be8d,
   [HASIL-RISET-ESKALASI-MODEL.md](HASIL-RISET-ESKALASI-MODEL.md)). Tidak diubah tanpa
   persetujuan.
4. **Simulasi ulang** gpt-5.4-mini dan haiku-4.5 dengan kode final dan sampel lebih
   banyak per model; hitung biaya per model dari `usage.cost` (setelah saldo terisi).
5. **Uji di WhatsApp asli.** Belum pernah diuji: rute departemen "get back",
   penjaga ketidakyakinan, pencegahan pertanyaan kembar, funnel closing ESBEJE.
6. **Alamat toko Cisauk** di Pengaturan > Lokasi (diisi Hanny).
7. **Aturan diskon volume** belum ada: pertanyaan "30 sak bisa lebih murah?" selalu
   dijawab "diputuskan tim".
8. **Harga barang yang tak lewat `cek_harga`** masih dibuang guard dengan kalimat
   kaku; periksa apakah a97e8ca sudah menutupnya.
9. **Rekening ESBEJE** untuk cek bukti transfer, dan order AI/ongkir Lalamove dengan
   kunci asli (masih sandbox), menunggu isian Hanny.
10. **Saklar belajar dari departemen/chat** belum dinyalakan; belum diuji dengan model
    asli.
11. **Berkas WIP tak terlacak** di checkout utama (skrip `scripts/esbeje-*.sh`,
    `scripts/setup-esbeje-sisa.sh`, `docs/simulasi-agnes-29okt/`, dll.) dan stash
    `WIP on main` milik sesi lain: periksa dan putuskan.
12. Putaran sub sesi `belajar-dari-grup` dan `confidence-rendah` sudah selesai dan
    idle; cabang `claude/ai-confidence-rendah-ae9696` dan
    `claude/belajar-dari-jawaban-grup-790b41` tidak perlu digabung (isinya sudah di main).
