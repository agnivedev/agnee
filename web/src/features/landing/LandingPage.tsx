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
 * SUARA HALAMAN = SUARA APP. Hero dan band "siapa bicara" memakai kata-kata
 * halaman masuk app (login.eyebrow, login.headline, login.description di
 * web/src/lib/messages.ts): bicara langsung ke pembaca ("kamu"), bukan
 * membingkai CS sebagai pihak ketiga. Kalau salah satunya diubah, ubah
 * keduanya. Em dash di app ditulis titik dua di sini (aturan antislop halaman).
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

const WA_PERSONAL = waLink('Halo, saya mau langganan Agnee Personal');
const WA_COMPANY = waLink('Halo, saya mau langganan Agnee Company');
const WA_LIFETIME = waLink('Halo, saya mau tanya paket Agnee Lifetime');
const WA_WHITELABEL = waLink('Halo, saya mau tanya Agnee white label');
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
 * Kuota promo pembukaan.
 *
 * Angka ini janji ke pembaca, bukan hiasan. Kalau perusahaan ke-101 mendaftar,
 * harga promonya memang harus berhenti — atau angkanya yang diubah di sini
 * sebelum itu terjadi.
 */
const KUOTA_PROMO = 100;

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
    document.title = 'Agnee: kamu offline, AI tetap online';
  }, []);

  return (
    <div className="min-h-dvh scroll-smooth bg-[#eef5eb] text-ink dark:bg-[#0c1912] dark:text-[#f4f9f0]">
      <Nav />
      <Hero />
      <ProofStrip />
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
          ['#fitur', 'Fitur'],
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
            AI dan CS kamu, satu inbox
          </p>
          <h1 className="mt-4 mb-0 text-[clamp(36px,6vw,66px)] leading-[1.03] font-semibold tracking-[-.05em]">
            Kamu offline.
            <br />
            <span className="text-green-dark dark:text-[#7fff4f]">AI tetap online.</span>
          </h1>
          <p className="mt-5 mb-0 max-w-xl text-[17px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
            Satu inbox WhatsApp buat semua tim. Kamu mulai ngetik, AI minggir. Kamu pergi, AI lanjut jaga chat. Tiap balasan ketahuan siapa yang nulis: AI atau kamu. Ga ada chat yang dibiarin nganggur.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={`${APP_URL}/?signup=1`}
              className={`rounded-app bg-ink px-5 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912] ${FOKUS}`}
            >
              Coba Gratis 7 Hari
            </a>
            <a
              href="#ebook"
              className={`rounded-app border border-[#c6dcc0] px-5 py-3 text-[15px] font-semibold no-underline dark:border-[#24403a] ${FOKUS}`}
            >
              Ambil Ebook Gratis
            </a>
          </div>
          <p className="mt-4 mb-0 text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">
            Promo beta untuk {KUOTA_PROMO} perusahaan pertama.
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
const BUKTI: [string, string][] = [
  ['30 menit', 'CS diam 30 menit, chat otomatis balik ke AI'],
  ['8 dokumen', 'Playbook yang mengatur cara AI menjawab, diisi lewat ngobrol'],
  ['AI atau kamu', 'Tiap balasan ketahuan siapa yang nulis'],
  ['3 pengaman', 'Follow-up cuma jalan di jam, jumlah, dan jarak yang kamu atur'],
];

function ProofStrip() {
  return (
    <Section className="border-y border-[#c6dcc0] py-8 dark:border-[#24403a]">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {BUKTI.map(([nilai, label]) => (
          <div key={nilai} className="text-center">
            <span className="block text-[22px] leading-tight font-semibold tracking-[-.03em]">{nilai}</span>
            <span className="mt-1.5 block text-[13px] leading-[1.5] text-[#4e6e5e] dark:text-[#7aaa8a]">{label}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function BandSiapaBicara() {
  return (
    <Section id="fitur" className="py-16 sm:py-20">
      <Eyebrow>AI dan CS kamu, satu inbox</Eyebrow>
      <SectionTitle>Satu inbox buat semua tim, tanpa tabrakan.</SectionTitle>
      <Lead>
        Kalau kamu mulai ngetik di chat yang lagi dipegang AI, chat itu langsung jadi milikmu dan AI berhenti balas. Kalau kamu pergi dan chat diam 30 menit, AI lanjut jaga. Tiap balasan ketahuan siapa yang nulis: AI, atau nama CS-nya.
      </Lead>
      <DuaSisi
        perusahaan="Satu nomor WhatsApp dipakai seluruh tim, dan riwayat siapa yang janji apa tinggal dicek."
        cs="Ga ada lagi AI yang kirim link checkout padahal kamu baru janji mau telepon jam 3."
      />
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
    <Section className="bg-ink py-16 text-white sm:py-20 dark:bg-[#14241f]">
      <p className="m-0 mb-2.5 flex items-center gap-2 text-[12px] font-semibold text-[#7fff4f]">
        <span aria-hidden className="inline-block h-px w-5 bg-[#7fff4f]" />
        Follow-up otomatis
      </p>
      <SectionTitle>Follow-up ke lead yang diam, tanpa bikin pelanggan risih.</SectionTitle>
      <p className="m-0 max-w-2xl text-[16px] leading-[1.7] text-white/65">
        Agnee kirim follow-up ke lead yang belum balas, tapi tiap pesan harus lolos tiga pengecekan dulu: masih dalam jam kirim yang kamu atur, belum lewat batas jumlah per hari, dan jaraknya dari pesan sebelumnya sudah cukup. Supervisor tetap bisa kirim manual di luar jadwal, dengan jarak yang dipersingkat. Rangkaian yang sudah selesai bisa dimulai lagi dengan jeda yang kamu tentukan.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-panel border border-white/15 p-5">
          <p className="m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-white/50 uppercase">
            Buat perusahaan
          </p>
          <p className="m-0 text-[14px] leading-[1.65] text-white/80">
            Lead yang belum balas tetap dihubungi, dengan batas jumlah dan jarak kirim supaya ga kelihatan spam.
          </p>
        </div>
        <div className="rounded-panel border-2 border-[#7fff4f] bg-[#7fff4f]/10 p-5">
          <p className="m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-[#7fff4f] uppercase">
            Buat tim CS
          </p>
          <p className="m-0 text-[14px] leading-[1.65] text-white">
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
            className="rounded-app border border-[#c6dcc0] bg-white px-3.5 py-2 text-[13px] dark:border-[#24403a] dark:bg-[#14241f]"
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
    <Section className="py-16 sm:py-20">
      <Eyebrow>Broadcast</Eyebrow>
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
 * Plafon di tiap paket harus sama dengan yang benar-benar diberlakukan server
 * (lihat batas paket di src/database.js): personal = 1 pengguna, 1 nomor,
 * 1 playbook, 500 pesan AI per bulan; company = 5 pengguna, dan sisanya tanpa
 * plafon angka. Jangan menulis "unlimited" tanpa catatan pemakaian wajar.
 */
const PLANS = [
  {
    badge: 'Perorangan',
    name: 'Personal',
    oldPrice: 'Rp 899.000',
    price: 'Rp 99.000',
    period: '/bulan',
    features: [
      '1 pengguna',
      '1 nomor WhatsApp',
      '1 dokumen playbook',
      '500 pesan AI per bulan',
      'Riwayat percakapan penuh',
      'Broadcast dengan tempo dan batas harian',
      'Bantuan via WhatsApp',
    ],
    href: WA_PERSONAL,
    cta: 'Ambil harga promo',
    highlight: false,
    note: '',
  },
  {
    badge: 'Buat tim CS',
    name: 'Company',
    oldPrice: 'Rp 8.900.000',
    price: 'Rp 3.900.000',
    period: '/bulan',
    features: [
      '5 pengguna (agent CS)',
      'Nomor WhatsApp tanpa batas',
      'Delapan dokumen playbook, semuanya',
      'Pesan AI tanpa batas',
      'Follow-up berjadwal + pengaman',
      'Lead List + ekspor XLSX/CSV',
      'Broadcast dengan tempo dan batas harian',
      'Biaya AI dicatat per perusahaan',
    ],
    href: WA_COMPANY,
    cta: 'Ambil harga promo',
    highlight: true,
    note: 'Pemakaian wajar: kalau pemakaianmu jauh di atas rata-rata, kami hubungin dulu. Layananmu ga akan kami putus tiba-tiba.',
  },
  {
    badge: '',
    name: 'Lifetime',
    oldPrice: 'Rp 39.900.000',
    price: 'Rp 29.900.000',
    period: 'sekali bayar',
    features: [
      'Semua yang ada di Company',
      'Bayar sekali, ga kedaluwarsa',
      'Ga ada tagihan bulanan, selamanya',
    ],
    href: WA_LIFETIME,
    cta: 'Tanya paket Lifetime',
    highlight: false,
    note: '',
  },
];

function Pricing() {
  return (
    <Section id="pricing" className="py-16 sm:py-20">
      <SectionTitle>Harga promo untuk {KUOTA_PROMO} perusahaan pertama.</SectionTitle>
      <Lead>
        Kuotanya beneran terbatas. Setelah {KUOTA_PROMO} perusahaan terdaftar, harga promo ditutup dan kembali ke harga normal. Yang udah daftar sebelum itu tetap bayar harga promo selama langganannya jalan tanpa putus. Ga ada hitung mundur palsu dan ga ada perpanjangan kuota.
      </Lead>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {PLANS.filter((plan) => plan.period === '/bulan').map((plan) => (
          <div
            key={plan.name}
            className={
              plan.highlight
                ? 'flex flex-col rounded-panel border-2 border-ink bg-white p-7 dark:border-[#7fff4f] dark:bg-[#14241f]'
                : 'flex flex-col rounded-panel border border-[#c6dcc0] bg-white p-7 dark:border-[#24403a] dark:bg-[#14241f]'
            }
          >
            <span className="inline-block self-start rounded-full bg-[#dff0d6] px-3 py-1 font-mono text-[11px] font-semibold text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
              {plan.badge}
            </span>
            <h3 className="mt-3 mb-2 text-xl font-semibold">{plan.name}</h3>
            <s className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">{plan.oldPrice}</s>
            <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
              <span className="text-3xl font-semibold tracking-[-.03em]">{plan.price}</span>
              <span className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">{plan.period}</span>
            </div>
            <ul className="mt-5 mb-6 grid list-none gap-2 p-0 text-[13px]">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span aria-hidden className="text-green-dark dark:text-[#7fff4f]">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
            {plan.note ? (
              <p className="mt-auto mb-5 text-[12px] leading-[1.55] text-[#4e6e5e] dark:text-[#7aaa8a]">{plan.note}</p>
            ) : null}
            <a
              href={plan.href}
              target="_blank"
              rel="noopener noreferrer"
              className={
                plan.note
                  ? `block rounded-app bg-[#25d366] text-[#0c1912] px-5 py-3 text-center text-[15px] font-semibold no-underline transition hover:bg-[#1dbd5e] ${FOKUS}`
                  : `mt-auto block rounded-app bg-[#25d366] text-[#0c1912] px-5 py-3 text-center text-[15px] font-semibold no-underline transition hover:bg-[#1dbd5e] ${FOKUS}`
              }
            >
              {plan.cta}
            </a>
          </div>
        ))}
      </div>

      {PLANS.filter((plan) => plan.period === 'sekali bayar').map((plan) => (
        <div
          key={plan.name}
          className="mt-4 grid gap-5 rounded-panel border border-[#c6dcc0] bg-white p-7 md:grid-cols-[1fr_auto] md:items-center dark:border-[#24403a] dark:bg-[#14241f]"
        >
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="m-0 text-xl font-semibold">{plan.name}</h3>
              <s className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">{plan.oldPrice}</s>
              <span className="text-2xl font-semibold tracking-[-.03em]">{plan.price}</span>
              <span className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">{plan.period}</span>
            </div>
            <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0 text-[13px]">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <span aria-hidden className="text-green-dark dark:text-[#7fff4f]">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>
          <a
            href={plan.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`block rounded-app bg-[#25d366] text-[#0c1912] px-5 py-3 text-center text-[15px] font-semibold no-underline transition hover:bg-[#1dbd5e] md:w-max ${FOKUS}`}
          >
            {plan.cta}
          </a>
        </div>
      ))}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-panel border border-[#c6dcc0] bg-white p-6 dark:border-[#24403a] dark:bg-[#14241f]">
        <div>
          <h3 className="mt-0 mb-1 text-base font-semibold">Mau Agnee tampil dengan namamu sendiri?</h3>
          <p className="m-0 text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
            White label dibahas satu per satu, ruang lingkup dan harganya menyesuaikan kebutuhanmu.
          </p>
        </div>
        <a
          href={WA_WHITELABEL}
          target="_blank"
          rel="noopener noreferrer"
          className={`rounded-app border border-[#c6dcc0] px-5 py-3 text-[15px] font-semibold no-underline dark:border-[#24403a] ${FOKUS}`}
        >
          Minta penawaran white label
        </a>
      </div>
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
    'Personal untuk 1 pengguna, Company untuk 5 CS aktif. Butuh lebih banyak? Chat kami lewat WhatsApp, batasnya memang diatur per perusahaan.',
  ],
  [
    '"Pesan AI tanpa batas" beneran tanpa batas?',
    'Ga ada angka yang bikin AI-mu berhenti di tengah jalan, dan memang begitu cara sistemnya jalan. Tapi pemakaian AI itu ada biayanya buat kami. Kalau pemakaianmu jauh di atas rata-rata, kami hubungin dulu buat ngobrol. Layananmu ga akan kami matikan tiba-tiba.',
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
    'Ga. Kalau kamu daftar sebelum kuota promo penuh, harga promo berlaku selama langgananmu jalan tanpa putus. Syaratnya cuma satu: kalau langgananmu berhenti lalu kamu mulai lagi setelah kuotanya penuh, yang berlaku harga normal. Paket Lifetime dibayar sekali dan ga ada tagihan lagi.',
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
 * Soal FOMO: angkanya aritmetika dari harga yang sudah tertulis di halaman ini
 * (8.900.000 - 3.900.000), bukan hitung mundur, bukan sisa kuota karangan.
 * Kalau nanti sisa kuota mau ditampilkan, dia harus datang dari hitungan nyata
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
              Harga promo berhenti di perusahaan ke-{KUOTA_PROMO}.
            </h2>
            <p className="m-0 text-[15px] leading-[1.65] text-white/70">
              Setelah kuotanya penuh, Company balik ke Rp 8.900.000 per bulan. Selisihnya Rp 5.000.000 tiap bulan, dan
              Personal naik dari Rp 99.000 ke Rp 899.000. Yang daftar sebelum kuota penuh tetap bayar harga promo
              selama langganannya jalan tanpa putus. Ga ada hitung mundur palsu di halaman ini: kuotanya yang habis,
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
