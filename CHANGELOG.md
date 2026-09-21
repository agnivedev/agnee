## [Unreleased]

### Added

- **Halaman Kebijakan Privasi (`/privasi`) dan Syarat & Ketentuan
  (`/ketentuan`).** Keduanya publik tanpa sesi — orang memutuskan mau mendaftar
  atau tidak justru sebelum punya akun — dan tautannya sekarang ada di footer
  halaman depan, menggantikan catatan "belum ada halamannya".
  Isinya diturunkan dari apa yang sistem ini benar-benar lakukan, bukan dari
  template: daftar data mengikuti tabel yang ada di `db/migrations`, daftar
  pihak ketiga mengikuti endpoint yang benar-benar dipanggil `src/`, dan lokasi
  penyimpanan mengikuti tempat produksi berjalan. Yang muncul dari penelusuran
  itu dan sebelumnya tidak pernah tertulis di mana pun: **server produksi ada
  di UpCloud Singapura, jadi data pelanggan disimpan di luar Indonesia** —
  keterangan yang wajib ada dan sekarang disebut terus terang. Begitu juga
  Google Fonts, yang membuat alamat IP pengunjung sampai ke server Google.
  Dua hal yang sengaja TIDAK dijanjikan berlebihan: kami tidak mengaku bisa
  bicara atas nama penyedia model soal pelatihan data (yang kami janjikan hanya
  bahwa kami sendiri tidak memakainya untuk melatih model kami), dan Syarat &
  Ketentuan menyebut apa adanya bahwa jalur QR memakai WhatsApp Web yang tidak
  resmi, bisa berhenti bekerja, dan nomor bisa diblokir Meta — risiko yang
  harus diketahui orang sebelum membayar, bukan sesudah.
  Keputusan yang diambil Hanny: entitas ditulis "Agnive"; kanal permintaan data
  `privasi@agnive.co`; data dihapus 90 hari setelah akun ditutup; pengembalian
  dana penuh dalam 7 hari sejak pembayaran pertama.

### Outstanding

- **`privasi@agnive.co` belum dibuat.** Halaman privasi menyebutnya sebagai
  kanal resmi dan menjanjikan jawaban dalam 7 hari kerja. Alamat itu harus ada
  dan dipantau (atau diteruskan ke kotak yang dibaca) **sebelum** halaman ini
  dipromosikan — halaman privasi yang menyebut alamat mati lebih buruk daripada
  yang menyebut alamat biasa.
- **Penghapusan 90 hari belum punya mekanismenya.** Tidak ada satu pun rutin
  penghapusan otomatis di kode hari ini, dan belum ada alur "menutup akun" sama
  sekali; janji 90 hari itu baru bisa ditagih saat ada akun pertama yang
  ditutup. Bangun jalurnya sebelum itu terjadi, bukan sesudah.

### Security

- **Pairing WhatsApp sekarang urusan supervisor.** Tiga rute terbuka untuk
  agent mana pun di company: `GET /v1/whatsapp/qr`,
  `POST /v1/whatsapp/qr-refresh`, dan `POST /v1/whatsapp/logout`. Yang paling
  berat justru bukan QR-nya — **`logout` membuat satu agent bisa memutus nomor
  WhatsApp perusahaan dan menghentikan seluruh percakapan masuk maupun keluar
  untuk semua orang**, dan itu baru terlihat saat memasang pagar untuk QR-nya.
  QR sendiri cukup berbahaya: siapa pun yang memegangnya bisa memindainya
  dengan WhatsApp pribadinya, dan sejak itu nomor pribadi itulah yang terpasang
  di Agnee — chat pribadinya masuk ke inbox perusahaan, percakapan perusahaan
  berhenti. `GET /v1/whatsapp/status` sengaja TETAP terbuka: header inbox
  menampilkan status koneksi, dan itu memang perlu dilihat agent.
  Tombolnya di header memang sudah disembunyikan untuk agent, tapi dialognya
  masih bisa dibuka lewat URL `?connect=<id>`, dan rutenya terbuka untuk
  siapa pun yang memanggilnya langsung. UI-nya disamakan dengan server:
  agent yang membuka dialog itu sekarang melihat keterangan bahwa pairing
  dilakukan supervisor, bukan QR yang gagal dimuat atau tombol yang mati.
  Diverifikasi di peramban dengan dua akun: agent melihat keterangan itu dan
  tidak memanggil satu pun rute yang digerbang; supervisor tetap mendapat QR
  seperti biasa.

### Changed

- **Plafon aliran SSE dihitung per company, bukan satu angka untuk seluruh
  server.** `SSE_MAX_CLIENTS = 50` berlaku global, jadi company yang ramai
  menghabiskan jatah company lain: pelanggan yang tidak melakukan apa pun
  kehilangan pembaruan realtime karena tetangganya membuka banyak tab. Sekarang
  25 aliran per company (satu aliran per tab peramban) yang menggigit lebih
  dulu — yang kena batas adalah yang menyebabkannya — dengan plafon global 200
  di atasnya untuk melindungi proses, sengaja jauh di atas plafon per company
  supaya satu tenant tidak bisa mencapainya sendiri. Pesan penolakannya juga
  dibedakan: "terlalu banyak tab terbuka untuk perusahaan ini" dan "server
  sedang penuh" adalah dua keadaan berbeda dengan tindakan berbeda.

### Changed

- **Agent yang mengintip chat yang belum diambil tidak mengirim centang
  biru.** Membuka chat di inbox memanggil `mark-read`, dan di produksi itu
  berarti `sendSeen()` — centang biru ke customer. Untuk agent yang membuka
  percakapan yang belum dipegang siapa pun, itu janji yang tidak ditepati:
  customer melihat pesannya "sudah dibaca" lalu menunggu jawaban, padahal yang
  terjadi cuma seseorang mengintip sebentar dan menutupnya lagi — dia belum
  memutuskan mau menanganinya atau tidak. Rutenya sekarang menjawab
  `200 {"seen": false, "reason": "unclaimed"}` tanpa memanggil `sendSeen`, dan
  badge unread-nya tetap menyala walau chatnya terbuka di layar: percakapannya
  memang masih menunggu seseorang.
  **Supervisor tidak berubah** — inbox itu memang miliknya, dia yang menyisir
  percakapan masuk dan membagikannya, jadi "supervisor sudah membacanya" sama
  saja dengan "perusahaan sudah membacanya". Kalau dia pun tidak menandai,
  badge inbox tidak akan pernah bisa dibersihkan oleh siapa pun yang berhak
  membersihkannya. Chat yang **sudah** diambil juga tidak berubah, dan
  membalas tetap ikut menandai sudah dibaca (`sendTextForUi` memanggil
  `sendSeen` sendiri) untuk semua — di situ memang ada orang atau AI yang
  menjawab, jadi centangnya jujur.
  UI ikut disamakan: badge baru diturunkan setelah server memastikan
  `seen: true`. Dulu ia diturunkan optimistis sebelum jawaban datang, yang
  untuk kasus agent di atas berarti badge melompat balik begitu daftarnya
  dimuat ulang.

### Fixed

- **Agent membuka chat yang belum diambil siapa pun dan dapat tiga 403.**
  Membuka percakapan yang belum dipegang siapa pun memicu tiga
  `403 Forbidden` untuk `POST /v1/chats/:chatId/mark-read` di console peramban,
  sementara semua GET-nya (messages, notes, lead, summary, routing) 200.
  Penyebabnya gerbang "ambil alih dulu": aturannya sengaja *membaca boleh,
  menulis harus mengambil alih*, dan `mark-read` kebetulan sebuah POST jadi ia
  ikut tertolak. Menandai-sudah-dibaca sekarang mengikuti aturan MEMBACA,
  bukan MENULIS: ia pembukuan dari membaca, bukan aksi baru, dan membaca chat
  itu memang sudah diizinkan. Rutenya yang memutuskan apa yang pantas
  dilakukan (lihat catatan centang biru di atas), bukan UI yang menebak-nebak
  kapan boleh memanggilnya.
  Pengecualiannya sempit dan tidak melonggarkan apa pun yang lain — **membalas
  tetap harus mengambil alih dulu**, dan percakapan yang dipegang agent lain
  tetap tertutup rapat, termasuk untuk mark-read.
  Diverifikasi di localhost (demo mode, port 4100), lewat API dan di peramban:
  agent membuka chat yang belum diambil → mark-read 200 `seen: false`, badge
  tetap 2, tidak ada baris merah di console; chat sudah diambil → `seen: true`,
  badge 2 → 0; supervisor di chat yang belum diambil → `seen: true`, badge
  2 → 0; `POST notes` dan `POST /v1/messages/send` tetap 403; mark-read ke chat
  milik agent lain tetap 403.

