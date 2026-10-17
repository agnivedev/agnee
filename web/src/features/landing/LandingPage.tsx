import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowLeftRight, ArrowRight, BarChart3, BookOpen, ClipboardPaste, Copy, Eye, LogIn, MessagesSquare, Send, Wifi, Blocks, Bot, Check, Clock, Coins, Columns3, FileText, Gauge, GraduationCap,
  Hourglass, Megaphone, MessageCircleQuestion, Plug, ShieldCheck, Table2, Target, Timer, Users,
  type LucideIcon,
} from 'lucide-react';

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
      <BandTampilan />
      <BandMcp />
      <BandSerahTerima />
      <BandBroadcastVisual />
      <UmpanEbook />
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

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-green-dark dark:text-[#7fff4f]">
      <span aria-hidden className="inline-block h-px w-5 bg-green-dark dark:bg-[#7fff4f]" />
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
  const CALLOUTS = [
    { n: 1, kiri: '81.4%', atas: '9.6%', teks: 'Skor minat 95 beserta alasannya, ditulis dari kalimat customer sendiri.' },
    { n: 2, kiri: '46.4%', atas: '67.5%', teks: 'Tiap balasan ada penulisnya: AI, atau nama CS-nya.' },
    { n: 3, kiri: '96.5%', atas: '83.4%', teks: 'Tahap CRM disarankan AI. Kamu yang memutuskan.' },
  ];
  return (
    <Section className="pt-12 pb-10 sm:pt-16 sm:pb-14">
      <p className="m-0 flex items-center gap-2.5 text-[13px] font-semibold text-green-dark dark:text-[#7fff4f]">
        <span aria-hidden className="inline-block h-0.5 w-7 bg-green-dark dark:bg-[#7fff4f]" />
        AI untuk WhatsApp bisnis kamu
      </p>
      <h1 className="mt-4 mb-0 text-[clamp(32px,5.2vw,60px)] leading-[1.08] font-semibold tracking-[-.045em] text-balance">
        <span className="block">Chatbot lain cuma auto&#8209;respon.</span>
        <span className="block text-green-dark dark:text-[#7fff4f]">Agnee kerja kayak satu tim CS.</span>
      </h1>
      <ul className="m-0 mt-7 flex list-none flex-wrap gap-x-8 gap-y-3 p-0 text-[15px] sm:text-[16px]">
        {[
          [Bot, 'Menjawab dari Knowledge bisnismu'],
          [ArrowLeftRight, 'Minggir saat CS mulai ngetik'],
          [Megaphone, 'Menyusul lead yang diam'],
        ].map(([Ikon, teks]) => {
          const Icon = Ikon as LucideIcon;
          return (
            <li key={teks as string} className="flex items-center gap-2.5 font-medium whitespace-nowrap">
              <Icon aria-hidden size={20} className="shrink-0 text-green-dark dark:text-[#7fff4f]" />
              {teks as string}
            </li>
          );
        })}
      </ul>
      <div className="mt-7 flex flex-wrap gap-3">
        <a
          href={`${APP_URL}/?signup=1`}
          className={`rounded-app bg-ink px-6 py-3.5 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912] ${FOKUS}`}
        >
          Coba Gratis 7 Hari
        </a>
        <a
          href="#semua"
          className={`rounded-app border border-[#c6dcc0] px-6 py-3.5 text-[15px] font-semibold no-underline dark:border-[#24403a] ${FOKUS}`}
        >
          Lihat Semua yang Dikerjakan
        </a>
      </div>
      <p className="mt-4 mb-0 text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">
        Promo dibuka untuk {KUOTA_PROMO} perusahaan baru tiap bulan. Tanpa kartu kredit.
      </p>

      <figure className="relative m-0 mt-10 rounded-panel bg-ink p-2 sm:p-4 dark:bg-[#14241f]">
        <div className="relative">
          <img
            src="/assets/landing/inbox.webp"
            width={1800}
            height={1125}
            alt="Kotak masuk Agnee: percakapan dengan skor minat 95, balasan AI dan balasan CS, serta tahap CRM Closing"
            className="block h-auto w-full rounded-app"
          />
          {CALLOUTS.map((c) => (
            <span
              key={c.n}
              aria-hidden
              style={{ left: c.kiri, top: c.atas }}
              className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#7fff4f] font-mono text-[12px] font-bold text-[#0c1912] shadow-md sm:size-7 sm:text-[13px]"
            >
              {c.n}
            </span>
          ))}
        </div>
        <figcaption className="sr-only">Tangkapan layar app Agnee dengan data contoh.</figcaption>
      </figure>
      <ol className="m-0 mt-5 grid list-none gap-3 p-0 sm:grid-cols-3">
        {CALLOUTS.map((c) => (
          <li key={c.n} className="flex items-start gap-3 text-[14px] leading-[1.55]">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-green-dark font-mono text-[12px] font-bold text-white dark:bg-[#7fff4f] dark:text-[#0c1912]">
              {c.n}
            </span>
            {c.teks}
          </li>
        ))}
      </ol>
      <p className="mt-3 mb-0 text-[12px] text-[#4e6e5e] dark:text-[#7aaa8a]">Tangkapan layar app asli dengan data contoh, bukan data pelanggan.</p>
    </Section>
  );
}

/**
 * Pita bukti. Empat angka yang bisa ditunjuk barisnya, bukan angka hasil bisnis:
 *   30 menit  : AUTO_ASSIGN_IDLE_MINUTES di src/server.js
 *   8 dokumen : Database.PLAYBOOK_KINDS di src/database.js
 *   5-60 dtk  : src/reply-delay.js
 *   3 pengaman: jendela jam, plafon harian, jarak minimum di src/follow-up.js
 */
const BUKTI: [LucideIcon, string, string][] = [
  [Clock, '30 menit', 'CS diam, chat balik ke AI'],
  [BookOpen, '8 bagian Knowledge', 'Satu sumber jawaban, diisi lewat ngobrol'],
  [Timer, '5 sampai 60 detik', 'Jeda balasan seperti manusia'],
  [ShieldCheck, '3 pengaman', 'Follow-up: jam, jumlah, jarak'],
];

function ProofStrip() {
  return (
    <Section className="border-y border-[#c6dcc0] py-8 dark:border-[#24403a]">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {BUKTI.map(([Icon, nilai, label]) => (
          <div key={nilai} className="flex items-center gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-app bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]">
              <Icon aria-hidden size={22} />
            </span>
            <div>
              <span className="block text-[20px] leading-tight font-semibold tracking-[-.03em]">{nilai}</span>
              <span className="mt-0.5 block text-[13px] leading-[1.4] text-[#4e6e5e] dark:text-[#7aaa8a]">{label}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Bento kemampuan. Tiap tile menunjuk fitur yang ada di kode. Cuplikan mini (chat,
 * kolom kanban, tingkatan model) adalah ILUSTRASI yang dilabeli "contoh", bukan data.
 * Nama tingkatan model memakai label publik Low/Medium/High/Top-end saja
 * (src/model-tiers.js), tanpa vendor dan tanpa harga. Jangan menambah klaim hasil,
 * persentase cakupan, merek CRM lain, atau fitur chat internal.
 */
const TILE = 'rounded-panel p-5 transition hover:-translate-y-0.5 sm:p-6';
const TILE_TERANG = `${TILE} border border-[#c6dcc0] bg-white dark:border-[#24403a] dark:bg-[#14241f]`;
const TILE_HIJAU = `${TILE} bg-[#dff0d6] dark:bg-[#1b3028]`;
const TILE_AKSEN = `${TILE} bg-green-dark text-white dark:bg-[#7fff4f] dark:text-[#0c1912]`;
const IKON = 'grid size-10 place-items-center rounded-app';
const JUDUL = 'mt-3 mb-1 text-[18px] leading-snug font-semibold tracking-[-.02em]';
const ISI = 'm-0 text-[14px] leading-[1.55] opacity-75';

function Gelembung({ dari, children }: { dari: 'customer' | 'ai' | 'kamu'; children: ReactNode }) {
  const gaya =
    dari === 'customer'
      ? 'bg-white text-ink dark:bg-[#0c1912] dark:text-[#f4f9f0]'
      : dari === 'ai'
        ? 'ml-auto bg-[#7fff4f] text-[#0c1912]'
        : 'bg-[#dff0d6] text-[#0c1912]';
  return <p className={`m-0 w-fit max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-[1.4] ${gaya}`}>{children}</p>;
}

function BandKemampuan() {
  return (
    <Section id="semua" className="py-16 sm:py-20">
      <Eyebrow>Kenalan sama Agnee</Eyebrow>
      <SectionTitle>
        <span className="text-balance">Chatbot lain berhenti di balasan pertama. Agnee baru mulai.</span>
      </SectionTitle>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:[grid-auto-flow:dense]">
        <div className={`${TILE_AKSEN} sm:col-span-2 lg:row-span-2`}>
          <span className={`${IKON} bg-white/20 dark:bg-[#0c1912]/15`}>
            <Target aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Tahu siapa yang siap beli, dan kenapa</h3>
          <p className={ISI}>Skor minat di tiap chat, dengan alasan dari kalimat customer sendiri. Kamu setujui atau tolak sarannya.</p>
          <img
            src="/assets/landing/intent.webp"
            width={500}
            height={365}
            alt="Panel lead: skor minat 95 dengan alasan"
            loading="lazy"
            className="mt-4 block h-auto w-full max-w-[340px] rounded-app"
          />
        </div>

        <div className={`${TILE_HIJAU} sm:col-span-2`}>
          <span className={`${IKON} bg-white text-green-dark dark:bg-[#0c1912] dark:text-[#7fff4f]`}>
            <MessageCircleQuestion aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>AI yang bertanya, bukan menebak</h3>
          <p className={ISI}>Ke departemen, supplier, dan vendor lewat WhatsApp.</p>
          <div className="mt-4 grid gap-1.5">
            <Gelembung dari="customer">Stok biji Gayo 12 kg ada, Kak?</Gelembung>
            <Gelembung dari="ai">Saya cek ke gudang dulu ya, Kak.</Gelembung>
          </div>
          <span className="mt-2 inline-block text-[11px] opacity-60">Contoh percakapan</span>
        </div>

        <div className={`${TILE_TERANG} lg:row-span-2`}>
          <span className={`${IKON} bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]`}>
            <Columns3 aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Kanban CRM</h3>
          <p className={ISI}>AI mengusulkan tahap, kamu menyeret kartunya.</p>
          <ul className="m-0 mt-4 grid list-none gap-2 p-0 text-[13px] font-medium">
            {[
              ['Cold', 'bg-[#9db99a]'],
              ['Warm', 'bg-[#e8c547]'],
              ['Hot', 'bg-[#f08a3c]'],
              ['Closing', 'bg-green-dark dark:bg-[#7fff4f]'],
            ].map(([nama, warna]) => (
              <li key={nama} className="flex items-center gap-2 rounded-app border border-[#c6dcc0] px-3 py-2 dark:border-[#24403a]">
                <span aria-hidden className={`size-2.5 rounded-full ${warna}`} />
                {nama}
              </li>
            ))}
          </ul>
        </div>

        <div className={TILE_TERANG}>
          <span className={`${IKON} bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]`}>
            <ArrowLeftRight aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Serah-terima mulus</h3>
          <p className={ISI}>Alasan, ringkasan, dan janji AI ikut pindah ke CS.</p>
        </div>

        <div className={TILE_TERANG}>
          <span className={`${IKON} bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]`}>
            <Blocks aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Banyak peran</h3>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] font-semibold">
            {['Sales', 'CS', 'Operasi antar-departemen'].map((r) => (
              <span key={r} className="rounded-full bg-[#dff0d6] px-2.5 py-1 text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
                {r}
              </span>
            ))}
          </div>
        </div>

        <div className={`${TILE_TERANG} sm:col-span-2`}>
          <span className={`${IKON} bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]`}>
            <GraduationCap aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Dilatih kayak karyawan baru</h3>
          <p className={ISI}>Ngobrol sama Agnee, atau unggah dokumen perusahaan. Tanpa nulis prompt.</p>
          <div className="mt-4 grid gap-1.5">
            <Gelembung dari="customer">Jam berapa toko buka?</Gelembung>
            <Gelembung dari="kamu">Jam 9 pagi sampai 9 malam, tiap hari.</Gelembung>
          </div>
          <span className="mt-2 inline-block text-[11px] opacity-60">Contoh: Agnee bertanya, kamu menjawab, jadi Knowledge</span>
        </div>

        <div className={TILE_HIJAU}>
          <span className={`${IKON} bg-white text-green-dark dark:bg-[#0c1912] dark:text-[#7fff4f]`}>
            <Coins aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Hemat</h3>
          <p className={ISI}>Model berlapis, credit ga habis percuma.</p>
          <div aria-hidden className="mt-3 flex items-end gap-1.5">
            {['Low', 'Medium', 'High', 'Top'].map((t, i) => (
              <span
                key={t}
                style={{ height: 14 + i * 9 }}
                className="flex-1 rounded-t-[4px] bg-green-dark/70 text-center text-[9px] leading-[1.9] font-semibold text-white dark:bg-[#7fff4f]/80 dark:text-[#0c1912]"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className={TILE_TERANG}>
          <span className={`${IKON} bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]`}>
            <FileText aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Laporan otomatis</h3>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] font-semibold">
            {['Harian', 'Mingguan', 'Bulanan'].map((r) => (
              <span key={r} className="rounded-full bg-[#dff0d6] px-2.5 py-1 text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
                {r}
              </span>
            ))}
          </div>
          <p className={`${ISI} mt-2`}>Langsung ke WhatsApp supervisor.</p>
        </div>

        <div className={`${TILE_TERANG} sm:col-span-2`}>
          <span className={`${IKON} bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]`}>
            <Megaphone aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Broadcast pintar</h3>
          <p className={ISI}>Satu maksud, bunyi beda tiap penerima.</p>
        </div>

        <div className={`${TILE_TERANG} sm:col-span-2`}>
          <span className={`${IKON} bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]`}>
            <Table2 aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Lead List</h3>
          <p className={ISI}>Ekspor dan impor XLSX atau CSV.</p>
        </div>

        <div className={`${TILE_TERANG} sm:col-span-2`}>
          <span className={`${IKON} bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]`}>
            <Plug aria-hidden size={20} />
          </span>
          <h3 className={JUDUL}>Nyambung ke mana saja</h3>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] font-semibold">
            {['Mayar', 'API', 'MCP'].map((r) => (
              <span key={r} className="rounded-full bg-[#dff0d6] px-2.5 py-1 text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
                {r}
              </span>
            ))}
          </div>
          <p className={`${ISI} mt-2`}>Lewat MCP, tanya laporan dan performa agent dari asisten AI favoritmu.</p>
        </div>
      </div>
    </Section>
  );
}

type Tampilan = {
  judul: string;
  poin: string[];
  gambar: { src: string; lebar: number; tinggi: number; alt: string }[];
};

const TAMPILAN: Tampilan[] = [
  {
    judul: 'Tahu siapa yang siap beli, dan kenapa',
    poin: [
      'Skor minat di tiap percakapan',
      'Alasan ditulis dari kalimat customer sendiri',
      'Pindah tahap CRM: AI mengusulkan, kamu memutuskan',
    ],
    gambar: [{ src: 'intent', lebar: 500, tinggi: 365, alt: 'Panel lead: skor minat 95 dengan alasan' }],
  },
  {
    judul: 'Kanban CRM yang bergerak duluan',
    poin: [
      'Cold, Warm, Hot, Closing dalam satu papan',
      'Seret kartu antar kolom',
      'Lead dari landing page dan Mayar masuk sendiri',
    ],
    gambar: [{ src: 'pipeline', lebar: 1800, tinggi: 650, alt: 'Papan lead per tahap: Cold, Warm, Hot, Closing' }],
  },
  {
    judul: 'AI yang bertanya, bukan menebak',
    poin: [
      'Soal di luar Knowledge diteruskan ke departemen terkait',
      'Supplier dan vendor ditanya lewat WhatsApp',
      'Jawaban pihak luar ditinjau staf sebelum sampai ke customer',
      'Sebut rekan atau departemen di komentar, lalu jadikan tugas dengan SLA',
    ],
    gambar: [{ src: 'dept', lebar: 1400, tinggi: 1092, alt: 'Pertanyaan AI ke departemen dan daftar departemen' }],
  },
  {
    judul: 'Dilatih lewat ngobrol',
    poin: [
      'Agnee bertanya, kamu menjawab seperti ke karyawan baru',
      'Atau unggah dokumen perusahaan',
      'Delapan bagian Knowledge tersusun sendiri',
      'Uji AI dulu sebelum dipakai ke customer',
    ],
    gambar: [{ src: 'train', lebar: 1400, tinggi: 875, alt: 'Halaman Latih AI dengan Knowledge' }],
  },
  {
    judul: 'Datamu bukan sandera',
    poin: [
      'Ekspor Lead List ke XLSX atau CSV kapan saja',
      'Impor Excel atau CSV dengan pratinjau dulu',
    ],
    gambar: [{ src: 'leads', lebar: 1400, tinggi: 753, alt: 'Lead List dengan tombol unduh XLSX dan CSV' }],
  },
];

function BandTampilan() {
  return (
    <Section id="fitur" className="py-4 sm:py-8">
      <div className="grid gap-16 sm:gap-24">
        {TAMPILAN.map((t, index) => {
          const lebarPenuh = t.gambar[0].lebar / t.gambar[0].tinggi > 2.2;
          return (
          <div
            key={t.judul}
            className={
              lebarPenuh
                ? 'grid gap-6'
                : 'grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] md:gap-12'
            }
          >
            <div className={!lebarPenuh && index % 2 ? 'md:order-2' : ''}>
              <span className="font-mono text-[12px] font-semibold text-green-dark dark:text-[#7fff4f]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-1.5 mb-4 text-[clamp(24px,3.2vw,34px)] leading-[1.15] font-semibold tracking-[-.03em]">
                {t.judul}
              </h3>
              <ul className="m-0 grid list-none gap-2.5 p-0">
                {t.poin.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-[15px] leading-[1.5]">
                    <Check aria-hidden size={18} className="mt-0.5 shrink-0 text-green-dark dark:text-[#7fff4f]" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className={`grid gap-3 ${t.gambar.length > 1 ? 'sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2' : ''}`}>
              {t.gambar.map((g) => (
                <figure
                  key={g.src}
                  className={`m-0 overflow-hidden rounded-panel border border-[#c6dcc0] bg-white dark:border-[#24403a] dark:bg-[#14241f] ${g.lebar < 600 ? 'max-w-[420px]' : ''}`}
                >
                  <img
                    src={`/assets/landing/${g.src}.webp`}
                    width={g.lebar}
                    height={g.tinggi}
                    alt={g.alt}
                    loading="lazy"
                    className="block h-auto w-full"
                  />
                </figure>
              ))}
            </div>
          </div>
          );
        })}
      </div>
      <p className="mt-10 mb-0 text-[12px] text-[#4e6e5e] dark:text-[#7aaa8a]">Semua tangkapan layar berasal dari app asli dengan data contoh.</p>
    </Section>
  );
}

/**
 * Bagian MCP. Alat yang benar-benar ada di src/mcp-server.mjs:
 *   report_summary, agent_performance (khusus supervisor), whatsapp_status,
 *   list_conversations, read_conversation, send_whatsapp_message.
 * Alat Agnive Hub (hub_*) khusus staf Agnive dan TIDAK boleh disebut di halaman ini.
 * Akses mengikuti akun Agnee yang login, jadi alat khusus supervisor hanya jalan
 * untuk supervisor. Waktu respons agent hanya ada bila terukur (lihat panel kinerja).
 * Langkah sambung dan nama ChatGPT atau Claude mengikuti kartu MCP di Setting
 * (web/src/features/settings). Jangan menyebut klien lain tanpa mengujinya.
 */
const CONTOH_MCP: [LucideIcon, string, string][] = [
  [BarChart3, 'Bandingkan chat hari ini dengan kemarin', 'Laporan ringkas'],
  [Users, 'Siapa agent yang paling cepat membalas 7 hari terakhir?', 'Kinerja agent'],
  [MessagesSquare, 'Tampilkan percakapan terbaru', 'Daftar chat'],
  [Eye, 'Baca chat Dewi, lalu siapkan balasannya', 'Baca chat'],
  [Send, 'Kirim pesan ini ke chat Budi', 'Kirim pesan'],
  [Wifi, 'WhatsApp kita masih tersambung?', 'Status nomor'],
];

const LANGKAH_MCP: [LucideIcon, string][] = [
  [Copy, 'Salin alamat server MCP di Setting'],
  [ClipboardPaste, 'Tempel di ChatGPT atau Claude'],
  [LogIn, 'Login pakai akun Agnee'],
];

function BandMcp() {
  return (
    <Section id="mcp" className="py-16 sm:py-20">
      <div className="rounded-panel border-2 border-green-dark p-5 sm:p-8 dark:border-[#7fff4f]">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-dark px-3 py-1 text-[12px] font-semibold text-white dark:bg-[#7fff4f] dark:text-[#0c1912]">
          <Plug aria-hidden size={14} />
          Siap MCP
        </span>
        <h2 className="mt-4 mb-3 max-w-3xl text-[clamp(28px,4vw,42px)] leading-[1.15] font-semibold tracking-[-.035em] text-balance">
          Ajak Agnee ngobrol dari asisten AI favoritmu.
        </h2>
        <p className="m-0 max-w-2xl text-[16px] leading-[1.7] text-[#4e6e5e] dark:text-[#7aaa8a]">
          MCP itu colokan standar yang menghubungkan asisten AI ke aplikasi lain. Dengan MCP, ChatGPT atau Claude bisa membaca chat WhatsApp-mu, menarik laporan, dan menyiapkan balasan, tanpa kamu buka dashboard.
        </p>

        <div className="mt-8 grid items-center gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          {[
            [Bot, 'Asisten AI', 'ChatGPT atau Claude'],
            [Plug, 'MCP', 'Colokan standar'],
            [MessagesSquare, 'Agnee', 'Chat, laporan, kinerja tim'],
          ].map(([Ikon, judul, isi], i) => {
            const Icon = Ikon as LucideIcon;
            return (
              <div key={judul as string} className="contents">
                {i > 0 ? (
                  <span aria-hidden className="grid place-items-center text-green-dark dark:text-[#7fff4f]">
                    <ArrowRight size={22} className="hidden md:block" />
                    <ArrowDown size={22} className="md:hidden" />
                  </span>
                ) : null}
                <div
                  className={`flex items-center gap-3 rounded-panel p-4 ${
                    i === 1
                      ? 'bg-green-dark text-white dark:bg-[#7fff4f] dark:text-[#0c1912]'
                      : 'border border-[#c6dcc0] bg-white dark:border-[#24403a] dark:bg-[#14241f]'
                  }`}
                >
                  <Icon aria-hidden size={24} className="shrink-0" />
                  <div>
                    <p className="m-0 text-[16px] font-semibold">{judul as string}</p>
                    <p className="m-0 text-[13px] opacity-75">{isi as string}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <h3 className="mt-10 mb-4 text-[18px] font-semibold tracking-[-.02em]">Yang bisa kamu minta</h3>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {CONTOH_MCP.map(([Icon, tanya, alat]) => (
            <li
              key={tanya}
              className="rounded-panel border border-[#c6dcc0] bg-white p-4 dark:border-[#24403a] dark:bg-[#14241f]"
            >
              <span className="flex items-center gap-2 text-[12px] font-semibold text-green-dark dark:text-[#7fff4f]">
                <Icon aria-hidden size={16} />
                {alat}
              </span>
              <p className="m-0 mt-2.5 w-fit max-w-full rounded-2xl rounded-bl-md bg-[#dff0d6] px-3.5 py-2 text-[14px] leading-[1.45] text-[#0c1912] dark:bg-[#1b3028] dark:text-[#f4f9f0]">
                {tanya}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 mb-0 text-[12px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
          Contoh permintaan. Laporan dan kinerja agent hanya untuk supervisor, dan akses asisten AI sama dengan akses akun Agnee-mu. Waktu respons agent muncul bila memang terukur.
        </p>

        <div className="mt-10 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:gap-10">
          <div>
            <h3 className="m-0 mb-4 text-[18px] font-semibold tracking-[-.02em]">Tersambung dalam tiga langkah</h3>
            <ol className="m-0 grid list-none gap-3 p-0">
              {LANGKAH_MCP.map(([Icon, teks], i) => (
                <li key={teks} className="flex items-center gap-3 text-[15px]">
                  <span className="grid size-10 shrink-0 place-items-center rounded-app bg-[#dff0d6] text-green-dark dark:bg-[#1b3028] dark:text-[#7fff4f]">
                    <Icon aria-hidden size={18} />
                  </span>
                  <span>
                    <span className="mr-1.5 font-mono text-[12px] text-green-dark dark:text-[#7fff4f]">{i + 1}</span>
                    {teks}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <figure className="m-0 overflow-hidden rounded-panel border border-[#c6dcc0] bg-white dark:border-[#24403a] dark:bg-[#14241f]">
            <img
              src="/assets/landing/mcp.webp"
              width={1200}
              height={643}
              alt="Kartu MCP di pengaturan Agnee: alamat server dan langkah menghubungkan ke ChatGPT atau Claude"
              loading="lazy"
              className="block h-auto w-full"
            />
          </figure>
        </div>
      </div>
    </Section>
  );
}

/**
 * Diagram serah-terima. Angka 30 menit = AUTO_ASSIGN_IDLE_MINUTES (src/server.js).
 * Isi kartu serah-terima = migrasi 066 (alasan terstruktur, ringkasan, janji, data, saran).
 */
const ALUR_SERAH: [LucideIcon, string, string][] = [
  [Bot, 'AI menjawab', 'Dari Knowledge dan riwayat chat'],
  [Users, 'CS mulai mengetik', 'Chat jadi milik CS, AI minggir'],
  [Hourglass, 'CS diam 30 menit', 'Chat kembali ke AI, customer tidak menunggu'],
];

const ISI_KARTU = ['Alasan', 'Ringkasan 3 baris', 'Janji yang sudah dibuat AI', 'Data yang terkumpul', 'Saran balasan pertama'];

function BandSerahTerima() {
  return (
    <Section className="bg-ink py-16 text-white sm:py-20 dark:bg-[#14241f]">
      <p className="m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-[#7fff4f]">
        <span aria-hidden className="inline-block h-px w-5 bg-[#7fff4f]" />
        Serah-terima AI dan CS
      </p>
      <h2 className="m-0 mb-8 max-w-3xl text-[clamp(28px,4vw,42px)] leading-[1.15] font-semibold tracking-[-.035em]">
        Pindah tangan tanpa customer mengulang cerita.
      </h2>
      <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-3">
        {ALUR_SERAH.map(([Icon, judul, isi], i) => (
          <li key={judul} className="relative rounded-panel border border-white/15 p-5">
            <span className="flex items-center justify-between">
              <span className="grid size-10 place-items-center rounded-app bg-[#7fff4f]/15 text-[#7fff4f]">
                <Icon aria-hidden size={20} />
              </span>
              <span className="font-mono text-[12px] text-white/50">{String(i + 1).padStart(2, '0')}</span>
            </span>
            <h3 className="mt-3 mb-1 text-[17px] font-semibold">{judul}</h3>
            <p className="m-0 text-[13px] leading-[1.55] text-white/65">{isi}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6 rounded-panel border-2 border-[#7fff4f] bg-[#7fff4f]/10 p-6">
        <h3 className="m-0 mb-3 text-[17px] font-semibold">Setiap serah-terima membawa kartu</h3>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {ISI_KARTU.map((i) => (
            <li key={i} className="rounded-app border border-[#7fff4f]/40 px-3 py-1.5 text-[13px]">
              {i}
            </li>
          ))}
        </ul>
        <p className="mt-3 mb-0 text-[13px] leading-[1.6] text-white/70">
          CS yang menerima langsung tahu harus mulai dari mana. Saat chat dikembalikan ke AI, CS boleh menulis batasan, misalnya jangan bahas diskon.
        </p>
      </div>
    </Section>
  );
}

/**
 * Aturan main broadcast. Tiap angka ada barisnya di kode:
 *   20 sampai 45 detik, 300 per hari  src/broadcast.js, TEMPO.whatsapp_web
 *   08.00 sampai 20.00                src/broadcast.js, JAM_KIRIM
 *   bawaan cuma yang pernah membalas  Database.listBroadcastAudience + acceptUnproven di POST /v1/broadcasts
 *   STOP dikeluarkan                  broadcast_opt_outs
 *   hanya supervisor                  server.js, broadcastGuard
 *
 * Halaman ini sengaja TIDAK menjanjikan nomor aman dari blokir. Broadcast dari
 * WhatsApp Web selalu punya risiko dan yang memutuskan WhatsApp, bukan Agnee.
 * Yang ditulis cuma rem yang memang dipasang. Jaga itu kalau menyunting.
 */
const REM_BROADCAST: [LucideIcon, string, string][] = [
  [Timer, '20 sampai 45 detik', 'Jeda acak antar pesan'],
  [Gauge, '300 pesan', 'Batas per hari'],
  [Check, 'Hanya yang pernah membalas', 'Bawaan audiensnya'],
  [ShieldCheck, 'STOP dihormati', 'Yang membalas STOP dikeluarkan'],
];

function BandBroadcastVisual() {
  const jam = Array.from({ length: 24 }, (_, i) => i);
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Broadcast pintar</Eyebrow>
      <SectionTitle>Satu maksud, bunyi beda tiap penerima. Dengan rem dari awal.</SectionTitle>
      <ul className="m-0 grid list-none gap-2.5 p-0 text-[15px] sm:grid-cols-2">
        {[
          'Pilih audiens warm, cold, hot, atau saring sendiri',
          'Bawa audiens dari Lead List, atau impor Excel dan CSV',
          'Kirim sekarang atau jadwalkan',
          'Lihat siapa yang terkirim, gagal, atau dilewati',
        ].map((p) => (
          <li key={p} className="flex items-start gap-2.5">
            <Check aria-hidden size={18} className="mt-0.5 shrink-0 text-green-dark dark:text-[#7fff4f]" />
            {p}
          </li>
        ))}
      </ul>

      <div className="mt-8 rounded-panel border border-[#c6dcc0] bg-white p-5 dark:border-[#24403a] dark:bg-[#14241f]">
        <p className="m-0 mb-3 text-[13px] font-semibold">Jam kirim dalam sehari, waktu perusahaanmu</p>
        <div className="grid grid-cols-24 gap-[2px]" role="img" aria-label="Pesan hanya terkirim antara pukul 08.00 sampai 20.00">
          {jam.map((j) => (
            <span
              key={j}
              className={
                j >= 8 && j < 20
                  ? 'h-8 rounded-[3px] bg-green-dark dark:bg-[#7fff4f]'
                  : 'h-8 rounded-[3px] bg-[#dfe9da] dark:bg-[#24403a]'
              }
            />
          ))}
        </div>
        <div className="relative mt-1.5 h-4 font-mono text-[11px] text-[#4e6e5e] dark:text-[#7aaa8a]">
          <span className="absolute left-0">00</span>
          <span className="absolute left-[33.33%] -translate-x-1/2">08</span>
          <span className="absolute left-[83.33%] -translate-x-1/2">20</span>
          <span className="absolute right-0">24</span>
        </div>
      </div>

      <ul className="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {REM_BROADCAST.map(([Icon, nilai, label]) => (
          <li key={nilai} className="rounded-panel border border-[#c6dcc0] bg-white p-4 dark:border-[#24403a] dark:bg-[#14241f]">
            <Icon aria-hidden size={20} className="text-green-dark dark:text-[#7fff4f]" />
            <span className="mt-2 block text-[16px] leading-tight font-semibold">{nilai}</span>
            <span className="mt-0.5 block text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">{label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 mb-0 max-w-2xl text-[12px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
        Risiko blokir tidak nol: pesan massal dari WhatsApp Web selalu berisiko dan WhatsApp yang menentukan. Ini rem yang kami pasang, bukan jaminan.
      </p>
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

function UmpanWebinar() {
  return (
    <Section id="webinar" className="py-16 sm:py-20">
      <div className="rounded-panel bg-ink p-7 text-white sm:p-10 dark:bg-[#14241f]">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_.85fr]">
          <div>
            <p className="m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-[#7fff4f]">
              <span aria-hidden className="inline-block h-px w-5 bg-[#7fff4f]" />
              Kelas gratis, kuota terbatas
            </p>
            <h2 className="m-0 mb-4 text-[clamp(26px,3.6vw,38px)] leading-[1.15] font-semibold tracking-[-.035em]">
              Jualan Apa Pun dalam 15 Menit Chat
            </h2>
            <p className="m-0 max-w-xl text-[16px] leading-[1.7] text-white/65">
              Kerangka lima tahap buat ngebawa pelanggan dari "nanya doang" ke "transfer ke mana ya", tanpa terkesan jualan. Kerangka yang sama kami tanam di Agnee.
            </p>
            <p className="mt-3 mb-0 text-[14px] leading-[1.65] text-white/50">
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
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#7fff4f] font-mono text-[11px] font-bold text-[#0c1912]">
                  {index + 1}
                </span>
                <span className="text-[13px] leading-[1.5]">
                  <b className="font-semibold">{tahap}</b>
                  <span className="text-white/55">: {isi}</span>
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
  ['Isi Knowledge lewat ngobrol', 'Agnee yang nanya, kamu yang jawab. Delapan bagian Knowledge tersusun dari jawabanmu.'],
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
      'Delapan bagian Knowledge, semuanya',
      'Follow-up berjadwal dengan pengaman',
      'Broadcast pintar',
      'Laporan otomatis ke supervisor',
      'Departemen internal',
    ],
    href: WA_GROWTH,
    cta: 'Ambil harga promo',
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
      'Template Knowledge siap pasang',
      'Mode agent antar-departemen',
    ],
    href: WA_PRO,
    cta: 'Ambil harga promo',
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

      <div className="mt-6 rounded-panel border-2 border-green-dark bg-[#dff0d6] p-6 dark:border-[#7fff4f] dark:bg-[#1b3028]">
        <h3 className="m-0 mb-2 text-lg font-semibold">Sulit menolaknya, karena kamu ga menanggung risikonya.</h3>
        <ul className="m-0 grid list-none gap-1.5 p-0 text-[14px]">
          <li>7 hari gratis, tanpa kartu kredit. Ga terasa bedanya? Tutup akunnya, ga ada yang ditagih.</li>
          <li>Harga promo terkunci selama langgananmu jalan tanpa putus. Dibuka untuk {KUOTA_PROMO} perusahaan baru tiap bulan.</li>
          <li>Ebook CS gratis tetap jadi milikmu, mau lanjut berlangganan atau tidak.</li>
        </ul>
      </div>

      <p className="mt-10 mb-0 max-w-2xl text-[14px] leading-[1.65] text-[#4e6e5e] dark:text-[#7aaa8a]">
        Tiap bulan hanya {KUOTA_PROMO} perusahaan baru yang dapat harga promo. Kalau kuota bulan itu penuh, promo ditutup sampai bulan berikutnya dan harga naik. Kuotanya yang habis, bukan jamnya: ga ada hitung mundur palsu dan ga ada perpanjangan kuota.
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
    'Bisa. Knowledge adalah satu sumber kebenaran (source of truth) untuk seluruh tim: harga, aturan, dan cara bicara bisnismu. Isinya delapan bagian yang mengatur cara AI menjawab: persona, batasan, tanya-jawab, penggalian kebutuhan, penanganan keberatan, penutupan, follow-up, dan serah terima ke manusia. Kamu ga perlu nulisnya. Agnee yang nanya, kamu jawab, lalu dokumennya tersusun dari jawabanmu.',
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
    'Hubungin WhatsApp cukup sekali scan QR. Undang tim cuma beberapa menit. Yang paling makan waktu itu ngisi Knowledge, karena isinya cara bisnismu ngomong ke pelanggan. Tapi kamu ngisinya sambil ngobrol, dan boleh dicicil.',
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
 * Blok penutup: tiga pintu, lalu alasan untuk tidak menunda.
 *
 * Menggantikan banner CTA lama, yang cuma menawarkan satu jalan (coba gratis)
 * ke semua orang. Pembaca yang belum siap beli tidak punya apa-apa selain
 * pergi, padahal tiga pintunya sudah ada, cuma tersebar di tengah halaman.
 *
 * Disusun MENAIK menurut komitmen, sebagai baris bertumpuk, bukan tiga kolom
 * sejajar: tiga kolom membuat ketiganya terlihat setara, padahal yang kita mau
 * justru menunjukkan tangga. Penekanan visualnya ikut naik (garis tipis, garis
 * biasa, garis aksen) supaya tangganya terbaca tanpa perlu dijelaskan.
 *
 * Soal FOMO: tidak ada angka selisih harga sejak 2026-10-17, karena harga normal
 * sesudah kuota belum ditetapkan. Tidak ada hitung mundur, tidak ada sisa kuota
 * karangan. Kalau nanti sisa kuota mau ditampilkan, dia harus datang dari hitungan nyata
 * tabel companies, bukan dari konstanta yang gampang basi.
 */
const PINTU = [
  {
    kondisi: 'Belum butuh sekarang',
    isi: 'Ambil ebook buat tim CS-mu dulu. Gratis, ga perlu bikin akun, dan tetap kepakai walaupun kantormu ga pakai Agnee.',
    aksi: 'Ambil ebook gratis',
    href: '#ebook',
    eksternal: false,
    gaya: 'border border-[#c6dcc0] p-5 sm:p-6 dark:border-[#24403a]',
    tombol:
      'border border-[#c6dcc0] bg-transparent text-ink hover:bg-[#dff0d6] dark:border-[#24403a] dark:text-[#f4f9f0] dark:hover:bg-[#1b3028]',
  },
  {
    kondisi: 'Masih menimbang',
    isi: 'Ikut kelas 15 menit soal cara menutup penjualan lewat chat. Kerangka yang sama yang kami tanam di Agnee, jadi kamu sekalian lihat cara kerjanya.',
    aksi: 'Ambil kursi webinar',
    href: WA_WEBINAR,
    eksternal: true,
    gaya: 'border border-[#9db99a] bg-white p-6 sm:p-7 dark:border-[#3a5a4c] dark:bg-[#14241f]',
    tombol: 'bg-[#25d366] text-[#0c1912] hover:bg-[#1dbd5e]',
  },
  {
    kondisi: 'Mau lihat sendiri',
    isi: 'Hubungkan nomor WhatsApp-mu dan jalankan Agnee di chat beneran selama 7 hari. Tanpa kartu kredit, dan bisa berhenti kapan aja.',
    aksi: 'Coba Gratis 7 Hari',
    href: APP_URL + '/?signup=1',
    eksternal: false,
    gaya: 'border-2 border-green-dark bg-white p-7 sm:p-8 dark:border-[#7fff4f] dark:bg-[#14241f]',
    tombol: 'bg-ink text-white hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912]',
  },
];

function FunnelPenutup() {
  return (
    <Section id="mulai" className="py-16 sm:py-20">
      <SectionTitle>Tiga pintu. Pilih yang paling pas buat kamu hari ini.</SectionTitle>
      <Lead>
        Ga semua orang yang baca halaman ini lagi siap bayar, dan itu wajar. Jadi pintunya ada tiga, dari yang paling
        ringan sampai yang paling serius.
      </Lead>

      <div className="mt-8 grid gap-3">
        {PINTU.map((pintu, index) => (
          <div
            key={pintu.kondisi}
            className={`flex flex-col gap-4 rounded-panel sm:flex-row sm:items-center sm:gap-6 ${pintu.gaya}`}
          >
            <span className="shrink-0 font-mono text-[11px] font-semibold text-green-dark dark:text-[#7fff4f]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="mt-0 mb-1 text-base font-semibold sm:text-lg">{pintu.kondisi}</h3>
              <p className="m-0 text-[13px] leading-[1.6] text-[#4e6e5e] sm:text-[14px] dark:text-[#7aaa8a]">
                {pintu.isi}
              </p>
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

      <div className="mt-8 rounded-panel bg-ink p-7 text-white sm:p-10 dark:bg-[#14241f]">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
          <div>
            {/* "Batas promo", bukan "Sisa kuota": halaman ini tidak menampilkan
                angka sisa, jadi eyebrow-nya tidak boleh menjanjikan angka. Kalau
                nanti sisa kuota ditampilkan, dia harus dihitung dari tabel
                companies, bukan dari konstanta yang gampang basi. */}
            <p className="m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-[#7fff4f]">
        <span aria-hidden className="inline-block h-px w-5 bg-[#7fff4f]" />
              Batas promo
            </p>
            <h2 className="m-0 mb-3 text-[clamp(24px,3.4vw,34px)] leading-[1.15] font-semibold tracking-[-.035em]">
              Promo tiap bulan berhenti di perusahaan ke-{KUOTA_PROMO}.
            </h2>
            <p className="m-0 text-[15px] leading-[1.65] text-white/70">
              Kalau kuota bulan itu penuh, harga naik sampai bulan berikutnya. Yang daftar sebelum itu tetap bayar harga promo selama
              langganannya jalan tanpa putus. Ga ada hitung mundur palsu di halaman ini: kuotanya yang habis,
              bukan jamnya.
            </p>
          </div>
          <div className="lg:text-right">
            <a
              href="#pricing"
              className={`inline-block rounded-app bg-[#7fff4f] px-6 py-3 text-[15px] font-semibold text-[#0c1912] no-underline ${FOKUS_GELAP}`}
            >
              Lihat harga promo
            </a>
            <p className="mt-3 mb-0 text-[13px] leading-[1.6] text-white/55">
              Masih ragu? Coba 7 hari dulu, tanpa kartu kredit.
            </p>
          </div>
        </div>
      </div>
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
