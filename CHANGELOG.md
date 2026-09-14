## [Unreleased]

### Added

- **Kirim tindak lanjut manual dari inbox**: section baru di panel lead, hanya
  untuk supervisor dan bukan untuk grup. Dua langkah — server menyusun,
  supervisor membaca teks persisnya di dialog dan boleh menyuntingnya, baru
  dikirim. Route `/v1/follow-up/draft` dan `/v1/follow-up/send` sudah ada sejak
  lama tapi tidak punya satu pun pemanggil di frontend.
  `ApiError` sekarang membawa badan respons, supaya penolakan yang bernama
  (`reasonKey` + `vars`) bisa diterjemahkan alih-alih menampilkan pesan mentah.

### Fixed

- **`normalizeChatId` menulis ulang alamat `@lid` menjadi `@c.us`** — alamat
  yang sama sekali berbeda. LID adalah id buram, bukan nomor telepon, jadi
  `5197682204772@lid` menjadi `5197682204772@c.us` dan tindak lanjut akan
  menyasar orang lain. Semua percakapan di produksi berformat `@lid`, jadi
  jalur kirim manual akan salah sasaran untuk setiap percakapan asli. Sekarang
  apa pun yang memuat `@` dikembalikan apa adanya; normalisasi digit hanya
  untuk nomor telepon yang diketik orang.
- **Kegagalan kirim di jalur manual tidak menghentikan rangkaian.** Aturan
  "kegagalan kirim = berhenti" hanya ada di `processOne`, yang dipakai jalur
  otomatis. Rute manual memanggil `send()` langsung sehingga percobaan tercatat,
  pengiriman gagal, dan rangkaian tetap terpasang — scheduler lalu mengirimnya
  lagi, mekanisme yang persis menyebabkan insiden spam 2026-09-14. Aturannya
  dipindah ke `send()` supaya kedua jalur tidak bisa menyimpang.
- **Id percakapan tidak sah menjawab 500, bukan 400**, dan kegagalan kirim
  membocorkan pesan error internal WhatsApp (`pupPage`) ke layar supervisor.
  Sekarang 400 untuk id tidak sah dan 502 dengan `fu.sendFailed` untuk kirim
  yang gagal.

### Changed

- **`chart-campaign.md` (TM)**: isi placeholder link akses dengan
  `https://t.me/bzonesyndicate` — ditambahkan di template balasan otomatis dan
  FAQ komunitas.

### Fixed

- **Role `hannyfx20@gmail.com` di prod**: diubah dari `agent` ke `supervisor`
  di company `tradersmastermind` langsung via DB prod.
- **Email `tony_rahardjo@gmail.com` di prod**: diubah ke `tony.rahardjo@gmail.com`
  (underscore ke titik) langsung via DB prod.

### Added

- **Frontend dibangun ulang dengan React + Tailwind** (Vite + TypeScript) —
  stack yang sama dengan shadcn/ui dan 21st.dev. Sumbernya pindah dari `public/`
  ke `web/`, dibangun ke `dist/`, dan disajikan Fastify.
  Dikerjakan bertahap: satu halaman pindah, sisanya tetap dilayani frontend lama
  sampai gantian, supaya produk yang sedang melayani customer tidak pernah
  setengah jalan. Inbox, Lead List, Settings, Admin, dan landing sudah pindah;
  10.500 baris HTML/CSS/JS vanilla dihapus.
  - Token desain dipindah apa adanya dari `public/styles.css`, dan kamus i18n
    (kini 693 kunci × 2 bahasa) **diekstrak mekanis**, bukan diketik ulang —
    salinan yang diketik ulang pasti menyimpang.
  - Bundel disajikan di bawah **`/app/`**, bukan `/assets/`. `public/assets/`
    sudah memuat gambar landing, dan sempat tertutup sampai keduanya 404.
  - `dist/` wajib ada. Tanpa build, setiap halaman menjawab 503 beserta
    instruksinya — bukan 404 kosong. Dockerfile jadi dua tahap supaya Vite dan
    React tidak ikut ke image runtime.
  - Warna nama pengirim di grup jadi kelas Tailwind, bukan inline style: CSP
    aplikasi melarang atribut `style`, dan halaman lama melanggarnya diam-diam.
    Halaman React terverifikasi **nol** elemen ber-inline-style.
  - `landing-b/c/d` dihapus — sisa eksperimen A/B yang sudah tidak dipakai.
- **Pintu masuk Lead List di inbox**: halaman `/leads` sudah ada sejak commit
  `3b9baef`, tapi satu-satunya tautannya ada di sidebar Settings sehingga
  praktis tidak terlihat.
- **Settings dibagi jadi lima tab**: Paket & Pembayaran, Nomor WhatsApp,
  AI & Tindak Lanjut, Ekspor Data, Tim & Akun. Sembilan section dalam satu
  gulungan panjang susah dipindai.
  Tiap tab memuat section-nya sendiri, jadi tab yang tidak dibuka tidak memakai
  satu request pun; sebelumnya sembilan section memuat data serentak.
  Id section lama dipertahankan karena halaman lain menautinya langsung
  (`/settings#coachSection` dari Admin) — hash yang menyebut section membuka tab
  pemiliknya lalu menggulir ke sana, setelah menunggu elemennya benar-benar ada.
  Tab disimpan di hash lewat `replaceState`, bukan penetapan hash: entri riwayat
  per klik tab akan membuat tombol Back menyusuri tab, bukan meninggalkan
  halaman.

- **Tiga pengaman tindak lanjut yang tidak saling bergantung**, setelah insiden
  2026-09-14. Perbaikan urutan catat-lalu-kirim menutup penyebab yang diketahui;
  ketiganya menutup penyebab yang belum diketahui.
  1. **Batasan di database** (migration 022): `UNIQUE (company_id, chat_id,
     day_index, attempt_in_day)` pada `follow_up_sends`. Kalau logika penjadwal
     salah lagi, percobaan kedua untuk slot yang sama ditolak Postgres, bukan
     diteruskan ke customer.
  2. **Plafon absolut dari baris terkirim**, bukan dari penghitung di
     `follow_up_state`. Penghitung itulah yang kemarin rusak; jumlah baris di
     `follow_up_sends` tetap benar walau penghitungnya nol.
  3. **Pengiriman gagal menghentikan rangkaian**, bukan menjadwalkannya ulang.
     Insiden kemarin terjadi persis karena kegagalan diperlakukan sebagai
     "coba lagi nanti", padahal pesannya sudah terkirim dan yang gagal langkah
     sesudahnya. Tindak lanjut yang hilang tidak merugikan siapa pun; tindak
     lanjut berulang merugikan customer dan reputasi nomor WhatsApp-nya.

- **Dua pengaman tingkat nomor untuk tindak lanjut.** Pengaman sebelumnya
  semuanya melindungi satu percakapan. Keduanya di bawah melindungi nomor
  WhatsApp-nya, yang bisa ditandai walau tiap customer hanya menerima satu
  pesan.
  1. **Rem per company per putaran** (bawaan 3) dan **jeda antar pesan**
     (bawaan 1,5 detik). `minGapMinutes` hanya menjaga jarak ke satu customer;
     tanpa rem ini, 25 chat yang jatuh tempo bersamaan keluar beruntun dalam
     hitungan detik dari satu nomor. Chat yang kena rem tidak hilang — putaran
     berikutnya mengambilnya lagi, dan tidak ada yang dihentikan atau memakan
     plafon.
  2. **Menyalakan kembali menutup rangkaian lama** (migration 023, alasan
     berhenti baru `feature_reenabled`). Rangkaian hanya terpasang saat kita
     membalas customer, jadi yang masih terpasang dari periode menyala
     sebelumnya mewakili kesenyapan basi yang tidak ditinjau siapa pun sejak
     fitur dimatikan. Tanpa ini, satu klik "aktifkan" melepaskan seluruh
     antrean itu sekaligus ke customer yang mungkin sudah lama beralih.
     Hanya transisi mati→menyala yang membersihkan; menyimpan pengaturan lain
     saat fitur sudah menyala tidak menyentuh rangkaian hidup.