- **Healthcheck melaporkan sehat selama database mati.** Rute `/health` selalu
  menjawab 200, dan `docker compose` hanya melihat status HTTP-nya — itulah
  sebabnya container dilaporkan `healthy` selama 16 jam pada 21 Sep sementara
  app melayani tanpa database sama sekali, dan yang pertama tahu adalah orang
  yang tidak bisa login. Sekarang database yang seharusnya hidup tapi tidak
  menjawab membuat rute ini 503. Kondisinya juga **diukur**, bukan dibaca dari
  bendera: `database.connected` dulu dipasang sekali di `connect()` dan tidak
  pernah ditinjau lagi, jadi Postgres yang mati setelah app menyala tetap
  dilaporkan tersambung selamanya. `ping()` menjalankan `SELECT 1` (hasilnya
  di-cache 5 detik supaya pemantau tidak jadi beban sendiri) dan mengoreksi
  benderanya dua arah — termasuk kembali hidup saat databasenya pulih. Pesan
  error pg hanya masuk log, tidak ikut ke jawaban: `/health` terbuka tanpa
  autentikasi dan error pg kadang memuat host, user, dan nama database.
  Database yang memang sengaja tidak dipakai (demo/lokal) tetap 200 — di sana
  ketiadaan DB bukan kerusakan.
- **Login menjawab "Email atau password salah" untuk kerusakan kita sendiri.**
  Kalau database yang seharusnya ada sedang putus, login jatuh ke fallback
  admin dan menolak setiap pengguna asli dengan pesan yang menyalahkan
  orangnya — persis yang dilihat semua orang selama outage 21 Sep. Sekarang
  kondisi itu menjawab 503 "Layanan sedang bermasalah, bukan password", dan
  fallback admin pun tidak membuka pintu selama database aktif tapi putus.
  Fallback tetap sah kalau memang tidak ada database sama sekali (demo/lokal).

### Changed

- **Paket yang berhenti sekarang mematikan SEMUA jalur AI, bukan cuma balasan
  otomatis.** Sebelumnya hanya `generateAutoReply()` yang memeriksa
  `planStatus === 'suspended'`; ringkasan percakapan, coach, simulate,
  playground, dan playbook chat/compile tetap memanggil model, jadi perusahaan
  yang sudah tidak membayar tetap menghasilkan tagihan OpenRouter untuk kita.
  Pemeriksaannya pindah ke `getCompanyAi()` yang sudah dipanggil kedua belas
  jalur itu, jadi tertutup sekaligus, bukan satu per satu. Rutenya juga
  berhenti menyalahkan hal yang salah: "paketnya berhenti" dan
  "OPENROUTER_API_KEY belum diisi" dua masalah berbeda dengan dua tindakan
  berbeda, dan sebelumnya keduanya dijawab dengan kalimat yang sama.
- **Playground dapat rem yang sama dengan coach dan playbook** (per company,
  per jam). Itu satu-satunya rute AI yang sebelumnya tanpa batas apa pun.
- **Kuota "Pesan AI bulan ini" tetap berarti pesan ke customer** — keputusan
  Hanny, 21 Sep. Ringkasan percakapan (di produksi 199 panggilan berbanding 62
  balasan otomatis — tiga kali lebih sering) dan alat internal sengaja TIDAK
  menagih kuota, supaya angka yang dilihat pelanggan tetap berarti pekerjaan
  yang sampai ke customer-nya. Biayanya tidak hilang dari pandangan: semua
  panggilan LLM tercatat di `ai_usage_logs` lengkap dengan company dan purpose,
  dan terlihat per purpose di konsol `/superhuman`. Yang menahan jalur-jalur
  itu sekarang status paket dan rate limit, bukan kuota.

### Security

- **Rate limit login berlaku untuk seluruh platform, bukan per IP.** Di
  produksi app berada di belakang Nginx, tapi `TRUST_PROXY` tidak pernah diisi,
  jadi `request.ip` adalah IP gateway Docker untuk SETIAP permintaan — satu
  ember rate limit untuk semua tenant. Sepuluh login gagal dari siapa pun,
  termasuk pemindai otomatis yang tiap hari mengetuk server, mengunci login
  semua pelanggan selama 15 menit tanpa perlu satu akun pun.
  `.env.example` sudah memperingatkan hal ini sejak lama; yang tidak ada adalah
  apa pun yang menegakkannya. Sekarang defaultnya di kode
  (`127.0.0.1,::1,172.16.0.0/12` — loopback dan bridge Docker), bukan "mati",
  jadi deployment baru tidak bisa lagi salah diam-diam. Header
  `X-Forwarded-For` tetap diabaikan kalau permintaannya datang langsung, bukan
  dari alamat proxy di daftar itu.
  Bentuk nilainya ternyata menentukan dan tidak bisa ditebak dari dokumentasi
  — diukur pada Fastify 5.12.1: `TRUST_PROXY=1` (hitungan hop) **tidak
  memperbaiki apa pun**, `request.ip` tetap IP proxy; `TRUST_PROXY=true`
  malah lebih buruk karena memakai entri paling kiri yang dikirim klien, jadi
  satu header palsu per permintaan sudah cukup melewati rate limit. Keduanya
  sekarang menulis peringatan di log saat start.
- **Pack knowledge pelanggan lain bisa dibaca lewat Playground.**
  `/v1/admin/config` menyodorkan daftar SELURUH pack (bZone, Trader's
  Mastermind, Agnee) ke dropdown Admin setiap supervisor, dan
  `/v1/admin/playground/auto-reply` menerima pack mana pun dari daftar itu.
  Supervisor satu pelanggan tinggal memilih pack pelanggan lain lalu membaca
  FAQ, harga, funnel, dan reply policy-nya lewat jawaban AI. Kode sendiri
  sudah menyebut pack ini proprietary per pelanggan (`ENTITLEMENT_FIELDS`),
  hanya saja tidak ada yang memeriksanya. Sekarang pelanggan hanya melihat dan
  hanya boleh memakai pack miliknya; staf platform (`is_platform_admin`) tetap
  bisa memilih semuanya untuk menguji. Gerbangnya sengaja berjalan **sebelum**
  cek "OpenRouter aktif": kalau sesudahnya, jawaban untuk pack orang lain
  berubah-ubah mengikuti status LLM, dan itu sendiri sudah membocorkan bahwa
  pack itu ada. Pemilih pack hilang dari UI untuk pelanggan, karena tidak ada
  lagi yang bisa dipilih.
  Keduanya ditemukan lewat audit ulang 21 Sep — audit 20 Sep tidak
  meninggalkan laporan, jadi tidak ada yang tahu apa yang sudah dan belum
  diperiksa.

### Fixed

- **Produksi melayani 16 jam tanpa database — semua login pengguna asli
  ditolak "Email atau password salah".** Perbaikan sebelumnya menjadikan
  `connectionString: ''` berarti "matikan DB", supaya satu test demo-mode
  tidak diam-diam menyentuh Postgres CI. Tapi `''` persis yang dikirim
  produksi: Compose mengoper `PGHOST`/`PGUSER`/`PGPASSWORD` dan membiarkan
  `DATABASE_URL` kosong, jadi `config.databaseUrl` di sana memang string
  kosong. Sejak deploy 21 Sep 00:34 WIB `database.enabled` false, dan login
  jatuh ke fallback admin yang tidak mengenal satu pun pengguna asli; pesan
  masuk tidak tercatat dan follow-up tidak jalan. Sekarang hanya `null` yang
  mematikan DB — string kosong berarti "pakai env ambient", sama seperti tidak
  diberikan. Dua pagar tambahan: **di produksi app menolak start kalau database
  tidak menyala** (lebih baik deploy merah daripada melayani tanpa data tanpa
  satu pun alarm), dan `test/database-enabled.test.js` mengunci keempat
  kombinasi termasuk kondisi produksi yang kemarin tidak terwakili tes mana pun.

