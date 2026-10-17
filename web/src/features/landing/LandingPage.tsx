import { useEffect, useState, type ReactNode } from 'react';

/**
 * Halaman jualan publik Agnee.
 *
 * Sengaja tidak lewat kamus i18n: ini naskah penjualan Bahasa Indonesia, bukan
 * label antarmuka, dan halaman vanilla yang digantikannya juga tidak pernah
 * diterjemahkan. Palet dan mode gelapnya berdiri sendiri, tidak ikut workspace.
 *
 * ATURAN NASKAH — jangan dilanggar saat menyunting halaman ini:
 *
 * Nadanya boleh sekeras apa pun. Klaimnya tidak boleh bisa dibuktikan salah.
 * Tiap angka di halaman ini punya baris kodenya sendiri, dicatat di komentar
 * tepat di atas tempat angka itu dipakai. Kalau mau menambah angka baru, cari
 * dulu kodenya; kalau tidak ketemu, angkanya tidak boleh ditulis.
 *
 * Yang DIBUANG dari versi sebelumnya dan tidak boleh dikembalikan:
 *   - empat testimoni dengan nama, jabatan, dan bintang lima dari orang yang
 *     tidak pernah mengatakannya;
 *   - "500+ chat dihandle hari ini", "<3 dtk response AI", "10+ tim CS onboard"
 *     — tidak ada sumbernya di mana pun;
 *   - "Distribusi traffic otomatis ke agen yang available" — yang ada adalah
 *     pengambilalihan saat agent mengetik, bukan pembagian chat;
 *   - "response time rata-rata" di laporan — yang dicatat ai_usage_logs adalah
 *     token dan biaya, bukan waktu balas.
 *
 * Blok testimoni boleh dipasang lagi HANYA dengan kutipan asli yang orangnya
 * sudah menyetujui namanya ditampilkan.
 *
 * SUARA HALAMAN. Bicara langsung ke pembaca ("kamu"), bukan membingkai CS
 * sebagai pihak ketiga. Hero (2026-10-17) sengaja TIDAK lagi memakai kata-kata
 * halaman masuk app: pesannya sekarang "bukan sekadar auto-respon", dan daftar
 * kemampuan di KEMAMPUAN hanya memuat fitur yang sudah jalan di produksi.
 * Jangan menulis persentase cakupan ("menjawab 95% kebutuhan") tanpa sumber
 * hitungnya. Em dash ditulis titik dua di sini (aturan antislop halaman).
 *
 * JANGAN menulis "24x7", "24 jam", atau "nonstop", dan jangan memakai "Ga ada
 * yang kelewat" dari app. AI hanya membalas selama nomor WhatsApp tersambung
 * dan server hidup, dan produksi pernah mati berjam-jam (7 Okt, container
 * Postgres hilang ~4,5 jam). "AI tetap online" dipakai sebagai lawan dari
 * "kamu offline", bukan janji uptime.
 */

const APP_URL = 'https://app.agnee.agnive.co';
const WA_LINK = 'https://wa.me/6281218700276';
const waLink = (pesan: string) => `${WA_LINK}?text=${encodeURIComponent(pesan)}`;

const WA_LIFETIME = waLink('Halo, saya mau tanya paket Agnee Lifetime');
const WA_GROWTH = waLink('Halo, saya mau langganan Agnee Growth');
const WA_PRO = waLink('Halo, saya mau langganan Agnee Pro');
const WA_ENTERPRISE = waLink('Halo, saya mau tanya Agnee Enterprise');
const WA_EBOOK = waLink('EBOOK CS - halo, saya mau ebook "Balas Chat Seharian Tanpa Kena Mental"');
const WA_WEBINAR = waLink('WEBINAR - halo, saya mau daftar kelas "Jualan Apa Pun dalam 15 Menit Chat"');

/**
 * Halaman pendaftaran Mayar untuk kedua umpan.
 *
 * Biarkan kosong selama produknya belum dibuat: tombol Mayar menyembunyikan
 * dirinya sendiri dan yang tersisa jalur WhatsApp, yang selalu hidup karena
 * dilayani Agnee sendiri. Isi dengan URL produk Rp0 begitu ada di akun Mayar
 * Agnive — perhatikan bahwa akun Mayar yang terhubung ke repo ini milik Traders
 * Mastermind, bukan Agnive.
 */
const MAYAR_EBOOK = '';
const MAYAR_WEBINAR = '';

/**
 * Kuota promo: 50 perusahaan BARU per bulan (keputusan pemilik 2026-10-17, sebelumnya
 * 100 total). Halaman belum menampilkan sisa kuota; kalau nanti ditampilkan, hitungannya
 * harus dari tabel companies bulan berjalan.
 *
 * Kuota promo pembukaan (naskah lama).
 *
 * Angka ini janji ke pembaca, bukan hiasan. Kalau perusahaan ke-101 mendaftar,
 * harga promonya memang harus berhenti — atau angkanya yang diubah di sini
 * sebelum itu terjadi.
 */
const KUOTA_PROMO = 50;

/**
 * Kebijakan kunci harga, diputuskan pemilik 2026-10-07 ("kamu decide aja"):
 * yang daftar sebelum kuota penuh tetap bayar harga promo selama langganannya
 * jalan tanpa putus. Berhenti lalu mulai lagi setelah kuota penuh = harga normal.
 *
 * Ini janji komersial, bukan fakta dari kode: sistem tidak menyimpan harga dan
 * tidak menagih otomatis (penjualan lewat WhatsApp), jadi tidak ada yang
 * memaksa janji ini selain orang yang menagih. Kalau kebijakannya diubah,
 * ubah di TIGA tempat: Pricing (Lead), FunnelPenutup, dan FAQ "Harga promonya
 * naik bulan depan?".
 */

/**
 * Penanda fokus keyboard.
 *
 * Halaman ini tidak pernah menghapus `outline`, jadi fokus bawaan peramban
 * sebetulnya ada. Masalahnya outline bawaan itu nyaris tidak terlihat di band
 * gelap (`bg-ink`, kartu webinar, blok penutup), jadi orang yang menyusuri
 * halaman dengan Tab kehilangan jejak persis di tempat tombolnya berada.
 *
 * FOKUS dipakai di permukaan terang dan ikut mode gelap. FOKUS_GELAP dipakai
 * pada elemen yang duduk di atas band gelap di KEDUA mode, jadi warnanya tidak
 * boleh ikut berbalik.
 */
const FOKUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087d4c] dark:focus-visible:outline-[#7fff4f]';
const FOKUS_GELAP = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fff4f]';


/**
 * Warna per bagian (keputusan pemilik 2026-10-17: halaman terlalu hijau tua dan
 * neon). Hijau tetap warna merek dan dipakai untuk CTA. Tiga warna pendamping
 * hanya dipakai sebagai penanda bagian, satu warna per bagian, supaya pembaca
 * tahu sedang di topik mana: biru = inbox dan serah-terima, kuning = jadwal dan
 * batas jam, koral = broadcast. Kuning juga satu-satunya warna blok promo.
 */
const TEMA = {
  hijau: {
    teks: 'text-green-dark dark:text-[#7fff4f]',
    garis: 'bg-green-dark dark:bg-[#7fff4f]',
    isi: 'bg-[#19c666]',
    band: '',
    kartu: 'border-[#c6dcc0] dark:border-[#24403a]',
  },
  biru: {
    teks: 'text-[#1d5f8f] dark:text-[#7cc4f5]',
    garis: 'bg-[#1d5f8f] dark:bg-[#7cc4f5]',
    isi: 'bg-[#3a9ad9]',
    band: 'bg-[#e3f1fc] dark:bg-[#10222e]',
    kartu: 'border-[#b9d7ee] dark:border-[#244a63]',
  },
  kuning: {
    teks: 'text-[#8a5a00] dark:text-[#f5c451]',
    garis: 'bg-[#8a5a00] dark:bg-[#f5c451]',
    isi: 'bg-[#e0a526]',
    band: 'bg-[#fdf3dc] dark:bg-[#2a2412]',
    kartu: 'border-[#ecd49a] dark:border-[#6b5620]',
  },
  koral: {
    teks: 'text-[#a8400f] dark:text-[#ff9b7a]',
    garis: 'bg-[#a8400f] dark:bg-[#ff9b7a]',
    isi: 'bg-[#e0587a]',
    band: 'bg-[#fde8df] dark:bg-[#2b1a16]',
    kartu: 'border-[#f0c4b3] dark:border-[#6a3a2c]',
  },
} as const;
type NamaTema = keyof typeof TEMA;
const URUTAN_TEMA: NamaTema[] = ['hijau', 'biru', 'kuning', 'koral'];

/** Panel putih untuk grafik atau diagram di dalam band berwarna. */
function PanelGrafik({ judul, tema, children, catatan }: { judul: string; tema: NamaTema; children: ReactNode; catatan: string }) {
  return (
    <figure className={`m-0 mt-8 rounded-panel border bg-white p-5 sm:p-6 dark:bg-[#0c1912]/70 ${TEMA[tema].kartu}`}>
      <figcaption className={`mb-4 text-[13px] font-semibold ${TEMA[tema].teks}`}>{judul}</figcaption>
      {children}
      <p className="mt-4 mb-0 text-[12px] leading-[1.55] text-[#4e6e5e] dark:text-[#9fc4ae]">{catatan}</p>
    </figure>
  );
}

/**
 * Diagram serah-terima. Aturannya dari kode: AI berhenti saat CS mulai ngetik,
 * dan chat kembali ke AI setelah CS diam 30 menit (AUTO_ASSIGN_IDLE_MINUTES).
 */