- **Halaman Lead List** (`/leads`): tabel semua percakapan beserta statusnya —
  cari di semua kolom, saring tahap lead dan penanganan (AI atau manusia),
  urutkan dengan mengeklik judul kolom, dan unduh **XLSX** atau **CSV**.
  Kolomnya diambil dari metadata API yang sama dengan file ekspor, bukan daftar
  terpisah, jadi tabel dan file tidak bisa saling menyimpang.
  Kolom nomor dan baris header menempel saat tabel digulir ke samping; tanpa
  nomornya, baris di sebelah kanan tidak bisa dikenali lagi.
- **Penulis .xlsx sendiri** (`src/xlsx-writer.js`) — ZIP + XML lewat `zlib`
  bawaan, tanpa dependency baru. Menarik pustaka spreadsheet utuh hanya untuk
  mengekspor satu tabel datar tidak sebanding.
  Baris header dibekukan dan diberi filter otomatis. Skor dan jumlah pesan
  ditulis sebagai angka supaya bisa dijumlah dan diurutkan; nomor telepon
  sengaja tetap teks, karena sebagai angka nol di depannya hilang.
  Karakter kontrol yang dilarang XML 1.0 dibuang — isi pesan WhatsApp bisa
  membawanya, dan Excel menolak membuka file yang memuatnya.

- **Sinkronisasi kontak ke Google Sheets** (migration 021), sejajar dengan
  OneDrive. Sebuah company boleh memakai salah satu atau keduanya — barisnya
  sama, dan sebagian tim memang hidup di dua ekosistem.
  Google Sheets API v4 langsung, tanpa layanan perantara dan tanpa dependency
  baru: JWT service account ditandatangani `node:crypto` lalu ditukar jadi
  access token. Bedanya dengan Microsoft, Google **tidak menuntut persetujuan
  admin** — pemilik sheet cukup membagikan sheet ke alamat email service
  account sebagai Editor.
  Supervisor menempel isi file JSON service account apa adanya; memecahnya jadi
  beberapa field hanya menambah cara untuk salah. Kredensial diverifikasi ke
  Google sebelum disimpan, dan tab dibuat otomatis kalau belum ada.
  Sisa baris lama dihapus pakai endpoint `:clear`, bukan ditimpa string kosong
  seperti di Excel — selnya benar-benar kosong, jadi `COUNTA` dan filter di
  sheet tetap benar.
  Kegagalan yang paling sering (sheet belum dibagikan) dijawab dengan
  instruksinya, bukan kode HTTP.

- **Route pengelolaan nomor**: `GET/POST /v1/whatsapp/numbers`,
  `PATCH/DELETE /v1/whatsapp/numbers/:id`. Nomor utama tidak dapat dihapus —
  menghapusnya membuat company kehilangan identitas WhatsApp sekaligus profil
  Chromium-nya. Plafon `max_whatsapp` dihitung dari gabungan nomor WhatsApp Web
  dan Cloud API. Nomor baru tidak langsung dinyalakan: Chromium yang belum
  tentu dipakai hanya memakan ~400 MB.
- `/v1/whatsapp/qr`, `/v1/whatsapp/qr-refresh`, dan `/v1/whatsapp/logout`
  menerima `connectionId` untuk memilih nomor; tanpa itu, nomor utama.

- **Tindak lanjut lead yang diam.** Kalau customer berhenti membalas, AI
  menyapa kembali dengan **plafon per hari** (default 5 di hari pertama, 3 di
  hari kedua, 2 di hari ketiga, lalu berhenti permanen). Angka itu batas atas,
  bukan kuota: mesin hanya mengirim kalau ada yang layak disampaikan, dan
  generatornya boleh menjawab `SKIP` tanpa memakai kuota hari itu.
  Pengamanannya: jarak minimum antar pesan (default 120 menit), jam kirim
  8–21 WIB, berhenti begitu customer membalas atau agent mengambil alih chat,
  dan kuota AI paket tetap dihitung supaya tindak lanjut bukan celah untuk
  melewatinya. Plafon disimpan **per company**, jadi tenant yang funnel-nya
  hanya mengizinkan 3 kali bisa diset `[1,1,1]`.
  Fitur ini **mati secara default** — deploy tidak akan mengirim apa pun
  sampai supervisor menyalakannya, karena menyalakan tindak lanjut otomatis ke
  seluruh basis chat lama adalah cara tercepat kena laporan spam.
- **Kirim tindak lanjut manual** lewat dua langkah: `POST /v1/follow-up/draft`
  menyusun pesannya, supervisor membaca teks persisnya di dialog konfirmasi,
  lalu `POST /v1/follow-up/send` mengirimnya. Plafon diperiksa **ulang** saat
  kirim, supaya draft yang sempat menganggur di layar tidak lolos melewati
  batas yang sudah dipenuhi scheduler. Jarak minimum sengaja tidak berlaku di
  jalur manual — supervisor yang memutuskan waktunya.
- **Playbook per company sebagai dokumen Markdown**, disusun lewat percakapan
  dengan asisten admin (bukan mengisi formulir): supervisor menjelaskan cara
  kerja CS-nya, asisten menanyakan yang masih kurang, lalu percakapan itu
  dijadikan satu dokumen `.md` yang dibaca AI saat membalas customer.
  Delapan jenis: persona, compliance, qna, discovery, objection, closing,
  followup, handoff. Ada riwayat versi, dan dokumen bisa juga disunting
  langsung. Disimpan di DB, bukan di `knowledge/clients/` — file repo sama
  untuk semua tenant dan tidak bisa ditulis dari UI.
  Urutan bacanya tetap: persona dan compliance lebih dulu, supaya aturan yang
  melarang sesuatu terbaca sebelum materi jualan yang bisa menggodanya.
- **Komponen dialog aplikasi** (`public/ui-dialog.js`) untuk konfirmasi,
  pemberitahuan, dan input.

- **Knowledge base TM lengkap**: `funnel/sales-funnel.md` untuk Trader's Mastermind
  — produk Recovery Plan (Rp99k) dan Bundle Mentorship (Rp188k), Copy Trade
  Master vs Copy Trade EA, alur funnel 6 stage, FAQ, objection handling, link
  checkout, dan panduan onboarding. AI kini punya sumber fakta yang jelas
  dan tidak perlu mengarang detail produk.

- FAQ Trader's Mastermind dipecah jadi 25 entri terindeks di `faq/`
  (produk, harga, EA & copy trade, akun & broker) sehingga hanya jawaban yang
  relevan disuntik ke konteks AI per pesan, bukan seluruh dokumen funnel.

- Panel pengaturan **Pembayaran & Closing** (link pembayaran atau transfer
  bank) — instruksi ini otomatis disisipkan ke konteks AI saat pelanggan
  siap closing, sehingga AI tahu cara menutup transaksi tanpa mengarang.
- Header `x-agnee-company` untuk pemanggil berbasis API key (termasuk MCP
  server, lewat env `AGNEE_COMPANY`) — wajib diisi karena tidak ada lagi
  tenant default yang bisa dijadikan fallback diam-diam.

- Endpoint `POST /v1/chats/:chatId/mark-read` yang menandai chat sebagai
  terbaca (mengirim `sendSeen` ke WhatsApp) begitu chat tersebut dibuka;
  badge unread langsung hilang di UI tanpa menunggu refresh.
- Tab Inbox dan Archived terpisah di daftar percakapan, dengan filter
  `inbox`/`archived` di endpoint `GET /v1/chats` dan properti `archived`
  pada setiap chat.

### Changed

- Penjadwal ekspor kini satu putaran untuk dua tujuan sekaligus. Satu company
  atau satu tujuan yang gagal tidak menghentikan sisanya.