### Security

- **Signature webhook Meta yang kosong sekarang ditolak.** Sebelumnya, kalau
  header `x-hub-signature-256` tidak ada sama sekali, verifikasi dilewati
  diam-diam — siapa pun yang tahu URL-nya bisa menyuntikkan pesan masuk.
  Perbandingannya juga pindah ke `safeEqual`, bukan `!==`.
- **Setelan AI (enabled/model) bocor lintas tenant.** Nilainya hidup di objek
  proses global, jadi supervisor company mana pun bisa mematikan AI atau
  mengganti model untuk SELURUH tenant lain lewat `/v1/admin/ai-settings`.
  Sekarang kolom per company (migrasi `033_per_company_ai_settings.sql`),
  dengan tes regresi yang membuktikan isolasinya.
- **Password plaintext dihapus dari komentar migrasi 008** (kredensialnya
  sudah dirotasi).
- **Test tenant-isolation dan billing sebelumnya tidak benar-benar jalan di
  CI** — tidak ada Postgres di sana, jadi keduanya lewat tanpa menguji apa pun.
  Workflow deploy sekarang menyalakan service Postgres.

### Added

- **Konsol platform `/superhuman`** — satu-satunya tempat yang sengaja
  melintasi isolasi tenant, untuk staf Agnive. Perannya di
  `users.is_platform_admin` (migrasi `032_platform_admin.sql`), diberikan hanya
  lewat `scripts/grant-platform-admin.js`; tidak ada halaman yang bisa
  mengangkat superadmin, jadi bug otorisasi di halaman mana pun tidak bisa jadi
  eskalasi ke peran ini. Tiga gerbang, semuanya perlu — dan cabang kunci API
  keluar dari hook lebih dulu sehingga harus ditolak terpisah di dalam cabang
  itu (ditemukan oleh tes, bukan oleh review): tanpa itu satu kunci API bocor =
  akses seluruh pelanggan. Berandanya menampilkan tenant kumulatif, biaya AI
  harian, tenant paling boros, sebaran paket, dan trial yang segera berakhir,
  dengan grafik SVG tulisan sendiri (bundel ini ikut diunduh pelanggan).
  Sengaja belum ada: isi percakapan pelanggan dan tombol "masuk sebagai tenant".

### Changed

- **Copy landing page dan login dikasualkan** — "ga/udah/ngetik" menggantikan
  bahasa formal, plus audit menyeluruh yang membuang sisa "tidak"/"Anda"/
  "ditangguhkan" di seluruh UI.

### Added

- **Seed playbook tidak bisa lagi memundurkan produksi.** Berkas seed dan
  berkas hasil ekspor sekarang membawa stempel `seed_written_at` dan melewati
  setiap dokumen yang di database lebih baru dari stempel itu, dengan
  `RAISE NOTICE` yang menyebutkan dokumen mana dan selisih waktunya. Sebelum
  ini pengamannya hanya ingatan orang: siapa pun yang menyunting playbook di
  DB produksi harus ingat menjalankan `scripts/export-playbooks.js`, dan yang
  lupa akan memundurkan tulisannya sendiri begitu seed dijalankan ulang.
  `scripts/check-playbook-stamps.js` (dipasang di `npm run check`, jadi ikut
  jalan di CI) menggagalkan build kalau isi berkas seed berubah tapi
  stempelnya tertinggal — tanpa itu, stempelnya sendiri jadi celah baru.
  Diverifikasi terhadap PostgreSQL sungguhan, bukan hanya dibaca: suntingan
  yang lebih baru bertahan, dan dokumen yang lebih tua tetap diperbarui.
- **Mengelola tugas dari halaman `/tasks`, bukan hanya melihatnya.** Supervisor
  bisa memindahkan pemegang tugas, mengubah prioritas, dan menugaskan
  percakapan yang belum jadi tugas lewat pencarian chat — semuanya dari
  halaman itu. Rute barunya (`PATCH /v1/tasks/:chatId`) sengaja tidak
  menyentuh WhatsApp sama sekali, berbeda dari `POST /v1/chats/:chatId/routing`
  yang juga bisa mengirim pesan penutup: memindahkan penugasan tidak boleh
  gagal hanya karena nomornya sedang tidak tersambung. Aturan aksesnya sama
  seperti di panel chat — agent tidak bisa mengambil atau menutup tugas
  rekannya.
- **Notifikasi saat percakapan ditugaskan ke seseorang** (jenis `task`).
  Dipasang di `saveRouting`, bukan di rutenya, supaya semua jalur penugasan
  ikut: panel chat, daftar tugas, dan penugasan otomatis. Penugasan ke diri
  sendiri tidak menghasilkan notifikasi.
- **Notifikasi didorong lewat SSE, tidak lagi ditarik tiap 60 detik.** Frame
  yang dikirim tidak membawa isi apa pun dan hanya masuk ke aliran milik
  penerimanya (`broadcastToUser`) — isi catatan tetap ditarik lewat rute yang
  sudah memeriksa siapa pemanggilnya. Satu `EventSource` dipakai bersama
  seluruh tab (`web/src/lib/live-events.ts`); tanpa itu lonceng notifikasi
  akan membuka koneksi kedua dan memakan jatah `SSE_MAX_CLIENTS` company lain.
  Penarikan berkala tetap ada sebagai jaring pengaman, tapi 5 menit sekali.
  Jawaban `@AI` di catatan ikut memberi notifikasi ke yang bertanya — AI butuh
  beberapa detik, dan sampai sekarang jawabannya datang tanpa memberi tahu
  siapa pun.
- **Jejak audit untuk lead yang dibuka lewat `wa.me`.** Tabel `audit_logs` ada
  sejak migration 002 tapi tidak pernah dipakai; baris pertamanya adalah agent
  yang membuka percakapan dari WhatsApp pribadinya. Dicatat sebelum tabnya
  dibuka, dengan alasan yang sama seperti follow-up — tercatat tapi batal
  dibuka hanya menyisakan satu baris berlebih, sedangkan terbuka tanpa
  tercatat menghapus satu-satunya jejak yang ada. Kalau pencatatannya gagal,
  tabnya tetap dibuka: menghalangi pekerjaan karena audit gagal lebih mahal
  daripada satu baris yang hilang. Daftarnya muncul di Admin, hanya untuk
  supervisor.

- **Nama customer + fix nomor grup di Lead List/Inbox.** Lead List dibangun
  dari database dan tidak punya sumber nama sama sekali (kolom `picName`
  adalah nama agent, bukan customer); Inbox dapat nama langsung dari WhatsApp
  tapi tidak menampilkan nomor. Nama sekarang direkam saat pesan masuk, dari
  `notifyName` (whatsapp-web.js) dan `contacts[].profile.name` (Cloud API).
  Baris lama tidak bisa diisi surut — namanya memang tidak pernah tersimpan.
  Grup dilewati saat merekam (`notifyName` di pesan grup adalah nama
  pengirim, bukan nama grup) dan `phone` untuk grup sekarang `NULL`, bukan
  id grup yang terlihat seperti nomor tak bisa dihubungi
  (`120363369733804176`). Header percakapan menampilkan nomor customer
  menggantikan label "lead aktif" yang tidak memberi informasi.
- **Mention dan notifikasi antar pengguna Agnee di catatan percakapan.**
  Catatan bisa dibalas (satu tingkat) dan menyebut `@rekan`, `@AI`, atau
  `@percakapan-lain`. Mention pengguna memicu notifikasi (lonceng di
  sidebar); mention percakapan HANYA tautan navigasi — tidak pernah jadi
  penerima, karena kalau ikut, catatan internal bisa bocor ke customer.
  Id mention divalidasi dua lapis terhadap keanggotaan company sebelum
  disimpan dan sebelum notifikasi dibuat.
