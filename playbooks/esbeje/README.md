# Playbook ESBEJE

Disusun 23 Oktober 2026 dari daftar produk bestseller dan SOP CS manual ESBEJE (foto papan "Daily Report"). ESBEJE dulu bernama Super Bangun Jaya (SBJ), toko bahan bangunan.

## Isi

| File | Cakupan |
| --- | --- |
| `umum.md` | Semua delapan jenis dokumen. Tidak dipecah per produk. |
| `produk.json` | Company `esbeje`, tanpa produk. |

## Kenapa tidak dipecah per produk

Di Agnee, produk yang sudah tertebak menempel ke chat. Kalau customer pindah produk, AI minta izin dulu. Customer toko bangunan biasa memesan banyak barang sekaligus (semen, pipa, cat), jadi playbook dibuat satu. Produknya dikelompokkan per tahap pembangunan.

## Dari SOP ke playbook

| SOP manual | Di Agnee |
| --- | --- |
| Tanya lokasi customer | Menggali kebutuhan, langkah 1 |
| Tanya progres pembangunan (6 tahap) | Menggali kebutuhan, langkah 2, lalu tawarkan barang tahap berikutnya |
| Tanya kebutuhan VK/VB | Menggali kebutuhan, langkah 3. VK = volume kecil, VB = volume besar |
| VB di atas 5 jt: grup online, SPV, Head MD, Pak John | Serah terima ke tim |
| Akhiri chat dengan pertanyaan | Persona |
| Jangan kalimat negatif (indent, barang kosong) | Larangan, dengan kalimat pengganti |
| 1 hari 1 closing 1 orang | Penutupan. Kolom Closing di Pipeline terisi otomatis oleh AI |
| Sesi 06.45 sampai 21.00 | Persona (jam layanan) |

## Harus disiapkan di company ESBEJE sebelum dipakai

1. **Departemen `Gudang` dan `Keuangan`** (Pengaturan, Tim). Playbook menyuruh AI bertanya stok ke Gudang dan cek transfer ke Keuangan. Penerimanya bisa orang, grup WhatsApp, atau keduanya. Nomor WhatsApp ESBEJE harus sudah masuk grupnya.
2. **Integrasi DealPOS di company ESBEJE.** Per 23 Oktober, koneksi `esbeje.dealpos.co.id` terpasang di company Beweix Digital, bukan ESBEJE. Harga untuk AI dibaca dari koneksi milik company yang sedang membalas.
3. **Nomor WhatsApp** ESBEJE masih `waiting_for_qr`.

## Memuat

```bash
node scripts/load-playbooks.js playbooks/esbeje          # simulasi
node scripts/load-playbooks.js playbooks/esbeje --apply  # menulis
```

Di produksi, pakai perintah `docker compose run` di README Beweix (`playbooks/beweix-digital/README.md`).

## Belum dikonfirmasi pemilik

- Pemetaan tahap ke produk (mis. toren di tahap atap, pipa di pondasi dan finishing).
- Nama persona. Sekarang "admin penjualan ESBEJE" tanpa nama.
- Ejaan merek toren "Mpoin".
- Area kirim, rekening, dan aturan ongkir. Playbook menyerahkan semuanya ke tim.
