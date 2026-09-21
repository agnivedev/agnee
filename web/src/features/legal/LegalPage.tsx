/**
 * Kebijakan Privasi dan Syarat & Ketentuan.
 *
 * Isinya diturunkan dari apa yang sistem ini benar-benar lakukan, bukan dari
 * template: daftar data mengikuti tabel yang ada di db/migrations, daftar
 * pihak ketiga mengikuti endpoint yang benar-benar dipanggil src/, dan lokasi
 * server mengikuti tempat produksi berjalan (UpCloud Singapura). Kalau salah
 * satu dari itu berubah, halaman ini ikut berubah — janji yang tidak lagi
 * benar lebih berbahaya daripada halaman yang belum ada.
 *
 * Dua halaman ini berdiri sendiri seperti /landing: tidak ada sidebar, tidak
 * ada sesi yang harus dicek, dan bisa dibuka orang yang belum punya akun.
 */

import { useEffect } from 'react';

const KONTAK_PRIVASI = 'privasi@agnive.co';
const WA_LINK = 'https://wa.me/6281218700276';
const BERLAKU_SEJAK = '21 September 2026';

type Blok =
  | { jenis: 'paragraf'; isi: string }
  | { jenis: 'daftar'; isi: string[] }
  | { jenis: 'tabel'; kepala: [string, string]; baris: [string, string][] };

type Bagian = { judul: string; blok: Blok[] };

