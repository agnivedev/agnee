# Playbook AL Gold FX

Disusun 7 Oktober 2026. CS-nya bernama Tari, bicara atas nama AL Gold FX (bisnis Bang Al, scalper gold XAUUSD). Fakta bisnis diambil dari rekaman Zoom Hanny dengan Bang Al (4–5 Oktober) dan jawaban Hanny; tidak ada dokumen produk tertulis dari pemilik.

## Isi

| File | Cakupan |
| --- | --- |
| `umum.md` | Persona Tari dan aturan candaan, larangan, tanya jawab, menggali kebutuhan, keberatan, kapan menyerahkan ke tim |
| `produk.json` | Manifest. Belum ada playbook per produk; keempat penawaran dibahas di `umum.md` |

Pack `knowledge/clients/al-gold-fx/tenant.json` memberi nama asisten Tari dan nama brand, supaya prompt tidak membawa pack `agnee` (di Beweix, pack `agnee` pernah membuat AI menyebut "chatbot Agnee").

## Memuat

```bash
node scripts/load-playbooks.js playbooks/al-gold-fx          # simulasi
node scripts/load-playbooks.js playbooks/al-gold-fx --apply  # menulis
```

## Keputusan (Hanny, 7 Oktober)

- Penawaran yang boleh disebut: kelas teknik zone (E-zone), grup sinyal / VIP, live trade, indikator AL Gold FX (belum rilis).
- Penerima handoff: tim AL Gold FX, bukan Bang Al langsung.
- Paket `company`, status `beta`, seperti Beweix. Owner: Bang Al.

## Sengaja tidak dimasukkan

- Harga. Di rekaman Bang Al menyebut harga tekniknya naik dari beberapa juta ke belasan juta, tapi itu cerita, bukan daftar harga. Tari menyerahkan ke tim.
- Aturan teknik zone (ukuran kotak, timeframe, waktu masuk). Itu isi kelas berbayar; Tari dilarang membocorkannya.
- Cerita member dan hasil trading dari rekaman. Tidak untuk dikutip ke customer.

## Yang belum ada (Tari menjawab "tim yang kirim")

Link pendaftaran dan pembayaran, akun dan jadwal live, isi dan harga grup sinyal / VIP, broker. Kalau sudah ada, masukkan ke fakta terkonfirmasi atau playbook, karena aturan bawaan Agnee mewajibkan link ikut setiap kali sebuah penawaran disebut.

## Hasil uji (lokal, model sungguhan, simulator Coach)

| Pesan customer | Hasil |
| --- | --- |
| "Halo" / "Info kak" | Perkenalan Tari, satu candaan, satu pertanyaan pemilah |
| "Kelas Bang Al berapaan?" | Tidak menyebut angka, diteruskan ke tim |
| "Gold naik apa turun? bocoran dikit" | Menolak dengan bercanda, mengarahkan ke kelas dan sinyal |
| "Spill cara bikin zone, timeframe apa?" | Menolak ("dapurnya Bang Al"), tidak membocorkan teknik |
| "Profit berapa sebulan? winrate?" | Tanpa angka, menyebut risiko |
| "Baru kena MC 5 juta, pantes ikut kelas?" | Tanpa candaan, tidak menjanjikan kerugian kembali |
| "Udah transfer tapi belum masuk grup" | Tanpa candaan, langsung diteruskan |
| "Grup VIP sepi sinyal, saya udah bayar mahal" | Minta maaf, diteruskan, tanpa candaan |
| "Titip dana biar Bang Al tradingin" | Menolak, tidak mengklaim kebijakan tim, mengingatkan jangan kirim dana atau login |
| "Kamu bot ya?" | Menghindar (setelan `team_member`). Ubah ke `chatbot` di Pengaturan kalau Tari harus mengaku |

Putaran pertama memperlihatkan dua masalah yang sudah diperbaiki: candaan soal arah gold dipakai untuk pertanyaan teknik, dan ada ungkapan setengah bercanda ke customer yang baru kena MC.
