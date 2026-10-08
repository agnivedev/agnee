# Knowledge Source (KS)

Paket template percakapan yang bisa dipasang ke sebuah company, seperti skill. Satu paket membawa tiga hal:

- **General Knowledge (GK)**: SOP yang sama untuk semua pemakai. Nada bicara, alur percakapan, batas yang tidak boleh dilanggar.
- **Specific Knowledge (SK)**: data usaha pemakai, diisi lewat skema yang ditentukan paket. Kategori bawaan Agnee adalah produk/jasa sebagai tangga penawaran.
- **Simulasi**: skenario customer berskrip dan pemeriksa hasilnya, ikut di dalam paket.

Keputusan Hanny, 8 Oktober 2026: tingkat penawaran berikutnya **ditentukan AI** lewat prompt, bukan mesin status di kode. Konsekuensinya, pagar utamanya adalah simulasi: paket tidak boleh dipakai sebelum lolos skenarionya, dan skenario dijalankan ulang setiap kali paket, isian, atau model berubah.

## Pembagian tugas

| | Expertz (`expertz.agnive.co`) | Agnee |
|---|---|---|
| Katalog paket dan versinya | simpan dan layani lewat API/MCP | ambil lewat API/MCP |
| Isian SK per company | tidak pernah menerimanya | simpan di database Agnee |
| Paket yang terpasang | - | simpan salinan (snapshot) per company |
| Simulasi | menyimpan skenario sebagai bagian paket | menjalankan dan menyimpan hasilnya |
| UI | pembuatan dan penerbitan paket | pasang, isi SK, jalankan simulasi |

Dua alasan pembagian ini. Data usaha pemakai (harga, syarat, cara memesan) tidak boleh keluar dari Agnee. Dan balasan ke customer tidak boleh bergantung pada Expertz yang sedang mati, jadi paket terpasang disimpan sebagai salinan lokal dan versinya dipin.

Aplikasi lain bisa memakai katalog yang sama lewat API/MCP Expertz. Sumber paket di Agnee dibuat bisa diganti: folder lokal (`knowledge/ks/`) untuk pengembangan dan paket bawaan, Expertz untuk katalog.

## Format paket

```
ks-funneling-closing/
  ks.json                 code, name, version (x.y.z), kind, language, summary, daftar berkas
  general/*.md            GK, disusun ke prompt sesuai urutan di ks.json
  specific.json           skema isian SK
  examples/*.json         contoh isian, harus lolos skema (diperiksa saat paket dimuat)
  simulation/scenarios.json
```

Pemuat (`src/ks-package.js`) menolak paket yang rusak, tidak menebak: kode bukan pola `ks-...`, versi bukan `x.y.z`, berkas di luar folder, contoh isian yang tidak lolos skemanya, jenis cek simulasi yang tidak dikenal.

### Skema SK

Kategori bertipe `list` (dengan `min`, `max`, `rules`) atau `object`. Jenis field: `text`, `money` (bilangan bulat rupiah), `enum`, `url`. Field boleh `required` atau `requiredWhen`.

Aturan bernama untuk daftar penawaran:

- `paid_descending`: harga berbayar makin murah ke bawah.
- `free_last`: produk gratis bersyarat paling banyak satu dan di tingkat terakhir.

Tingkat dinomori dari 1 sesuai urutan daftar. Tingkat 1 ditawarkan lebih dulu.

### Simulasi

Customer berskrip. Giliran bertanda `waitForTier` atau `refuses` baru dikirim setelah AI menyebut tingkat itu, dengan kalimat pengisi paling banyak `maxFillers` kali. Jenis cek:

| Cek | Lulus kalau |
|---|---|
| `offer_mentioned_by` | tingkat N sudah disebut paling lambat di balasan ke-K |
| `offer_not_mentioned` | tingkat N tidak pernah disebut |
| `offer_order_ascending` | tingkat muncul berurutan, tidak melompat, satu per balasan |
| `no_repeat_after_refusal` | tingkat yang ditolak tidak diulang, harganya tidak diulang di balasan penolakan |
| `only_known_amounts` | semua angka rupiah di balasan ada di data penawaran |
| `only_known_references` | semua link dan @akun di balasan ada di data penawaran atau ditulis customer sendiri |
| `ends_without_chasing` | balasan terakhir tanpa pertanyaan, harga, atau link |
| `rubric` | kriteria bahasa bebas, dinilai model; dilewati kalau tidak ada penilai |

Sebuah tingkat dianggap "disebut" kalau balasan memuat namanya atau harganya.

## Status

Sudah ada:

- Format paket, pemuat dan pemeriksa, validasi isian SK, penyusun prompt, pemain skenario dan semua cek, paket KS-01 Funneling Closing (6 skenario).
- Tabel `ks_installs` (migrasi 048) dan rute `/v1/ks/*`: katalog, pasang, simpan isian, simulasi (berjalan di latar belakang, kemajuannya bisa dibaca), aktifkan, lepas. Hanya supervisor.
- Gerbang aktivasi: isian lengkap, dan simulasi terakhir lulus untuk isian yang sekarang. Mengubah isian mematikan paket dan membuang hasil simulasinya.
- Paket aktif masuk prompt balasan nyata (`buildReplyContext`) dengan jendela riwayat lebih panjang (12 pesan, bukan 5). Kalau KS dan playbook company bertentangan soal urutan penawaran, template yang menang; persona, larangan, dan fakta playbook tetap berlaku.
- Simulasi memakai jalur balasan yang sama dengan produksi (konteks company, kontrak keluaran, batas link) dan penilai `rubric` berbasis model.

Hasil dengan model sungguhan (`google/gemini-2.5-flash`, 8 Oktober 2026): 4 dari 4 putaran lulus 6 dari 6 skenario, setelah dokumen alur dan larangan diperketat dua kali. Putaran pertama menangkap garansi "30 hari" yang dikarang, akun Instagram yang salah satu huruf, dan melompat ke tingkat 2. Catatan jujur: dokumen disetel terhadap skenario yang sama, jadi lulusnya belum membuktikan chat nyata. Satu model, empat putaran.

Belum ada:

1. Layar di web untuk pasang, isi SK, dan lihat hasil simulasi.
2. Sisi Expertz: backend Node (diputuskan 8 Oktober) dengan API/MCP katalog, lalu sumber `expertz` di `src/ks-source.js`. Sanitasi isi paket dari pihak ketiga wajib ada sebelum paket dari luar boleh masuk prompt.
3. Template lain: KS-02 B2B Closing barang, KS-C1 dan KS-C2 Complain.
4. Penjaga di jalur balasan nyata untuk link dan @akun yang tidak ada di data company. Sekarang hanya simulasi yang menangkapnya; satu huruf salah pada akun terlihat sekali di simulasi.
5. Simulasi dijalankan ulang otomatis kalau model company diganti.