const PRIVASI: Bagian[] = [
  {
    judul: 'Siapa kami',
    blok: [
      {
        jenis: 'paragraf',
        isi: `Agnee adalah produk milik Agnive. Halaman ini menjelaskan data apa yang kami simpan, kenapa, di mana, berapa lama, dan apa yang bisa kamu minta dari kami. Berlaku sejak ${BERLAKU_SEJAK}.`,
      },
      {
        jenis: 'paragraf',
        isi: `Pertanyaan atau permintaan soal data pribadi: ${KONTAK_PRIVASI}. Kami jawab paling lambat 7 hari kerja.`,
      },
    ],
  },
  {
    judul: 'Dua peran yang berbeda',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Ini pembeda yang penting, karena menentukan ke siapa kamu mengajukan permintaan.',
      },
      {
        jenis: 'daftar',
        isi: [
          'Untuk data akun Agnee — nama, email, kata sandi, peran di tim, dan catatan penagihan — kami yang menentukan tujuan dan caranya. Permintaan soal data ini kirim ke kami.',
          'Untuk isi percakapan pelanggan yang masuk ke Agnee, perusahaan pengguna Agnee yang menentukan, dan kami hanya memprosesnya atas perintah mereka. Kalau kamu adalah customer yang mengirim pesan WhatsApp ke sebuah bisnis, hubungi bisnis itu — merekalah yang memegang keputusan atas percakapanmu. Kalau mereka meneruskannya ke kami, kami bantu.',
        ],
      },
    ],
  },
  {
    judul: 'Data yang kami simpan',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Akun dan tim: nama, alamat email, kata sandi (disimpan sebagai hash scrypt, bukan teks asli), peran, status aktif, status kehadiran, dan notifikasi di dalam aplikasi.',
          'Percakapan: nomor WhatsApp customer, nama profil WhatsApp-nya, isi pesan masuk dan keluar, catatan internal tim, ringkasan yang dibuat AI, tahap lead, penugasan, dan jejak audit tindakan tertentu.',
          'Dokumen yang kamu unggah sebagai playbook, beserta teks yang diekstrak darinya.',
          'Pemakaian AI: jumlah token, biaya, dan keperluan tiap panggilan, supaya kamu bisa melihat sendiri biayanya.',
          'Data teknis: alamat IP saat login dan daftar, serta log server biasa yang dipakai untuk menjaga keamanan dan menelusuri gangguan.',
        ],
      },
      {
        jenis: 'paragraf',
        isi: 'Media (foto, video, dokumen) di dalam percakapan diambil langsung dari WhatsApp saat dibuka, bukan disalin ke server kami.',
      },
    ],
  },
  {
    judul: 'Untuk apa data itu dipakai',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Menjalankan layanan: menampilkan inbox, mengirim balasan, mengelola lead, dan menjadwalkan tindak lanjut.',
          'Menyusun balasan AI dan ringkasan percakapan.',
          'Menagih dan menghitung batas paket.',
          'Menjaga keamanan: membatasi percobaan login, mencatat tindakan tertentu, dan menyelidiki penyalahgunaan.',
          'Menjawab pertanyaan dukungan yang kamu kirim sendiri.',
        ],
      },
      {
        jenis: 'paragraf',
        isi: 'Kami tidak menjual data kamu, tidak menukarnya, dan tidak memakainya untuk mengiklankan produk lain kepada customer-mu.',
      },
    ],
  },
  {
    judul: 'Bagaimana AI memakai percakapanmu',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Saat Agnee menyusun balasan, meringkas percakapan, atau menjawab pertanyaan tim di catatan, bagian percakapan yang relevan dikirim ke OpenRouter, yang meneruskannya ke penyedia model bahasa. Yang dikirim adalah bagian yang dibutuhkan untuk menjawab, bukan seluruh riwayat.',
      },
      {
        jenis: 'paragraf',
        isi: 'Kami tidak memakai isi percakapanmu untuk melatih model milik kami sendiri. Penyedia model punya kebijakannya masing-masing dan kami tidak bisa berjanji atas nama mereka; kalau kamu tidak ingin percakapan diproses AI sama sekali, fitur AI bisa dimatikan untuk perusahaanmu lewat Pengaturan.',
      },
    ],
  },
  {
    judul: 'Pihak ketiga yang ikut memproses',
    blok: [
      {
        jenis: 'tabel',
        kepala: ['Pihak', 'Perannya'],
        baris: [
          ['UpCloud (Singapura)', 'Tempat server dan database Agnee berjalan.'],
          ['OpenRouter', 'Meneruskan permintaan ke penyedia model bahasa untuk balasan dan ringkasan AI.'],
          ['Meta / WhatsApp', 'Jalur pesan itu sendiri — pesan masuk dan keluar melewati WhatsApp.'],
          ['Google Fonts', 'Memuat huruf pada halaman; server Google menerima alamat IP pengunjung.'],
          ['Microsoft OneDrive', 'Hanya kalau perusahaanmu menyambungkannya sendiri untuk sinkronisasi kontak.'],
          ['Google Sheets', 'Hanya kalau perusahaanmu menyambungkannya sendiri untuk sinkronisasi kontak.'],
          ['Mayar', 'Memproses pembayaran, bila pembayaran dilakukan lewat jalur itu.'],
        ],
      },
    ],
  },
  {
    judul: 'Di mana data disimpan',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Server dan database Agnee berjalan di pusat data UpCloud di Singapura, jadi datamu disimpan di luar Indonesia. Penyedia AI, WhatsApp, dan layanan lain di daftar di atas juga memproses data di luar negeri. Dengan memakai Agnee, kamu memahami bahwa data diproses lintas negara seperti yang dijelaskan di sini.',
      },
    ],
  },
  {
    judul: 'Cookie',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Agnee memakai satu cookie: agnee_session, yang menandai bahwa kamu sudah masuk. Cookie itu HttpOnly (tidak bisa dibaca skrip halaman), SameSite=Strict, dan berlaku 12 jam. Peramban juga menyimpan preferensi tampilan seperti pilihan bahasa dan sidebar yang diciutkan di perangkatmu sendiri.',
      },
      {
        jenis: 'paragraf',
        isi: 'Tidak ada cookie iklan, tidak ada pelacak pihak ketiga, dan tidak ada skrip analitik di halaman ini.',
      },
    ],
  },
  {
    judul: 'Bagaimana kami menjaganya',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Semua lalu lintas ke Agnee lewat HTTPS.',
          'Kata sandi disimpan sebagai hash scrypt, tidak pernah sebagai teks asli, dan tidak bisa kami baca.',
          'Kredensial integrasi yang kamu simpan (OneDrive, Google Sheets, WhatsApp Cloud API) dienkripsi di database.',
          'Data tiap perusahaan dipisahkan: setiap permintaan terikat pada satu perusahaan, dan tidak ada perusahaan bawaan yang bisa jadi tempat jatuh.',
          'Sesi diperiksa ulang ke database secara berkala, jadi akses yang dicabut langsung berhenti tanpa menunggu sesinya kedaluwarsa.',
        ],
      },
      {
        jenis: 'paragraf',
        isi: 'Tidak ada sistem yang kebal. Kalau terjadi kebocoran yang berisiko merugikanmu, kami beri tahu lewat email akun dan menjelaskan apa yang terjadi serta apa yang kami lakukan.',
      },
    ],
  },
  {
    judul: 'Berapa lama disimpan',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Selama akun perusahaanmu aktif, data percakapan dan lead disimpan supaya riwayatnya utuh.',
          'Setelah akun ditutup, data dihapus dalam 90 hari. Rentang itu memberi ruang kalau kamu berubah pikiran atau masih butuh mengekspor sesuatu.',
          'Kamu bisa minta penghapusan lebih cepat kapan saja lewat email di atas.',
          'Catatan penagihan disimpan lebih lama bila diwajibkan aturan pajak dan pembukuan.',
        ],
      },
    ],
  },
  {
    judul: 'Hak kamu',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi, kamu berhak meminta akses ke datamu, memperbaiki yang keliru, menghapusnya, mendapatkan salinannya, menarik persetujuan, dan mengajukan keberatan atas pemrosesan tertentu.',
      },
      {
        jenis: 'paragraf',
        isi: `Kirim permintaannya ke ${KONTAK_PRIVASI} dari alamat email akunmu. Kami jawab paling lambat 7 hari kerja. Kalau permintaanmu soal percakapan yang dipegang sebuah bisnis pengguna Agnee, kami teruskan ke bisnis itu karena keputusannya ada pada mereka.`,
      },
    ],
  },
  {
    judul: 'Anak-anak',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Agnee dibuat untuk keperluan bisnis dan tidak ditujukan untuk anak-anak. Kami tidak mengumpulkan data anak secara sengaja.',
      },
    ],
  },
  {
    judul: 'Perubahan halaman ini',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Kalau ada perubahan yang berarti — misalnya pihak ketiga baru yang ikut memproses, atau lokasi penyimpanan yang berpindah — kami perbarui halaman ini dan memberi tahu lewat email akun sebelum perubahannya berlaku.',
      },
    ],
  },
];