function DiagramSerahTerima() {
  const langkah: [string, string, string][] = [
    ['AI membalas', 'Customer chat, AI menjawab dari playbook.', 'bg-[#19c666]'],
    ['CS mulai ngetik', 'Chat jadi milik CS. AI berhenti membalas.', 'bg-[#3a9ad9]'],
    ['CS diam 30 menit', 'Tidak ada balasan manusia selama 30 menit.', 'bg-[#e0a526]'],
    ['AI lanjut jaga', 'Customer tidak menunggu orang yang sudah pulang.', 'bg-[#19c666]'],
  ];
  return (
    <PanelGrafik
      judul="Siapa yang memegang chat, dari waktu ke waktu"
      tema="biru"
      catatan="Chat yang ditugaskan supervisor lewat panel tidak ikut kembali ke AI."
    >
      <ol className="m-0 grid list-none gap-4 p-0 sm:grid-cols-4">
        {langkah.map(([judul, isi, warna], i) => (
          <li key={judul} className="relative">
            <div className="flex items-center gap-2">
              <span className={`size-3.5 shrink-0 rounded-full ${warna}`} aria-hidden />
              <span aria-hidden className={`hidden h-0.5 flex-1 sm:block ${i === langkah.length - 1 ? 'opacity-0' : 'bg-[#b9d7ee] dark:bg-[#244a63]'}`} />
            </div>
            <p className="mt-2 mb-1 text-[14px] font-semibold">{judul}</p>
            <p className="m-0 text-[12px] leading-[1.55] text-[#4e6e5e] dark:text-[#9fc4ae]">{isi}</p>
          </li>
        ))}
      </ol>
    </PanelGrafik>
  );
}

/**
 * Jendela kirim 24 jam. 08.00 sampai 20.00 adalah JAM_KIRIM bawaan broadcast
 * (src/broadcast.js). Follow-up memakai jendela yang diatur perusahaan, jadi
 * grafik ini diberi label "contoh bawaan broadcast", bukan angka follow-up.
 */
function GrafikJamKirim() {
  const tanda = [0, 6, 12, 18, 24];
  return (
    <PanelGrafik
      judul="Jendela jam kirim dalam satu hari (bawaan broadcast)"
      tema="kuning"
      catatan="Di luar jendela, pesan menunggu sampai jam kirim berikutnya. Jendela follow-up diatur sesuai perusahaanmu."
    >
      <svg viewBox="0 0 480 64" role="img" aria-label="Bagan 24 jam. Pesan hanya keluar antara pukul 08.00 dan 20.00." className="w-full">
        <rect x="0" y="14" width="480" height="22" rx="6" className="fill-[#f3e6c4] dark:fill-[#3a3216]" />
        <rect x={(8 / 24) * 480} y="14" width={(12 / 24) * 480} height="22" rx="6" className="fill-[#e0a526]" />
        {tanda.map((jam) => (
          <g key={jam}>
            <line x1={(jam / 24) * 480} x2={(jam / 24) * 480} y1="36" y2="42" className="stroke-[#8a5a00] dark:stroke-[#f5c451]" strokeWidth="1.5" />
            <text
              x={(jam / 24) * 480}
              y="58"
              textAnchor={jam === 0 ? 'start' : jam === 24 ? 'end' : 'middle'}
              className="fill-[#4e6e5e] text-[11px] dark:fill-[#d9c48a]"
            >
              {String(jam).padStart(2, '0')}.00
            </text>
          </g>
        ))}
        <text x={(14 / 24) * 480} y="29" textAnchor="middle" className="fill-[#14241f] text-[11px] font-semibold">
          Pesan boleh keluar
        </text>
      </svg>
    </PanelGrafik>
  );
}

/**
 * Rem broadcast (src/broadcast.js, TEMPO.whatsapp_web): jeda acak 20 sampai 45
 * detik, maksimal 300 pesan per hari. Skala jeda 0 sampai 60 detik hanya untuk
 * menggambar, bukan angka produk.
 */
function GrafikRem() {
  return (
    <PanelGrafik
      judul="Dua batas yang dipasang di tiap broadcast"
      tema="koral"
      catatan="Ini rem yang dipasang Agnee. Risiko diblokir WhatsApp tetap ada dan tidak bisa dihilangkan."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="m-0 mb-2 text-[13px] font-semibold">Jeda antar pesan: 20 sampai 45 detik, acak</p>
          <div className="relative h-5 rounded-md bg-[#f6d5c8] dark:bg-[#47261c]" role="img" aria-label="Skala 0 sampai 60 detik, jeda jatuh di 20 sampai 45 detik">
            <div className="absolute inset-y-0 rounded-md bg-[#e0587a]" style={{ left: `${(20 / 60) * 100}%`, width: `${(25 / 60) * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] text-[#4e6e5e] dark:text-[#e8b5a3]">
            <span>0 dtk</span>
            <span>60 dtk</span>
          </div>
        </div>
        <div>
          <p className="m-0 mb-2 text-[13px] font-semibold">Jumlah pesan: maksimal 300 per hari</p>
          <div className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]" role="img" aria-label="Batas 300 pesan per hari">
            {Array.from({ length: 30 }, (_, i) => (
              <span key={i} className="aspect-square rounded-[3px] bg-[#e0587a]" />
            ))}
          </div>
          <p className="mt-1 mb-0 font-mono text-[11px] text-[#4e6e5e] dark:text-[#e8b5a3]">satu kotak = 10 pesan</p>
        </div>
      </div>
    </PanelGrafik>
  );
}

/** Tangga harga dari TANGGA_HARGA. Panjang batang proporsional, label angka tetap tertulis. */
function GrafikTangga() {
  const nilai = [100_000_000, 25_000_000, 9_000_000, 299_000, 99_000];
  const label = [...TANGGA_HARGA, 'Rp 99.000'];
  const nama = ['Harga pantas versi kami', 'Harga pantas versi kami', 'Harga pantas versi kami', 'Harga pantas versi kami', 'Starter, harga promo'];
  const warna = ['bg-[#c9d8cf]', 'bg-[#c9d8cf]', 'bg-[#c9d8cf]', 'bg-[#c9d8cf]', 'bg-[#19c666]'];
  return (
    <figure className="m-0 mt-8 rounded-panel border border-[#c6dcc0] bg-white p-5 sm:p-6 dark:border-[#24403a] dark:bg-[#14241f]">
      <figcaption className="mb-4 text-[13px] font-semibold text-green-dark dark:text-[#7fff4f]">
        Harga pantas versi kami dibanding Starter, per bulan
      </figcaption>
      <div className="grid gap-3">
        {nilai.map((n, i) => (
          <div key={label[i]} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[170px_1fr_auto]">
            <span className="text-[12px] text-[#4e6e5e] dark:text-[#9fc4ae]">{nama[i]}</span>
            <span className="col-span-2 row-start-2 h-3 rounded-sm bg-[#eef5eb] sm:col-span-1 sm:row-start-auto dark:bg-[#0c1912]">
              <span className={`block h-3 rounded-sm ${warna[i]}`} style={{ width: `${Math.max((n / nilai[0]) * 100, 1.5)}%` }} />
            </span>
            <span className="text-right font-mono text-[12px] font-semibold">{label[i]}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 mb-0 text-[12px] leading-[1.55] text-[#4e6e5e] dark:text-[#9fc4ae]">
        Empat angka pertama adalah perkiraan kami sendiri dan tidak pernah ditagihkan. Panjang batang mengikuti angkanya.
      </p>
    </figure>
  );
}

export function LandingPage() {
  useEffect(() => {
    document.title = 'Agnee: bukan auto-respon, satu tim CS lengkap';
  }, []);

  return (
    <div className="min-h-dvh scroll-smooth bg-[#eef5eb] text-ink dark:bg-[#0c1912] dark:text-[#f4f9f0]">
      <Nav />
      <Hero />
      <ProofStrip />
      <BandKemampuan />
      <BandSiapaBicara />
      <BandFollowUp />
      <UmpanEbook />
      <BandKnowledge />
      <BandRingkasan />
      <BandBroadcast />
      <GridPendukung />
      <GridYangBerubah />
      <UmpanWebinar />
      <HowItWorks />
      <Pricing />
      <Faq />
      <FunnelPenutup />
      <Footer />
    </div>
  );
}

function Section({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={className}>
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">{children}</div>
    </section>
  );
}

function Eyebrow({ children, tema = 'hijau' }: { children: ReactNode; tema?: NamaTema }) {
  return (
    <p className={`m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold ${TEMA[tema].teks}`}>
      <span aria-hidden className={`inline-block h-px w-5 ${TEMA[tema].garis}`} />
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="m-0 mb-6 text-[clamp(28px,4vw,42px)] leading-[1.15] font-semibold tracking-[-.035em]">{children}</h2>;
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-2xl text-[16px] leading-[1.7] text-[#4e6e5e] dark:text-[#7aaa8a]">{children}</p>;
}

/** Dua sisi tiap fitur: yang perusahaan dapat, dan yang orangnya dapat. */
function DuaSisi({ perusahaan, cs }: { perusahaan: ReactNode; cs: ReactNode }) {
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      <div className="rounded-panel border border-[#c6dcc0] bg-white p-5 dark:border-[#24403a] dark:bg-[#14241f]">
        <p className="m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-[#4e6e5e] uppercase dark:text-[#7aaa8a]">
          Buat perusahaan
        </p>
        <p className="m-0 text-[14px] leading-[1.65]">{perusahaan}</p>
      </div>
      <div className="rounded-panel border-2 border-green-dark bg-[#dff0d6] p-5 dark:border-[#7fff4f] dark:bg-[#1b3028]">
        <p className="m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-[#205a38] uppercase dark:text-[#7fff4f]">
          Buat tim CS
        </p>
        <p className="m-0 text-[14px] leading-[1.65] text-[#14241f] dark:text-[#f4f9f0]">{cs}</p>
      </div>
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 flex items-center gap-6 border-b border-[#c6dcc0] bg-[#eef5eb]/85 px-5 py-3.5 backdrop-blur-md sm:px-8 dark:border-[#24403a] dark:bg-[#0c1912]/85">
      <a href="/landing" className={`shrink-0 rounded-app py-2 ${FOKUS}`} aria-label="Agnee by Beweix">
        <img src="/brand/agnee-logo-primary.svg" alt="Agnee by Beweix" className="h-7 dark:brightness-0 dark:invert" />
      </a>
      <nav className="hidden gap-6 md:flex">
        {[
          ['#semua', 'Semua fitur'],
          ['#fitur', 'Inbox'],
          ['#ebook', 'Ebook gratis'],
          ['#webinar', 'Webinar'],
          ['#pricing', 'Harga'],
          ['#faq', 'FAQ'],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className={`rounded-app text-sm font-medium text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a] dark:hover:text-[#f4f9f0] ${FOKUS}`}
          >
            {label}
          </a>
        ))}
      </nav>
      <a
        href={APP_URL}
        className={`ml-auto rounded-full border border-[#c6dcc0] px-4 py-3 text-sm font-semibold no-underline dark:border-[#24403a] ${FOKUS}`}
      >
        Masuk
      </a>
    </header>
  );
}

