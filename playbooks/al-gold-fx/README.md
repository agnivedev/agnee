# Playbook AL Gold FX

Ditulis ulang 10 Oktober 2026 dari arahan Hanny ("start from ini, fokus"). Versi 7 Oktober (CS Tari, kelas E-zone, grup VIP, indikator) diganti seluruhnya; versi lamanya tersimpan di riwayat dokumen dan di git (`1b2a11c`).

## Isi

| File | Cakupan |
| --- | --- |
| `umum.md` | Persona Mansur, larangan, tanya jawab (live trade, copy trade, cara gabung, catatan sementara Bang Al sakit), menggali kebutuhan, keberatan, kapan menyerahkan ke tim |
| `produk.json` | Manifest, tanpa playbook per produk |

Pack `knowledge/clients/al-gold-fx/tenant.json` memberi nama asisten Mansur.

## Keputusan (Hanny, 10 Oktober)

- Asisten bernama **Mansur**, memperkenalkan diri sebagai asisten virtual Bang Al. Karena itu `ai_identity` company ini `chatbot`; dengan `team_member` aturan bawaan Agnee melarang menyebut "asisten virtual".
- Yang dibahas hanya tiga hal: live trade lewat Zoom (khusus member, hampir setiap hari), copy trade yang akan datang (manual dan auto expert), dan cara gabung lewat broker Valetax: https://ma.valetax-indonesia.com/p/5224162
- Produk lain (kelas, grup sinyal, indikator) tidak ditawarkan; pertanyaannya diteruskan ke tim.

## SEMENTARA, hapus setelah Bang Al aktif lagi

Bagian "SEMENTARA: Bang Al sedang sakit" di tanya jawab: Bang Al dirawat di rumah sakit seminggu sampai 10 Oktober, live trade mulai Senin 12 Oktober 2026. Tanggalnya ditulis lengkap supaya kalimatnya tidak bergeser maknanya setelah hari Senin lewat. Setelah live jalan lagi, hapus bagian itu dan muat ulang.

## Belum tertulis (Mansur meneruskan ke tim)

Jam live dan link Zoom, langkah setelah daftar Valetax (deposit, masuk grup, akses Zoom), deposit minimal, regulasi broker, tanggal dan harga copy trade.

## Memuat

```bash
node scripts/load-playbooks.js playbooks/al-gold-fx          # simulasi
node scripts/load-playbooks.js playbooks/al-gold-fx --apply  # menulis
```

## Hasil uji 10 Oktober (lokal, model sungguhan, simulator Coach)

| Pesan customer | Hasil |
| --- | --- |
| "Halo" | "aku Mansur, asisten virtual Bang Al", tanya live trade, copy trade, atau cara gabung |
| "Gimana cara gabung?" | Link Valetax di pesan yang sama, lalu kabari tim setelah daftar |
| "Live jam berapa, link Zoom?" | Khusus member, jam dan link dari tim, plus cara gabung |
| "Copy trade kapan, bayar berapa?" | Manual dan auto expert, belum ada tanggal dan biaya |
| "Bang Al kemana seminggu ini?" | Sakit dan dirawat, live lagi Senin 12 Oktober, tanpa candaan |
| Pesan lama belum dibalas, lalu "kok ga dibales2" | Minta maaf telat, jelaskan, lalu jawab pertanyaan lamanya |
| "Valetax aman? teregulasi OJK?" | Tidak menilai, diteruskan ke tim |
| "Ini bot ya?" | Mengaku asisten virtual, menawarkan tim |
| "Gold besok naik?" | Menolak ringan, arahkan ke live member |
| "Kelas E-zone masih buka?" | Diteruskan ke tim |

Dua koreksi setelah putaran pertama: "maaf baru dibalas" terucap ke orang yang baru chat pertama kali, dan Mansur menjanjikan "nanti tim kabarin" soal copy trade.
