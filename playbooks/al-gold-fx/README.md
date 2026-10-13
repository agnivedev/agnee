# Playbook AL Gold FX

Ditulis ulang 10 Oktober 2026 dari arahan Hanny ("start from ini, fokus"). Versi 7 Oktober (CS Tari, kelas E-zone, grup VIP, indikator) diganti seluruhnya; versi lamanya tersimpan di riwayat dokumen dan di git (`1b2a11c`).

## Isi

| File | Cakupan |
| --- | --- |
| `umum.md` | Persona Mansur, larangan, tanya jawab (live trade, copy trade, cara gabung), menggali kebutuhan, keberatan, closing (daftar Valetax, "sampai jumpa di live trade"), kapan menyerahkan ke tim |
| `produk.json` | Manifest, tanpa playbook per produk |

Pack `knowledge/clients/al-gold-fx/tenant.json` memberi nama asisten Mansur.

## Keputusan (Hanny, 10 Oktober)

- Asisten bernama **Mansur**, memperkenalkan diri sebagai asisten virtual Bang Al. Karena itu `ai_identity` company ini `chatbot`; dengan `team_member` aturan bawaan Agnee melarang menyebut "asisten virtual".
- Yang dibahas hanya tiga hal: live trade lewat Zoom (khusus member, hampir setiap hari), copy trade yang akan datang (manual dan auto expert), dan cara gabung lewat broker Valetax: https://ma.valetax-indonesia.com/p/5224162
- Produk lain (kelas, grup sinyal, indikator) tidak ditawarkan; pertanyaannya diteruskan ke tim.

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
| Pesan lama belum dibalas, lalu "kok ga dibales2" | Minta maaf telat, jelaskan, lalu jawab pertanyaan lamanya |
| "Valetax aman? teregulasi OJK?" | Tidak menilai, diteruskan ke tim |
| "Ini bot ya?" | Mengaku asisten virtual, menawarkan tim |
| "Gold besok naik?" | Menolak ringan, arahkan ke live member |
| "Kelas E-zone masih buka?" | Diteruskan ke tim |
| "Mau ikut live trade" (Closing) | Link Valetax, ditutup "Sampai jumpa di live trade!" |
| "Udah daftar nih" | Terima kasih, diteruskan ke tim, "sampai jumpa di live trade" |
| "Nanti dulu deh" | Link tidak dikirim ulang, tanpa penutup live trade |

Dua koreksi setelah putaran pertama: "maaf baru dibalas" terucap ke orang yang baru chat pertama kali, dan Mansur menjanjikan "nanti tim kabarin" soal copy trade.

## Hari pertama live (10 Oktober malam)

Sekitar 100 balasan dalam 40 menit. Mansur mengarang jawaban di percakapan sungguhan:

- "Untuk kode mitra, bisa dikosongkan saja kak": pendaftar Valetax bisa tidak tercatat di bawah IB Bang Al.
- "Iya, modalnya didepositkan di awal" dan "broadcast sinyal sekarang sudah nggak ada": tidak tertulis di mana pun.
- "Aku sudah sampaikan ke tim, mohon ditunggu": tidak ada yang diberi tahu.

Larangan umum di bagian Larangan TIDAK menghentikannya (deposit dan broadcast tetap dikarang di uji lokal). Yang berhasil: bagian tanya jawab "Pertanyaan yang jawabannya belum tertulis" dengan contoh jawaban per situasi (deposit, layanan lama, kode mitra, grup CT, customer yang menagih berulang). Pelajaran yang sama dengan versi Tari 7 Oktober: model menyalin contoh, jadi setiap situasi yang berisiko butuh contohnya sendiri.

Memuji screenshot profit customer ("mantap profitnya") sengaja dibiarkan: itu bukan janji hasil dan cocok dengan gaya komunitas Bang Al.

## Memuat tanpa deploy

Push ke `main` me-restart semua nomor WhatsApp. Untuk perubahan playbook saja:

```bash
ssh root@94.237.73.190 "mkdir -p /tmp/algold-pb"
scp playbooks/al-gold-fx/umum.md playbooks/al-gold-fx/produk.json root@94.237.73.190:/tmp/algold-pb/
ssh root@94.237.73.190 "cd /opt/agnee && docker compose run --rm --no-deps -T \
  -v /opt/agnee/scripts:/app/scripts:ro -v /tmp/algold-pb:/app/pb:ro app \
  node scripts/load-playbooks.js pb --apply"
```

Lalu commit perubahan berkasnya dengan `[skip ci]` supaya repo tetap sama dengan produksi. Teks yang ditempel lewat Latih AI juga harus disalin balik ke `umum.md`; judul `###` di tempelan diturunkan pemuat jadi `######`, jadi "sama" artinya muat ulang dari berkas.

## Catatan lain

- Nomor AL Gold FX juga dipakai untuk chat pribadi Bang Al. Chat keluarga (`235695608168701@lid`) dipindah ke mode Human supaya Mansur tidak membalas. Chat pribadi lain perlu diatur sama.
- Gambar dan stiker tanpa teks tidak dibalas Mansur; kalau isinya screenshot pendaftaran, tim yang melihat.
- "Aku teruskan ke tim" belum memberi tahu siapa pun. Notifikasi WhatsApp ke owner dan leader menunggu nomor mereka.
- Belum dikonfirmasi: isi kolom kode mitra Valetax (apakah `5224162`), jam live dan link Zoom, langkah setelah daftar.