- **Sinkronisasi kontak ke Excel di OneDrive** (migration 020). Kredensial
  Microsoft disimpan per company dan client secret dienkripsi pgcrypto, sama
  seperti kredensial Cloud API — tenant Microsoft dan workbook tiap company
  berbeda, jadi ini tidak pernah boleh jadi konfigurasi global.
  Memakai alur client credentials (app-only), bukan OAuth delegasi: sinkronisasi
  berjalan di server tanpa ada orang yang login, dan token delegasi akan
  kedaluwarsa lalu menuntut seseorang masuk kembali. Konsekuensinya, app-nya
  butuh persetujuan admin tenant.
  Kredensial diverifikasi ke Microsoft **sebelum** disimpan, dan tautan berbagi
  diterjemahkan jadi `driveId`/`itemId` — tautan bisa dicabut, id tetap.
  Sinkronisasi menulis header, baris, lalu **mengosongkan sisa baris lama**:
  Excel tidak menghapus baris hanya karena kita menulis lebih sedikit, jadi
  tanpa itu kontak yang sudah hilang tetap terlihat ada.
  Berjalan tiap 10 menit, satu interval sederhana — menulis tiap ada pesan
  masuk akan menembus batas laju Graph dan mengunci file bagi orang yang sedang
  membukanya. Satu company yang gagal tidak menghentikan yang lain, dan
  alasannya ditampilkan di halaman pengaturan.
- Tombol **Unduh CSV** di Settings untuk ekspor langsung tanpa setup apa pun.

- **Export kontak**: `GET /v1/export/contacts` (JSON) dan
  `/v1/export/contacts.csv` (unduhan). Satu baris per percakapan, 23 kolom —
  nomor, nomor kita yang melayani, pesan masuk dan balasan terakhir beserta
  waktunya, ringkasan percakapan, ditangani AI atau manusia, PIC beserta
  emailnya, status, tahap lead, prioritas, skor, status tindak lanjut, dan
  jumlah pesan.
  Daftar percakapannya digabung dari empat sumber (`inbound_messages`,
  `outbound_replies`, `lead_states`, `conversation_routing`), bukan satu: lead
  bisa punya baris routing tanpa pesan tercatat, dan pesan bisa masuk sebelum
  ada lead state. Mengambil dari satu tabel akan menghilangkan sebagian kontak.
  Semuanya satu query; versi per-kontak akan menjadi ratusan query tiap
  sinkronisasi.
  CSV diawali BOM supaya Excel membaca UTF-8 dengan benar — tanpa itu nama
  dengan aksen dan emoji tampil rusak saat dibuka langsung di Excel.

- **Halaman pengelolaan nomor WhatsApp** di Settings: daftar nomor, tambah
  nomor, keluarkan/masukkan rotasi, hapus, dan tombol "Scan QR" yang membawa
  supervisor ke dialog pairing di inbox untuk nomor itu (`/?connect=<id>`).
  Tanpa ini rotator tidak bisa dipakai sama sekali — API-nya ada tapi tidak
  ada cara menambah nomor dari aplikasi.
  Halamannya menyebut batas kapasitas apa adanya: tiap nomor menjalankan
  browser sendiri dan memakai sekitar 400 MB memori server.
- Dialog pairing di inbox menerima `connectionId`, dan mengabaikan event fase
  dari nomor lain selagi memasang satu nomor — kalau tidak, QR nomor kedua bisa
  tertimpa perubahan fase nomor pertama.

- **`WhatsappManager` kini di-key `connectionId`, bukan `companyId`.** Ini
  syarat agar satu company boleh punya beberapa nomor WhatsApp Web, masing-masing
  dengan profil Chromium sendiri. Menyentuh 48 titik panggil di `server.js`.
  Pendengar SSE dipindah ke map terpisah yang tetap **per company** —
  antarmukanya memang company-scoped, supervisor melihat satu inbox, bukan satu
  inbox per nomor. `activeCompanyCount()` menghitung company, bukan koneksi.
  Fase `ready` sekarang hanya ditetapkan lewat `_markReady()`, dan setiap
  siaran `whatsapp_phase` membawa `connectionId`.
- **Inbox menggabungkan percakapan dari semua nomor yang hidup.** Kalau hanya
  nomor utama yang dibaca, percakapan yang masuk lewat nomor kedua tidak
  terlihat sama sekali — itu menghapus gunanya punya beberapa nomor. Percakapan
  yang sama tidak dimunculkan dua kali; pemetaan sticky yang menentukan siapa
  yang membalas.
- **Operasi per-percakapan memakai nomor pemilik percakapan itu** (riwayat,
  pinned, arsip, tandai dibaca, avatar, ringkasan, kirim). Pengiriman ke
  percakapan baru memilih nomor aktif dengan beban paling ringan lalu
  menempelkannya.

- `npm run check` kini ikut memeriksa `whatsapp-manager.js`, `follow-up.js`,
  dan `knowledge-loader.js` — tiga file inti yang selama ini lolos dari syntax
  check di CI.

- **Semua dialog bawaan browser diganti.** 14 pemakaian `confirm()`/`alert()`
  di `admin.js` dan `settings.js` dihapus: dialog OS tidak bisa digaya, tidak
  ikut bahasa yang dipilih user, dan memblokir thread. Penggantinya memakai
  `<dialog>` dengan gaya yang sama seperti `.workspace-dialog` di inbox.
  Konfirmasi yang menghapus sesuatu kini menjelaskan akibatnya, bukan hanya
  menanyakan "yakin?".
- `settings.js` sebelumnya **tidak memakai i18n sama sekali** — seluruh
  teksnya Indonesia dan tidak berubah walau user memilih English. Sekarang
  helper `tr()` tersedia di sana, dan seluruh string baru punya pasangan
  ID/EN (389 kunci, seimbang di kedua bahasa).

- **Model AI default: `qwen-2.5-72b-instruct` → `google/gemini-2.5-flash`.**
  Alasannya bukan harga (biayanya setara karena balasan WhatsApp pendek,
  sehingga biaya didominasi token masuk), tapi kecepatan: 0,9–1,3 detik
  dibanding 3–7 detik. Funnel sendiri menargetkan balasan di bawah 5 menit.
  Gemini juga lebih patuh pada kontrak keluaran (8/8 vs 2/3 pada uji yang sama)
  dan mengikuti tahap discovery playbook, bukan langsung menawarkan harga.
- Daftar model di panel admin dirapikan: 4 dari 7 pilihan sebelumnya sudah
  tidak ada di OpenRouter (`mistralai/mistral-7b-instruct`,
  `google/gemini-2.0-flash-exp`, `anthropic/claude-3.5-haiku`,
  `anthropic/claude-opus-4-1`) — memilihnya membuat balasan gagal tanpa
  pesan yang jelas. Semua ID sekarang sudah diverifikasi aktif, dan labelnya
  menampilkan harga masuk dan keluar terpisah karena keduanya bisa berbeda
  jauh (Gemini Flash: masuk $0,30 tapi keluar $2,50).
- Harga acuan Trader's Mastermind dibakukan jadi **normal Rp1.900.000 → promo
  Rp99.000**. Sebelumnya dokumen memuat tiga angka (Rp4.900.000, Rp1.900.000,
  Rp99.000) tanpa aturan pemakaian, sehingga AI kadang menyebut harga normal
  Rp1,9jt dan kadang Rp4,9jt ke customer. Angka Rp4.900.000 sekarang hanya
  dipakai saat customer mempertanyakan kenapa harganya murah.

- Semua istilah teknis data-science di UI (`token`, `MODEL`, `STORAGE`,
  `training`, dsb.) diganti dengan bahasa bisnis/marketing (`kredit`,
  `MESIN AI`, `DATA`, `Latih AI`, dsb.) di kedua locale (ID/EN).
- Inbox membedakan "WhatsApp sedang tersambung..." dari "Belum ada
  percakapan" — sebelumnya keduanya tampil sebagai kotak masuk kosong yang
  sama meski API sudah mengembalikan `phase` untuk kasus WhatsApp belum
  siap.
- Setiap perusahaan sekarang punya identitas WhatsApp sendiri
  (`agnee-<companyId>`) alih-alih fallback ke client ID bersama — 4 dari 5
  tenant sebelumnya berbagi satu profil Chromium dan saling merusak sesi
  satu sama lain (kunci Singleton saling terhapus, QR tidak pernah muncul).