- **`@AI` menjawab di dalam catatan** — tidak pernah ke customer. Tiga
  pagar: tidak ada jalur ke `sendOutbound`; isi catatan diperlakukan sebagai
  pertanyaan/data, bukan instruksi sistem (diuji dengan prompt injection
  sungguhan — model menolak permintaan diskon 90% "melanggar kebijakan
  perusahaan", nol baris masuk `outbound_replies`); kuota AI paket tetap
  dihitung supaya utas catatan bukan celah melewati batas.
- **Ekspor playbook dari database ke repo** (`scripts/export-playbooks.js`).
  Playbook yang disunting langsung di DB produksi sebelumnya tidak punya
  jalur balik ke git — berkas seed diam-diam berubah dari alat pemulihan
  jadi alat pemundur. Nyaris terjadi: instruksi menjalankan ulang seed lama
  akan memundurkan tiga playbook Trader's Mastermind lima hari (lihat
  Outstanding). Mode `--check` mendeteksi drift tanpa menulis apa pun.
- **Daftar tugas** (`/tasks`) dari `conversation_routing` yang sudah ada
  sejak awal (assignee/status/priority) tapi tak pernah tampil sebagai satu
  daftar — bukan tabel baru. Agent hanya melihat tugasnya sendiri (dipaksa
  dari session, bukan dari klien); supervisor melihat semua. Endpoint status
  terpisah (`PATCH /v1/tasks/:chatId/status`) menjaga mode/assignee tetap
  sama, hanya status yang berubah.
- **Opsi buka di aplikasi WhatsApp** dari Lead List, di samping "Buka di
  Inbox". Diberi peringatan dulu: chat terkirim dari WhatsApp pribadi agent
  di perangkat itu, bukan nomor perusahaan — customer melihat nomor pribadi
  agent dan balasannya tidak pernah kembali ke Agnee. Tidak ditawarkan untuk
  grup (tidak punya nomor).

- **Isi asli pesan yang dihapus, dicoret** — bukan cuma "Pesan ini dihapus".
  WhatsApp membuang isi asli begitu pesan direvoke, tapi Agnee sudah mencatat
  isi pesan KELUAR di `outbound_replies` sejak sebelum dihapus (dan pesan
  MASUK di `inbound_messages`, kalau `wa_message_id`-nya kebetulan terisi —
  kolom itu diketahui sering kosong untuk chat `@lid`). Kalau isinya ketemu,
  ditampilkan dicoret; kalau tidak, tetap jatuh ke placeholder biasa.

- **Prompt ganti ke mode Manusia saat ketik manual sementara chat masih AI.**
  Sebelumnya, mengetik balasan sendiri padahal chat masih mode AI langsung
  terkirim diam-diam tanpa memindah mode — AI bisa ikut membalas di atasnya,
  atau "kembalikan ke AI" berikutnya mengirim pesan penutup yang nyambung
  aneh (ditemukan di produksi: pertanyaan AI yang belum dijawab customer
  diikuti "terima kasih ya" semenit kemudian). Sekarang Composer bertanya
  dulu sebelum kirim: "Ganti ke mode Manusia dan serahkan ke <nama>?" —
  ya baru mode pindah ke Manusia (diserahkan ke diri sendiri) dan pesan
  terkirim; batal tidak mengirim apa pun.

### Outstanding

- **Belum ada SLA untuk tugas.** Notifikasi sekarang ada saat penugasan
  berpindah, tapi tidak ada yang berbunyi ketika sebuah tugas terlalu lama
  terbuka. Itu butuh keputusan soal ambang waktunya lebih dulu, bukan hanya
  kode.
- **Audit baru merekam satu jenis tindakan** (`lead.open_in_whatsapp`).
  Tindakan lain yang akibatnya di luar Agnee — mengunduh seluruh daftar
  customer, misalnya — belum meninggalkan baris apa pun, padahal tabelnya
  sekarang sudah dipakai dan rutenya sudah ada.
- **Layar baru di `/tasks` dan kartu audit di Admin belum dilihat di
  peramban.** Dibangun tanpa error dan rutenya diuji lewat `app.inject` serta
  dipanggil langsung ke server lokal, tapi memeriksanya di layar butuh
  masuk akun, dan kredensialnya milik Hanny.

### Fixed

- **Semua dialog (konfirmasi, hapus pesan, edit lead, dsb) nempel di pojok
  kiri atas, bukan di tengah layar.** Browser sendiri menaruh `margin: auto`
  pada `<dialog>` modal untuk menengahkannya, tapi Tailwind preflight
  menimpanya jadi `margin: 0` untuk SEMUA elemen. Satu komponen `Dialog`
  dipakai semua modal di app, jadi satu baris `m-auto` membetulkan semuanya
  sekaligus.

- **Percakapan hilang total dari Inbox kalau pesan terakhirnya dihapus.**
  Ditemukan lewat laporan Hanny: dua lead nyata menghilang dari Agnee setelah
  pesan terakhirnya dihapus langsung dari WhatsApp. Akar masalahnya beda dari
  perbaikan "pesan dihapus dicoret" sebelumnya — itu memperbaiki tampilan
  DALAM satu percakapan yang sudah terbuka; bug ini ada di filter TERPISAH
  yang menentukan chat mana yang muncul di daftar Inbox sama sekali
  (`isConversationMessageForUi`), dan filter itu belum menganggap pesan
  `revoked` sebagai "pesan terakhir yang sah" — chat dengan HANYA satu pesan
  yang sudah dihapus dianggap tidak punya pesan sama sekali, jadi tersaring
  keluar seolah percakapan itu tidak pernah ada. Sekarang `revoked` diakui,
  dan pratinjaunya di daftar Inbox menampilkan "Pesan dihapus".
  **Ada DUA jalur kode independen yang membangun daftar Inbox** (jalur
  standar `wa.getChats()`, dan snapshot cadangan lewat `pupPage.evaluate`
  yang dipakai kalau jalur standar gagal serialisasi) — keduanya punya
  logic visibilitas pesan sendiri-sendiri, jadi keduanya harus diperbaiki
  terpisah. Baru ketahuan lolos di jalur cadangan setelah perbaikan pertama
  ternyata belum menyelesaikan laporan Hanny.

### Added

- **Board Kanban CRM** (`/pipeline`) — pindahkan lead antar kolom Cold/Warm/
  Hot/Closing/Lost/On Hold secara visual, di atas fondasi stage CRM yang
  sudah dibangun sebelumnya. Endpoint baru `GET /v1/leads/pipeline` (`agnee-df`).
- **Klik baris di Lead List** sekarang memunculkan pilihan: buka percakapannya
  langsung di Inbox, atau lihat & edit detailnya lewat modal (ringkasan,
  ditangani/PIC, prioritas, tahap CRM — sisanya read-only).
- **Link http(s) di bubble chat sekarang biru dan bisa diklik** — sebelumnya
  tampil sebagai teks polos tak bisa disentuh. Tanda baca di akhir kalimat
  tidak ikut ke dalam link.
- **Pesan yang dihapus tetap tampil di riwayat, dicoret** — sebelumnya
  "hapus untuk semua orang" membuat pesan hilang total dari tampilan begitu
  riwayat dimuat ulang (WhatsApp menandai pesan sebagai `revoked` dengan isi
  dikosongkan, dan filter riwayat membuang semua pesan berisi kosong). Sekarang
  pesan `revoked` tetap muncul di posisinya dengan teks "Pesan ini telah
  dihapus" (atau "Pesan ini kamu hapus" kalau kita sendiri yang menghapusnya),
  dicoret dan miring — tanpa tombol aksi, karena tidak ada lagi yang bisa
  dilakukan ke pesan yang sudah dihapus.
