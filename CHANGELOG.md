# Changelog

Semua perubahan penting Agnee dicatat di file ini. Format mengikuti prinsip
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) dan versi mengikuti
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
