# Daftar gambar product profile

Semua file ada di `img/`. Halaman: `product-profile.html`, cetakan: `agnee-product-profile.pdf` (satu halaman panjang, lebar A4).

## Screenshot app asli (data dummy)

Diambil dari app Agnee yang dijalankan lokal dengan `WA_DEMO_MODE=true`, database kosong baru, company fiktif "Kopi Senja". Semua nama, nomor (`+62 812 0000 01xx`, bukan nomor nyata), percakapan, dan playbook dibuat untuk keperluan ini. Tidak ada data Beweix, kredensial, atau pelanggan nyata. Kata sandi akun dummy tidak tampil di gambar.

| File | Isi |
| --- | --- |
| `app-inbox.png` | Kotak masuk, percakapan dengan skor minat 95 dan balasan AI/staf |
| `app-intent.png` | Potongan panel lead dari `app-inbox.png` (skor + alasan) |
| `app-pipeline.png` | Kanban CRM, dipangkas ke bagian atas |
| `app-dept.png` | Pertanyaan AI ke departemen + daftar departemen |
| `app-train.png` | Halaman Latih AI dengan playbook dummy |
| `app-leads.png` | Lead List dengan tombol Unduh XLSX/CSV (dipangkas) |
| `app-mcp.png` | Kartu MCP di Setting (alamat server publik produk, bukan rahasia) |

## Buatan AI

| File | Isi |
| --- | --- |
| `ai-barista.png` | Foto barista perempuan membaca ponsel. Dibuat dengan model `gpt_image_2_5` lewat alat image generation. Hanya ilustrasi, diberi label "Foto AI" di halaman, tidak dipasang sebagai testimoni atau pelanggan. |

Rencana awal tiga foto, tetapi saldo kredit image generation habis setelah foto pertama, jadi hanya satu.

## Cara membuat ulang

Skrip yang dipakai (server demo dengan dataset dummy, seed SQL, tangkap layar puppeteer) tidak di-commit karena memuat salinan lokal `src/server.js` yang diubah hanya untuk demo. Rangkuman: buat database kosong, jalankan app dengan `WA_STARTUP_ENABLED=false WA_DEMO_MODE=true`, buat company dengan `scripts/create-company-user.js`, isi `lead_states`, `conversation_summaries`, `departments`, `department_questions`, `playbook_docs`, lalu tangkap layar 1440x900 @2x.