- Perusahaan "default" bootstrap dihapus konsepnya sepenuhnya: 41 titik
  fallback `database.companyId` di server.js dan ~30 default implisit di
  database.js dihapus. Setiap sesi dan pemanggil API key sekarang wajib
  menyebutkan company secara eksplisit. Perusahaan default lama di-rename
  menjadi Agnive (identitas aslinya) alih-alih dihapus.
- Notifikasi status WhatsApp (`whatsapp_phase`) kini didorong secara
  real-time lewat SSE ke UI alih-alih menunggu polling; polling hanya
  dipakai sebagai fallback setiap 30 detik.
- Workflow deploy GitHub Actions sekarang benar-benar menjalankan
  `docker-compose build` + `up -d` di server, bukan sekadar `git pull` dan
  me-restart systemd service lama yang sudah tidak dipakai.

- Tombol rail, menu percakapan, attachment, connection status, dan handoff kini
  menjalankan aksi nyata; kontrol yang sebelumnya placeholder sudah diaktifkan.
- Composer dapat menampilkan konteks reply/lampiran tanpa menggeser area chat.
- Dialog connection menampilkan status sesi aktif dan tidak meminta QR ulang
  saat WhatsApp sudah connected.

### Fixed

- **Halaman Settings menawarkan yang tidak bisa dipakai agent.** Tab
  Paket & Pembayaran tampil untuk agent padahal `/v1/admin/company` menjawab
  403 — kartunya kosong dan tombol simpannya pasti gagal. Sekarang
  supervisor-only. Agent hanya punya satu tab, jadi bar tab-nya disembunyikan.
- **Nav menyembunyikan Settings dari agent** padahal agent boleh membukanya dan
  memang perlu: akun sendiri dan daftar tim ada di sana. Agent berakhir di
  halaman yang navigasinya sendiri menyangkal.
- **Kirim tindak lanjut manual bisa menghabiskan plafon harian beruntun.**
  Jalur manual mengosongkan `lastSentAt` supaya supervisor tidak perlu menunggu
  jadwal otomatis. Efek sampingnya jarak minimum hilang sepenuhnya: dengan
  plafon bawaan 5 di hari pertama, lima pesan bisa keluar ke satu orang dalam
  hitungan detik. Itu spam, dan tidak berhenti jadi spam karena manusia yang
  mengekliknya. Jaraknya sekarang diperpendek, bukan dihapus — yang berlaku
  adalah yang lebih kecil antara setelan company dan 15 menit. Plafon harian,
  jam kirim, dan batas hari tidak berubah. Aturannya pindah ke `follow-up.js`
  supaya jalur otomatis dan manual memakai sumber yang sama.
- **Paket personal bisa berakhir dengan lebih dari satu pemilik.** Plafon
  anggota diperiksa di route, sebelum transaksi penambahan. Dua permintaan yang
  datang bersamaan sama-sama melihat kuota masih sisa dan sama-sama lolos —
  pada paket personal yang plafonnya 1, hasilnya dua pemilik pada ruang yang
  seharusnya milik satu orang. Plafon kini ditegakkan lagi di dalam transaksi
  dengan baris company dikunci (`FOR UPDATE`), jadi permintaan kedua menunggu
  lalu melihat hitungan yang sudah benar. Terverifikasi: lima permintaan
  serentak pada plafon 2 menghasilkan tepat satu keberhasilan.
- **Nav inbox masih menyembunyikan Settings dari agent.** Perbaikan sebelumnya
  hanya menyentuh sidebar halaman; rail inbox tetap menandainya supervisor-only.
  Karena agent praktis hidup di inbox, tidak ada satu pun rute ke halaman yang
  server dengan senang hati melayani untuknya. Kelas cacat yang sama, nav yang
  berbeda — periksa **setiap** nav, bukan yang pertama ketemu.
- **Tombol "Percakapan baru" tertutup pil ID/EN di ponsel.** Pil itu `fixed`
  16px dari tepi layar dan selebar 80px, sedangkan header inbox hanya menyisakan
  64px, jadi 15×14px pojok tombol tertelan: `elementFromPoint` di sana
  mengembalikan tombol bahasa. Mengetuk pojok itu mengganti bahasa, bukan
  membuka percakapan. Clearance jadi 96px, dan dilepas dari `md` ke atas —
  di sana rail sudah jadi sidebar dan header tidak lagi menempel tepi layar.
- **Dua tombol nav mengumumkan nama yang sama.** `nav.admin` dan `nav.settings`
  sama-sama berbunyi "Pengaturan", sisa kamus lama dari sebelum halaman Admin
  ada. Di ponsel label visualnya disembunyikan, jadi tombol Admin dan Setting
  sama sekali tak terbedakan oleh pembaca layar. `nav.admin` kini "Panel admin".
- **Sidebar halaman (Lead List, Settings, Admin) meremas isi di ponsel.** Kolom
  248px tetap terpasang di layar 390px, jadi isi halaman tersisa ~130px dan
  judulnya terpotong. Di bawah `md` sidebar jadi bar horizontal yang membungkus,
  bukan menggulir ke samping: bar yang menggulir menyembunyikan justru item
  halaman yang sedang dibuka.
- **Halaman masuk kehilangan branding di ponsel.** Panel kiri (logo + headline)
  tersembunyi di bawah `lg`, jadi yang tersisa hanya form di latar kosong.
  Halaman lama tetap menampilkannya versi pendek; sekarang sama.
- **Build image mengunduh Chromium yang tidak dipakai.** Stage build frontend
  memasang devDependencies, jadi puppeteer ikut terpasang dan mengunduh
  Chromium yang tahap itu tidak pernah menjalankannya.

- **Lingkaran skor lead gepeng** (terukur 41,8 × 52 px, seharusnya 52 × 52).
  `.lead-score` adalah flex item, dan flex item menyusut kalau teks di
  sebelahnya panjang — terlihat jelas di percakapan grup, yang keterangannya
  paling panjang. Diperbaiki dengan `flex: none`, lalu ikut terbawa ke
  panel lead versi React.

- **Pesan yang sudah terkirim bisa terlihat seperti gagal kirim.**
  `window.WWebJS.sendMessage` menserialisasi model hasilnya sendiri, dan
  membaca model WhatsApp bisa melempar — di produksi ia melempar berulang
  dengan error `r` yang sama seperti yang sudah lama muncul di jalur baca.
  `sendTextForUi` membiarkan lemparan itu naik ke pemanggil, sehingga pesan
  yang sudah sampai ke customer dilaporkan gagal. Itu akar dari insiden tindak
  lanjut yang mengirim pesan sama 20 kali.
  Sekarang setiap langkah setelah pengiriman tidak bisa lagi menggagalkan
  pengiriman itu sendiri: receipt diambil secara defensif (id atau waktu yang
  tidak terbaca cukup dikosongkan, bukan melempar), `sendSeen` yang gagal
  diabaikan, dan kalau pengiriman melempar kita periksa dulu riwayat chat —
  kalau pesan dengan isi persis sama dari kita muncul dalam lima detik
  terakhir, itu dianggap terkirim dan receipt-nya dipulihkan dari sana.
  Pemulihan ini dicatat di log; kalau sering terpakai, penyebabnya ada di
  serialisasi model WhatsApp dan pantas dikejar ke sana.
  Lampiran sengaja dikecualikan dari pemulihan: isinya tidak dapat dibandingkan
  dengan teks, jadi kemiripan body bukan bukti yang sah.