- **Nomor WhatsApp asli untuk chat `@lid`** — chat dengan fitur privasi nomor
  WhatsApp Business mengirim id internal buram (mis. "248627670863983"),
  bukan nomor telepon, dan Lead List sebelumnya menampilkan id itu apa
  adanya di kolom "Nomor WhatsApp". Sekarang di-resolve lewat API internal
  WhatsApp (`WAWebApiContact.getPhoneNumber`, butuh koneksi yang hidup) dan
  di-cache di tabel baru `lid_phone_map` supaya tidak ditanyakan ulang tiap
  kali tabel dibuka. Gagal diam-diam per baris — kalau WhatsApp sedang tidak
  siap atau resolusinya gagal, id `@lid` tetap tampil seperti sebelumnya.
- **Menu sidebar disatukan dan bisa diciutkan.** Rail ikon di inbox dan
  sidebar lebar di Lead List/Settings/Admin/Knowledge dulu punya daftar menu
  BERBEDA — sidebar lebar hilang Contacts, Funnel, Train AI, Admin, dan
  Logout sama sekali. Sekarang keduanya membaca dari satu daftar
  (`nav-entries.ts`), jadi menunya identik di semua halaman. Sidebar lebar
  juga bisa diciutkan jadi ikon saja (tersimpan per-browser), dengan tooltip
  hover yang menampilkan labelnya. Sekalian: Train AI/Admin/Settings dari
  rail pindah dari reload halaman penuh (`window.location.href`) ke navigasi
  SPA (`navigate()`), konsisten dengan Lead List yang sudah begitu.

### Fixed

- **AI menanyakan balik maksud customer, persis pola yang sudah lama dilarang
  di prompt tapi tidak pernah ditegakkan di kode.** Ditemukan di produksi
  2026-09-16: customer membalas "Gimana kak" (pertanyaan lanjutan yang sah)
  dibalas "Maksudnya gimana apanya kak?" — membuat customer merasa disalahkan.
  Aturan larangan ini sudah ada di `AGNEE_CONVERSATION_RULES` butir 11 sejak
  lama (dengan contoh persis "maksudnya yang mana ya kak"), tapi larangan
  prompt saja terbukti tidak cukup dua kali di dua company berbeda. Sekarang
  ditegakkan di kode seperti klaim hasil/risiko dan placeholder `{jam}`:
  balasan yang menanyakan balik maksud customer ditulis ulang sekali oleh
  model, dan kalau masih melanggar, kalimatnya dibuang.

### Added

- **Stage CRM (pipeline) terpisah dari flag kualifikasi AI**: field baru
  `pipeline_stage` di `lead_states` (cold/warm/hot/closing/lost/on_hold),
  sengaja terpisah dari `stage` lama (inbox/qualified/assigned) yang murni
  penanda kualifikasi otomatis. AI HANYA boleh mengusulkan — setiap kali
  `summarizeConversation()` jalan, prompt LLM yang sama (tidak ada panggilan
  tambahan) diminta juga menaksir `pipelineStage` + alasan singkat; hasilnya
  disimpan sebagai *usulan* (`pipeline_stage_suggested`), bukan langsung
  menimpa stage aktif. Panel lead menampilkan pita usulan dengan alasannya
  dan tombol Terima/Abaikan; klik Terima baru memindahkan `pipeline_stage`
  yang aktif. Selain itu tersedia 6 tombol pill untuk pindah stage manual
  kapan saja. Endpoint baru: `PATCH /v1/chats/:chatId/pipeline-stage` (manual
  atau terima usulan) dan `DELETE /v1/chats/:chatId/pipeline-stage/suggestion`
  (abaikan usulan). Board kanban drag-drop terpisah menyusul — ini baru
  fondasi data model + alur usul/konfirmasi dari panel lead.
  Migrasi: `db/migrations/028_crm_pipeline_stage.sql`.

- **Edit dan hapus pesan langsung dari inbox** (icon di samping bubble saat
  hover, bukan klik kanan): pensil untuk edit (hanya pesan teks milik kita
  sendiri), tempat sampah untuk hapus untuk saya (semua pesan), dan tempat
  sampah merah untuk hapus untuk semua orang (hanya pesan milik kita).
  WhatsApp sendiri yang menentukan jendela waktu dan siapa yang boleh — kita
  hanya meneruskan aksinya dan menampilkan pesan yang jelas kalau ditolak.
  Implementasinya SENGAJA tidak lewat `wa.getMessageById()` bawaan
  whatsapp-web.js: method itu memakai `getMessageModel()`, fungsi yang sama
  yang membuang getter `_serialized` untuk chat `@lid` (akar dua bug riwayat
  percakapan yang sudah diperbaiki hari ini). Edit/delete di sini menyalin
  logic `Message.prototype.edit()`/`.delete()` persis, tapi dijalankan dalam
  satu `pupPage.evaluate` yang menerima id pesan sebagai string dari luar dan
  mengembalikan status sederhana — tidak pernah mencoba serialize objek
  Message kembali ke Node.

### Fixed

- **Balasan otomatis kehilangan riwayat percakapan lewat jalur yang berbeda
  dari UI — regresi dari perbaikan `Object.assign` sebelumnya.**
  `generateAutoReply()` punya implementasi sendiri (`message.getChat()` +
  `chat.fetchMessages()` langsung) tanpa fallback apa pun; kalau serialisasi
  standar whatsapp-web.js melempar (error "r" yang sama yang sudah lama
  muncul di jalur baca UI), catch kosong menelannya diam-diam dan riwayat
  jatuh ke `[]` tanpa jejak. Ditemukan lewat log produksi 2026-09-16: satu
  chat membalas dengan `riwayat:0` di giliran ke-8, dan transkripnya
  menunjukkan akibatnya persis — pertanyaan discovery dan tawaran call yang
  sama diulang tiga kali karena setiap balasan digenerate seolah kontak
  pertama.
  Sekarang `generateAutoReply()` memakai `getMessagesForUi()` yang sama
  dengan jalur UI dan ringkasan percakapan — fungsi itu sudah punya fallback
  snapshot lewat `pupPage.evaluate` langsung untuk persis kegagalan ini. Satu
  jalur robust dipakai UI, ringkasan, dan balasan otomatis, bukan tiga
  implementasi yang bisa gagal dengan cara berbeda-beda. Kegagalan yang
  tersisa sekarang dicatat di log, bukan ditelan diam-diam.

### Planned

- **Tanggal webinar belum ditentukan.** Materinya sudah ada, tapi jadwalnya
  belum — halaman sengaja tidak menyebut tanggal apa pun, jadi tidak ada janji
  yang dilanggar. Tentukan tanggalnya sebelum mengiklankan halaman ini.
- **Produk Mayar Rp0 untuk kedua umpan belum dibuat.** Konstanta `MAYAR_EBOOK`
  dan `MAYAR_WEBINAR` di `LandingPage.tsx` sengaja dikosongkan: selama kosong,
  tombolnya jatuh ke jalur WhatsApp yang memang sudah hidup. Perhatikan bahwa
  akun Mayar yang terhubung ke repo ini milik Traders Mastermind, bukan Agnive.
- ~~**Halaman Kebijakan Privasi dan Syarat & Ketentuan belum ada.**~~
  **SELESAI 2026-09-21** — keduanya ada di `/privasi` dan `/ketentuan`, dan
  tautannya sudah dipasang di footer.

### Fixed

- **Placeholder template `{jam}` bocor mentah ke customer.** Instruksi call
  Anya/Rizki di `knowledge/clients/tradersmastermind/funnel/sales-funnel.md`
  memakai notasi `{jam}` sebagai contoh yang harus diisi model dengan jam
  sungguhan — tapi tidak selalu diganti. Ditemukan di produksi 2026-09-16: 15
  balasan menjanjikan jadwal call ke delapan chat berbeda, satu di antaranya
  mengirim "...jam {jam} WIB..." apa adanya. `enforceReplyContract` sekarang
  mendeteksi pola `{kata}` sebagai pelanggaran keras — sejajar dengan klaim
  hasil/risiko — dan membuang kalimat yang memuatnya sebelum terkirim.