const KETENTUAN: Bagian[] = [
  {
    judul: 'Ringkasnya',
    blok: [
      {
        jenis: 'paragraf',
        isi: `Halaman ini mengatur pemakaian Agnee, produk milik Agnive. Dengan membuat akun atau memakai layanan, kamu setuju dengan ketentuan di bawah. Berlaku sejak ${BERLAKU_SEJAK}.`,
      },
    ],
  },
  {
    judul: 'Akun',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Kamu bertanggung jawab atas kerahasiaan kata sandi dan atas apa yang dilakukan orang-orang yang kamu undang ke ruang kerjamu.',
          'Data yang kamu isi saat mendaftar harus benar.',
          'Satu akun dipakai satu perusahaan. Kamu boleh menambah anggota tim sesuai batas paketmu.',
        ],
      },
    ],
  },
  {
    judul: 'Uji coba, paket, dan harga',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Uji coba berjalan 7 hari sejak akun dibuat, tanpa kartu kredit. Setelah masa itu habis dan paket belum diaktifkan, fitur AI berhenti bekerja dan akunmu masuk status tidak aktif — datamu tidak langsung hilang, lihat bagian penyimpanan di Kebijakan Privasi.',
      },
      {
        jenis: 'tabel',
        kepala: ['Paket', 'Harga promo'],
        baris: [
          ['Personal', 'Rp 99.000 per bulan'],
          ['Company', 'Rp 3.900.000 per bulan'],
          ['Lifetime', 'Rp 29.900.000 sekali bayar'],
        ],
      },
      {
        jenis: 'daftar',
        isi: [
          'Harga promo berlaku untuk 100 perusahaan pertama. Harga yang kamu dapat saat berlangganan tetap berlaku selama langganannya berjalan tanpa putus.',
          'Harga di atas belum termasuk pajak yang berlaku, bila ada.',
          'Kalau kami mengubah harga untuk langganan yang sedang berjalan, kami beri tahu paling lambat 30 hari sebelum berlaku, dan kamu boleh berhenti sebelum tanggal itu.',
          'Paket Company memakai asas pemakaian wajar: kalau pemakaianmu jauh di atas rata-rata, kami hubungi lebih dulu dan tidak pernah memutus tiba-tiba.',
        ],
      },
    ],
  },
  {
    judul: 'Paket Lifetime',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Lifetime berarti sekali bayar tanpa tagihan bulanan, selama layanan Agnee masih kami operasikan. Itu bukan janji bahwa sebuah layanan akan hidup selamanya — tidak ada perusahaan yang bisa menjanjikan itu dengan jujur.',
      },
      {
        jenis: 'paragraf',
        isi: 'Kalau suatu saat kami menghentikan Agnee secara permanen, kami beri tahu pemegang Lifetime paling lambat 60 hari sebelumnya dan menyediakan jalan untuk mengekspor seluruh data kamu sebelum layanan berhenti.',
      },
    ],
  },
  {
    judul: 'Pembayaran dan pengembalian dana',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Kamu bisa meminta pengembalian dana penuh dalam 7 hari sejak pembayaran pertama, dengan alasan apa pun. Kirim permintaannya lewat WhatsApp atau email kami.',
          'Setelah 7 hari itu, pembayaran yang sudah berjalan tidak dikembalikan, termasuk untuk sisa bulan yang belum terpakai.',
          'Perpanjangan bulan berikutnya tidak membuka kembali jendela 7 hari itu.',
          'Untuk paket Lifetime, jendela 7 hari yang sama berlaku sejak pembayaran diterima.',
        ],
      },
    ],
  },
  {
    judul: 'Cara memakai yang kami minta',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Kirim pesan hanya ke orang yang memang berhubungan dengan bisnismu dan sudah memberi nomornya. Agnee bukan alat pengirim massal.',
          'Patuhi kebijakan WhatsApp dan Meta. Melanggarnya berisiko pada nomormu sendiri.',
          'Jangan memakai Agnee untuk menipu, mengancam, menyebarkan konten ilegal, atau menyamar sebagai orang atau perusahaan lain.',
          'Jangan mencoba menembus batas antar perusahaan di dalam Agnee, atau membebani layanan secara sengaja.',
        ],
      },
      {
        jenis: 'paragraf',
        isi: 'Kalau ada pelanggaran yang jelas dan berisiko merugikan orang lain, kami bisa menangguhkan akun. Untuk hal yang tidak mendesak, kami hubungi kamu dulu.',
      },
    ],
  },
  {
    judul: 'Soal WhatsApp — ini perlu kamu tahu sebelum membeli',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Agnee tidak berafiliasi dengan Meta maupun WhatsApp. Sambungan lewat pemindaian QR memakai jalur WhatsApp Web yang tidak resmi: ia bisa berubah atau berhenti bekerja kapan saja kalau WhatsApp mengubah sistemnya, dan Meta berhak membatasi atau memblokir nomor yang dianggap melanggar kebijakan mereka.',
      },
      {
        jenis: 'paragraf',
        isi: 'Karena itu kami tidak bisa menjamin nomormu tidak akan diblokir, dan risiko itu ada di luar kendali kami. Untuk pemakaian yang butuh kepastian lebih, sambungkan nomor lewat WhatsApp Business Platform resmi yang juga didukung Agnee.',
      },
    ],
  },
  {
    judul: 'Ketersediaan layanan',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Kami menjaga Agnee tetap hidup sebaik yang kami bisa, tapi belum menjanjikan angka uptime tertentu. Akan ada saatnya layanan berhenti untuk pemeliharaan atau karena gangguan, termasuk gangguan di pihak WhatsApp atau penyedia AI yang di luar kendali kami.',
      },
    ],
  },
  {
    judul: 'Data dan kepemilikan',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Percakapan, kontak, lead, dan playbook yang kamu buat tetap milikmu.',
          'Kami memprosesnya untuk menjalankan layanan, seperti dijelaskan di Kebijakan Privasi.',
          'Kamu bisa mengekspor kontak dan lead kapan saja dari dalam aplikasi.',
          'Kami boleh memakai statistik gabungan yang tidak bisa dikaitkan ke perusahaan atau orang tertentu untuk memperbaiki layanan.',
          'Perangkat lunak, merek, dan materi Agnee tetap milik Agnive.',
        ],
      },
    ],
  },
  {
    judul: 'Menghentikan langganan',
    blok: [
      {
        jenis: 'daftar',
        isi: [
          'Kamu boleh berhenti kapan saja. Langganan berjalan sampai akhir periode yang sudah dibayar.',
          'Sebelum berhenti, ekspor dulu data yang kamu butuhkan.',
          'Setelah akun ditutup, data dihapus dalam 90 hari sesuai Kebijakan Privasi.',
        ],
      },
    ],
  },
  {
    judul: 'Batas tanggung jawab',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Sejauh diizinkan hukum, tanggung jawab kami atas kerugian yang berkaitan dengan pemakaian Agnee dibatasi sebesar jumlah yang kamu bayarkan kepada kami dalam 12 bulan terakhir. Kami tidak bertanggung jawab atas kehilangan keuntungan atau kerugian tidak langsung, termasuk akibat pemblokiran nomor oleh Meta.',
      },
      {
        jenis: 'paragraf',
        isi: 'Tidak ada bagian dari ketentuan ini yang menghapus tanggung jawab yang menurut hukum memang tidak bisa dihapus.',
      },
    ],
  },
  {
    judul: 'Perubahan ketentuan',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Kalau ada perubahan yang berarti, kami beri tahu lewat email akun paling lambat 30 hari sebelum berlaku. Kalau kamu tidak setuju, kamu boleh berhenti sebelum tanggal itu.',
      },
    ],
  },
  {
    judul: 'Hukum yang berlaku',
    blok: [
      {
        jenis: 'paragraf',
        isi: 'Ketentuan ini tunduk pada hukum Republik Indonesia. Kalau ada perselisihan, kita selesaikan lewat musyawarah lebih dulu; kalau tidak selesai juga, diselesaikan di pengadilan negeri di tempat kedudukan Agnive.',
      },
    ],
  },
];

