import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

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
      <BandPoin />
      <UmpanEbook />
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

function Nav() {
  return (
    <header className="sticky top-0 z-50 flex items-center gap-6 border-b border-[#c6dcc0] bg-[#eef5eb]/85 px-5 py-3.5 backdrop-blur-md sm:px-8 dark:border-[#24403a] dark:bg-[#0c1912]/85">
      <a href="/landing" className={`shrink-0 rounded-app py-2 ${FOKUS}`} aria-label="Agnee by Beweix">
        <img src="/brand/agnee-logo-primary.svg" alt="Agnee by Beweix" className="h-7 dark:brightness-0 dark:invert" />
      </a>
      <nav className="hidden gap-6 md:flex">
        {[
          ['#semua', 'Semua fitur'],
          ['#ebook', 'Ebook gratis'],
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
 * Poin singkat, ditulis dari sisi pembaca: yang bikin pegal, dan yang berubah.
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
 *   follow-up                  src/follow-up.js (jendela jam, plafon harian, jarak minimum)
 *   serah-terima AI ke CS      AUTO_ASSIGN_IDLE_MINUTES di src/server.js (30 menit)
 * Butir bertanda `segera` BELUM jalan di produksi: mode agent, impor Excel/CSV,
 * laporan performa per human agent, alasan serah-terima terstruktur, mention
 * departemen. Jangan hapus tandanya sebelum fiturnya live. Fitur internal chat
 * TIDAK boleh disebut di halaman ini. Jangan menyebut merek CRM lain, nama model,
 * atau persentase cakupan. Jangan menulis "24 jam" atau "nonstop" (lihat aturan
 * suara halaman di atas).
 */
const POIN: { pain: string; gain: string; segera?: boolean }[] = [
  { pain: 'Lead yang siap beli lewat begitu saja', gain: 'Ditandai lengkap dengan alasannya, kamu tinggal setuju' },
  { pain: 'Tool beda untuk sales, CS, dan operasi', gain: 'Satu AI untuk semua peran, satu paket', segera: true },
  { pain: 'Bot ngarang jawaban, kamu yang minta maaf', gain: 'Kalau ga tahu, dia tanya tim atau supplier, lalu balik dengan jawaban pasti' },
  { pain: 'Customer disuruh cerita ulang', gain: 'Chat pindah ke CS lengkap dengan riwayat dan alasannya' },
  { pain: 'Urusan antar-divisi nyangkut di grup chat', gain: 'Sebut rekan, jadi tugas ber-SLA' },
  { pain: 'Pipeline lupa diupdate', gain: 'AI yang menyarankan kartu pindah tahap, kamu cukup seret' },
  { pain: 'Lead dari form dan Mayar dicatat manual', gain: 'Masuk sendiri, sisanya lewat API dan MCP' },
  { pain: 'Nulis prompt panjang, hasilnya tetap melenceng', gain: 'Ngobrol atau unggah dokumen, AI belajar kayak karyawan baru' },
  { pain: 'Credit habis di tugas sepele', gain: 'Model dipilih sesuai tugasnya, tagihan wajar' },
  { pain: 'Minta rekap tiap minggu', gain: 'Laporan masuk ke WhatsApp supervisor sendiri' },
  { pain: 'Data kontak berserakan', gain: 'Satu tabel, ekspor XLSX atau CSV kapan saja' },
  { pain: 'Daftar kontak lama nganggur di Excel', gain: 'Impor, langsung jadi audiens broadcast', segera: true },
  { pain: 'Broadcast sama rata, dianggap spam', gain: 'Satu maksud, bunyinya beda tiap penerima' },
  { pain: 'Buka dashboard cuma buat cek chat', gain: 'Tanya dari asisten AI favoritmu' },
  { pain: 'Ga tahu siapa di tim yang paling lambat', gain: 'Tinggal tanya', segera: true },
  { pain: 'Lead diam, lupa dikejar', gain: 'Follow-up jalan sendiri, dibatasi jam, jumlah, dan jarak kirim' },
  { pain: 'AI dan CS bales di chat yang sama', gain: 'Kamu mulai ngetik, AI minggir. CS diam 30 menit, AI jaga lagi' },
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

const URUTAN_TEMA: NamaTema[] = ['hijau', 'biru', 'kuning', 'koral'];

function BandPoin() {
  return (
    <Section id="semua" className="py-16 sm:py-20">
      <Eyebrow>Kenalan sama Agnee</Eyebrow>
      <SectionTitle>Chatbot lain berhenti di balasan pertama. Agnee baru mulai.</SectionTitle>
      <Lead>Yang bikin pegal tiap hari di tim CS dan sales, dan apa yang berubah begitu Agnee ikut kerja.</Lead>
      <ol className="m-0 mt-10 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {POIN.map(({ pain, gain, segera }, index) => (
          <li
            key={pain}
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
            <p className="mt-2 mb-1.5 text-[13px] leading-[1.5] text-[#4e6e5e] line-through decoration-[#9fc4ae] decoration-2 dark:text-[#9fc4ae]">
              {pain}
            </p>
            <p className="m-0 text-[15px] leading-[1.5] font-semibold">{gain}</p>
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
          href="#ebook"
          className={`inline-block rounded-app bg-ink px-6 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912] ${FOKUS}`}
        >
          Lihat fitur lanjutan dan ebook gratis
        </a>
      </div>
    </Section>
  );
}

/**
 * Angka di blok highlight. Keputusan pemilik 2026-10-18: ini gimmick, jadi tanpa
 * nama brand, tanpa nama Bewei, dan tanpa catatan kaki.
 *   10x ROAS   target tim iklan manusia, tertulis "Kita ngejar 10x ROAS" di
 *              express.beweidigital.com. AI ditambah 2 sampai 3 kali lipat
 *              (angka dari pemilik), jadi judul memakai 20x sebagai TARGET.
 *   Rp 1,5 M   "Sales (from Digital)" klien ritel otomotif di situs yang sama
 *   engagement 4,34%, 3,34%, 2,45%: tiga akun lain di situs yang sama
 * Pembaca tidak boleh melihat kata "target" hilang dari judul: 20x bukan hasil
 * terukur, dan biaya iklan di balik Rp 1,5 M tidak diketahui.
 */
const ANGKA_HASIL: [string, string][] = [
  ['Rp 1,5 M', 'penjualan dari digital, ritel otomotif nomor 1'],
  ['4,34%', 'engagement, jaringan toko bangunan lokal'],
  ['3,34%', 'engagement, supermarket bahan bangunan'],
  ['2,45%', 'engagement, jaringan restoran lokal'],
];

const KOLOM_FORM = 'h-12 w-full rounded-app border border-white/25 bg-white px-4 text-[15px] text-[#0c1912] placeholder:text-[#6b7f73]';

function UmpanEbook() {
  const [kirim, setKirim] = useState(false);

  // Dua langkah dalam satu klik. Lead dicatat dulu lewat POST /public/ebook-lead
  // (keepalive, supaya tetap terkirim walau tab berpindah), lalu isiannya dibawa
  // ke WhatsApp Agnee sebagai pesan siap kirim. Server sengaja tidak mengirim
  // WhatsApp ke nomor yang diisi: pesan pembuka dari pengunjung itulah yang
  // memicu balasan ebook dari playbook. Pencatatan yang gagal tidak menahan
  // pengunjung: pesan WhatsApp tetap membawa keempat isiannya.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nilai = (kunci: string) => String(data.get(kunci) ?? '').trim();
    fetch('/public/ebook-lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: nilai('nama'),
        brand: nilai('brand'),
        email: nilai('email'),
        whatsapp: nilai('wa'),
        website: nilai('website'),
      }),
      keepalive: true,
    }).catch(() => undefined);
    const pesan = [
      'EBOOK ROAS - halo, saya mau fitur lanjutan dan ebook "Emang AI Bisa Bikin ROAS Naik dari 10x jadi 20x?".',
      `Nama: ${nilai('nama')}`,
      `Brand/bisnis/toko: ${nilai('brand')}`,
      `Email: ${nilai('email')}`,
      `WhatsApp: ${nilai('wa')}`,
    ].join('\n');
    window.open(waLink(pesan), '_blank', 'noopener,noreferrer');
    setKirim(true);
  }

  return (
    <Section id="ebook" className="py-16 sm:py-20">
      <div className="rounded-panel bg-[#12304a] p-7 text-white sm:p-10 dark:bg-[#10222e]">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <p className="m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-[#9bd3f7]">
              <span aria-hidden className="inline-block h-px w-5 bg-[#9bd3f7]" />
              Ebook gratis
            </p>
            <h2 className="m-0 mb-4 text-[clamp(28px,4vw,46px)] leading-[1.08] font-semibold tracking-[-.04em]">
              Emang AI Bisa Bikin ROAS Naik dari <span className="text-[#9bd3f7]">10x jadi 20x?</span>
            </h2>
            <p className="m-0 mb-5 text-[17px] leading-[1.5] text-white/80">Iklan, AI, dan tim closing bekerja bersama.</p>
            <ul className="m-0 grid list-none gap-2 p-0 text-[15px] leading-[1.55] text-white/85">
              <li className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[#9bd3f7]" />
                Tim iklan manusia mengejar 10x ROAS.
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[#9bd3f7]" />
                AI membalas saat kamu offline dan menyusul lead yang diam, menambah 2 sampai 3 kali lipat.
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[#9bd3f7]" />
                Di ebook: cara menyambungkan keduanya.
              </li>
            </ul>
          </div>

          <form onSubmit={onSubmit} className="grid content-start gap-3.5 rounded-panel bg-white/8 p-5 sm:p-6">
            <h3 className="m-0 text-lg font-semibold">Mau lihat fitur lanjutannya dan ebook-nya?</h3>
            <p className="m-0 -mt-1 text-[13px] leading-[1.55] text-white/70">Isi empat kolom, kami kirim keduanya.</p>
            {(
              [
                ['nama', 'Nama', 'text', 'name'],
                ['brand', 'Nama brand, perusahaan, bisnis, atau toko', 'text', 'organization'],
                ['email', 'Email', 'email', 'email'],
                ['wa', 'Nomor WhatsApp', 'tel', 'tel'],
              ] as const
            ).map(([kunci, label, tipe, auto]) => (
              <label key={kunci} className="grid gap-1.5 text-[13px] font-semibold">
                {label}
                <input
                  name={kunci}
                  type={tipe}
                  autoComplete={auto}
                  inputMode={tipe === 'tel' ? 'tel' : undefined}
                  required
                  minLength={tipe === 'tel' ? 8 : 2}
                  className={`${KOLOM_FORM} ${FOKUS_GELAP}`}
                />
              </label>
            ))}
            <label aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
              Jangan diisi
              <input name="website" type="text" tabIndex={-1} autoComplete="off" />
            </label>
            <button
              type="submit"
              className={`mt-1 h-12 cursor-pointer rounded-app border-0 bg-[#25d366] px-5 text-[15px] font-semibold text-[#0c1912] transition hover:bg-[#1dbd5e] ${FOKUS_GELAP}`}
            >
              Kirim fitur lanjutan dan ebook
            </button>
            {kirim ? (
              <p role="status" className="m-0 text-[13px] leading-[1.55] text-[#9bd3f7]">
                Datamu tercatat. WhatsApp terbuka dengan isianmu: tekan kirim di sana, ebook-nya langsung dibalas ke chat itu.
              </p>
            ) : null}
          </form>
        </div>

        <dl className="m-0 mt-10 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-white/15 pt-8 lg:grid-cols-4">
          {ANGKA_HASIL.map(([angka, keterangan]) => (
            <div key={angka}>
              <dt className="text-[clamp(26px,3.6vw,40px)] leading-none font-semibold tracking-[-.04em] text-[#9bd3f7]">{angka}</dt>
              <dd className="m-0 mt-2 text-[13px] leading-[1.5] text-white/70">{keterangan}</dd>
            </div>
          ))}
        </dl>
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
          <li>Ebook gratis tetap jadi milikmu, mau lanjut berlangganan atau tidak.</li>
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
 * Blok penutup: dua cara kenalan, disusun menaik menurut komitmen.
 *
 * Nadanya tenang (keputusan pemilik 2026-10-17): tidak ada desakan, tidak ada
 * hitung mundur, tidak ada angka selisih harga. Keduanya sama besar, supaya
 * pembaca yang belum siap bayar tidak merasa dikejar. Satu-satunya penekanan di
 * halaman ini adalah PromoKuota di bawahnya, dan itu karena batasnya nyata.
 */
const PINTU: { kondisi: string; isi: string; aksi: string; href: string; eksternal: boolean; tema: NamaTema; tombol: string }[] = [
  {
    kondisi: 'Belum butuh sekarang',
    isi: 'Baca ebook "Emang AI Bisa Bikin ROAS Naik dari 10x jadi 20x?" dulu. Gratis, ga perlu bikin akun, dan tetap kepakai walaupun kamu ga pakai Agnee.',
    aksi: 'Ambil ebook gratis',
    href: '#ebook',
    eksternal: false,
    tema: 'koral',
    tombol: 'border border-[#c6dcc0] bg-transparent text-ink hover:bg-[#fde8df] dark:border-[#24403a] dark:text-[#f4f9f0] dark:hover:bg-[#2b1a16]',
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
        Ga semua orang yang baca halaman ini lagi siap bayar, dan itu wajar. Ada dua cara kenalan dengan Agnee, dari yang paling ringan sampai yang langsung dipakai.
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
      ['#semua', 'Fitur'],
      ['#pricing', 'Harga'],
      [APP_URL, 'Masuk'],
    ],
  ],
  [
    'Gratis',
    [
      ['#ebook', 'Ebook 20x ROAS'],
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