- **Follow-up bisa menawarkan checkout ke orang yang sudah setuju dijadwalkan
  telepon.** `checkoutAlreadySent` sudah membaca konteks, tapi tidak tahu soal
  janji call — follow-up untuk chat yang sedang menunggu telepon Anya/Rizki
  bisa saja menanyakan "sudah checkout?" alih-alih soal panggilannya.
  `callPromisePending()` membaca balasan kita yang terakhir dengan pola yang
  sama (`COMMITMENT_MARKERS`) yang sudah dipakai untuk mengenali giliran CS
  yang menutup sesuatu — satu sumber kebenaran untuk "ini janji call", dipakai
  di balasan customer maupun balasan kita sendiri. Kalau menggantung, follow-up
  dilarang menawarkan apa pun yang baru dan hanya boleh menanyakan status
  panggilannya. Ini mengalahkan `checkoutSent` kalau keduanya sama-sama benar.

### Added

- **Ikon nyata (lucide-react) di seluruh navigasi**, menggantikan karakter
  unicode (◇ ▤ ◈ dst) yang terlihat seperti teks biasa di layar kecil. Dipakai
  di `AppSidebar` (Inbox/Lead List/Settings), `Rail` inbox (delapan aksi), tab
  Settings (Paket, WhatsApp, AI & Follow-up, Data, Tim), dan tiap kartu dokumen
  di halaman Knowledge — satu ikon per jenis dokumen (persona, larangan,
  qna, discovery, objection, closing, follow-up, handoff).
- **Daftar dokumen Knowledge sekarang sticky + scroll sendiri** di layar lebar
  (`lg:sticky lg:top-7 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto`).
  Delapan dokumen muat hari ini, tapi daftar yang bertambah tidak lagi
  mendorong panel isi dokumen ke bawah — ia bergulir di dalam kontainernya
  sendiri sementara halaman tetap diam.

- **Ebook CS "Balas Chat Tanpa Kehabisan Diri Sendiri"** — 38 halaman A5, delapan
  bab, untuk orang yang membalas chat setiap hari dan bukan untuk pemilik bisnis:
  beban keputusan, dua belas template, menghadapi orang marah, membaca sinyal
  siap beli, follow-up yang tidak menagih, serah terima antar shift, menutup
  hari, dan checklist siap cetak. Tiap bab ditutup kotak yang menunjukkan bagian
  mana yang sudah dikerjakan Agnee. Sumbernya `marketing/ebook/ebook.html`,
  dirender ke PDF dengan headless Chrome.
- **Materi training "Closing di Bawah 15 Menit"** — 23 slide 16:9 untuk melatih
  agent CS: kerangka lima tahap (buka, gali, cocokkan, tangani keberatan, tutup)
  dengan alokasi menit, transkrip percakapan utuh yang dibedah per tahap, kartu
  role-play, dan checklist saku. Sumbernya `marketing/webinar/deck.html`.

- **Landing page depan jadi halaman jualan per fitur.** `/landing` ditulis ulang
  dari satu pitch umum menjadi empat band fitur yang masing-masing dijual dua
  sisi: apa yang perusahaan dapat, dan apa yang CS-nya dapat. Sudut pandang itu
  yang membedakannya dari copy SaaS biasa — yang dimudahkan bukan cuma
  perusahaannya, tapi orang yang membalas chat setiap hari. Ditutup promo tiga
  paket (Personal Rp99.000/bln, Company Rp3.900.000/bln, Lifetime Rp29.900.000
  sekali bayar) dengan batas 100 perusahaan pertama, plus strip white label.
- **Dua umpan di halaman depan.** Ebook untuk CS diletakkan di tengah, tepat
  setelah dua band yang paling menyentuh pekerjaan harian mereka; webinar
  diletakkan tepat sebelum harga, karena niat pembacanya sudah lebih tinggi di
  sana. Keduanya punya dua jalur pendaftaran: Mayar kalau produknya sudah ada,
  dan WhatsApp yang selalu hidup — dilayani Agnee sendiri, jadi calon pelanggan
  mengalami produknya sebelum membelinya.

### Removed

- **Empat testimoni karangan dan empat angka hasil tanpa sumber** dibuang dari
  landing page. Testimoninya memakai nama, jabatan, perusahaan, dan bintang lima
  dari orang yang tidak pernah mengatakannya; angkanya ("500+ chat dihandle hari
  ini", "<3 dtk rata-rata response AI", "10+ tim CS onboard beta") tidak punya
  sumber di mana pun di repo. Ruang yang ditinggalkan diisi grid "15 hal kecil
  yang berhenti mengganggu" — pernyataan tentang apa yang dilakukan produk,
  tanpa nama, foto, atau bintang. Blok testimoni boleh dipasang lagi hanya
  dengan kutipan asli yang orangnya sudah menyetujui namanya ditampilkan.
- **Dua klaim fitur yang tidak ada di kode.** "Distribusi traffic cerdas — chat
  dibagi otomatis ke agen yang available" (yang ada adalah pengambilalihan saat
  agent mengetik, bukan pembagian chat) dan "response time rata-rata" di laporan
  (yang dicatat `ai_usage_logs` adalah token dan biaya, bukan waktu balas).

### Changed

- **Plafon di kartu harga disamakan dengan yang diberlakukan server.** Personal
  1 pengguna / 1 nomor / 1 playbook / 500 pesan AI per bulan, Company 5 pengguna
  dan sisanya tanpa plafon angka — sesuai batas paket di `src/database.js`.
  "Unlimited pesan AI" diganti "tanpa plafon angka" dengan catatan pemakaian
  wajar yang menyebutkan apa yang benar-benar terjadi kalau pemakaian melonjak:
  dihubungi dulu, tidak diputus tiba-tiba.
- **Angka di pita bukti diganti angka yang bisa ditunjuk barisnya** — 30 menit
  (`AUTO_ASSIGN_IDLE_MINUTES`), 8 dokumen (`Database.PLAYBOOK_KINDS`), 2 penulis
  1 tanda (kolom `author` di migrasi 014), 3 pengaman follow-up (`src/follow-up.js`).


### Fixed

- **"Oke" dibalas "Maksudnya yang mana ya kak?".** CS menutup dengan jadwal
  call, lead membalas "Oke", dan CS menanyakan maksudnya — lead lalu menulis
  "Saya krng paham". Penjaga balasan pendek menggolongkan semua "ya"/"oke"
  sesudah pesan tanpa tanda tanya sebagai ambigu; pembedanya ternyata bukan
  tanda tanya, melainkan apakah giliran CS terakhir menutup sesuatu yang sudah
  disepakati. Balasan pendek kini digolongkan tiga (`classifyShortReply`):
  bukan balasan pendek, ambigu, atau pengakuan. Pengakuan **selalu dibalas** —
  yang berganti isinya: ronde pertama ucapan terima kasih, ronde berikutnya satu
  keterangan baru tentang apa yang sudah disepakati, dengan larangan mengulang
  kalimat sebelumnya. Pertanyaan sungguhan di antaranya mengembalikan hitungan
  ke nol.
- **Pertanyaan "maksudnya yang mana ya kak?" dihapus seluruhnya.** Menanyakan
  maksud customer menaruh beban pada orang yang sudah menjawab dan terbaca
  seperti diajak berdebat. Penjaga balasan ambigu tetap ada — menebak "setuju
  beli" lalu mengirim link pembayaran masih dihindari — tapi isinya berubah:
  akui balasannya, lalu tawarkan satu langkah lanjutan yang konkret, sehingga
  customer tinggal memilih alih-alih menjelaskan dirinya.
- **Label hanya bisa disunting sebagai teks dipisah koma.** Membuang satu dari
  lima berarti mencari koma yang tepat; salah satu karakter menggabung dua
  label. Sekarang tiap label adalah chip dengan tombol buangnya sendiri, dengan
  penolakan duplikat tanpa memandang besar-kecil huruf.
- **Hasil pencarian kontak lama menimpa yang baru** di kolom tujuan percakapan
  baru: membersihkan timer debounce tidak membatalkan permintaan yang sudah
  terbang.