function Hero() {
  return (
    <Section className="py-14 sm:py-20">
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <p className="m-0 flex items-center gap-2.5 text-[13px] font-semibold text-green-dark dark:text-[#7fff4f]">
            <span aria-hidden className="inline-block h-0.5 w-7 bg-green-dark dark:bg-[#7fff4f]" />
            AI untuk WhatsApp bisnis kamu
          </p>
          <h1 className="mt-4 mb-0 text-[clamp(34px,5.6vw,62px)] leading-[1.04] font-semibold tracking-[-.05em]">
            Chatbot lain cuma auto-respon.
            <br />
            <span className="text-green-dark dark:text-[#7fff4f]">Agnee kerja kayak satu company sales.</span>
          </h1>
          <p className="mt-5 mb-0 max-w-xl text-[17px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
            Auto-respon membalas kata kunci. Agnee membaca riwayat chat, menjawab dari playbook-mu, minggir saat CS mulai ngetik, menyusul lead yang diam, mengirim broadcast, mencatat tugas, dan melapor ke supervisor. Semuanya dari satu nomor WhatsApp yang sudah kamu pakai.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={`${APP_URL}/?signup=1`}
              className={`rounded-app bg-ink px-5 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912] ${FOKUS}`}
            >
              Coba Gratis 7 Hari
            </a>
            <a
              href="#semua"
              className={`rounded-app border border-[#c6dcc0] px-5 py-3 text-[15px] font-semibold no-underline dark:border-[#24403a] ${FOKUS}`}
            >
              Lihat Semua yang Dikerjakan
            </a>
          </div>
          <p className="mt-4 mb-0 text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">
            7 hari gratis, tanpa kartu kredit, berhenti kapan aja.
          </p>
        </div>
        <img src="/assets/hero-team.png" alt="Tim CS Agnee" className="w-full rounded-panel" />
      </div>
    </Section>
  );
}

/**
 * Pita bukti. Empat angka yang bisa ditunjuk barisnya, bukan angka hasil bisnis:
 *   30 menit  — AUTO_ASSIGN_IDLE_MINUTES di src/server.js
 *   8 dokumen — Database.PLAYBOOK_KINDS di src/database.js
 *   AI atau CS — kolom author ('ai' | 'human') di migrasi 014
 *   3 pengaman — jendela jam, plafon harian, jarak minimum di src/follow-up.js
 */
const BUKTI: [string, string, NamaTema][] = [
  ['30 menit', 'CS diam 30 menit, chat otomatis balik ke AI', 'biru'],
  ['8 dokumen', 'Playbook yang mengatur cara AI menjawab, diisi lewat ngobrol', 'hijau'],
  ['AI atau kamu', 'Tiap balasan ketahuan siapa yang nulis', 'koral'],
  ['3 pengaman', 'Follow-up cuma jalan di jam, jumlah, dan jarak yang kamu atur', 'kuning'],
];

