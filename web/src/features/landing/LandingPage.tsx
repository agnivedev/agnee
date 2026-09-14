import { useEffect, useState, type ReactNode } from 'react';

/**
 * Public marketing page. Deliberately not run through the i18n dictionary: the
 * copy is Indonesian sales writing, not interface labels, and the vanilla page
 * it replaces was never translated either.
 *
 * It carries its own palette (neon on deep green) rather than the workspace
 * one, and follows the visitor's system dark mode.
 */

const WA_LINK = 'https://wa.me/6281218700276';
const WA_PERSONAL = `${WA_LINK}?text=Halo%2C%20saya%20mau%20langganan%20Agnee%20Personal%20Beta`;
const WA_COMPANY = `${WA_LINK}?text=Halo%2C%20saya%20mau%20langganan%20Agnee%20Company%20Beta`;

export function LandingPage() {
  useEffect(() => {
    document.title = 'Agnee — Inbox CS WhatsApp untuk Tim yang Serius';
  }, []);

  return (
    <div className="min-h-dvh scroll-smooth bg-[#eef5eb] text-ink dark:bg-[#0c1912] dark:text-[#f4f9f0]">
      <Nav />
      <Hero />
      <Stats />
      <Features />
      <HowItWorks />
      <Product />
      <Testimonials />
      <Pricing />
      <Faq />
      <CtaBanner />
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
    <p className="m-0 mb-2 font-mono text-[11px] font-medium tracking-[.14em] text-green-dark uppercase dark:text-[#7fff4f]">
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="m-0 mb-10 text-[clamp(28px,4vw,42px)] leading-[1.15] font-semibold tracking-[-.035em]">{children}</h2>;
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 flex items-center gap-6 border-b border-[#c6dcc0] bg-[#eef5eb]/85 px-5 py-3.5 backdrop-blur-md sm:px-8 dark:border-[#24403a] dark:bg-[#0c1912]/85">
      <a href="/landing" className="shrink-0" aria-label="Agnee by Beweix">
        <img src="/brand/agnee-logo-primary.svg" alt="Agnee by Beweix" className="h-7 dark:brightness-0 dark:invert" />
      </a>
      <nav className="hidden gap-6 sm:flex">
        {[
          ['#fitur', 'Fitur'],
          ['#pricing', 'Harga'],
          ['#faq', 'FAQ'],
        ].map(([href, label]) => (
          <a key={href} href={href} className="text-sm font-medium text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a] dark:hover:text-[#f4f9f0]">
            {label}
          </a>
        ))}
      </nav>
      <a
        href="/"
        className="ml-auto rounded-full border border-[#c6dcc0] px-4 py-2 text-sm font-semibold no-underline dark:border-[#24403a]"
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
          <span className="inline-block rounded-full bg-[#dff0d6] px-3 py-1 font-mono text-[11px] font-semibold text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
            Beta
          </span>
          <h1 className="mt-4 mb-0 text-[clamp(38px,6vw,68px)] leading-[1.03] font-semibold tracking-[-.05em]">
            Banyak agen CS,
            <br />
            satu dashboard.
          </h1>
          <p className="mt-5 mb-0 max-w-xl text-[17px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
            Atur distribusi chat otomatis, pantau seluruh tim, dan biarkan AI balas pelanggan 24/7 — dari satu tempat.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="/?signup=1"
              className="rounded-app bg-ink px-5 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912]"
            >
              Coba Gratis
            </a>
            <a
              href="#pricing"
              className="rounded-app border border-[#c6dcc0] px-5 py-3 text-[15px] font-semibold no-underline dark:border-[#24403a]"
            >
              Lihat harga
            </a>
          </div>
        </div>
        <img src="/assets/hero-team.png" alt="Tim CS Agnee" className="w-full rounded-panel" />
      </div>
    </Section>
  );
}

const STATS = [
  ['500+', 'Chat dihandle hari ini'],
  ['<3 dtk', 'Rata-rata response AI'],
  ['10+', 'Tim CS onboard beta'],
  ['24/7', 'AI siap melayani'],
];

function Stats() {
  return (
    <Section className="border-y border-[#c6dcc0] py-8 dark:border-[#24403a]">
      <div className="grid gap-6 sm:grid-cols-4">
        {STATS.map(([value, label]) => (
          <div key={label} className="text-center">
            <span className="block text-2xl font-semibold tracking-[-.03em]">{value}</span>
            <span className="mt-1 block text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">{label}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

const FEATURES: { title: string; desc: string; path: ReactNode }[] = [
  {
    title: 'Multi-agent Inbox',
    desc: 'Satu nomor WA, seluruh tim CS. Assign, transfer, dan pantau semua percakapan dari satu dashboard bersama.',
    path: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  {
    title: 'AI Auto-reply 24/7',
    desc: 'Buat playbook sekali, AI yang jaga pelanggan. Dari FAQ sampai kualifikasi leads — semua otomatis, kapan saja.',
    path: (
      <>
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </>
    ),
  },
  {
    title: 'Distribusi Traffic Cerdas',
    desc: 'Chat masuk dibagi otomatis ke agen yang available. Tidak ada yang kelebihan beban, tidak ada chat yang terlewat.',
    path: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  },
  {
    title: 'Dashboard Real-time',
    desc: 'Monitor beban kerja setiap agen, status percakapan, dan performa tim secara langsung tanpa perlu refresh.',
    path: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    ),
  },
  {
    title: 'Histori Percakapan Lengkap',
    desc: 'Semua riwayat chat tersimpan dan mudah dicari. Agen baru langsung tahu konteks pelanggan tanpa tanya ulang.',
    path: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  },
  {
    title: 'Laporan & Analitik',
    desc: 'Lihat berapa chat ditangani, response time rata-rata, dan performa AI — semua dalam satu halaman laporan.',
    path: (
      <>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </>
    ),
  },
];

function Features() {
  return (
    <Section id="fitur" className="py-16 sm:py-20">
      <Eyebrow>Fitur utama</Eyebrow>
      <SectionTitle>Semua yang tim CS kamu butuhkan</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-panel border border-[#c6dcc0] bg-white p-6 dark:border-[#24403a] dark:bg-[#14241f]"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-[#dff0d6] text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {feature.path}
              </svg>
            </span>
            <h3 className="mt-4 mb-1.5 text-base font-semibold">{feature.title}</h3>
            <p className="m-0 text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">{feature.desc}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

const STEPS = [
  ['Hubungkan WhatsApp', 'Scan QR code dari dashboard Agnee. Selesai dalam 2 menit — tanpa coding, tanpa API berbayar.'],
  ['Undang Tim CS', 'Tambahkan agen via email, atur peran mereka, dan mulai assign percakapan ke orang yang tepat.'],
  ['Aktifkan AI', 'Setup playbook sesuai bisnis kamu sekali. AI langsung siap balas pelanggan 24/7 sesuai panduan yang kamu buat.'],
];

function HowItWorks() {
  return (
    <Section className="bg-ink py-16 text-white sm:py-20 dark:bg-[#14241f]">
      <p className="m-0 mb-2 font-mono text-[11px] font-medium tracking-[.14em] text-[#7fff4f] uppercase">Cara kerja</p>
      <SectionTitle>Setup dalam 3 langkah mudah</SectionTitle>
      <div className="grid gap-6 sm:grid-cols-3">
        {STEPS.map(([title, desc], index) => (
          <div key={title}>
            <span className="grid size-9 place-items-center rounded-full bg-[#7fff4f] font-semibold text-[#0c1912]">
              {index + 1}
            </span>
            <h3 className="mt-3.5 mb-1.5 text-base font-semibold">{title}</h3>
            <p className="m-0 text-[13px] leading-[1.6] text-white/60">{desc}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Product() {
  return (
    <Section className="py-16 text-center sm:py-20">
      <Eyebrow>Satu inbox. Semua agen. Semua percakapan.</Eyebrow>
      <SectionTitle>
        Kelola seluruh tim CS dan chat WhatsApp
        <br />
        dari satu dashboard
      </SectionTitle>
      <img src="/assets/hero-dashboard.png" alt="Agnee Dashboard" loading="lazy" className="mx-auto w-full rounded-panel" />
    </Section>
  );
}

const TESTIMONIALS = [
  [
    '"Sejak pakai Agnee, tim CS kami tidak perlu pindah-pindah HP lagi. Semua chat WA terpusat, dan AI yang jaga malam hari. Response time kami turun dari 30 menit jadi di bawah 5 menit."',
    'RS',
    'Ratna S.',
    'Owner, Toko Online Fashion',
  ],
  [
    '"AI-nya bisa dikustomisasi sesuai produk kita. Playbook-nya fleksibel, dan kalau ada yang butuh agen manusia langsung di-handover dengan mulus. Tim kami jadi jauh lebih efisien."',
    'DA',
    'Deni A.',
    'CS Manager, Properti Digital',
  ],
  [
    '"Kami punya 3 agen CS dengan 1 nomor WA. Sebelumnya chaos karena tidak ada yang tahu siapa handle siapa. Sekarang semua ter-assign jelas, histori lengkap, tidak ada yang terlewat."',
    'MA',
    'Maya A.',
    'Founder, Klinik Kecantikan',
  ],
  [
    '"Dashboard-nya simpel tapi lengkap. Saya bisa lihat berapa chat yang pending, siapa agen yang paling sibuk, dan berapa yang sudah AI tangani — semua real-time tanpa perlu tanya-tanya ke tim."',
    'BW',
    'Budi W.',
    'Operations Lead, E-commerce',
  ],
];

function Testimonials() {
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Kata mereka</Eyebrow>
      <SectionTitle>Dipercaya tim CS yang berkembang</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        {TESTIMONIALS.map(([quote, initials, name, role]) => (
          <figure
            key={name}
            className="m-0 rounded-panel border border-[#c6dcc0] bg-white p-6 dark:border-[#24403a] dark:bg-[#14241f]"
          >
            <div className="text-[#f0b429]" aria-label="5 dari 5">
              ★★★★★
            </div>
            <blockquote className="mt-3 mb-4 text-[14px] leading-[1.65]">{quote}</blockquote>
            <figcaption className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-[#dff0d6] font-mono text-[11px] font-bold text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
                {initials}
              </span>
              <span className="grid">
                <b className="text-[13px]">{name}</b>
                <small className="text-[11px] text-[#4e6e5e] dark:text-[#7aaa8a]">{role}</small>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </Section>
  );
}

const PLANS = [
  {
    badge: 'Beta Promo',
    name: 'Personal',
    oldPrice: 'Rp 299.000',
    price: 'Rp 99.000',
    features: ['1 user', '1 WhatsApp', '1 Playbook AI', '500 pesan AI/bulan', 'Histori percakapan', 'Dukungan via WhatsApp'],
    href: WA_PERSONAL,
    highlight: false,
  },
  {
    badge: 'Most Popular',
    name: 'Company',
    oldPrice: 'Rp 1.299.000',
    price: 'Rp 999.000',
    features: [
      '5 users (agen CS)',
      'Unlimited WhatsApp',
      'Unlimited Playbook AI',
      'Unlimited pesan AI',
      'Distribusi traffic otomatis',
      'Dashboard analytics',
      'Prioritas dukungan',
    ],
    href: WA_COMPANY,
    highlight: true,
  },
];

function Pricing() {
  return (
    <Section id="pricing" className="py-16 sm:py-20">
      <Eyebrow>Harga</Eyebrow>
      <SectionTitle>
        Pilih paket yang sesuai
        <br />
        dengan kebutuhan tim kamu
      </SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={
              plan.highlight
                ? 'rounded-panel border-2 border-ink bg-white p-7 dark:border-[#7fff4f] dark:bg-[#14241f]'
                : 'rounded-panel border border-[#c6dcc0] bg-white p-7 dark:border-[#24403a] dark:bg-[#14241f]'
            }
          >
            <span className="inline-block rounded-full bg-[#dff0d6] px-3 py-1 font-mono text-[11px] font-semibold text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
              {plan.badge}
            </span>
            <h3 className="mt-3 mb-2 text-xl font-semibold">{plan.name}</h3>
            <s className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">{plan.oldPrice}</s>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tracking-[-.03em]">{plan.price}</span>
              <span className="text-[13px] text-[#4e6e5e] dark:text-[#7aaa8a]">/bulan</span>
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
            <a
              href={plan.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-app bg-[#25d366] px-5 py-3 text-center text-[15px] font-semibold text-white no-underline transition hover:bg-[#1dbd5e]"
            >
              Beli via WhatsApp
            </a>
          </div>
        ))}
      </div>
    </Section>
  );
}

const FAQ_ITEMS = [
  [
    'Apakah Agnee menggunakan WhatsApp resmi (API)?',
    'Agnee menggunakan WhatsApp Web — bukan WhatsApp Business API berbayar. Ini artinya kamu bisa mulai langsung dengan nomor WA yang sudah ada, tanpa perlu approval Meta atau biaya per-pesan. Tradeoff-nya: nomor harus tetap terhubung (scan QR sekali, lalu berjalan di background).',
  ],
  [
    'Berapa banyak agen CS yang bisa saya tambahkan?',
    'Paket Personal mendukung 1 user. Paket Company mendukung hingga 5 agen CS aktif. Butuh lebih? Hubungi kami via WhatsApp — kami bisa buat paket custom sesuai kebutuhan tim kamu.',
  ],
  [
    'Apakah AI bisa dikustomisasi sesuai bisnis saya?',
    'Ya. Kamu buat "Playbook" — panduan yang memberitahu AI cara menjawab, produk apa yang dijual, pertanyaan mana yang harus di-eskalasi ke agen manusia, dan tone yang harus digunakan. AI akan mengikuti playbook tersebut secara konsisten.',
  ],
  [
    'Apakah data percakapan pelanggan aman?',
    'Data percakapan disimpan di server kami dengan enkripsi. Kami tidak membagikan data ke pihak ketiga. Setiap perusahaan hanya bisa mengakses data mereka sendiri — isolasi antar tenant sudah diterapkan di level database.',
  ],
  [
    'Apakah ada masa trial atau versi gratis?',
    'Saat ini kami masih dalam fase beta. Klik "Coba Gratis" untuk membuat akun dan mulai menggunakan Agnee. Hubungi kami via WhatsApp jika ingin mendiskusikan akses extended atau kebutuhan khusus.',
  ],
  [
    'Berapa lama proses setup?',
    'Rata-rata kurang dari 10 menit: buat akun, scan QR WhatsApp (2 menit), undang agen, dan setup playbook AI dasar. Tim kamu sudah bisa mulai handle chat WA bersama hari ini juga.',
  ],
];

function Faq() {
  // One open at a time, as the vanilla page behaved.
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Section id="faq" className="py-16 sm:py-20">
      <Eyebrow>FAQ</Eyebrow>
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
              className="flex w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent p-5 text-left text-[15px] font-semibold text-inherit"
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

function CtaBanner() {
  return (
    <Section className="py-16 sm:py-20">
      <div className="rounded-panel bg-ink p-10 text-center text-white dark:bg-[#14241f]">
        <h2 className="m-0 text-[clamp(26px,4vw,40px)] leading-[1.15] font-semibold tracking-[-.035em]">
          Siap tingkatkan layanan
          <br />
          CS tim kamu?
        </h2>
        <p className="mt-3 mb-6 text-white/65">Setup dalam 10 menit. Tidak perlu kartu kredit.</p>
        <a
          href="/?signup=1"
          className="inline-block rounded-app bg-[#7fff4f] px-6 py-3 text-[15px] font-semibold text-[#0c1912] no-underline"
        >
          Mulai Gratis Sekarang →
        </a>
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
      ['/', 'Login'],
    ],
  ],
  [
    'Perusahaan',
    [
      ['#tentang', 'Tentang Kami'],
      [WA_LINK, 'Karir'],
    ],
  ],
  [
    'Dukungan',
    [
      ['#faq', 'FAQ'],
      [WA_LINK, 'WhatsApp Kami'],
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
              Inbox CS WhatsApp untuk tim yang ingin tumbuh lebih cepat — tanpa chaos.
            </p>
            <a
              href={WA_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-app bg-[#25d366] px-4 py-2.5 text-[13px] font-semibold text-white no-underline"
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
              <ul className="m-0 grid list-none gap-2 p-0">
                {links.map(([href, label]) => (
                  <li key={label}>
                    <a
                      href={href}
                      {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="text-[13px] text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a] dark:hover:text-[#f4f9f0]"
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
          <span>© 2025 Agnive. Hak cipta dilindungi.</span>
          <span className="flex gap-4">
            <a href="#" className="text-inherit no-underline hover:underline">
              Kebijakan Privasi
            </a>
            <a href="#" className="text-inherit no-underline hover:underline">
              Syarat &amp; Ketentuan
            </a>
          </span>
          <span>Dibuat di Indonesia 🇮🇩</span>
        </div>
      </div>
    </footer>
  );
}