- **Follow-up mengirim pesan yang sama berulang setiap lima menit.** Satu
  customer menerima pesan identik 20 kali dalam 13 jam sebelum ini ketahuan.
  Penyebabnya urutan operasi di `FollowUpScheduler.send()`: pesan dikirim
  dulu, percobaannya dicatat kemudian. `sendTextForUi` mengirim ke WhatsApp
  lalu menserialisasi hasilnya di dalam `pupPage.evaluate`, dan ketika
  serialisasi itu gagal — di produksi ia gagal berulang kali dengan error `r`
  yang sama seperti pada jalur baca — pesannya SUDAH terkirim tetapi
  pemanggilnya melempar sebelum sempat mencatat. Tick berikutnya melihat
  plafon harian masih kosong dan mengirim lagi.
  Plafon `[1,1,1]` dan jarak minimum 180 menit sama sekali tidak menahannya,
  karena keduanya dihitung dari catatan yang tidak pernah ditulis.
  Sekarang percobaannya dicatat **sebelum** dikirim. Asimetrinya besar:
  percobaan yang tercatat tapi gagal terkirim merugikan satu pesan yang
  hilang, sedangkan percobaan yang terkirim tapi tidak tercatat merugikan
  pesan berulang tanpa batas ke customer sungguhan — dan reputasi nomor
  WhatsApp-nya. Kalau harus salah, salah ke arah diam.

- **Kolom "Pesan customer terakhir" menampilkan epoch mentah.** Driver Postgres
  mengembalikan BIGINT sebagai string, jadi pemeriksaan `typeof value ===
  'number'` tidak pernah terpenuhi dan angka detik bocor ke tabel dan ke file
  ekspor.

- **Dropdown "Metode pembayaran" jauh lebih tinggi daripada seharusnya**
  (terukur 104px, seharusnya 42px). `.plan-config` adalah grid dua kolom, dan
  sel grid meregang setinggi barisnya. Karena `<label>` di dalamnya juga sebuah
  grid, baris otomatisnya ikut meregang — jadi sebuah `<select>` yang sendirian
  di kolom kiri menjadi setinggi tiga field di kolom kanan.
  Diperbaiki dengan `align-items: start` pada `.plan-config` dan
  `align-content: start` pada labelnya. Hanya muncul di layar lebar; di bawah
  700px grid-nya sudah satu kolom, sehingga tidak pernah terlihat saat
  pengujian di pane sempit.
  Diperiksa ulang ke seluruh halaman pengaturan: dari 44 kontrol form, tidak
  ada lagi yang tingginya di atas 50px.

- **Pemanggilan database baru dijaga `canCall()`.** `.catch()` tidak menangkap
  TypeError dari method yang tidak ada, dan driver pengganti (test, demo) tidak
  memiliki semuanya — itu sempat membuat route ringkasan percakapan menjawab
  500 tanpa jejak begitu ia mulai memanggil `getConnConfig()`.

- **Catatan pesan masuk (`inbound_messages`, migration 019).** Untuk jalur
  whatsapp-web.js, database sebelumnya hanya menyimpan balasan KITA
  (`outbound_replies`) — isi chat customer hanya hidup di dalam browser
  Chromium. Akibatnya kolom "pesan terakhir" ikut mati setiap kali client
  WhatsApp bermasalah. Tabel ini menyimpannya untuk kedua provider.
  Idempotent lewat `UNIQUE (company_id, wa_message_id)`: whatsapp-web.js
  menembakkan ulang event setelah reconnect dan Meta mengirim ulang webhook
  yang belum di-ACK, jadi pesan yang sama bisa sampai dua kali.
  `listLastInboundPerChat()` memberi satu baris per percakapan lewat satu
  query `DISTINCT ON` — export Sheets butuh itu, dan memanggil per kontak akan
  menjadi ratusan query tiap sinkronisasi.
- **Dasar rotator nomor lewat QR** (migration 019): `whatsapp_connections`
  mendapat `is_active`, dan `whatsapp_chat_numbers` menempelkan percakapan ke
  satu nomor — cerminan `cloud_chat_numbers` di jalur Cloud API, dengan alasan
  yang sama. Kolom `connection_id` di `inbound_messages` mencatat nomor mana
  yang menerima tiap pesan.

- **Rotator nomor WhatsApp lewat Cloud API** (migration 018). Satu company kini
  boleh punya banyak nomor: `UNIQUE (company_id)` dilepas dan diganti
  `UNIQUE (company_id, phone_number_id)`. `phone_number_id` tetap unik global
  karena webhook Meta memetakan pesan masuk ke company lewat kolom itu.
  Jalur Cloud API dipilih karena tidak memakai Chromium: satu nomor lewat
  whatsapp-web.js terukur ~400 MB dan ~118 pid di produksi, Cloud API mendekati
  nol.
  **Rotasi hanya berlaku untuk percakapan baru.** Tabel `cloud_chat_numbers`
  menempelkan tiap percakapan ke satu nomor selamanya — termasuk kalau nomor itu
  kemudian dinonaktifkan. Di sisi customer, balasan dari nomor lain bukan
  kelanjutan percakapan melainkan chat baru dari nomor asing, dan riwayatnya
  pecah. Pesan masuk menempelkan percakapan ke nomor yang menerimanya; itu
  sumber kebenaran terkuat karena customer memang sedang bicara ke nomor itu.
  Percakapan baru jatuh ke nomor aktif dengan beban paling ringan, bukan
  round-robin berbasis urutan, supaya nomor yang ditambah belakangan langsung
  ikut menyerap beban.
  Settings mendapat daftar nomor: tambah nomor (dengan nama opsional),
  keluarkan/masukkan ke rotasi, dan hapus. Token dan app secret tidak pernah
  dikirim balik ke browser.

- **Halaman pengaturan tindak lanjut** di Settings. Mesinnya, API-nya, dan
  kunci terjemahannya sudah ada sejak rilis follow-up, tapi tidak pernah ada
  antarmukanya — supervisor tidak punya cara menyalakan atau mengatur plafon
  selain memanggil API langsung. Sekarang ada: sakelar aktif/nonaktif, batas
  kirim per hari, jarak minimum antar pesan, jam kirim, dan ringkasan berapa
  yang terkirim/dibalas/sedang berjalan.
  Salinan di halaman itu menegaskan hal yang paling sering disalahpahami:
  angkanya batas atas, bukan target, dan menyalakannya TIDAK menyasar
  percakapan lama — rangkaian hanya dimulai untuk chat baru sesudahnya.

- **Memilih "Link pembayaran + transfer bank" justru menyimpan dua-duanya
  kosong.** `savePaymentConfig()` membandingkan metode persis ke `'link'` /
  `'bank_transfer'`, jadi nilai `'both'` yang baru tidak cocok dengan keduanya
  dan semua field dikirim sebagai string kosong. Ditemukan saat menelusuri
  jalur simpan setelah menambahkan opsinya.

- **Pembayaran boleh link DAN transfer bank sekaligus** (`payment_method = 'both'`,
  migration 017). Sebelumnya metodenya eksklusif, jadi company yang menerima
  keduanya — pola lumrah di Indonesia — harus memilih satu dan yang satunya
  tidak pernah sampai ke konteks AI. Saat keduanya aktif, AI diminta menawarkan
  dua-duanya dan membiarkan customer memilih.
