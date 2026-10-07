# DESIGN.md — Agnee

Arah desain ini **bukan ditemukan**, melainkan dibaca dari yang sudah berjalan di
`web/src/index.css` dan `web/src/features/landing/LandingPage.tsx`. Ditulis
2026-10-07 supaya sesi berikutnya tidak menebak-nebak.

## Identitas

Agnee menangani percakapan WhatsApp pelanggan untuk perusahaan, dan menopang CS
yang menanganinya. Pembacanya dua lapis: pemilik yang menandatangani, dan CS
yang membalas chat tiap hari. Copy selalu ditulis untuk keduanya, dan sisi CS
yang ditulis lebih hangat.

## Karakter

Tenang dan blak-blakan. Bukan korporat, bukan hype. Bahasa Indonesia kasual
("ga", "udah", "ngetik"), sapaan "kamu", tanpa "Anda". Istilah yang sengaja
dipertahankan dalam English: `Funnel`, `Lead`, `Qualified`.

## Palet

Dua warna inti, satu aksen. Netral tidak dihitung.

| Token | Terang | Gelap | Dipakai untuk |
|---|---|---|---|
| Inti 1 | `#14241f` (ink) | `#f4f9f0` | Teks utama, latar band gelap |
| Inti 2 | `#4e6e5e` | `#7aaa8a` | Teks isi, keterangan |
| Aksen | `#087d4c` (green-dark) | `#7fff4f` (lime) | Eyebrow, penanda, satu CTA kunci |
| Latar | `#eef5eb` | `#0c1912` | Latar halaman |
| Panel | `#ffffff` | `#14241f` | Kartu |
| Garis | `#c6dcc0` | `#24403a` | Pembatas |
| WhatsApp | `#25d366` | sama | **Hanya** tombol yang benar-benar membuka WhatsApp |

`#25d366` bukan warna merek Agnee. Dia dipakai sebagai penanda kanal: kalau
tombolnya hijau WhatsApp, tombol itu memang membuka WhatsApp. Jangan dipakai
untuk hal lain.

## Tipografi

- Teks: **DM Sans**. Dipilih karena bentuk hurufnya terbuka dan terbaca di
  ukuran kecil, dan tidak terbaca sebagai font bawaan AI.
- Mono: **IBM Plex Mono**. Hanya untuk penanda kecil, angka urut, dan label
  kategori. Tidak pernah untuk judul besar.
- Judul rapat (`tracking-[-.035em]` sampai `-.05em`), teks isi normal.

## Radius

`--radius-app: 14px` untuk tombol dan input, `--radius-panel: 18px` untuk kartu
dan band. Pil penuh (`rounded-full`) hanya untuk badge dan angka urut bulat.
Variasi radius ini adalah penanda hierarki, bukan hiasan.

## Dial

`Dial: ENERGY 2 / RHYTHM 2 / MOTION 1`

- **ENERGY 2** — halaman ini menjual, jadi dia harus menyapa. Tapi pembelinya
  pemilik usaha yang sedang menilai kepercayaan, bukan juri Awwwards.
- **RHYTHM 2** — konsisten, dengan beberapa patahan yang disengaja: band gelap,
  kartu umpan berbingkai, grid 15 kartu.
- **MOTION 1** — hanya hover dan transisi. Tidak ada scroll-reveal, parallax,
  atau koreografi. Alasannya: halaman ini panjang dan dibaca di ponsel dengan
  koneksi apa adanya.

## Motif identitas

Dua sisi. Hampir tiap fitur dijual dua kali: **"Buat perusahaan"** dan **"Buat
tim CS"**, dengan kartu sisi CS selalu memakai aksen. Ini yang membedakan Agnee
dari copy SaaS CS biasa, dan dia diulang supaya terbaca sebagai pendirian,
bukan kebetulan.

## Aturan jujur (tidak bisa ditawar)

Nada boleh berlebihan. Klaim yang bisa dibuktikan salah tidak boleh.

- Tiap angka di halaman harus punya baris kodenya. Kalau tidak ketemu, angkanya
  tidak ditulis.
- Tidak ada testimoni karangan, nama karangan, atau angka hasil karangan.
- Tidak ada hitung mundur palsu. Kalau ada batas, batas itu ditepati.
- Plafon di kartu harga harus sama dengan yang diberlakukan `src/database.js`.