function BlokIsi({ blok }: { blok: Blok }) {
  if (blok.jenis === 'paragraf') {
    return <p className="mt-0 mb-4 text-[15px] leading-[1.75] text-[#315141] dark:text-[#b6d0bf]">{blok.isi}</p>;
  }
  if (blok.jenis === 'daftar') {
    return (
      <ul className="mt-0 mb-4 grid list-disc gap-2 pl-5 text-[15px] leading-[1.7] text-[#315141] dark:text-[#b6d0bf]">
        {blok.isi.map((butir) => (
          <li key={butir}>{butir}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr>
            {blok.kepala.map((judul) => (
              <th
                key={judul}
                className="border-b border-[#c6dcc0] py-2 pr-4 font-semibold text-ink dark:border-[#24403a] dark:text-[#f4f9f0]"
              >
                {judul}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blok.baris.map(([kiri, kanan]) => (
            <tr key={kiri}>
              <td className="border-b border-[#c6dcc0]/60 py-2 pr-4 align-top font-medium whitespace-nowrap dark:border-[#24403a]/60">
                {kiri}
              </td>
              <td className="border-b border-[#c6dcc0]/60 py-2 align-top text-[#315141] dark:border-[#24403a]/60 dark:text-[#b6d0bf]">
                {kanan}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalPage({ halaman }: { halaman: 'privasi' | 'ketentuan' }) {
  const privasi = halaman === 'privasi';
  const bagian = privasi ? PRIVASI : KETENTUAN;
  const judul = privasi ? 'Kebijakan Privasi' : 'Syarat & Ketentuan';

  // Judul tab bawaan aplikasi ("Agnee — Customer conversations") menyesatkan di
  // halaman publik: inilah yang muncul di bilah tab, di riwayat, dan di pratinjau
  // saat tautannya dibagikan.
  useEffect(() => {
    const sebelumnya = document.title;
    document.title = `${judul} — Agnee`;
    return () => {
      document.title = sebelumnya;
    };
  }, [judul]);

  return (
    <div className="min-h-dvh bg-[#f4f9f0] text-ink dark:bg-[#0f1f1b] dark:text-[#f4f9f0]">
      <header className="border-b border-[#c6dcc0] dark:border-[#24403a]">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <a href="/landing" className="inline-flex items-center">
            <img
              src="/brand/agnee-logo-primary.svg"
              alt="Agnee by Beweix"
              className="h-7 dark:brightness-0 dark:invert"
            />
          </a>
          <a
            href={privasi ? '/ketentuan' : '/privasi'}
            className="text-[13px] text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a] dark:hover:text-[#f4f9f0]"
          >
            {privasi ? 'Syarat & Ketentuan' : 'Kebijakan Privasi'}
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="eyebrow m-0">AGNEE OLEH AGNIVE</p>
        <h1 className="mt-2 mb-2 text-[32px] leading-[1.15] tracking-[-.03em] sm:text-[40px]">{judul}</h1>
        <p className="mt-0 mb-10 text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">Berlaku sejak {BERLAKU_SEJAK}</p>

        {bagian.map((item, index) => (
          <section key={item.judul} className="mb-9">
            <h2 className="mt-0 mb-3 text-[19px] tracking-[-.02em]">
              <span className="mr-2 font-mono text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">
                {String(index + 1).padStart(2, '0')}
              </span>
              {item.judul}
            </h2>
            {item.blok.map((blok, i) => (
              <BlokIsi key={i} blok={blok} />
            ))}
          </section>
        ))}

        <div className="rounded-2xl border border-[#c6dcc0] bg-white/60 p-6 dark:border-[#24403a] dark:bg-white/5">
          <h2 className="mt-0 mb-2 text-[17px] tracking-[-.02em]">Menghubungi kami</h2>
          <p className="mt-0 mb-3 text-[15px] leading-[1.7] text-[#315141] dark:text-[#b6d0bf]">
            Soal data pribadi: <a href={`mailto:${KONTAK_PRIVASI}`} className="underline">{KONTAK_PRIVASI}</a>. Untuk
            hal lain, termasuk permintaan pengembalian dana, WhatsApp kami jalur tercepat.
          </p>
          <a
            href={WA_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-app bg-[#25d366] px-4 py-2.5 text-[13px] font-semibold text-white no-underline"
          >
            Chat via WhatsApp
          </a>
        </div>
      </main>

      <footer className="border-t border-[#c6dcc0] py-8 dark:border-[#24403a]">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-5 text-[12px] text-[#4e6e5e] sm:px-8 dark:text-[#7aaa8a]">
          <span>© 2026 Agnive. Hak cipta dilindungi.</span>
          <a href="/landing" className="text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a]">
            Kembali ke halaman depan
          </a>
        </div>
      </footer>
    </div>
  );
}