- **Follow-up tahu konteks percakapan.** Sebelumnya `buildFollowUpPrompt()`
  hanya menerima nomor hari, follow-up sebelumnya, dan playbook — tidak tahu
  apa pun tentang percakapannya, jadi satu-satunya yang bisa dilakukan adalah
  mengulang penawaran umum. Sekarang lima balasan terakhir kita ikut dibawa,
  dan kalau link checkout sudah dikirim tapi belum dibalas, follow-up pertama
  diminta menanyakan langsung dan singkat ("sudah sempat checkout?", "ada yang
  masih mengganjal?") alih-alih mengirim ulang penawaran. Aturan anti-nagging
  tetap berlaku saat tidak ada langkah yang menggantung.

- **Kontrak keluaran ditegakkan di kode, bukan cuma di prompt.** Sebelum balasan
  AI dikirim ke customer, `enforceReplyContract()` memeriksanya: kalau melanggar,
  model diminta menulis ulang SEKALI dengan pelanggarannya disebut eksplisit
  (prompt pendek, jadi aturannya tidak tenggelam); kalau klaim hasil/risiko masih
  ada, kalimat yang melanggar dibuang; kalau tidak ada isi aman yang tersisa,
  balasan otomatis dibatalkan dan percakapan jatuh ke manusia.
  Alasannya terukur: dengan system prompt 52.000 karakter, Gemini Flash tetap
  menulis "risiko kakak nyaris nggak ada" dan mengarang "rata-rata perbaikan
  signifikan di 60 hari pertama". Larangan yang terkubur di prompt panjang tidak
  dipatuhi konsisten.
- **Deteksi klaim hasil dan klaim risiko** (`CLAIM_PATTERNS`). Sebelumnya tidak
  ada cek apa pun untuk ini — `styleWarnings()` hanya menjaga panjang, emoji,
  markdown, dan kalimat template. Pola sengaja sempit: "jaminan uang kembali",
  "trading tetap berisiko", dan "link pembayarannya aman" harus lolos bersih,
  sementara "dijamin balik modal", "bebas risiko", "lebih aman buat modal",
  "meminimalisir risiko", dan "teruji" ditandai.
- **Klarifikasi untuk balasan pendek yang ambigu.** Kalau customer membalas "ya",
  "oke", atau "1" sementara giliran CS terakhir bukan pertanyaan dan tidak memuat
  daftar bernomor, AI menanyakan maksudnya alih-alih menebak. Pembedanya
  deterministik (`isAmbiguousCustomerReply()`), tidak bergantung kepatuhan model,
  dan link dibuang paksa dari kalimat klarifikasi.

- **WhatsApp macet selamanya di "Syncing messages 100%".** Watchdog pemulihan
  sesi hanya berjalan selama fase `starting` dan `authenticated`. Begitu
  WhatsApp menembakkan `loading_screen`, fase berubah jadi `syncing` dan tick
  berikutnya langsung keluar sambil menghapus timernya — jadi kalau `ready`
  tidak pernah datang setelah itu, tidak ada lagi yang memulihkan. Fase
  bertahan di `syncing` 100% sampai container di-restart, dan UI berputar tanpa
  ujung. Ini menjelaskan sifat kambuhannya: saat tidak ada backlog, watchdog
  sempat menang balapan dan menandai `ready`; saat ada pesan yang harus
  disinkronkan, `loading_screen` menang dan pemulihan mati.
  Watchdog sekarang ikut mengawasi `syncing`, punya batas waktu nyata (5 menit),
  membedakan "sedang sibuk" dari "macet" lewat pergerakan persen, dan kalau
  menyerah ia melaporkan fase `error` — bukan diam. Fase `error` bisa
  ditindaklanjuti `/v1/whatsapp/qr-refresh` (quarantine profil + start ulang),
  sedangkan `syncing` tidak.
- **Renderer Chromium yang mati tidak terdeteksi sama sekali.** Event
  `disconnected` milik whatsapp-web.js hanya menyala untuk logout di sisi
  WhatsApp, jadi browser yang kena OOM-kill menggantung tanpa jejak. Sekarang
  `pupPage` (`close`, `error`) dan `pupBrowser` (`disconnected`) diawasi, dengan
  penjaga agar `destroy()` yang disengaja tidak ikut tertangkap.
- **`mem_limit` app dikembalikan ke 1536m dan `pids_limit` ke 1024.** Chromium +
  Node sudah memakai ~635 MB hanya dengan satu company tersambung, jadi pada
  768m sinkronisasi akun ber-backlog menembus plafon dan renderer kena
  OOM-kill. Nilai ini pernah dinaikkan manual di VPS tapi tidak pernah masuk
  repo, sehingga `git reset --hard` saat memperbaiki CI membuangnya dan deploy
  berikutnya mengunci balik ke 768m.
- **Fase `ready` ditetapkan di dua tempat dengan hasil berbeda.** Jalur watchdog
  lupa membersihkan `qrDataUrl`/`syncPercent`, sehingga status publik masih
  melaporkan `hasQr: true` padahal sudah tersambung. Sekarang keduanya lewat
  satu `_markReady()`.
- **Fase `ready` disiarkan dua kali.** Watchdog dan event `ready` bawaan
  whatsapp-web.js bisa sampai duluan bergantian, sehingga setiap browser yang
  terhubung memuat ulang workspace dua kali di setiap koneksi.
- **Frontend menghapus field status yang tidak dikirim event.** Handler SSE
  menyalin `payload.account` mentah-mentah, jadi setiap event `syncing`
  (yang tidak membawa akun) menghapus akun yang sudah diketahui; `percent` juga
  tidak pernah masuk state sehingga `openConnection()` membaca `syncPercent`
  basi.
- **Dialog koneksi membuang alasan kegagalan dari server** — semua error
  terlihat sama ("koneksi lambat"), dan tombol ⟳ yang menjawab 404 saat fase
  `syncing` hanya menulis ke console sehingga terasa mati total. Keduanya kini
  menampilkan alasan sebenarnya.

- **Hapus dokumen playbook tidak punya konfirmasi apa pun** — sekali klik
  langsung terhapus, padahal isinya dipakai AI sebagai sumber jawaban.

- **Playground auto-reply balas HTTP 500** kalau driver database tidak
  menyediakan `getPlaybookContext` — `.catch()` hanya menangkap promise yang
  reject, bukan `TypeError` sinkron dari memanggil sesuatu yang bukan fungsi.
  Ditambahkan guard `typeof` yang sama seperti yang sudah dipakai jalur
  balasan live.
- **AI re-introduce diri di setiap pesan** — `generateAutoReply()` kini mengambil
  10 pesan terakhir dari chat WhatsApp dan meneruskannya sebagai conversation
  history ke LLM. AI tahu konteks percakapan sebelumnya dan tidak memulai
  ulang dengan "Halo kak, aku Anya…" setiap kali customer membalas.
- **Nama persona TM salah** — `tenant.json` sebelumnya menyebutkan
  `assistantName: "Admin"` padahal persona customer-facing-nya adalah
  **Anya**. Dikoreksi, juga di `reply-policy.md`.

- Tombol koneksi WhatsApp, panel admin, dan playground kini disembunyikan
  untuk agent non-supervisor; agent yang login sebelum WhatsApp perusahaan
  tersambung melihat pesan "hubungi supervisor" alih-alih dialog QR yang
  gagal.
- QR code sekarang muncul untuk supervisor dari perusahaan yang WhatsApp-nya
  belum pernah dijalankan sama sekali (`qr-refresh` sebelumnya hanya
  me-restart client yang error, tidak menyalakan client yang belum pernah
  ada).
- `qr-refresh` tidak lagi terkunci permanen oleh limit `max_whatsapp` pada
  perusahaan yang sudah punya koneksi — limit sekarang hanya menghalangi
  pembuatan koneksi baru, bukan penyegaran QR pada koneksi yang sudah ada.
- Supervisor pemilik akun (`owner`) tidak lagi mendapat 403 acak di halaman
  admin — sesi yang di-refresh dari DB menulis ulang role mentah `owner`
  alih-alih `supervisor` yang dipahami otorisasi, menyebabkan kegagalan
  intermiten setiap 60 detik.
- Agent yang mengklaim chat kosong (belum ada yang menangani) tidak lagi
  diblokir 403 — pengetatan otorisasi chat sebelumnya membuat agent tidak
  bisa mengambil percakapan apa pun.
- Assignment chat ke agent sekarang benar-benar terikat perusahaan
  (isolasi ganda WhatsApp + routing), mencegah agent satu tenant melihat
  atau mengambil alih chat milik tenant lain.
- `PATCH /v1/admin/company` memvalidasi `paymentLink` sebagai URL
  http(s); sebelumnya bisa diisi skema apa pun (mis. `javascript:`).
- Isi `knowledge_client` yang salah pasang diperbaiki: akun platform
  Agnive sempat menampilkan playbook/FAQ proprietary milik tenant lain
  (`bzone`) alih-alih konten internalnya sendiri.
- Server tidak lagi crash total ketika whatsapp-web.js melempar error
  internal (mis. `TargetCloseError` saat `Client.inject`); ditambahkan
  handler `unhandledRejection`/`uncaughtException` di level proses.
- Sesi WhatsApp yang di-restore dari disk tidak lagi macet selamanya di
  fase `authenticated`; pengecekan pemulihan sesi sekarang diulang setiap
  5 detik (maks. 12 kali) alih-alih hanya sekali di detik ke-5.
- Event `authenticated` yang kadang ditembak ulang oleh whatsapp-web.js
  setelah `ready` tidak lagi memundurkan status koneksi di UI.
- Form login tidak lagi terisi otomatis dengan kredensial default lama
  (`admin@agnee.local` / `agnee-demo`) yang sudah tidak berlaku di server.
- Grid layout panel inbox diperbaiki setelah penambahan tab Inbox/Archived
  (baris grid yang hilang menyebabkan filter row tumpang tindih).
- Status `ready` tidak lagi dilaporkan palsu saat sesi WhatsApp yang
  di-restore terhubung secara socket (`getState() === 'CONNECTED'`) tapi
  helper halaman whatsapp-web.js (`window.WWebJS`) belum selesai ter-inject
  — endpoint yang bergantung padanya (mark-read, kirim pesan, pinned) gagal
  diam-diam sebelumnya. Sekarang di-restart penuh (destroy + reinit, sesi
  LocalAuth tetap dipakai) sekali begitu ketidaksesuaian ini terdeteksi.
- QR pairing kini diperbarui via dua mekanisme: SSE push segera saat
  WhatsApp merotasi QR (~setiap 20 detik), didukung polling fallback 15
  detik yang tetap jalan meski SSE terputus sejenak — sehingga QR di
  layar tidak expired sebelum sempat di-scan.

- MCP smoke test sekarang gagal dengan jelas ketika API key backend salah,
  alih-alih mencetak respons `Unauthorized` sebagai status yang terlihat sukses.
- Volume state OAuth sekarang dimiliki user non-root container sehingga dynamic
  client registration dapat dipersist tanpa gagal sebagai metadata invalid.
- Stale Chromium `Singleton*` lock dari hostname container lama dibersihkan
  sebelum session restore, sehingga redeploy tidak mengunci profil WhatsApp.

- Payload thumbnail JPEG Base64 pada pesan WhatsApp `interactive` tidak lagi
  bocor sebagai teks ke bubble, preview inbox, atau ringkasan lead; thumbnail
  kini dirender sebagai gambar dan tetap dapat dibuka di image viewer.
- Recovery sesi tersimpan kini melanjutkan sinkronisasi baik dari fase
  `starting` maupun `authenticated`, sehingga restart tidak berhenti di tengah.
- Preview thumbnail Base64 kini mempertahankan tipe asli (`Video`, `Foto`, atau
  `Dokumen`) dan caption, bukan menyamaratakan semuanya sebagai pesan interaktif.
- Video WhatsApp sekarang memiliki preview dengan tombol play dan terbuka dalam
  player modal berukuran nyaman, lengkap dengan controls dan download.

### Known issues — 2026-09-14

- **`WWebJS.sendMessage` melempar di hampir setiap pengiriman, bukan sesekali.**
  Uji kirim ke nomor sendiri memicu log `receipt dipulihkan dari riwayat chat`
  padahal pesannya sampai dengan `ack: 3`. Jalur pemulihan di `sendTextForUi`
  menahannya, tetapi akarnya ada di serialisasi model whatsapp-web.js dan belum
  dikejar. Selama belum, tidak ada lapis lain di bawah jalur pemulihan itu.
- **Tindak lanjut otomatis MATI di keempat company** dan belum dinyalakan lagi.
  Kalau dinyalakan, mulai dari satu percakapan uji, bukan seluruh basis.
- Kredensial OneDrive dan Google Sheets belum diisi di produksi, jadi kedua
  sinkronisasi belum pernah berjalan terhadap akun sungguhan.
- `/v1/messages/:messageId/media` masih dilayani nomor utama; route itu hanya
  membawa `messageId` tanpa `chatId` untuk dipetakan ke nomor.

### Investigated — bukan bug

- **"Pesan grup semua di kiri."** Seluruh 27 id pesan di grup yang dilaporkan
  berawalan `false_` — penanda milik WhatsApp sendiri, bukan tafsiran Agnee.
  Akun yang tersambung belum pernah mengirim apa pun di grup itu; nama yang
  dikira "kita" ternyata akun pribadi yang berbeda, dan dari sudut pandang
  akun yang tersambung ia memang peserta lain. Perataan kiri/kanan sudah benar.
  Jalan keluarnya menyambungkan nomor itu sebagai nomor kedua lewat rotator —
  bukan memindahkan pesan peserta lain ke kanan, yang akan memalsukan siapa
  pengirimnya.

### Belum dikerjakan — antrean per 2026-09-14

Poin 1–3 antrean sebelumnya (rotator, export, tabel pesan masuk) sudah selesai
dan pindah ke bagian Added di atas. Sisanya:

1. **Follow-up mati di semua company** setelah insiden spam 2026-09-14, dan
   sengaja dibiarkan mati sampai ada keputusan. Kalau dinyalakan lagi: bertahap,
   satu chat uji dulu, bukan seluruh basis.
2. **Kredensial ekspor cloud belum diisi** — `onedrive_connections` dan
   `gsheets_connections` keduanya nol baris di produksi, jadi sinkronisasi belum
   pernah berjalan terhadap akun asli. Unduhan XLSX/CSV tidak terpengaruh.
3. **UI kirim tindak lanjut manual** — route `/v1/follow-up/draft` dan `/send`
   plus kunci i18n `fu.manual*` sudah ada, tapi belum punya antarmuka di mana
   pun. Tempatnya di inbox, per percakapan.
4. **Media dari nomor kedua belum bisa diambil** —
   `/v1/messages/:messageId/media` hanya membawa `messageId`, tanpa `chatId`
   untuk dipetakan ke nomor, jadi selalu dilayani nomor utama.
5. **Konfigurasi produksi yang belum diisi** — pembayaran keempat company masih
   `none`; `[LINK_AKSES]` masih placeholder di `chart-campaign.md`.
6. **Kecil** — balasan "yakinin aku" masih ~163 kata setelah satu kali tulis
   ulang (batas 150; panjang sengaja diperlakukan sebagai pelanggaran lunak).
   `/v1/admin/playground/auto-reply` masih satu pesan tanpa history, jadi kasus
   multi-turn tidak bisa diuji dari sana.

### Known issues — status per 2026-09-12

Poin 1 dan 3 sudah diperbaiki (lihat Added di atas). Poin 2 **sengaja tidak
dikerjakan**: gerbang "tahan harga sampai nama + broker tercatat" dibatalkan
oleh funnel Recovery Package, yang memang menyebut harga sejak balasan pertama.
Mengembalikannya akan merusak funnel yang berlaku.

Catatan lama, ditemukan lewat test 8-turn di production (2026-09-10) terhadap Anya/tradersmastermind,
setelah fix conversation history dan model swap ke Gemini. Cek otomatis (kontrak
output, klaim hasil trading) lulus 0 pelanggaran, tapi transkrip menunjukkan
tiga masalah funnel yang cek otomatis tidak tangkap:

1. **Balasan singkat ambigu ("1", "ya", "oke") ditebak, bukan diklarifikasi.**
   Kalau history tidak memuat opsi bernomor eksplisit, AI tetap mencoba
   menjawab seolah tahu maksudnya — dalam satu kasus uji, dia malah membahas
   onboarding pasca-bayar padahal customer belum memutuskan beli.
2. **Gerbang capture nama + broker (Stage WL di sales-funnel.md) bisa
   terlewat.** Kalau customer tidak menjawab saat ditanya nama/broker dan
   melanjutkan topik lain, AI tidak menanyakan ulang dan tetap lanjut memberi
   harga di stage berikutnya — lead masuk ke harga tanpa data untuk follow-up.
3. **Bahasa hasil yang menjurus ke janji tanpa angka** ("modalmu bisa tumbuh
   lagi dengan aman") lolos filter kata terlarang (yang berbasis
   pola/angka) karena tidak menyebut figur, tapi mengarah ke arah yang sama.

Perbaikan yang diusulkan: tambah aturan eksplisit di system prompt/funnel —
(a) pesan ambigu tanpa rujukan jelas → klarifikasi dulu, jangan menebak;
(b) jangan bahas onboarding/pasca-bayar sebelum keputusan beli; (c) block
harga sampai nama+broker tercatat. Belum dikerjakan — menunggu keputusan user.

### Security

- **Eskalasi privilese ditutup**: supervisor perusahaan sebelumnya bisa
  mengubah `planStatus`, `plan`, dan seluruh kuota (`aiMessageLimit`,
  `maxUsers`, `maxPlaybooks`, `maxWhatsapp`) miliknya sendiri lewat
  `PATCH /v1/admin/company` — termasuk mengaktifkan diri sendiri dari
  trial ke `active` dan menghapus batas pesan AI. Field-field ini kini
  hanya bisa diubah oleh pemanggil API key (tim Agnee).
- **Kebocoran knowledge base lintas tenant ditutup**: `knowledgeClient`
  bisa diisi bebas oleh supervisor mana pun, sehingga satu tenant bisa
  mengarahkan AI-nya membaca playbook/FAQ/harga milik tenant lain yang
  bersifat proprietary. Field ini sekarang termasuk entitlement
  platform-only di atas.
- **Sesi tanpa company tidak lagi tembus ke tenant default**: sesi yang
  kehilangan `companyId` (token cacat, atau jalur API key tanpa header)
  sebelumnya diam-diam jatuh ke data perusahaan "default" bawaan sistem.
  Sekarang ditolak eksplisit (`401`) — tidak ada lagi tenant default yang
  bisa dijadikan tempat jatuh.
- Payload webhook inbound sekarang menyertakan `companyId`, karena satu
  URL webhook melayani seluruh tenant dan penerima sebelumnya tidak
  punya cara membedakan pesan milik perusahaan mana.

- Setup dan operations runbook lengkap, knowledge FAQ per kategori, sales
  funneling playbook, qualification schema, lead scoring, serta reply policy.
- Work history untuk mencatat keputusan arsitektur, UX WhatsApp, MCP, deployment,
  dan konsolidasi ke repository canonical Agnee.
- OAuth 2.1 Authorization Code + PKCE untuk koneksi ChatGPT, termasuk protected
  resource metadata, authorization-server discovery, dynamic client
  registration, rotating refresh token, dan login admin Agnee.
- Konfigurasi Nginx exact-host untuk tiga subdomain, TLS bootstrap, helper deploy
  Radmond, health checks Compose, volume state OAuth, dan remote MCP smoke test.
- Parameter `limit` pada `read_conversation` serta idempotency key otomatis pada
  setiap pemanggilan `send_whatsapp_message`.

- Reply pesan dari seluruh area baris melalui double-click, lengkap dengan
  quoted-message preview dan tombol reply yang muncul saat hover/focus.
- Pengiriman lampiran gambar, video, audio, dan PDF hingga 6 MB.
- Dialog percakapan baru, Contacts, Funnel, menu aksi percakapan, serta copy
  reference dengan fallback yang tetap bekerja tanpa izin clipboard.
- Lead assignment in-memory dan endpoint lead context untuk alur handoff MVP.
- Test API untuk quoted reply, attachment, idempotency, dan lead assignment.
- Status pesan lengkap: error, pending, sent, delivered, read, dan played,
  dengan tooltip yang menjelaskan arti setiap ikon.
- Fullscreen image viewer dengan download, tombol zoom, wheel/trackpad zoom,
  pinch gesture, drag/pan, double-click zoom, reset/fit, dan keyboard controls.
- Pembacaan pinned messages langsung dari WhatsApp, banner tetap di bawah header,
  daftar seluruh pesan pinned, serta navigasi dan highlight ke pesan aslinya.
- Pinned chat disinkronkan dari WhatsApp, diprioritaskan di bagian atas inbox,
  dan ditandai dengan ikon pin seperti WhatsApp Desktop.
- Quoted-message embed dapat diklik untuk memuat histori, scroll halus, dan
  menyorot pesan asli yang sedang dibalas.

### Planned

- Preview inline video, audio, dan dokumen.
- Knowledge base FAQ, klasifikasi intent, lead scoring, dan funnel persistence.
- Handoff serta assignment sales yang persisten di database.
- Persistence database untuk OAuth grants dan autentikasi multi-tenant.
- Adapter resmi WhatsApp Business Platform untuk penggunaan production ber-SLA.

## [0.2.0] - 2026-08-30

### Added

- Responsive customer inbox dengan layout desktop fixed dan mobile single-panel.
- Pairing WhatsApp real melalui QR serta penyimpanan sesi lokal.
- Daftar percakapan, riwayat pesan, avatar, foto, stiker, quoted reply, dan nama
  pengirim pada group chat.
- Call log terstruktur: arah panggilan, jenis suara/video, waktu, dan durasi jika
  tersedia.
- Delivery indicator untuk pesan keluar.
- Server-Sent Events (`GET /v1/events`) untuk refresh pesan dan acknowledgement
  tanpa reload halaman.
- Server-side search serta filter `all`, `unread`, dan placeholder `qualified`.
- Lazy loading daftar chat dan riwayat hingga 600 pesan per percakapan.
- Lead context panel yang dapat ditutup dan berubah menjadi drawer pada layar
  sempit.
- Proxy terautentikasi untuk avatar serta media gambar/stiker WhatsApp.
- Idempotency key `clientRequestId` pada pengiriman pesan untuk mencegah pesan
  ganda ketika request diulang.
- Rekonsiliasi pesan setelah error jaringan agar UI tidak menawarkan retry jika
  WhatsApp sebenarnya sudah menerima pesan.
- MCP Streamable HTTP dan stdio dengan empat tools WhatsApp yang dibatasi.
- Demo mode, Docker Compose, server helper script, unit test, dan MCP smoke test.

### Changed

- UI diubah dari mock glassmorphism menjadi business workspace khas Agnee.
- Inbox dipadatkan agar lebih banyak kontak terlihat dalam satu viewport.
- Hanya area daftar kontak dan percakapan yang scroll; rail, header, composer,
  dan lead context tetap.
- Date separator tidak lagi sticky agar tidak menutupi media.
- Kontrol yang belum memiliki backend dinonaktifkan secara jujur.
- Fallback internal WhatsApp Web memuat riwayat lama secara eksplisit ketika
  serializer upstream gagal.
- Jalur send tidak lagi bergantung pada serializer `whatsapp-web.js` yang dapat
  error setelah pesan sebenarnya terkirim.

### Fixed

- Inbox kosong walaupun WhatsApp sudah berstatus connected.
- Session restore berhenti pada status `starting`.
- Event mentah `[call_log]` tampil sebagai bubble teks.
- Preview chat memakai event teknis alih-alih pesan bermakna terakhir.
- Lead score demo tampil pada percakapan real.
- Foto profil tidak muncul pada chat berbasis LID dan group tertentu.
- Riwayat hanya membaca pesan yang kebetulan sudah ada di memori WhatsApp Web.
- Search race condition ketika query diubah cepat.
- Draft dihapus sebelum pengiriman dipastikan berhasil.
- UI menampilkan status gagal setelah pesan sebenarnya sudah terkirim, yang
  berisiko membuat pengguna mengirim duplikat.

### Security

- Signed HttpOnly session cookie untuk UI dan API key untuk server-to-server.
- Bearer token terpisah untuk MCP HTTP.
- Port container hanya di-bind ke loopback pada Compose.
- Media serta avatar diproxy melalui endpoint terautentikasi.
- Production menolak credential default yang tidak aman.

### Known limitations

- `whatsapp-web.js` bersifat unofficial dan dapat rusak ketika WhatsApp Web
  berubah; risiko logout atau account restriction tetap ada.
- Filter `qualified`, lead scoring, dan assignment sales belum memiliki database
  atau engine AI.
- Preview video, audio, dan dokumen penuh belum tersedia.
- UI saat ini ditujukan untuk satu workspace dan satu sesi WhatsApp.

## [0.1.0] - 2026-08-29

### Added

- Prototype awal login, inbox, composer, Fastify backend, WhatsApp Web adapter,
  serta MCP minimal.
- Brand assets Agnee dan demo conversation dataset.