- **Penawaran Rp99.000 terkirim tanpa cara mengambilnya.** Dua percakapan
  produksi 2026-09-16 berakhir identik: AI menyebut paketnya, customer membalas
  "Caranya kak?", agent manusia yang menutup. Batas satu link per balasan
  membuang link paket dari balasan pembuka yang memang menawarkan dua jalan
  bernomor, sambil membiarkan kalimat penawarannya tetap tinggal. Batasnya
  dinaikkan menjadi dua (`MAX_LINKS_PER_REPLY`); link ketiga dan seterusnya
  tetap dibuang, sekarang bersama kalimat yang memperkenalkannya.
- **Link Rp99.000 salah sasaran.** Sebagian besar lead datang dari iklan
  WhatsApp Meta yang membuka percakapan langsung dan belum pernah melewati
  halaman penawaran, sehingga yang mereka terima adalah formulir bayar untuk
  sesuatu yang belum pernah mereka baca. `/lp/trading-recovery-plan` kini
  bawaan setiap kali paket diperkenalkan; `/pl/...-checkout` hanya untuk lead
  yang sudah menyatakan siap. Keduanya diperiksa masih melayani 200.
- **Template balasan pertama dipakai di tengah percakapan.** Lead menjawab
  "Recovery", tidak ada blok playbook yang cocok dengan jawaban kondisi, dan
  model jatuh kembali ke varian pembuka — menyapa ulang dan menanyakan yang
  baru saja dijawab. Bagian itu sekarang ditandai khusus pesan pertama,
  ditambahi blok untuk jawaban kondisi, dan kalimat "kirim apa adanya" dicabut
  karena terbaca sebagai perintah menyalin template mentah-mentah.

### Added

- **Kolom tujuan percakapan baru bisa memilih percakapan yang sudah ada**, bukan
  hanya menerima nomor yang diketik ulang. Bukan buku kontak ponsel: nomor
  telepon tidak tersimpan di sisi kita — id chat WhatsApp berbentuk `@lid` —
  jadi yang bisa ditawarkan hanya orang yang pernah chat.
- **Panjang riwayat percakapan dicatat per balasan otomatis** (`riwayat` di log
  `Riwayat percakapan untuk balasan otomatis`). Gejala menyapa ulang bisa
  berarti riwayat kosong atau template disalin mentah, dan dua kali sudah salah
  tebak dari teks balasannya saja.

### Verified

- **Simulasi ulang percakapan yang rusak, 2026-09-16.** Sepuluh giliran yang
  sama diputar lewat `/v1/coach/simulate` di produksi setelah perbaikan riwayat.
  Perkenalan diri sekali saja, bukan lima kali. "100%" dibaca benar sebagai loss
  100% dan dijawab soal margin call, bukan soal garansi. "Mt5" dan "Valetax"
  dicatat lalu percakapan maju, tidak ditanyakan ulang. "Setelah ada dana saya
  akan ikuti" tidak lagi dibalas link checkout.
  **Yang masih meleset:** call dengan Anya atau Rizki tidak pernah ditawarkan
  walau playbook penutupnya sudah memuatnya, dan satu giliran mengirim dua link
  sekaligus — melanggar aturan satu pesan satu ajakan.

### Added

- **Aturan percakapan bawaan Agnee**, berlaku untuk semua tenant, di
  `src/reply-style.js` dan disisipkan ke setiap prompt: dokumen adalah sumber
  fakta bukan naskah; jangan mengulang tawaran yang sama dua kali; jangan
  memperkenalkan diri lagi di tengah percakapan; setiap percakapan harus menuju
  satu ujung; tiga giliran tanpa kemajuan berarti serahkan ke manusia.
  Bentuk percakapan milik Agnee dan seragam lintas company; APA ujungnya tetap
  milik playbook tiap company. Ditaruh di akhir prompt karena instruksi di ujung
  lebih konsisten dipatuhi daripada yang terkubur di tengah.
- **Penutup Trader's Mastermind diubah jadi menjadwalkan call**, bukan mengirim
  link. Tiga ujung yang sah: checkout Rp99.000, janji call dengan Anya atau
  Rizki dengan dua pilihan jam konkret, atau minimal join free signal Telegram.
  Call tetap terbuka untuk lead yang bilang belum punya dana — call tidak
  memerlukan uang. Berlaku di `knowledge/` dan di playbook `closing` produksi.

### Fixed

- **AI tidak pernah melihat riwayat percakapan. Sama sekali, sejak awal.**
  Penyaring riwayat membandingkan `m.id._serialized !== message.id._serialized`.
  `chat.fetchMessages()` memetakan tiap pesan lewat `getMessageModel`, yang
  membuang getter itu untuk chat `@lid` — semua percakapan produksi. Dengan
  kedua sisi `undefined`, perbandingannya bernilai false dan SETIAP pesan
  tersaring keluar: `conversationHistory` selalu array kosong.
  Akibatnya tiap balasan disusun seolah kontak pertama. Di produksi terlihat
  sebagai AI yang memperkenalkan diri berulang kali di tengah percakapan,
  menanyakan nama broker yang baru saja dijawab, dan salah membaca "100%"
  sebagai rujukan ke garansi. Bukan masalah prompt — konteksnya memang tidak
  pernah ada.
- **Perkenalan diri dihapus dari template balasan** Trader's Mastermind, di
  `knowledge/` dan di playbook `discovery` pada produksi.

- **Akar id pesan masuk yang hilang: `getMessageModel` milik whatsapp-web.js
  yang membuangnya.** Selama ini dicatat sebagai "bug serialisasi"; ternyata
  lebih sempit dan bisa ditunjuk barisnya. `_serialized` adalah getter di
  prototype MsgKey, dan library menjalankan
  `Object.assign({}, msg.id, { remote: ... })` setiap kali `msg.id.remote`
  bertipe object. `Object.assign` hanya menyalin own property, jadi getter-nya
  hilang di baris itu. Syaratnya berlaku untuk chat `@lid` — yaitu SEMUA
  percakapan di produksi, yang menjelaskan 80 dari 80 baris kosong.
  Id-nya sekarang dirakit ulang dari bagian yang selamat, dengan format yang
  sama seperti aslinya: `fromMe_remote_id[_participant]`.
- **Log jalur kirim tidak membedakan dua kegagalan yang sangat berbeda.**
  `WWebJS.sendMessage` diakhiri `Msg.get(newMsgKey._serialized)` SETELAH
  `addAndSendMsgToChat` menembak, dan `Msg.get` yang tidak menemukan
  mengembalikan undefined, bukan melempar. Jadi "pesan terkirim tapi pemanggil
  menganggap gagal" kemungkinan besar bukan lemparan sama sekali, melainkan
  pencarian model balik yang meleset — balapan, bukan serialisasi. Log sekarang
  mencatat `failureKind` (`threw` atau `empty`) supaya dugaan itu bisa
  dibuktikan pada kiriman berikutnya.

- **Penjaga pesan masuk ganda tidak pernah bekerja.** `UNIQUE (company_id,
  wa_message_id)` hanya menahan kalau kolomnya terisi — Postgres menganggap tiap
  NULL berbeda. Di produksi id WhatsApp tidak pernah sampai ke sana: 80 dari 80
  baris kosong, padahal `connection_id` di baris yang sama terisi setelah
  perbaikan kemarin. Baris ganda memang sudah muncul, lima pasang. Sekarang
  kalau id aslinya tidak ada, kunci diturunkan dari percakapan, detik, tipe, dan
  isi pesan — cukup untuk menahan tembakan ulang setelah reconnect, yang memang
  satu-satunya tugas penjaga ini.

- **Agent membuka percakapan, isinya kosong.** Hook cakupan agent menolak SEMUA
  permintaan ke percakapan yang belum dipegang siapa pun, termasuk membaca
  pesannya — jadi percakapan itu muncul di daftar inbox tapi kolom kanannya
  kosong, dengan alasan yang salah pula: "Chat ini ditangani oleh agent lain"
  padahal tidak ada yang memegangnya. Sekarang membaca boleh untuk percakapan
  yang tidak dipegang orang lain (aturan yang sama dengan daftar inbox), dan
  menulis tetap menuntut ambil alih dulu. Percakapan yang dipegang agent lain
  tetap tertutup, termasuk untuk dibaca.