function ProofStrip() {
  return (
    <Section className="border-y border-[#c6dcc0] py-8 dark:border-[#24403a]">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {BUKTI.map(([nilai, label, tema]) => (
          <div key={nilai} className="text-center">
            <span aria-hidden className={`mx-auto mb-3 block h-1 w-10 rounded-full ${TEMA[tema].isi}`} />
            <span className={`block text-[24px] leading-tight font-semibold tracking-[-.03em] ${TEMA[tema].teks}`}>{nilai}</span>
            <span className="mt-1.5 block text-[13px] leading-[1.5] text-[#4e6e5e] dark:text-[#7aaa8a]">{label}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Teaser kemampuan. Sengaja pendek dan memancing: halaman ini tidak membongkar
 * semuanya, sisanya dilihat orang di dalam app (7 hari gratis).
 * Setiap baris menunjuk fitur yang ada di kode:
 *   intent + alasan            pipelineStageSuggested + pipelineStageSuggestedReason (PipelinePage)
 *   tanya departemen/supplier  src/department-ask.js (ask_department, ask_third_party)
 *   serah-terima, antar-dept   conversation_handoffs (migrasi 003), notes + mentions (migrasi 030), tugas + sla.js
 *   kanban                     web/src/features/pipeline
 *   Mayar, API, MCP            src/mayar-sync.js, header x-api-key, src/mcp-server.mjs
 *   dilatih lewat chat/dokumen src/train-assistant.js, src/playbook-import.js
 *   rantai model               src/llm-service.js (fallback), src/model-tiers.js
 *   laporan                    src/supervisor-report.js (harian/mingguan/bulanan)
 *   ekspor                     /v1/export/contacts.xlsx dan .csv
 *   broadcast                  src/broadcast.js (variasi AI, filter tahap lead)
 *   jeda, rotasi, SLA, audit   reply-delay.js, rotator.js, sla.js, jejak audit
 * Butir bertanda `segera` BELUM jalan di produksi: mode agent, impor Excel/CSV,
 * laporan performa per human agent, alat MCP untuk laporan, alasan serah-terima
 * terstruktur, mention departemen. Fitur internal chat TIDAK boleh disebut di halaman
 * ini (hanya di playbook Beweix dan pitch deck). Jangan hapus tandanya
 * sebelum fiturnya live. Jangan menyebut merek CRM lain atau persentase cakupan.
 */
const KEMAMPUAN: { judul: string; isi: string; segera?: boolean }[] = [
  {
    judul: 'Tahu siapa yang siap beli, dan kenapa',
    isi: 'Agnee menandai lead yang niat belinya tinggi dan menulis alasannya dari kalimat customer sendiri. Kamu tinggal setujui atau tolak.',
  },
  {
    judul: 'Satu AI, banyak peran',
    isi: 'Mode sales. Mode CS. Mode operasi antar-departemen. Semua nomor departemenmu tetap dalam satu paket.',
    segera: true,
  },
  {
    judul: 'AI yang tahu kapan harus bertanya',
    isi: 'Kena soal yang jawabannya tidak ada, AI tidak menebak. Dia tanya departemen terkait, atau supplier dan vendor lewat WhatsApp, lalu balik ke customer dengan jawaban yang pasti.',
  },
  {
    judul: 'Serah-terima tanpa customer mengulang cerita',
    isi: 'Chat pindah dari AI ke CS dengan catatan alasan dan riwayat siapa yang memegangnya. Alasan terstruktur dan ringkasan otomatis: segera.',
  },
  {
    judul: 'Antar-departemen, satu utas',
    isi: 'Sebut rekan di komentar samping chat, lalu jadikan tugas dengan SLA. Sebut satu departemen sekaligus: segera.',
  },
  {
    judul: 'Kanban yang bergerak duluan',
    isi: 'Pipeline gaya CRM modern. AI menyarankan kartu pindah tahap, kamu tinggal seret.',
  },
  {
    judul: 'Nyambung ke apa yang sudah kamu pakai',
    isi: 'Lead dari landing page dan Mayar masuk sendiri. Sisanya lewat API dan MCP, termasuk integrasi yang kamu rancang sendiri.',
  },
  {
    judul: 'Dilatih kayak melatih karyawan baru',
    isi: 'Ngobrol dengan Agnee, atau unggah dokumen perusahaanmu. Tanpa nulis prompt.',
  },
  {
    judul: 'Hemat, tanpa jawaban asal',
    isi: 'Agnee memilih model yang pas dari beberapa tingkatan, jadi credit ga habis di tugas yang ga butuh model termahal. Model apa saja: rahasia dapur kami.',
  },
  {
    judul: 'Laporan sampai ke atasan sendiri',
    isi: 'Harian, mingguan, atau bulanan, langsung ke WhatsApp tiap supervisor. Kamu ga perlu minta rekap.',
  },
  {
    judul: 'Lead List yang rapi',
    isi: 'Tabel yang enak dibaca, diekspor ke XLSX atau CSV kapan saja.',
  },
  {
    judul: 'Impor Excel atau CSV',
    isi: 'Bawa daftar kontakmu masuk, langsung jadi audiens broadcast.',
    segera: true,
  },
  {
    judul: 'Broadcast satu maksud, beda tiap chat',
    isi: 'Satu pesan inti, bunyi disesuaikan per penerima. Pilih audiens warm, cold, hot, atau saring sendiri.',
  },
  {
    judul: 'Tanya Agnee dari mana saja',
    isi: 'Lewat MCP kamu bisa membaca percakapan dan menyuruh Agnee mengirim pesan dari asisten AI favoritmu.',
  },
  {
    judul: 'Tanya performa tim, minta laporan kilat',
    isi: 'Siapa yang paling cepat membalas, siapa yang sering diambil alih. Tinggal tanya.',
    segera: true,
  },
];

const DETAIL_KECIL = [
  'Jeda balasan seperti manusia',
  'Rotasi banyak nomor',
  'SLA tugas jam kerja',
  'Jejak audit',
  'Uji AI sebelum live',
  'Data tiap perusahaan terpisah',
];

const WARNA_KARTU = [
  'border-[#b5e3c4] bg-[#e4f7ea] dark:border-[#24523a] dark:bg-[#12281d]',
  'border-[#f2d9a0] bg-[#fdf3dc] dark:border-[#5a4a1e] dark:bg-[#2a2412]',
  'border-[#b9d9f2] bg-[#e3f1fc] dark:border-[#244a66] dark:bg-[#12222e]',
  'border-[#d6c9f2] bg-[#efe9fc] dark:border-[#443468] dark:bg-[#1e1830]',
  'border-[#f2c3cf] bg-[#fce6ec] dark:border-[#662a3a] dark:bg-[#2c1219]',
  'border-[#f2cfb3] bg-[#fcebdc] dark:border-[#66402a] dark:bg-[#2c1c12]',
];

function BandKemampuan() {
  return (
    <Section id="semua" className="py-16 sm:py-20">
      <Eyebrow>Kenalan sama Agnee</Eyebrow>
      <SectionTitle>Chatbot lain berhenti di balasan pertama. Agnee baru mulai.</SectionTitle>
      <Lead>
        Kebutuhan CS dan sales harian itu panjang: jawab, tahu kapan bertanya, mengejar yang diam, melapor ke atasan. Ini sebagian yang Agnee kerjakan. Sisanya kelihatan begitu kamu pakai.
      </Lead>
      <ol className="m-0 mt-10 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {KEMAMPUAN.map(({ judul, isi, segera }, index) => (
          <li
            key={judul}
            className={`flex flex-col rounded-panel border p-5 ${WARNA_KARTU[index % WARNA_KARTU.length]}`}
          >
            <span aria-hidden className={`mb-3 block h-1 w-8 rounded-full ${TEMA[URUTAN_TEMA[index % 4]].isi}`} />
            <span className={`flex items-center justify-between font-mono text-[11px] font-semibold ${TEMA[URUTAN_TEMA[index % 4]].teks}`}>
              {String(index + 1).padStart(2, '0')}
              {segera ? (
                <span className="rounded-full bg-[#dff0d6] px-2.5 py-0.5 text-[11px] text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
                  Segera
                </span>
              ) : null}
            </span>
            <h3 className="mt-2 mb-1.5 text-[16px] leading-snug font-semibold">{judul}</h3>
            <p className="m-0 text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">{isi}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">
        <span className="font-semibold text-ink dark:text-[#f4f9f0]">Dan yang jarang dipikirkan chatbot lain:</span>
        {DETAIL_KECIL.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-8">
        <a
          href={`${APP_URL}/?signup=1`}
          className={`inline-block rounded-app bg-ink px-6 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912] ${FOKUS}`}
        >
          Lihat sisanya di dalam, 7 hari gratis
        </a>
      </div>
    </Section>
  );
}

function BandSiapaBicara() {
  return (
    <Section id="fitur" className={`py-16 sm:py-20 ${TEMA.biru.band}`}>
      <Eyebrow tema="biru">AI dan CS kamu, satu inbox</Eyebrow>
      <SectionTitle>Satu inbox buat semua tim, tanpa tabrakan.</SectionTitle>
      <Lead>
        Kalau kamu mulai ngetik di chat yang lagi dipegang AI, chat itu langsung jadi milikmu dan AI berhenti balas. Kalau kamu pergi dan chat diam 30 menit, AI lanjut jaga. Tiap balasan ketahuan siapa yang nulis: AI, atau nama CS-nya.
      </Lead>
      <DuaSisi
        perusahaan="Satu nomor WhatsApp dipakai seluruh tim, dan riwayat siapa yang janji apa tinggal dicek."
        cs="Ga ada lagi AI yang kirim link checkout padahal kamu baru janji mau telepon jam 3."
      />
      <DiagramSerahTerima />
      <img
        src="/assets/hero-dashboard.png"
        alt="Inbox Agnee"
        loading="lazy"
        className="mt-10 w-full rounded-panel"
      />
    </Section>
  );
}

function BandFollowUp() {
  return (
    <Section className={`py-16 sm:py-20 ${TEMA.kuning.band}`}>
      <Eyebrow tema="kuning">Follow-up otomatis</Eyebrow>
      <SectionTitle>Follow-up ke lead yang diam, tanpa bikin pelanggan risih.</SectionTitle>
      <Lead>
        Agnee kirim follow-up ke lead yang belum balas, tapi tiap pesan harus lolos tiga pengecekan dulu: masih dalam jam kirim yang kamu atur, belum lewat batas jumlah per hari, dan jaraknya dari pesan sebelumnya sudah cukup. Supervisor tetap bisa kirim manual di luar jadwal, dengan jarak yang dipersingkat. Rangkaian yang sudah selesai bisa dimulai lagi dengan jeda yang kamu tentukan.
      </Lead>
      <GrafikJamKirim />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-panel border border-[#ecd49a] bg-white p-5 dark:border-[#6b5620] dark:bg-[#0c1912]/60">
          <p className="m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-[#4e6e5e] uppercase dark:text-[#d9c48a]">
            Buat perusahaan
          </p>
          <p className="m-0 text-[14px] leading-[1.65]">
            Lead yang belum balas tetap dihubungi, dengan batas jumlah dan jarak kirim supaya ga kelihatan spam.
          </p>
        </div>
        <div className="rounded-panel border-2 border-[#8a5a00] bg-[#fff8e6] p-5 dark:border-[#f5c451] dark:bg-[#3a3216]">
          <p className="m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-[#8a5a00] uppercase dark:text-[#f5c451]">
            Buat tim CS
          </p>
          <p className="m-0 text-[14px] leading-[1.65] text-[#14241f] dark:text-[#f4f9f0]">
            Daftar "nanti dikabarin lagi" ga perlu kamu hafalin sampai jam 11 malam.
          </p>
        </div>
      </div>
    </Section>
  );
}

/** Tombol umpan: Mayar kalau produknya sudah ada, WhatsApp selalu. */
function TombolUmpan({ mayar, mayarLabel, wa, waLabel }: { mayar: string; mayarLabel: string; wa: string; waLabel: string }) {
  return (
    <div className="mt-7 flex flex-wrap gap-3">
      {mayar ? (
        <a
          href={mayar}
          target="_blank"
          rel="noopener noreferrer"
          className={`rounded-app bg-ink px-5 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912] ${FOKUS}`}
        >
          {mayarLabel}
        </a>
      ) : null}
      <a
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        className={
          mayar
            ? `rounded-app border border-[#c6dcc0] px-5 py-3 text-[15px] font-semibold no-underline dark:border-[#24403a] ${FOKUS}`
            : `inline-flex items-center gap-2 rounded-app bg-[#25d366] text-[#0c1912] px-5 py-3 text-[15px] font-semibold no-underline transition hover:bg-[#1dbd5e] ${FOKUS_GELAP}`
        }
      >
        {waLabel}
      </a>
    </div>
  );
}

function UmpanEbook() {
  return (
    <Section id="ebook" className="py-16 sm:py-20">
      <div className="rounded-panel border-2 border-green-dark bg-white p-7 sm:p-10 dark:border-[#7fff4f] dark:bg-[#14241f]">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_.85fr]">
          <div>
            <Eyebrow>Ebook gratis untuk kamu yang balas chat</Eyebrow>
            <h2 className="m-0 mb-4 text-[clamp(26px,3.6vw,38px)] leading-[1.15] font-semibold tracking-[-.035em]">
              "Balas Chat Seharian Tanpa Kena Mental"
            </h2>
            <Lead>
              Buat kamu yang tiap hari balas chat pelanggan, bukan buat bosmu. Isinya cara menghadapi pelanggan yang lagi marah tanpa ikut kebawa, cara tahu kapan pelanggan udah siap beli, dan cara menutup hari tanpa bawa chat pulang.
            </Lead>
            <p className="mt-3 mb-0 text-[14px] leading-[1.65] text-[#4e6e5e] dark:text-[#7aaa8a]">
              Boleh dibaca walaupun kantormu ga pakai Agnee.
            </p>
            <TombolUmpan
              mayar={MAYAR_EBOOK}
              mayarLabel="Kirim ebook-nya ke saya"
              wa={WA_EBOOK}
              waLabel="Minta ebook via WhatsApp"
            />
          </div>
          <ol className="m-0 grid list-none content-start gap-2 p-0">
            {[
              'Kenapa 200 chat terasa berat, padahal isinya cuma 12 pertanyaan',
              'Dua belas balasan yang ga perlu kamu ketik ulang',
              'Menghadapi pelanggan marah: tiga kalimat pertama yang menentukan',
              'Membaca sinyal siap beli: kapan kirim link, kapan jangan',
              'Follow-up yang ga terasa nagih',
              'Serah terima shift tanpa ada yang ketinggalan',
              'Menutup hari: apa yang boleh ditinggal buat besok',
              'Checklist siap cetak',
            ].map((bab, index) => (
              <li key={bab} className="flex gap-3 text-[13px] leading-[1.55]">
                <span className="shrink-0 font-mono text-[11px] font-semibold text-green-dark dark:text-[#7fff4f]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>{bab}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}

function BandKnowledge() {
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Playbook AI</Eyebrow>
      <SectionTitle>Ajari AI-mu lewat ngobrol, bukan nulis prompt.</SectionTitle>
      <Lead>
        Cara AI menjawab diatur lewat 8 dokumen playbook. Kamu ga perlu nulisnya sendiri: Agnee yang nanya, kamu jawab kayak lagi jelasin ke karyawan baru, lalu dokumennya tersusun otomatis. Habis percakapan yang bagus, Agnee nawarin buat disimpan ke playbook.
      </Lead>
      <div className="mt-8 flex flex-wrap gap-2">
        {[
          ['Persona', 'Gaya bicara dan identitas AI'],
          ['Compliance', 'Hal yang ga boleh disebut'],
          ['Tanya-jawab', 'Pertanyaan yang sering muncul'],
          ['Discovery', 'Cara menggali kebutuhan pelanggan'],
          ['Objection', 'Cara jawab keberatan'],
          ['Closing', 'Cara ajak pelanggan ambil keputusan'],
          ['Follow-up', 'Cara menyusul pelanggan'],
          ['Handoff', 'Kapan AI serahkan ke manusia'],
        ].map(([nama, guna]) => (
          <span
            key={nama}
            className={`rounded-app border px-3.5 py-2 text-[13px] ${WARNA_KARTU[nama.length % WARNA_KARTU.length]}`}
          >
            <b className="font-semibold">{nama}</b>
            <span className="text-[#4e6e5e] dark:text-[#7aaa8a]">: {guna}</span>
          </span>
        ))}
      </div>
      <DuaSisi
        perusahaan="Playbook tumbuh dari percakapan yang beneran terjadi, bukan dokumen yang ditulis sekali terus dilupain."
        cs="Jawaban terbaikmu ga hilang bareng satu chat. Besok AI ikut jawab kayak kamu."
      />
      <img
        src="/assets/hero-team.png"
        alt="Tim CS bekerja bersama AI"
        loading="lazy"
        className="mt-10 w-full rounded-panel border border-[#d6c9f2] dark:border-[#443468]"
      />
    </Section>
  );
}

function BandRingkasan() {
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Ringkasan &amp; label</Eyebrow>
      <SectionTitle>Ringkasan chat dibuat AI, tetap bisa kamu koreksi.</SectionTitle>
      <Lead>
        Tiap percakapan punya ringkasan dan label otomatis. Kalau salah, tinggal edit. Editanmu tercatat dengan nama dan jam, dan AI tetap bisa memperbarui ringkasannya, tapi dia tahu ada manusia yang pernah mengoreksi.
      </Lead>
      <DuaSisi
        perusahaan="Ringkasan yang bisa dipercaya, karena ada orang yang bisa mengoreksinya."
        cs="Ga perlu baca ulang chat panjang dari atas, dan kalau AI salah kamu bisa langsung benerin."
      />
      <img
        src="/assets/hero-dashboard.png"
        alt="Ringkasan dan label percakapan di dashboard Agnee"
        loading="lazy"
        className="mt-10 w-full rounded-panel border border-[#b9d9f2] dark:border-[#244a66]"
      />
    </Section>
  );
}

const PENDUKUNG: { judul: string; isi: string; utama?: boolean }[] = [
  {
    judul: 'Data tiap perusahaan terpisah',
    isi: 'Pemisahannya diterapkan di level database, bukan cuma disembunyikan di tampilan. Kami udah menguji dengan permintaan lintas perusahaan yang sengaja dibuat buat nembus, dan ditolak.',
    utama: true,
  },
  { judul: 'Pakai nomor WhatsApp yang udah ada', isi: 'Scan QR, langsung jalan. Ga perlu nunggu approval Meta dan ga ada biaya per pesan.' },
  { judul: 'Lead List bisa diekspor', isi: 'Download datanya kapan aja dalam format XLSX atau CSV.' },
  {
    judul: 'Biaya AI tercatat per perusahaan',
    isi: 'Tiap panggilan AI dicatat: token masuk, token keluar, model yang dipakai, dan biayanya.',
  },
];

/**
 * Aturan main broadcast. Tiap angka ada barisnya di kode:
 *   20 sampai 45 detik, 300 per hari  src/broadcast.js, TEMPO.whatsapp_web
 *   08.00 sampai 20.00                src/broadcast.js, JAM_KIRIM
 *   bawaan cuma yang pernah membalas  Database.listBroadcastAudience (relation) + acceptUnproven di POST /v1/broadcasts
 *   STOP dikeluarkan                  broadcast_opt_outs, dibuang di server.js
 *   kalimat berhenti otomatis         broadcast.js, susunPesan (default aktif)
 *   variasi AI dijaga kode            broadcast.js, periksaVariasi
 *   hanya supervisor                  server.js, broadcastGuard
 *
 * Halaman ini sengaja TIDAK menjanjikan nomor aman dari blokir. Broadcast dari
 * WhatsApp Web selalu punya risiko dan yang memutuskan WhatsApp, bukan Agnee.
 * Yang ditulis cuma rem yang memang dipasang. Jaga itu kalau menyunting.
 */
const ATURAN_BROADCAST: [string, string][] = [
  [
    'Bawaannya cuma ke customer yang pernah membalas',
    'Kontak yang belum terlihat membalas ga ikut, kecuali kamu memilihnya sendiri dan menyetujui risikonya dulu. Pesan massal ke nomor yang ga pernah menghubungimu itu jalan tercepat nomor diblokir.',
  ],
  [
    'Pelan, dan di jam yang wajar',
    'Pesan keluar satu per satu dengan jeda acak 20 sampai 45 detik, cuma jam 08.00 sampai 20.00 waktu perusahaanmu, maksimal 300 pesan per hari.',
  ],
  [
    'STOP dihormati',
    'Tiap pesan ditutup kalimat cara berhenti. Customer yang balas STOP otomatis masuk daftar keluar dan ga dikirimi broadcast lagi.',
  ],
  [
    'Bunyi tiap pesan bisa dibuat beda',
    'Opsional: AI mengubah dua sampai empat kata per penerima. Angka, harga, dan link dijaga di kode, jadi ga ikut berubah.',
  ],
];

function BandBroadcast() {
  return (
    <Section className={`py-16 sm:py-20 ${TEMA.koral.band}`}>
      <Eyebrow tema="koral">Broadcast</Eyebrow>
      <SectionTitle>Kirim kabar ke customer lama, dengan rem yang dipasang dari awal.</SectionTitle>
      <Lead>
        Pilih customer dari daftar chat kamu, saring berdasarkan hubungan, label WhatsApp, tahap lead, topik, atau kapan terakhir mereka bales,
        lalu kirim sekarang atau jadwalkan. Sapaan {'{nama}'} terisi otomatis per penerima, dan kamu bisa lihat siapa
        yang udah terkirim, gagal, atau dilewati.
      </Lead>

      <ol className="m-0 mt-8 grid list-none gap-0 p-0">
        {ATURAN_BROADCAST.map(([judul, isi], index) => (
          <li
            key={judul}
            className="grid grid-cols-[auto_1fr] gap-x-5 border-t border-[#c6dcc0] py-5 last:border-b dark:border-[#24403a]"
          >
            <span className="pt-0.5 font-mono text-[13px] font-semibold text-green-dark dark:text-[#7fff4f]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <h3 className="mt-0 mb-1 text-base font-semibold sm:text-lg">{judul}</h3>
              <p className="m-0 max-w-2xl text-[13px] leading-[1.6] text-[#4e6e5e] sm:text-[14px] dark:text-[#7aaa8a]">
                {isi}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <GrafikRem />

      <DuaSisi
        perusahaan="Kabar promo atau pengingat sampai ke customer lama tanpa disalin satu per satu, dan cuma supervisor yang bisa memicunya."
        cs="Ga perlu ngetik pesan yang sama ratusan kali, dan ga perlu ngurus balasan STOP satu-satu."
      />
    </Section>
  );
}

function GridPendukung() {
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Ikut di semua paket</Eyebrow>
      <SectionTitle>Yang juga kamu dapat</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        {PENDUKUNG.map(({ judul, isi, utama }) => (
          <div
            key={judul}
            className={
              utama
                ? 'rounded-panel border-2 border-green-dark bg-[#dff0d6] p-7 sm:col-span-2 dark:border-[#7fff4f] dark:bg-[#1b3028]'
                : 'rounded-panel border border-[#c6dcc0] bg-white p-6 dark:border-[#24403a] dark:bg-[#14241f]'
            }
          >
            <h3 className={utama ? 'mt-0 mb-2 text-lg font-semibold sm:text-xl' : 'mt-0 mb-1.5 text-base font-semibold'}>
              {judul}
            </h3>
            <p
              className={
                utama
                  ? 'm-0 max-w-2xl text-[14px] leading-[1.65] text-[#205a38] dark:text-[#cfeac2]'
                  : 'm-0 text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]'
              }
            >
              {isi}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Lima belas hal yang berhenti mengganggu.
 *
 * Ini mengisi ruang yang dulu ditempati testimoni karangan. Tidak ada nama,
 * foto, atau bintang di sini dengan sengaja: tiap baris adalah pernyataan
 * tentang apa yang dilakukan produk, bukan kesaksian orang yang tidak pernah
 * mengatakannya. Kalau nanti ada kutipan asli, blok testimoni dipasang
 * terpisah — jangan mencampur keduanya.
 */
const YANG_BERUBAH: [string, string][] = [
  ['Dua CS bales ke pelanggan yang sama', 'CS mulai ngetik, AI langsung berhenti'],
  ['"Ini tadi siapa yang janji?"', 'Tiap balasan ketahuan siapa yang nulis'],
  ['Chat nganggur karena CS udah pulang', 'Setelah 30 menit diam, AI ambil alih lagi'],
  ['Follow-up kelupaan', 'Terjadwal, dengan batas harian dan jarak minimum'],
  ['Nomor kena report karena kebanyakan kirim', 'Ada batas jam, jumlah, dan jarak sebelum pesan terkirim'],
  ['Baca ulang chat panjang dari paling atas', 'Ringkasan per percakapan, bisa kamu koreksi'],
  ['Ringkasan AI salah dan ga ada yang berani benerin', 'Edit langsung, tercatat atas namamu'],
  ['Ngisi pengaturan AI kayak nulis dokumen', 'Cukup ngobrol, Agnee yang nanya'],
  ['Jawaban bagus hilang bareng satu chat', 'Bisa disimpan jadi playbook'],
  ['Data lead terkunci di aplikasi', 'Ekspor XLSX atau CSV kapan aja'],
  ['Pemakaian AI ga ada catatannya', 'Token, model, dan biaya dicatat per perusahaan'],
  ['Takut data perusahaan lain kelihatan', 'Data tiap perusahaan dipisah di level database'],
  ['Nunggu approval Meta', 'Scan QR pakai nomor yang udah kamu punya'],
  ['Biaya per pesan', 'Ga ada'],
  ['Pindah-pindah HP tiap ganti shift', 'Satu inbox untuk seluruh tim'],
];

function GridYangBerubah() {
  return (
    <Section className="py-16 sm:py-20">
      <SectionTitle>Masalah harian tim CS, dan jawabannya</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {YANG_BERUBAH.map(([masalah, jawaban], index) => (
          <div
            key={masalah}
            className="rounded-panel border border-[#c6dcc0] bg-white p-5 dark:border-[#24403a] dark:bg-[#14241f]"
          >
            <span className="block font-mono text-[11px] font-semibold text-[#4e6e5e] dark:text-[#7aaa8a]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <p className="mt-2 mb-2 text-[13px] leading-[1.5] text-[#4e6e5e] line-through decoration-[#c6dcc0] decoration-2 dark:text-[#7aaa8a] dark:decoration-[#24403a]">
              {masalah}
            </p>
            <p className="m-0 text-[14px] leading-[1.55] font-semibold">{jawaban}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function UmpanWebinar() {
  return (
    <Section id="webinar" className="py-16 sm:py-20">
      <div className="rounded-panel bg-[#12304a] p-7 text-white sm:p-10 dark:bg-[#10222e]">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_.85fr]">
          <div>
            <p className="m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-[#9bd3f7]">
              <span aria-hidden className="inline-block h-px w-5 bg-[#9bd3f7]" />
              Kelas gratis, 15 menit
            </p>
            <h2 className="m-0 mb-4 text-[clamp(26px,3.6vw,38px)] leading-[1.15] font-semibold tracking-[-.035em]">
              Jualan Apa Pun dalam 15 Menit Chat
            </h2>
            <p className="m-0 max-w-xl text-[16px] leading-[1.7] text-white/75">
              Kerangka lima tahap buat ngebawa pelanggan dari "nanya doang" ke "transfer ke mana ya", tanpa terkesan jualan. Kerangka yang sama kami tanam di Agnee.
            </p>
            <p className="mt-3 mb-0 text-[14px] leading-[1.65] text-white/70">
              Gratis. Rekamannya dikirim ke yang daftar.
            </p>
            <TombolUmpan
              mayar={MAYAR_WEBINAR}
              mayarLabel="Ambil kursi webinar"
              wa={WA_WEBINAR}
              waLabel="Daftar via WhatsApp"
            />
          </div>
          <ol className="m-0 grid list-none content-start gap-2.5 p-0">
            {[
              ['Buka', 'Kalimat pertama yang bikin pelanggan bales'],
              ['Gali', 'Tiga pertanyaan yang gantiin brosur'],
              ['Cocokkan', 'Tawarkan yang dia butuh, bukan yang kamu punya'],
              ['Tangani keberatan', '"Mahal" hampir ga pernah berarti mahal'],
              ['Tutup', 'Minta keputusan tanpa kedengeran maksa'],
            ].map(([tahap, isi], index) => (
              <li key={tahap} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#9bd3f7] font-mono text-[11px] font-bold text-[#0c1912]">
                  {index + 1}
                </span>
                <span className="text-[13px] leading-[1.5]">
                  <b className="font-semibold">{tahap}</b>
                  <span className="text-white/70">: {isi}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}

const STEPS: [string, string][] = [
  ['Hubungkan WhatsApp', 'Scan QR dari dashboard Agnee. Ga perlu coding, ga perlu API berbayar, ga perlu nunggu approval.'],
  ['Undang tim CS', 'Tambahkan CS lewat email dan atur perannya. Semuanya langsung dapat inbox yang sama.'],
  ['Isi playbook lewat ngobrol', 'Agnee yang nanya, kamu yang jawab. Delapan dokumen playbook tersusun dari jawabanmu.'],
];

function HowItWorks() {
  return (
    <Section className="py-16 sm:py-20">
      <SectionTitle>Tiga langkah, langsung jalan</SectionTitle>
      <ol className="m-0 mt-8 grid list-none gap-0 p-0">
        {STEPS.map(([judul, isi], index) => (
          <li
            key={judul}
            className="grid grid-cols-[auto_1fr] gap-x-5 border-t border-[#c6dcc0] py-5 last:border-b dark:border-[#24403a]"
          >
            <span className="pt-0.5 font-mono text-[13px] font-semibold text-green-dark dark:text-[#7fff4f]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <h3 className="mt-0 mb-1 text-base font-semibold sm:text-lg">{judul}</h3>
              <p className="m-0 max-w-2xl text-[13px] leading-[1.6] text-[#4e6e5e] sm:text-[14px] dark:text-[#7aaa8a]">
                {isi}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/**
 * Empat paket (keputusan pemilik 2026-10-17): Starter Rp99rb, Growth Rp1,9jt,
 * Pro Rp3,9jt, Enterprise custom. Ditagih dalam credit: langganan bulanan mengisi
 * credit, plus top-up pay as you go. SISTEM CREDIT BELUM ADA di kode saat ini
 * (server masih membatasi per jumlah pesan AI dan jumlah pengguna), jadi halaman
 * tidak menulis angka credit, jumlah pengguna, atau jumlah nomor per paket. Isi
 * angka itu hanya setelah sesi "Credit, langganan, dan 4 paket" selesai dan batasnya
 * sama dengan yang ditegakkan server.
 *
 * TANGGA_HARGA bukan harga yang pernah ditagihkan. Ia ditulis sebagai "harga pantas
 * versi kami" dan jangan pernah diberi label diskon dari harga sebelumnya.
 */
const TANGGA_HARGA = ['Rp 100.000.000', 'Rp 25.000.000', 'Rp 9.000.000', 'Rp 299.000'];

const PLANS = [
  {
    badge: 'Mulai di sini',
    name: 'Starter',
    price: 'Rp 99.000',
    period: '/bulan',
    features: [
      '1 pengguna dan 1 nomor WhatsApp',
      'Inbox, ringkasan, dan label AI',
      'Pipeline kanban dan Lead List',
      'Ekspor XLSX dan CSV',
      'Latih AI lewat chat',
      'Coba gratis 7 hari',
    ],
    href: `${APP_URL}/?signup=1`,
    cta: 'Coba Gratis 7 Hari',
    highlight: true,
  },
  {
    badge: 'Buat tim CS',
    name: 'Growth',
    price: 'Rp 1.900.000',
    period: '/bulan',
    features: [
      'Semua di Starter',
      'Tim CS dengan peran masing-masing',
      'Delapan dokumen playbook, semuanya',
      'Follow-up berjadwal dengan pengaman',
      'Broadcast pintar',
      'Laporan otomatis ke supervisor',
      'Departemen internal',
    ],
    href: WA_GROWTH,
    cta: 'Tanya paket Growth',
    highlight: false,
  },
  {
    badge: 'Operasi penuh',
    name: 'Pro',
    price: 'Rp 3.900.000',
    period: '/bulan',
    features: [
      'Semua di Growth',
      'Rotasi banyak nomor',
      'Tanya supplier dan vendor lewat WhatsApp',
      'MCP dan API',
      'Template playbook siap pasang',
      'Mode agent antar-departemen (segera)',
    ],
    href: WA_PRO,
    cta: 'Tanya paket Pro',
    highlight: false,
  },
  {
    badge: 'Skala besar',
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    features: [
      'Diskon credit sampai 90%',
      'White label dengan namamu sendiri',
      'Integrasi kustom',
      'Dibahas satu per satu',
    ],
    href: WA_ENTERPRISE,
    cta: 'Bahas kebutuhanmu',
    highlight: false,
  },
];

function Pricing() {
  return (
    <Section id="pricing" className="py-16 sm:py-20">
      <Eyebrow>Harga</Eyebrow>
      <SectionTitle>Seharusnya berapa? Kami sendiri bingung.</SectionTitle>
      <Lead>
        Hitung sendiri: satu tim CS yang menjawab, menyusul lead, mengirim broadcast, menyusun laporan, dan tidak pernah lupa janji. Berapa sebulan buat itu semua? Ini harga pantas versi kami, bukan harga yang kamu bayar:
      </Lead>
      <div className="mt-8 flex flex-wrap items-baseline gap-x-5 gap-y-2">
        {TANGGA_HARGA.map((nilai) => (
          <s key={nilai} className="text-[clamp(18px,3vw,28px)] font-semibold text-[#4e6e5e] decoration-2 dark:text-[#7aaa8a]">
            {nilai}
          </s>
        ))}
        <span className="text-[clamp(28px,5vw,48px)] leading-none font-semibold tracking-[-.04em] text-green-dark dark:text-[#7fff4f]">
          Rp 99.000
        </span>
        <span className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">per bulan, mulai dari sini</span>
      </div>

      <GrafikTangga />

      <div className="mt-6 rounded-panel border border-[#c6dcc0] bg-[#dff0d6] p-6 dark:border-[#24403a] dark:bg-[#1b3028]">
        <h3 className="m-0 mb-2 text-lg font-semibold">Risikonya kecil, dan kamu yang pegang kendali.</h3>
        <ul className="m-0 grid list-none gap-1.5 p-0 text-[14px]">
          <li>7 hari gratis, tanpa kartu kredit. Ga terasa bedanya? Tutup akunnya, ga ada yang ditagih.</li>
          <li>Harga promo terkunci selama langgananmu jalan tanpa putus.</li>
          <li>Ebook CS gratis tetap jadi milikmu, mau lanjut berlangganan atau tidak.</li>
        </ul>
      </div>

      <p className="mt-10 mb-0 max-w-2xl text-[14px] leading-[1.65] text-[#4e6e5e] dark:text-[#7aaa8a]">
        Harga di bawah adalah harga promo. Penjelasan batas kuotanya ada di bagian paling bawah halaman ini.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={
              plan.highlight
                ? 'flex flex-col rounded-panel border-2 border-ink bg-white p-6 dark:border-[#7fff4f] dark:bg-[#14241f]'
                : 'flex flex-col rounded-panel border border-[#c6dcc0] bg-white p-6 dark:border-[#24403a] dark:bg-[#14241f]'
            }
          >
            <span className="inline-block self-start rounded-full bg-[#dff0d6] px-3 py-1 font-mono text-[11px] font-semibold text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
              {plan.badge}
            </span>
            <h3 className="mt-3 mb-1 text-xl font-semibold">{plan.name}</h3>
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-2xl font-semibold tracking-[-.03em]">{plan.price}</span>
              <span className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">{plan.period}</span>
            </div>
            <ul className="mt-4 mb-6 grid list-none gap-2 p-0 text-[13px]">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span aria-hidden className="text-green-dark dark:text-[#7fff4f]">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
            <a
              href={plan.href}
              {...(plan.href.startsWith(APP_URL) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              className={`mt-auto block rounded-app px-5 py-3 text-center text-[15px] font-semibold no-underline transition ${
                plan.highlight
                  ? 'bg-ink text-white hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912]'
                  : 'bg-[#25d366] text-[#0c1912] hover:bg-[#1dbd5e]'
              } ${FOKUS}`}
            >
              {plan.cta}
            </a>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 rounded-panel border border-[#c6dcc0] bg-white p-6 md:grid-cols-[1fr_auto] md:items-center dark:border-[#24403a] dark:bg-[#14241f]">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="m-0 text-xl font-semibold">Lifetime</h3>
            <span className="text-2xl font-semibold tracking-[-.03em]">Rp 8.900.000</span>
            <span className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">sekali bayar</span>
          </div>
          <p className="m-0 mt-2 max-w-2xl text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
            Fitur setara Starter seumur hidup, tanpa tagihan bulanan. Credit awal diberikan sekali, dan top-up credit berikutnya dihitung dengan harga paket Lifetime.
          </p>
        </div>
        <a
          href={WA_LIFETIME}
          target="_blank"
          rel="noopener noreferrer"
          className={`block rounded-app bg-[#25d366] px-5 py-3 text-center text-[15px] font-semibold text-[#0c1912] no-underline transition hover:bg-[#1dbd5e] md:w-max ${FOKUS}`}
        >
          Tanya paket Lifetime
        </a>
      </div>

      <p className="mt-5 mb-0 max-w-3xl text-[12px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
        Pemakaian AI ditagih lewat credit: langganan bulanan mengisi credit, dan kamu bisa top-up kapan saja. Sistem credit sedang dipasang. Selama masa beta, langganan dan jumlah pengguna serta nomor tiap paket dikonfirmasi lewat WhatsApp sebelum kamu membayar.
      </p>
    </Section>
  );
}

const FAQ_ITEMS: [string, string][] = [
  [
    'Apakah Agnee pakai WhatsApp Business API resmi?',
    'Ga. Agnee pakai WhatsApp Web, jadi kamu bisa langsung mulai dengan nomor yang udah ada, tanpa approval Meta dan tanpa biaya per pesan. Konsekuensinya, nomor itu harus tetap terhubung. Scan QR sekali, setelah itu jalan di belakang layar.',
  ],
  [
    'Broadcast bisa bikin nomor saya diblokir?',
    'Risikonya ga nol, dan kami ga akan bilang sebaliknya. Pesan massal dari WhatsApp Web selalu punya risiko, dan WhatsApp yang menentukan, bukan Agnee. Yang kami lakukan: bawaannya cuma ke customer yang pernah membalas (kontak lain harus kamu pilih sendiri dan setujui risikonya), jeda acak 20 sampai 45 detik, jam 08.00 sampai 20.00, maksimal 300 per hari, dan yang balas STOP langsung dikeluarkan. Itu mengurangi risikonya, bukan menghilangkannya.',
  ],
  [
    'Berapa CS yang bisa ditambahkan?',
    'Starter untuk 1 pengguna. Growth dan Pro untuk tim CS. Jumlah persisnya dikonfirmasi lewat WhatsApp selama beta, karena batasnya diatur per perusahaan.',
  ],
  [
    'Credit habis di tengah bulan, AI langsung mati?',
    'Pemakaian AI ditagih lewat credit, dan kamu bisa top-up kapan saja. Sistem credit sedang dipasang, jadi selama beta kami hubungi kamu lewat WhatsApp sebelum pemakaianmu menyentuh batas. Layananmu ga akan kami matikan tiba-tiba.',
  ],
  [
    'Apakah AI-nya bisa disesuaikan dengan bisnis saya?',
    'Bisa. Ada delapan dokumen playbook yang mengatur cara AI menjawab: persona, batasan, tanya-jawab, penggalian kebutuhan, penanganan keberatan, penutupan, follow-up, dan serah terima ke manusia. Kamu ga perlu nulisnya. Agnee yang nanya, kamu jawab, lalu dokumennya tersusun dari jawabanmu.',
  ],
  [
    'Apakah data percakapan pelanggan saya aman?',
    'Tiap perusahaan cuma bisa mengakses datanya sendiri, dan pemisahannya diterapkan di level database, bukan cuma disembunyikan di tampilan. Kami udah menguji ini dengan permintaan lintas perusahaan yang sengaja dibuat untuk menembus, dan ditolak.',
  ],
  [
    'Kalau saya ambil alih chat, AI berhenti total?',
    'Berhenti di chat itu selama kamu masih di sana. Setelah kamu diam 30 menit, AI lanjut lagi supaya pelanggan ga nunggu orang yang udah pulang. Percakapan yang ditugaskan supervisor lewat panel ga ikut kembali ke AI.',
  ],
  [
    'Berarti atasan saya bisa lihat semua balasan saya?',
    'Bisa. Tiap balasan tercatat siapa penulisnya. Itu memang tujuannya, termasuk biar balasan bagusmu kelihatan siapa yang nulis, bukan diklaim sistem.',
  ],
  [
    'Saya harus belajar aplikasi baru lagi?',
    'Chat-nya tetap chat. Bedanya, kamu ga perlu pindah-pindah HP dan ga perlu nebak siapa yang udah bales siapa.',
  ],
  [
    'Harga promonya naik bulan depan?',
    'Ga. Kalau kamu daftar sebelum kuota promo bulan itu penuh, harga promo berlaku selama langgananmu jalan tanpa putus. Syaratnya cuma satu: kalau langgananmu berhenti lalu kamu mulai lagi saat kuota bulan itu sudah penuh, yang berlaku harga normal.',
  ],
  [
    'Ada masa percobaan?',
    'Ada. Klik "Coba Gratis 7 Hari" buat bikin akun dan mulai pakai, tanpa kartu kredit. Agnee masih beta. Kalau butuh waktu lebih lama atau ada kebutuhan khusus, chat kami lewat WhatsApp.',
  ],
  [
    'Berapa lama setup-nya?',
    'Hubungin WhatsApp cukup sekali scan QR. Undang tim cuma beberapa menit. Yang paling makan waktu itu ngisi playbook, karena isinya cara bisnismu ngomong ke pelanggan. Tapi kamu ngisinya sambil ngobrol, dan boleh dicicil.',
  ],
];

function Faq() {
  // Satu terbuka pada satu waktu, seperti perilaku halaman vanilla sebelumnya.
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Section id="faq" className="py-16 sm:py-20">
      <SectionTitle>Pertanyaan yang sering ditanya</SectionTitle>
      <div className="grid gap-2">
        {FAQ_ITEMS.map(([question, answer], index) => (
          <div
            key={question}
            className="overflow-hidden rounded-panel border border-[#c6dcc0] bg-white dark:border-[#24403a] dark:bg-[#14241f]"
          >
            <button
              type="button"
              aria-expanded={open === index}
              onClick={() => setOpen((current) => (current === index ? null : index))}
              className={`flex w-full cursor-pointer items-center justify-between gap-4 rounded-panel border-0 bg-transparent p-5 text-left text-[15px] font-semibold text-inherit ${FOKUS}`}
            >
              {question}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden
                className={`size-4 shrink-0 transition-transform ${open === index ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {open === index ? (
              <p className="m-0 px-5 pb-5 text-[14px] leading-[1.65] text-[#4e6e5e] dark:text-[#7aaa8a]">{answer}</p>
            ) : null}
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Blok penutup: tiga cara kenalan, disusun menaik menurut komitmen.
 *
 * Nadanya tenang (keputusan pemilik 2026-10-17): tidak ada desakan, tidak ada
 * hitung mundur, tidak ada angka selisih harga. Ketiganya sama besar, supaya
 * pembaca yang belum siap bayar tidak merasa dikejar. Satu-satunya penekanan di
 * halaman ini adalah PromoKuota di bawahnya, dan itu karena batasnya nyata.
 */
const PINTU: { kondisi: string; isi: string; aksi: string; href: string; eksternal: boolean; tema: NamaTema; tombol: string }[] = [
  {
    kondisi: 'Belum butuh sekarang',
    isi: 'Baca ebook buat tim CS-mu dulu. Gratis, ga perlu bikin akun, dan tetap kepakai walaupun kantormu ga pakai Agnee.',
    aksi: 'Baca ebook gratis',
    href: '#ebook',
    eksternal: false,
    tema: 'koral',
    tombol: 'border border-[#c6dcc0] bg-transparent text-ink hover:bg-[#fde8df] dark:border-[#24403a] dark:text-[#f4f9f0] dark:hover:bg-[#2b1a16]',
  },
  {
    kondisi: 'Masih menimbang',
    isi: 'Ikut kelas 15 menit soal cara menutup penjualan lewat chat. Kerangka yang sama yang kami tanam di Agnee, jadi kamu sekalian lihat cara kerjanya.',
    aksi: 'Daftar kelas webinar',
    href: WA_WEBINAR,
    eksternal: true,
    tema: 'biru',
    tombol: 'bg-[#25d366] text-[#0c1912] hover:bg-[#1dbd5e]',
  },
  {
    kondisi: 'Mau lihat sendiri',
    isi: 'Hubungkan nomor WhatsApp-mu dan jalankan Agnee di chat beneran selama 7 hari. Tanpa kartu kredit, dan bisa berhenti kapan aja.',
    aksi: 'Coba Gratis 7 Hari',
    href: APP_URL + '/?signup=1',
    eksternal: false,
    tema: 'hijau',
    tombol: 'bg-ink text-white hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912]',
  },
];

type StatusKuota = { tahap: 'memuat' } | { tahap: 'gagal' } | { tahap: 'ada'; used: number; limit: number; month: string };

const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/**
 * Terisi bulan ini, dari GET /public/promo-quota (src/server.js): jumlah baris
 * companies yang dibuat di bulan kalender berjalan, zona Asia/Jakarta. Angka itu
 * mencakup SEMUA perusahaan, termasuk akun uji internal, jadi pemilik perlu
 * memutuskan apakah akun uji dikecualikan sebelum halaman ini dipasang live.
 * Kalau data gagal dimuat, halaman tidak menampilkan angka sama sekali.
 */
function useKuotaPromo(): StatusKuota {
  const [status, setStatus] = useState<StatusKuota>({ tahap: 'memuat' });
  useEffect(() => {
    const kontrol = new AbortController();
    fetch('/public/promo-quota', { signal: kontrol.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { used?: unknown; limit?: unknown; month?: unknown }) => {
        if (typeof data.used !== 'number' || typeof data.limit !== 'number' || typeof data.month !== 'string') {
          throw new Error('format');
        }
        setStatus({ tahap: 'ada', used: data.used, limit: data.limit, month: data.month });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') setStatus({ tahap: 'gagal' });
      });
    return () => kontrol.abort();
  }, []);
  return status;
}

/**
 * Satu-satunya blok "terbatas" di halaman ini, dan satu-satunya yang boleh
 * ditekankan. Grafiknya bagan satuan: satu titik = satu kursi promo bulan ini.
 * Titik terisi = perusahaan yang sudah dibuat bulan ini (data nyata, lihat
 * useKuotaPromo). Yang habis adalah kuotanya, bukan jamnya: tidak ada hitung
 * mundur dan kuota tidak diperpanjang.
 */
function PromoKuota() {
  const kuota = useKuotaPromo();
  const used = kuota.tahap === 'ada' ? Math.min(kuota.used, kuota.limit) : 0;
  const limit = kuota.tahap === 'ada' ? kuota.limit : KUOTA_PROMO;
  const penuh = kuota.tahap === 'ada' && kuota.used >= kuota.limit;
  const [tahun, bulanAngka] = kuota.tahap === 'ada' ? kuota.month.split('-').map(Number) : [0, 0];
  const namaBulan = kuota.tahap === 'ada' ? `${NAMA_BULAN[(bulanAngka ?? 1) - 1] ?? ''} ${tahun}` : '';

  return (
    <div
      id="promo"
      className="mt-10 rounded-panel border-2 border-[#8a5a00] bg-[#fdf3dc] p-6 sm:p-10 dark:border-[#f5c451] dark:bg-[#2a2412]"
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
        <div>
          <p className="m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-[#8a5a00] dark:text-[#f5c451]">
            <span aria-hidden className="inline-block h-px w-5 bg-[#8a5a00] dark:bg-[#f5c451]" />
            Batas promo
          </p>
          <h2 className="m-0 mb-3 text-[clamp(26px,3.6vw,40px)] leading-[1.12] font-semibold tracking-[-.035em]">
            Harga promo untuk {KUOTA_PROMO} perusahaan baru tiap bulan.
          </h2>
          <p className="m-0 text-[15px] leading-[1.65] text-[#3d4a3f] dark:text-[#e6d9b4]">
            Kuotanya dihitung per bulan kalender. Yang daftar sebelum kuota bulan itu penuh tetap bayar harga promo selama langganannya jalan tanpa putus. Kalau penuh, promo berhenti sampai bulan berikutnya. Tidak ada hitung mundur, dan kuotanya tidak ditambah.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href="#pricing"
              className="inline-block rounded-app bg-ink px-6 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5a00] dark:bg-[#f5c451] dark:text-[#2a2412] dark:focus-visible:outline-[#f5c451]"
            >
              Lihat paket dan harga
            </a>
            <span className="text-[13px] text-[#4a4a3c] dark:text-[#d9c48a]">Coba 7 hari dulu, tanpa kartu kredit.</span>
          </div>
        </div>

        <figure className="m-0 rounded-panel border border-[#ecd49a] bg-white p-5 dark:border-[#6b5620] dark:bg-[#0c1912]/60">
          <figcaption className="mb-3 text-[13px] font-semibold text-[#14241f] dark:text-[#f4f9f0]">
            {kuota.tahap === 'ada' ? (
              <>
                <span className="text-[clamp(28px,4vw,40px)] leading-none tracking-[-.04em] text-[#8a5a00] dark:text-[#f5c451]">
                  {kuota.used}
                </span>{' '}
                dari {kuota.limit} kursi terisi, {namaBulan}
              </>
            ) : kuota.tahap === 'memuat' ? (
              <span role="status">Memuat data kuota bulan ini</span>
            ) : (
              <span role="status">Data kuota belum bisa dimuat. Tanyakan sisa kursi lewat WhatsApp.</span>
            )}
          </figcaption>
          <div
            role="img"
            aria-label={
              kuota.tahap === 'ada' ? `${used} dari ${limit} kursi promo terisi` : `${limit} kursi promo per bulan, jumlah terisi belum tersedia`
            }
            className="grid grid-cols-10 gap-1.5"
          >
            {Array.from({ length: limit }, (_, i) => (
              <span
                key={i}
                className={`aspect-square rounded-full border-2 ${
                  i < used
                    ? 'border-[#8a5a00] bg-[#e0a526] dark:border-[#f5c451] dark:bg-[#f5c451]'
                    : 'border-[#d8c48c] bg-transparent dark:border-[#6b5620]'
                } ${kuota.tahap === 'memuat' ? 'animate-pulse' : ''}`}
              />
            ))}
          </div>
          <p className="mt-4 mb-0 text-[12px] leading-[1.55] text-[#4a4a3c] dark:text-[#d9c48a]">
            {penuh
              ? 'Kuota bulan ini penuh. Promo dibuka lagi di awal bulan berikutnya.'
              : 'Satu titik satu kursi. Titik berwarna adalah perusahaan yang sudah terdaftar bulan ini, dihitung langsung dari data Agnee.'}
          </p>
          {kuota.tahap === 'gagal' ? (
            <a
              href={waLink('Halo, saya mau tanya sisa kursi promo Agnee bulan ini')}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-3 inline-block rounded-app bg-[#25d366] px-4 py-3 text-[13px] font-semibold text-[#0c1912] no-underline hover:bg-[#1dbd5e] ${FOKUS}`}
            >
              Tanya sisa kursi via WhatsApp
            </a>
          ) : null}
        </figure>
      </div>
    </div>
  );
}

function FunnelPenutup() {
  return (
    <Section id="mulai" className="py-16 sm:py-20">
      <SectionTitle>Mulai dari yang paling pas buat kamu hari ini</SectionTitle>
      <Lead>
        Ga semua orang yang baca halaman ini lagi siap bayar, dan itu wajar. Ada tiga cara kenalan dengan Agnee, dari yang paling ringan sampai yang langsung dipakai.
      </Lead>

      <div className="mt-8 grid gap-3">
        {PINTU.map((pintu, index) => (
          <div
            key={pintu.kondisi}
            className={`flex flex-col gap-4 rounded-panel border bg-white p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6 dark:bg-[#14241f] ${TEMA[pintu.tema].kartu}`}
          >
            <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-full font-mono text-[12px] font-bold text-white dark:text-[#0c1912] ${TEMA[pintu.tema].isi}`}>
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="mt-0 mb-1 text-base font-semibold sm:text-lg">{pintu.kondisi}</h3>
              <p className="m-0 text-[13px] leading-[1.6] text-[#4e6e5e] sm:text-[14px] dark:text-[#9fc4ae]">{pintu.isi}</p>
            </div>
            <a
              href={pintu.href}
              {...(pintu.eksternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={`block shrink-0 rounded-app px-5 py-3 text-center text-[15px] font-semibold no-underline transition ${pintu.tombol} ${FOKUS}`}
            >
              {pintu.aksi}
            </a>
          </div>
        ))}
      </div>

      <PromoKuota />
    </Section>
  );
}

const FOOTER_COLUMNS: [string, [string, string][]][] = [
  [
    'Produk',
    [
      ['#fitur', 'Fitur'],
      ['#pricing', 'Harga'],
      [APP_URL, 'Masuk'],
    ],
  ],
  [
    'Gratis',
    [
      ['#ebook', 'Ebook untuk CS'],
      ['#webinar', 'Webinar 15 menit'],
    ],
  ],
  [
    'Dukungan',
    [
      ['#faq', 'FAQ'],
      [WA_LINK, 'WhatsApp kami'],
      ['mailto:hanny@agnive.co', 'Email'],
    ],
  ],
];

function Footer() {
  return (
    <footer className="border-t border-[#c6dcc0] py-12 dark:border-[#24403a]">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <img src="/brand/agnee-logo-primary.svg" alt="Agnee by Beweix" className="h-7 dark:brightness-0 dark:invert" />
            <p className="mt-3 mb-4 max-w-xs text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
              AI dan CS kamu, satu inbox.
            </p>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-2 rounded-app bg-[#25d366] text-[#0c1912] px-4 py-3 text-[13px] font-semibold no-underline ${FOKUS}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                <path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.936.525 3.745 1.438 5.29L2.004 22l4.796-1.404A9.962 9.962 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.652 0-3.19-.45-4.508-1.228l-.323-.192-3.367.985.98-3.304-.21-.34A7.952 7.952 0 0 1 4 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z" />
              </svg>
              Chat via WhatsApp
            </a>
          </div>

          {FOOTER_COLUMNS.map(([title, links]) => (
            <div key={title}>
              <h4 className="m-0 mb-3 text-[13px] font-semibold">{title}</h4>
              <ul className="m-0 grid list-none p-0">
                {links.map(([href, label]) => (
                  <li key={label}>
                    <a
                      href={href}
                      {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className={`block rounded-app py-3.5 text-[13px] text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a] dark:hover:text-[#f4f9f0] ${FOKUS}`}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#c6dcc0] pt-5 text-[12px] text-[#4e6e5e] dark:border-[#24403a] dark:text-[#7aaa8a]">
          <span>© 2026 Agnive. Hak cipta dilindungi.</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              href="/privasi"
              className={`inline-block rounded-app py-3.5 text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a] dark:hover:text-[#f4f9f0] ${FOKUS}`}
            >
              Kebijakan Privasi
            </a>
            <a
              href="/ketentuan"
              className={`inline-block rounded-app py-3.5 text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a] dark:hover:text-[#f4f9f0] ${FOKUS}`}
            >
              Syarat &amp; Ketentuan
            </a>
            <span>Dibuat di Indonesia 🇮🇩</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
