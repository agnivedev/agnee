# Changelog

Semua perubahan penting Agnee dicatat di file ini. Format mengikuti prinsip
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Halaman pengaturan tindak lanjut** di Settings. Mesinnya, API-nya, dan
  kunci terjemahannya sudah ada sejak rilis follow-up, tapi tidak pernah ada
  antarmukanya — supervisor tidak punya cara menyalakan atau mengatur plafon
  selain memanggil API langsung. Sekarang ada: sakelar aktif/nonaktif, batas
  kirim per hari, jarak minimum antar pesan, jam kirim, dan ringkasan berapa
  yang terkirim/dibalas/sedang berjalan.
  Salinan di halaman itu menegaskan hal yang paling sering disalahpahami:
  angkanya batas atas, bukan target, dan menyalakannya TIDAK menyasar
  percakapan lama — rangkaian hanya dimulai untuk chat baru sesudahnya.

### Fixed

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

### Fixed

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

### Changed

- `npm run check` kini ikut memeriksa `whatsapp-manager.js`, `follow-up.js`,
  dan `knowledge-loader.js` — tiga file inti yang selama ini lolos dari syntax
  check di CI.

### Added

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

### Changed

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

### Fixed

- **Hapus dokumen playbook tidak punya konfirmasi apa pun** — sekali klik
  langsung terhapus, padahal isinya dipakai AI sebagai sumber jawaban.

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

### Added

- **Knowledge base TM lengkap**: `funnel/sales-funnel.md` untuk Trader's Mastermind
  — produk Recovery Plan (Rp99k) dan Bundle Mentorship (Rp188k), Copy Trade
  Master vs Copy Trade EA, alur funnel 6 stage, FAQ, objection handling, link
  checkout, dan panduan onboarding. AI kini punya sumber fakta yang jelas
  dan tidak perlu mengarang detail produk.

- FAQ Trader's Mastermind dipecah jadi 25 entri terindeks di `faq/`
  (produk, harga, EA & copy trade, akun & broker) sehingga hanya jawaban yang
  relevan disuntik ke konteks AI per pesan, bukan seluruh dokumen funnel.

### Changed

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

### Fixed

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

### Added

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

### Fixed

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

### Changed

- Tombol rail, menu percakapan, attachment, connection status, dan handoff kini
  menjalankan aksi nyata; kontrol yang sebelumnya placeholder sudah diaktifkan.
- Composer dapat menampilkan konteks reply/lampiran tanpa menggeser area chat.
- Dialog connection menampilkan status sesi aktif dan tidak meminta QR ulang
  saat WhatsApp sudah connected.

### Fixed

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
