# Riset model eskalasi ESBEJE (Agnes): 4 Nov 2026

## Apa itu eskalasi
Model utama (gemini-2.5-flash) menjawab dulu. Kalau penjaga menilai jawabannya bermasalah, giliran yang sama diulang dengan model eskalasi (`src/escalation.js`, `generateWithEscalation` di `src/server.js`). Ini berbeda dari `ai_model_chain`, yang hanya pindah model saat panggilan error.

- **Pemicu:** harga, rekening, atau klaim karangan; klaim uang sudah masuk; pesanan diproses tanpa pesanan; transfer tanpa bukti; hedging di kalimat berisiko; kontrak keluaran harus menulis ulang; panggilan alat bocor sebagai teks; model utama tidak membalas.
- **Bukan pemicu:** `tool_no_result` (datanya memang tidak ada) dan `empty_promise`. Pada putaran pertama `empty_promise` memicu sekitar 50% giliran, dan model kuat tetap menghasilkannya.
- **Tidak jalan kalau** alat pesanan, kurir, atau tanya departemen sudah dipanggil, supaya tidak dobel. Juga tidak jalan untuk template KS dan mode internal_ops.
- **Default hidup** dengan `anthropic/claude-haiku-5.5,openai/gpt-5.4-mini`. `AI_ESCALATION_CHAIN=off` mematikannya. Dalam eskalasi, jatah token dinaikkan ke 2000.

## Cara uji
Data ESBEJE sungguhan lewat `/v1/coach/simulate` di container sekali pakai di server produksi. Login palsu dan pencatatan simulasi dimatikan di memori proses.
- Putaran 1 dan 2 masih mencatat pemakaian ke `ai_usage_logs` ESBEJE (purpose `simulate`). Credit tidak terpotong karena `credit_mode` ESBEJE mati.
- Bagian A tidak mencatat apa pun.

## Hasil

### Alur eskalasi (gemini-2.5-flash → model eskalasi, 22 giliran, 1 putaran)
| Eskalasi ke | Giliran dieskalasi | Hasil eskalasi dipakai | Biaya 22 giliran |
|---|---|---|---|
| gpt-5.4-mini (pemicu lama) | 11 | 11 | $0,104 |
| gpt-5.4-mini (pemicu baru) | 4 | 4 | $0,046 |
| claude-haiku-4.5 (pemicu baru) | 4 | 2 | $0,174 |

Temuan: gpt-5.4-mini pernah mengirim `{"tool":"functions.cek_alamat",...}` ke customer. Baris seperti itu sekarang dibuang dan memicu eskalasi.

### Bagian A: kandidat sebagai penjawab langsung (25 giliran × 2 putaran, eskalasi mati, jatah token 2000)
"Masalah serius" artinya penjaga menemukan alasan selain `empty_promise` dan `tool_no_result`.

| Model | Harga OpenRouter (masuk / keluar per 1M) | Giliran dengan masalah serius | Biaya rata-rata per giliran | Median waktu |
|---|---|---|---|---|
| gemini-2.5-flash (utama) | $0,30 / $2,50 | 10 / 50 | $0,0024 | 1,3 dtk |
| gpt-5.4-mini | $0,75 / $4,50 | 9 / 50 | $0,0038 | 2,5 dtk |
| **claude-haiku-5.5** | $0,10 / $0,50 | **7 / 50** | $0,0045 | 5,0 dtk |
| claude-sonnet-5.5 | $2 / $10 | tidak terukur | | |
| gemini-3.8-flash | $0,825 / $4,125 | tidak terukur | | |
| gpt-5.4 | $2,50 / $15 | tidak terukur | | |

- **Sonnet, gemini-3.8, gpt-5.4 tidak terukur.** Sebagian besar panggilannya ditolak OpenRouter: "would exceed your available credits". Sisa kredit akun waktu itu sekitar $1.
- **Biaya haiku-5.5 yang terukur lebih tinggi** daripada gpt-5.4-mini, walau harga daftarnya jauh lebih rendah. Angka terukur yang dipakai.
- **Contoh kualitas jawaban:**
  - gpt-5.4-mini menjawab "status pesanan kemarin" dengan kalimat kaku ("Saya ingin memastikan jawabannya akurat...").
  - Untuk pertanyaan rekening, gpt-5.4-mini memicu kalimat tambahan "harga barang ini saya belum bisa memastikan" yang tidak relevan.
  - haiku-5.5 menjawab kedua kasus itu dengan wajar.
- **Kasus "ini buktinya" tanpa lampiran tetap bermasalah di semua model.** Penjaga menanganinya dengan meminta foto dikirim ulang.

## Keputusan
Eskalasi default hidup dengan `anthropic/claude-haiku-5.5`, dan `openai/gpt-5.4-mini` sebagai cadangan kalau haiku error.

## Batas riset ini
- Selisih 7 / 9 / 10 dari 50 itu kecil, dan sampelnya hanya 2 putaran.
- Alur eskalasi dengan haiku-5.5 belum diuji ujung ke ujung, karena kredit OpenRouter hampir habis. Yang sudah teruji ujung ke ujung adalah alur dengan gpt-5.4-mini.
- Sonnet, gemini-3.8-flash, dan gpt-5.4 perlu diuji ulang setelah kredit diisi.