### Added

- **Lead List terbuka untuk agent**, dengan baris yang tersaring memakai aturan
  yang sama dengan inbox: percakapannya sendiri dan yang belum dipegang siapa
  pun. Tanpa penyaringan itu halaman ini jadi pintu belakang — daftar lengkap
  nomor dan isi pesan seluruh customer, termasuk yang dipegang agent lain.
  Unduhan XLSX dan CSV tetap supervisor saja: satu berkas berisi seluruh daftar
  customer adalah hal yang berbeda dari melihat percakapan sendiri.

### Changed

- **Mode demo memakai id WhatsApp yang sah** (`6281200000001@c.us` dan
  seterusnya), bukan `demo-raka`. Id lama bukan alamat WhatsApp, jadi
  `normalizeChatId` menolaknya 400 sebelum permintaan sampai ke fitur yang
  sedang diuji. Tiga verifikasi terhalang karenanya dalam satu hari.
- **Penjagaan kepemilikan di rute kirim dipindah ke atas cabang mode demo.**
  Selama pengecekannya di bawah, mode demo memintasnya dan aturan "ambil alih
  dulu sebelum membalas" tidak pernah bisa diuji tanpa WhatsApp sungguhan.

### Fixed

- **Inbox agent selalu kosong, dan tidak ada jalan keluar.** Daftar percakapan
  menyaring agent dengan syarat `mode === 'human' && assignee === saya`, padahal
  tiap percakapan bermula di mode `ai` tanpa assignee. Tidak satu pun lolos,
  dan agent tidak bisa mengambil alih apa pun karena tidak ada yang terlihat
  untuk diambil. Syaratnya bertentangan dengan aturan klaim di hook preHandler,
  yang justru mengizinkan agent mengambil percakapan yang belum dipegang.
  Sekarang agent melihat percakapannya sendiri dan yang belum dipegang siapa
  pun; yang dipegang agent lain tetap tersembunyi. Satu aturan, dua tempat.
- **Menonaktifkan anggota tidak melepas percakapan yang dia pegang.** Percakapan
  itu tersangkut di mode `human` dengan pemilik yang tidak bisa login lagi:
  agent lain tidak melihatnya karena dianggap milik orang lain, dan AI juga
  tidak membalas. Customer-nya diam tanpa ada yang tahu. Sekarang percakapannya
  kembali ke AI dalam transaksi yang sama.

### Added

- **Kursor langsung siap di kolom balasan saat percakapan dibuka.** Tidak
  berlaku di layar sentuh: memfokuskan di sana menaikkan keyboard layar menutupi
  pesan yang justru baru saja dibuka orangnya.

### Fixed

- **Draf balasan terbawa antar percakapan.** Composer tidak pernah di-reset saat
  chat berganti, jadi teks yang diketik untuk satu orang duduk di composer orang
  berikutnya — satu Enter dari terkirim ke alamat yang salah. Kutipan "balas
  pesan ini" ikut terbawa dengan cara yang sama. Ditemukan saat menguji fokus
  otomatis, yang memperburuknya: kursor mendarat di kolom yang sudah berisi
  pesan untuk orang lain.

### Changed

- **Bundel dipecah per route.** Settings, Admin, Lead List, dan landing dimuat
  saat dibuka, bukan di muat pertama; inbox sengaja tetap di bundel awal karena
  itu halaman yang dituju semua orang setelah masuk.
  Dependency dipisah ke chunk `vendor` sendiri **berdasarkan path node_modules,
  bukan nama paket**: aplikasi mengimpor `react-dom/client`, dan entri
  `manualChunks` bernama `'react-dom'` tidak menangkapnya — react-dom ikut
  masuk ke chunk aplikasi, dan itu sebagian besar bobotnya.
  Hasilnya: satu berkas 518 kB (gzip 156 kB) jadi aplikasi 146 kB (gzip 46 kB)
  + vendor 289 kB (gzip 92 kB) + enam chunk sesuai kebutuhan. Peringatan ukuran
  dari Vite hilang.
  **Yang benar-benar membaik adalah kunjungan setelah deploy**, bukan muat
  pertama: total gzip muat dingin 150 kB, hampir sama dengan sebelumnya karena
  vendor tetap ikut. Tapi deploy berikutnya hanya mengubah chunk aplikasi 46 kB;
  vendor tetap di cache.

- **Mulai rangkaian tindak lanjut baru** untuk percakapan yang rangkaiannya
  sudah habis. Sebelum ini, sekali sebuah percakapan memakai seluruh plafonnya,
  tidak ada jalan kembali kecuali customer bicara duluan.
  Tiga penjaga: hanya rangkaian yang berhenti karena `exhausted` yang boleh
  (bukan `opted_out`, `replied`, `undeliverable`, atau `human_takeover`), harus
  lewat jeda hari yang disetel supervisor (`restartAfterDays`, 0 = tidak boleh
  sama sekali), dan tombolnya minta konfirmasi. Pita kuning muncul di percakapan
  yang sudah dimulai ulang dua kali atau lebih — memperingatkan, tidak
  menghalangi.
  Membuatnya menyingkap bahwa **dua pengaman lama menolak rangkaian baru
  sebelum satu pesan pun keluar**: plafon absolut menghitung semua baris
  `follow_up_sends` sepanjang masa, dan `UNIQUE (company_id, chat_id,
  day_index, attempt_in_day)` bertabrakan karena rangkaian baru memakai hari
  ke-0 percobaan ke-1 lagi. Migration 024 menambah `sequence_no`; hitungan dan
  kunci unik sekarang per rangkaian, riwayat lama tetap tersimpan.

- **Konfirmasi saat menyalakan tindak lanjut otomatis**, menyebut angka yang
  benar-benar akan berlaku (plafon per hari dan jam kirim). Menyalakan berarti
  AI mulai mengirim ke customer sungguhan; satu klik yang tidak disengaja
  pernah berujung insiden. Mematikan tidak ditanya — berhenti mengirim selalu
  aman.

### Fixed

- **`inbound_messages.connection_id` selalu kosong.** `whatsapp-manager`
  memanggil `onMessage(companyId, message, connectionId)` dengan string,
  sementara `handleInboundMessage` membaca `meta.connectionId` dari sebuah
  objek. Nol dari 61 baris di produksi punya nomor penerima, jadi tidak ada
  yang tahu nomor mana yang menerima pesan mana. Jalur Cloud API sudah benar.
- **Media dari nomor kedua tidak bisa diambil.** `/v1/messages/:messageId/media`
  selalu dilayani nomor utama karena route-nya tidak tahu percakapan mana yang
  dimaksud, padahal media hidup di dalam browser nomor yang menerimanya.
  Sekarang route menerima `?chatId=` dan memetakannya ke nomor lewat
  `whatsapp_chat_numbers`, jalur yang sama dengan operasi per-chat lain. Tanpa
  parameter itu tetap nomor utama, jadi pemanggil lama tidak berubah.
- **Sebelas teks penjelas di Settings tidak pernah tampil.** Rewrite React
  memakai keluarga kunci i18n yang pendek dan meninggalkan yang panjang, jadi
  `fu.intro`, `fu.enableHint`, `fu.gapHint`, dan `fu.windowHint` yatim.
  Yang paling merugikan `fu.windowHint`: kolom jam kirim tidak pernah menyebut
  zona waktunya, padahal servernya memakai WIB.
- **Kotak centang tindak lanjut berlabel status, bukan aksi** — terbaca
  "Nonaktif" di sebelah kotak kosong, sehingga mencentangnya seolah berarti
  mematikan. Sekarang labelnya menyebut apa yang terjadi kalau dicentang;
  statusnya tetap di badge kartu.

### Changed

- CI: `actions/checkout` dan `actions/setup-node` naik ke `v5`. Keduanya masih
  memakai runtime Node 20 yang sudah usang dan memicu peringatan tiap jalan.

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
