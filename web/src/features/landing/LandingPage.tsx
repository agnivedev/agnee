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
 */

const WA_LINK = 'https://wa.me/6281218700276';
const waLink = (pesan: string) => `${WA_LINK}?text=${encodeURIComponent(pesan)}`;

const WA_PERSONAL = waLink('Halo, saya mau langganan Agnee Personal');
const WA_COMPANY = waLink('Halo, saya mau langganan Agnee Company');
const WA_LIFETIME = waLink('Halo, saya mau tanya paket Agnee Lifetime');
const WA_WHITELABEL = waLink('Halo, saya mau tanya Agnee white label');
const WA_EBOOK = waLink('EBOOK CS - halo, saya mau ebook "Balas Chat Tanpa Kehabisan Diri Sendiri"');
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

export function LandingPage() {
  useEffect(() => {
    document.title = 'Agnee — Pelangganmu dilayani. CS-mu juga.';
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
      <GridPendukung />
      <GridYangBerubah />
      <UmpanWebinar />
      <HowItWorks />
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
          Perusahaanmu dapat
        </p>
        <p className="m-0 text-[14px] leading-[1.65]">{perusahaan}</p>
      </div>
      <div className="rounded-panel border-2 border-green-dark bg-[#dff0d6] p-5 dark:border-[#7fff4f] dark:bg-[#1b3028]">
        <p className="m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-[#205a38] uppercase dark:text-[#7fff4f]">
          Kamu, CS, dapat
        </p>
        <p className="m-0 text-[14px] leading-[1.65] text-[#14241f] dark:text-[#f4f9f0]">{cs}</p>
      </div>
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-50 flex items-center gap-6 border-b border-[#c6dcc0] bg-[#eef5eb]/85 px-5 py-3.5 backdrop-blur-md sm:px-8 dark:border-[#24403a] dark:bg-[#0c1912]/85">
      <a href="/landing" className="shrink-0" aria-label="Agnee by Beweix">
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
            className="text-sm font-medium text-[#4e6e5e] no-underline hover:text-ink dark:text-[#7aaa8a] dark:hover:text-[#f4f9f0]"
          >
            {label}
          </a>
        ))}
      </nav>
      <a href="/" className="ml-auto rounded-full border border-[#c6dcc0] px-4 py-2 text-sm font-semibold no-underline dark:border-[#24403a]">
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
            Beta — kuota promo {KUOTA_PROMO} slot, belum habis
          </span>
          <h1 className="mt-4 mb-0 text-[clamp(36px,6vw,66px)] leading-[1.03] font-semibold tracking-[-.05em]">
            Pelangganmu dilayani.
            <br />
            CS-mu juga.
          </h1>
          <p className="mt-5 mb-0 max-w-xl text-[17px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
            Semua yang lain jual robot yang gantiin CS. Agnee jaga chat pelangganmu{' '}
            <b className="font-semibold text-ink dark:text-[#f4f9f0]">dan</b> orang yang membalasnya — biar ga ada yang
            kelewat, dan ga ada CS yang pulang bawa kerjaan ke rumah.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="/?signup=1"
              className="rounded-app bg-ink px-5 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912]"
            >
              Coba Gratis 7 Hari
            </a>
            <a href="#ebook" className="rounded-app border border-[#c6dcc0] px-5 py-3 text-[15px] font-semibold no-underline dark:border-[#24403a]">
              Ambil ebook CS-nya dulu
            </a>
          </div>
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
 *   2 penulis — kolom author ('ai' | 'human') di migrasi 014
 *   3 pengaman — jendela jam, plafon harian, jarak minimum di src/follow-up.js
 */
const BUKTI: [string, string][] = [
  ['30 menit', 'Kamu pergi, AI jaga. Balik sendiri setelah chat segini lama diam'],
  ['8 dokumen', 'Cara AI-mu ngomong — semuanya diisi lewat ngobrol, bukan nulis'],
  ['2 penulis, 1 tanda', 'Tiap pesan keluar ketahuan siapa yang nulis — AI atau kamu'],
  ['3 pengaman', 'Tiga pintu yang harus dilolos follow-up sebelum boleh berangkat'],
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
      <Eyebrow>Inbox multi-agent</Eyebrow>
      <SectionTitle>Dua orang membalas satu pelanggan adalah mimpi buruk. Agnee tidak mengizinkannya.</SectionTitle>
      <Lead>
        Agent mulai ngetik di chat yang lagi dijaga AI? Chat itu langsung jadi miliknya — AI mundur sendiri. Agent
        pergi tanpa pamit? Setelah 30 menit diam, chat balik ke AI, bukan nunggu orang yang udah pulang. Tiap pesan
        yang keluar dari nomormu bawa nama penulisnya: AI, atau agent yang mana.
      </Lead>
      <DuaSisi
        perusahaan=”Satu nomor, seluruh tim, dan riwayat yang bisa ditanya “ini tadi siapa yang janji?” — dengan jawaban.”
        cs=”Ga bakal malu lagi gara-gara AI kirimin link checkout lima detik setelah kamu janji nelpon jam 3.”
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
      <p className="m-0 mb-2 font-mono text-[11px] font-medium tracking-[.14em] text-[#7fff4f] uppercase">
        Follow-up berjadwal
      </p>
      <SectionTitle>Follow-up yang lebih sopan daripada kebanyakan manusia.</SectionTitle>
      <p className=”m-0 max-w-2xl text-[16px] leading-[1.7] text-white/65”>
        Agnee kejar leadmu sampai jawab — tapi ga sampai dibenci. Sebelum satu pesan boleh jalan, harus lolos tiga
        pintu: masih dalam jam kirim yang kamu tentukan, belum lewatin plafon hari itu, dan udah cukup jauh jaraknya
        dari pesan sebelumnya. Supervisor mau kirim manual di luar jadwal? Boleh — jaraknya cuma diperpendek,{' '}
        <b className=”font-semibold text-white”>ga dihapus</b>. Rangkaian yang udah selesai pun bisa dimulai ulang,
        dengan jeda yang kamu atur sendiri.
      </p>
      <div className=”mt-8 grid gap-4 sm:grid-cols-2”>
        <div className=”rounded-panel border border-white/15 p-5”>
          <p className=”m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-white/50 uppercase”>
            Perusahaanmu dapat
          </p>
          <p className=”m-0 text-[14px] leading-[1.65] text-white/80”>
            Lead yang dingin tetap disentuh, tanpa nomormu dilaporkan.
          </p>
        </div>
        <div className=”rounded-panel border-2 border-[#7fff4f] bg-[#7fff4f]/10 p-5”>
          <p className=”m-0 mb-1.5 font-mono text-[11px] font-semibold tracking-[.12em] text-[#7fff4f] uppercase”>
            Kamu, CS, dapat
          </p>
          <p className=”m-0 text-[14px] leading-[1.65] text-white”>
            List “nanti dikabarin lagi” yang ga perlu lagi tinggal di kepala kamu sampai jam 11 malem.
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
          className="rounded-app bg-ink px-5 py-3 text-[15px] font-semibold text-white no-underline transition hover:-translate-y-0.5 dark:bg-[#7fff4f] dark:text-[#0c1912]"
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
            ? 'rounded-app border border-[#c6dcc0] px-5 py-3 text-[15px] font-semibold no-underline dark:border-[#24403a]'
            : 'inline-flex items-center gap-2 rounded-app bg-[#25d366] px-5 py-3 text-[15px] font-semibold text-white no-underline transition hover:bg-[#1dbd5e]'
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
            <Eyebrow>Gratis — untuk kamu yang membalas</Eyebrow>
            <h2 className="m-0 mb-4 text-[clamp(26px,3.6vw,38px)] leading-[1.15] font-semibold tracking-[-.035em]">
              “Balas Chat Tanpa Kehabisan Diri Sendiri”
            </h2>
            <Lead>
              Bukan untuk bosmu. Untuk kamu. Panduan tentang pekerjaan yang jarang ada bukunya: menghadapi orang marah
              tanpa ikut terbawa, membaca kapan seseorang sebenarnya sudah siap beli, dan menutup hari tanpa membawa
              satu pun chat pulang.
            </Lead>
            <p className="mt-3 mb-0 text-[14px] leading-[1.65] text-[#4e6e5e] dark:text-[#7aaa8a]">
              Boleh dibaca walaupun kantormu tidak pakai Agnee. Kami serius.
            </p>
            <TombolUmpan
              mayar={MAYAR_EBOOK}
              mayarLabel="Kirim ebook-nya ke saya"
              wa={WA_EBOOK}
              waLabel="Minta ebook-nya via WhatsApp"
            />
          </div>
          <ol className="m-0 grid list-none content-start gap-2 p-0">
            {[
              'Kenapa 200 chat terasa berat, padahal isinya cuma 12 pertanyaan',
              'Dua belas balasan yang harusnya tidak kamu ketik ulang',
              'Orang marah: tiga kalimat pertama yang menentukan sisanya',
              'Membaca sinyal siap beli — kapan kirim link, kapan justru jangan',
              'Follow-up yang tidak terasa nagih',
              'Serah terima ke shift berikutnya tanpa kehilangan konteks',
              'Menutup hari: apa yang boleh ditinggal untuk besok',
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
      <Eyebrow>Knowledge</Eyebrow>
      <SectionTitle>AI-mu tidak butuh kamu jadi penulis prompt.</SectionTitle>
      <Lead>
        Delapan dokumen yang nentuin cara AI-mu ngomong. Kamu ga nulis dokumen — kamu{' '}
        <b className="font-semibold text-ink dark:text-[#f4f9f0]">ngobrol</b>. Agnee yang nanya, kamu jawab kayak lagi
        jelasin ke karyawan baru, dan dokumennya tersusun sendiri. Tiap percakapan yang beres bagus, Agnee nawar:
        disimpan ke playbook?
      </Lead>
      <div className="mt-8 flex flex-wrap gap-2">
        {[
          ['Persona', 'Siapa dia saat bicara'],
          ['Compliance', 'Yang tidak boleh dikatakan'],
          ['Tanya-jawab', 'Pertanyaan yang itu-itu saja'],
          ['Discovery', 'Cara menggali kebutuhan'],
          ['Objection', 'Menjawab keberatan'],
          ['Closing', 'Membawa ke keputusan'],
          ['Follow-up', 'Cara menyusul'],
          ['Handoff', 'Kapan menyerah ke manusia'],
        ].map(([nama, guna]) => (
          <span
            key={nama}
            className="rounded-app border border-[#c6dcc0] bg-white px-3.5 py-2 text-[13px] dark:border-[#24403a] dark:bg-[#14241f]"
          >
            <b className="font-semibold">{nama}</b>
            <span className="text-[#4e6e5e] dark:text-[#7aaa8a]"> — {guna}</span>
          </span>
        ))}
      </div>
      <DuaSisi
        perusahaan="Playbook yang tumbuh dari percakapan yang beneran terjadi, bukan dokumen yang ditulis sekali terus dilupain."
        cs="Jawaban terbaik kamu ga mati bareng satu chat — dia jadi cara AI jawab besok."
      />
    </Section>
  );
}

function BandRingkasan() {
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Ringkasan &amp; label</Eyebrow>
      <SectionTitle>AI boleh menyimpulkan. Kamu boleh membantah.</SectionTitle>
      <Lead>
        Tiap percakapan punya ringkasan dan label buatan AI. Salah? Benerin. Editanmu tercatat dengan namamu dan
        jamnya — dan AI ga langsung dikunci. Dia tetap bisa update, tapi sekarang dia udah tahu manusia pernah turun
        tangan di sini.
      </Lead>
      <DuaSisi
        perusahaan="Ringkasan yang bisa dipercaya, bukan tebakan mesin yang ga ada yang berani koreksi."
        cs="Kata terakhir."
      />
    </Section>
  );
}

const PENDUKUNG: [string, string][] = [
  ['Lead List, siap dibawa ke mana saja', 'Ekspor XLSX atau CSV kapan aja. Datamu, datamu.'],
  [
    'Struk AI-mu terbuka',
    'Tiap panggilan AI tercatat: token masuk, token keluar, model yang dipakai, dan biayanya. Per perusahaan.',
  ],
  [
    'Tetangga ga bisa ngintip',
    'Isolasi antar perusahaan di level database — udah diuji dengan probe lintas company.',
  ],
  [
    'Nomor WA yang udah kamu punya',
    'Scan QR, selesai. Ga perlu nunggu approval Meta, ga ada biaya per pesan.',
  ],
];

function GridPendukung() {
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Ikut di semua paket</Eyebrow>
      <SectionTitle>Dan ini yang tidak dihitung terpisah</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        {PENDUKUNG.map(([judul, isi]) => (
          <div
            key={judul}
            className="rounded-panel border border-[#c6dcc0] bg-white p-6 dark:border-[#24403a] dark:bg-[#14241f]"
          >
            <h3 className="mt-0 mb-1.5 text-base font-semibold">{judul}</h3>
            <p className="m-0 text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">{isi}</p>
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
  ['Dua CS membalas orang yang sama', 'Agent mulai mengetik, AI mundur detik itu juga'],
  ['“Ini tadi siapa yang janji?”', 'Tiap balasan keluar membawa nama penulisnya'],
  ['Chat menggantung karena agent sudah pulang', 'Setelah 30 menit diam, AI mengambil alih lagi'],
  ['Follow-up yang kelewat', 'Berjadwal, dengan plafon harian dan jarak minimum'],
  ['Nomor kena report karena kebanyakan kirim', 'Tiga pintu harus lolos sebelum satu pesan berangkat'],
  ['Baca ulang chat panjang dari paling atas', 'Ringkasan per percakapan, siap dibantah kalau salah'],
  ['Ringkasan AI salah, tak ada yang berani koreksi', 'Sunting, tercatat namamu, dan AI tetap jalan'],
  ['Mengisi setelan AI seperti menulis dokumen', 'Diisi lewat obrolan — Agnee yang bertanya'],
  ['Jawaban bagusmu mati bersama satu chat', 'Ditawarkan disimpan jadi playbook'],
  ['Data lead terkunci di dalam aplikasi', 'Ekspor XLSX atau CSV kapan saja'],
  ['Tagihan AI yang tidak jelas dari mana', 'Token masuk, token keluar, model, biaya — per perusahaan'],
  ['Takut data perusahaan lain kelihatan', 'Isolasi di level database, sudah diuji probe lintas company'],
  ['Menunggu approval Meta', 'Scan QR nomor yang sudah kamu punya'],
  ['Biaya per pesan', 'Tidak ada'],
  ['Pindah-pindah HP antar shift', 'Satu inbox, seluruh tim'],
];

function GridYangBerubah() {
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Yang berubah di hari kerjamu</Eyebrow>
      <SectionTitle>15 hal kecil yang berhenti mengganggu</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {YANG_BERUBAH.map(([masalah, jawaban], index) => (
          <div
            key={masalah}
            className="rounded-panel border border-[#c6dcc0] bg-white p-5 dark:border-[#24403a] dark:bg-[#14241f]"
          >
            <span className="block font-mono text-[11px] font-semibold text-[#9db99a] dark:text-[#4e6e5e]">
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
            <p className="m-0 mb-2 font-mono text-[11px] font-medium tracking-[.14em] text-[#7fff4f] uppercase">
              Kelas gratis — kuota terbatas
            </p>
            <h2 className="m-0 mb-4 text-[clamp(26px,3.6vw,38px)] leading-[1.15] font-semibold tracking-[-.035em]">
              Jualan Apa Pun dalam 15 Menit Chat
            </h2>
            <p className="m-0 max-w-xl text-[16px] leading-[1.7] text-white/65">
              Kerangka lima tahap yang dipakai CS terbaik untuk membawa orang dari “nanya doang” ke “transfer ke mana
              ya” — tanpa terdengar sedang berjualan. Kerangka yang sama yang kami tanam ke dalam Agnee.
            </p>
            <p className="mt-3 mb-0 text-[14px] leading-[1.65] text-white/50">
              Gratis. Rekaman dibagikan ke yang mendaftar.
            </p>
            <TombolUmpan
              mayar={MAYAR_WEBINAR}
              mayarLabel="Daftar sekarang"
              wa={WA_WEBINAR}
              waLabel="Daftar via WhatsApp"
            />
          </div>
          <ol className="m-0 grid list-none content-start gap-2.5 p-0">
            {[
              ['Buka', 'Kalimat pertama yang membuat orang membalas'],
              ['Gali', 'Tiga pertanyaan yang menggantikan brosur'],
              ['Cocokkan', 'Menawarkan yang dia butuh, bukan yang kamu punya'],
              ['Tangani keberatan', '“Mahal” hampir tidak pernah berarti mahal'],
              ['Tutup', 'Meminta keputusan tanpa terdengar mendesak'],
            ].map(([tahap, isi], index) => (
              <li key={tahap} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#7fff4f] font-mono text-[11px] font-bold text-[#0c1912]">
                  {index + 1}
                </span>
                <span className="text-[13px] leading-[1.5]">
                  <b className="font-semibold">{tahap}</b>
                  <span className="text-white/55"> — {isi}</span>
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
  ['Undang tim CS', 'Tambahkan agent lewat email dan atur perannya. Mereka langsung punya inbox yang sama.'],
  ['Isi Knowledge lewat ngobrol', 'Agnee yang nanya, kamu yang jawab. Delapan dokumen playbook tersusun dari jawaban kamu.'],
];

function HowItWorks() {
  return (
    <Section className="py-16 sm:py-20">
      <Eyebrow>Cara kerja</Eyebrow>
      <SectionTitle>Tiga langkah, lalu sudah</SectionTitle>
      <div className="grid gap-6 sm:grid-cols-3">
        {STEPS.map(([judul, isi], index) => (
          <div key={judul}>
            <span className="grid size-9 place-items-center rounded-full bg-[#dff0d6] font-semibold text-[#205a38] dark:bg-[#1b3028] dark:text-[#7fff4f]">
              {index + 1}
            </span>
            <h3 className="mt-3.5 mb-1.5 text-base font-semibold">{judul}</h3>
            <p className="m-0 text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">{isi}</p>
          </div>
        ))}
      </div>
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
      'Dukungan via WhatsApp',
    ],
    href: WA_PERSONAL,
    cta: 'Ambil harga promo',
    highlight: false,
    note: '',
  },
  {
    badge: 'Paling banyak diambil tim',
    name: 'Company',
    oldPrice: 'Rp 8.900.000',
    price: 'Rp 3.900.000',
    period: '/bulan',
    features: [
      '5 pengguna (agent CS)',
      'Nomor WhatsApp tanpa plafon angka',
      'Delapan dokumen playbook, semuanya',
      'Pesan AI tanpa plafon angka',
      'Follow-up berjadwal + pengaman',
      'Lead List + ekspor XLSX/CSV',
      'Rincian token dan biaya AI',
    ],
    href: WA_COMPANY,
    cta: 'Ambil harga promo',
    highlight: true,
    note: 'Pemakaian wajar: kalau pemakaianmu jauh di atas rata-rata, kami menghubungi dulu — tidak pernah memutus tiba-tiba. Berapa pun pemakaianmu, rinciannya bisa kamu lihat sendiri.',
  },
  {
    badge: 'Sekali bayar',
    name: 'Lifetime',
    oldPrice: 'Rp 39.900.000',
    price: 'Rp 29.900.000',
    period: 'sekali bayar',
    features: [
      'Semua yang ada di Company',
      'Bayar sekali, tidak kedaluwarsa',
      'Tidak ada tagihan bulanan, selamanya',
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
      <Eyebrow>Promo pembukaan — {KUOTA_PROMO} slot total</Eyebrow>
      <SectionTitle>Harga ini berhenti di perusahaan ke-{KUOTA_PROMO}.</SectionTitle>
      <Lead>
        Bukan hitung mundur palsu yang reset sendiri tiap kamu buka. Begitu {KUOTA_PROMO} tercapai, harga ini tutup —
        tanpa pengumuman. Ga ada "perpanjangan mendadak".
      </Lead>
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
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
                  ? 'block rounded-app bg-[#25d366] px-5 py-3 text-center text-[15px] font-semibold text-white no-underline transition hover:bg-[#1dbd5e]'
                  : 'mt-auto block rounded-app bg-[#25d366] px-5 py-3 text-center text-[15px] font-semibold text-white no-underline transition hover:bg-[#1dbd5e]'
              }
            >
              {plan.cta}
            </a>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-panel border border-[#c6dcc0] bg-white p-6 dark:border-[#24403a] dark:bg-[#14241f]">
        <div>
          <h3 className="mt-0 mb-1 text-base font-semibold">Mau Agnee tampil dengan namamu sendiri?</h3>
          <p className="m-0 text-[13px] leading-[1.6] text-[#4e6e5e] dark:text-[#7aaa8a]">
            White label kami bicarakan satu per satu — ruang lingkup dan harganya menyesuaikan.
          </p>
        </div>
        <a
          href={WA_WHITELABEL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-app border border-[#c6dcc0] px-5 py-3 text-[15px] font-semibold no-underline dark:border-[#24403a]"
        >
          Hubungi kami
        </a>
      </div>
    </Section>
  );
}

const FAQ_ITEMS: [string, string][] = [
  [
    'Apakah Agnee memakai WhatsApp Business API resmi?',
    'Tidak — Agnee memakai WhatsApp Web. Artinya kamu langsung mulai dengan nomor yang sudah kamu punya, tanpa approval Meta dan tanpa biaya per pesan. Tradeoff-nya: nomor itu harus tetap terhubung. Scan QR sekali, lalu berjalan di belakang layar.',
  ],
  [
    'Berapa agent yang bisa saya tambahkan?',
    'Personal untuk 1 pengguna. Company untuk 5 agent aktif. Butuh lebih banyak? Bilang ke kami lewat WhatsApp — plafonnya memang diatur per perusahaan.',
  ],
  [
    '“Pesan AI tanpa plafon angka” itu benar-benar tanpa batas?',
    'Tidak ada angka yang memutusmu di tengah jalan, dan itu memang yang dijalankan sistemnya. Tapi kami tidak akan berpura-pura listrik itu gratis: kalau pemakaianmu jauh di atas rata-rata, kami menghubungi dulu untuk bicara. Yang tidak pernah kami lakukan adalah mematikan layananmu tiba-tiba. Rincian token dan biayanya bisa kamu lihat sendiri kapan saja.',
  ],
  [
    'Apakah AI-nya bisa disesuaikan dengan bisnis saya?',
    'Ada delapan dokumen yang menentukan cara dia bicara: persona, batasan, tanya-jawab, penggalian kebutuhan, penanganan keberatan, penutupan, follow-up, dan serah terima ke manusia. Kamu tidak perlu menulisnya — Agnee mewawancaraimu, dan dokumennya tersusun dari jawabanmu.',
  ],
  [
    'Apakah data percakapan pelanggan saya aman?',
    'Tiap perusahaan hanya bisa mengakses datanya sendiri, dan pemisahan itu diterapkan di level database, bukan sekadar disembunyikan di tampilan. Kami sudah mengujinya dengan permintaan lintas perusahaan yang sengaja dibuat untuk menembus — dan ditolak.',
  ],
  [
    'Kalau saya ambil alih chat, apakah AI berhenti total?',
    'Berhenti di chat itu, selama kamu masih di sana. Tiga puluh menit setelah kamu diam, dia melanjutkan — supaya pelanggan tidak menunggu orang yang sudah pulang. Percakapan yang ditugaskan supervisor lewat panel tidak ikut kedaluwarsa.',
  ],
  [
    'Berarti atasan saya bisa melihat semua balasan saya?',
    'Ya. Tiap balasan keluar tercatat penulisnya. Itu memang gunanya — termasuk supaya balasan bagusmu ketahuan siapa yang menulis, bukan diklaim sistem.',
  ],
  [
    'Saya harus belajar aplikasi baru lagi?',
    'Chat-nya tetap chat. Yang berubah: kamu berhenti pindah-pindah HP, dan berhenti menebak siapa yang sudah membalas siapa.',
  ],
  [
    'Ada masa percobaan?',
    'Agnee masih dalam fase beta. Klik “Coba Gratis” untuk membuat akun dan mulai memakainya. Kalau butuh akses yang lebih panjang atau ada kebutuhan khusus, bicarakan dengan kami lewat WhatsApp.',
  ],
  [
    'Berapa lama setup-nya?',
    'Menghubungkan WhatsApp perlu satu kali scan QR. Mengundang tim beberapa menit. Yang paling menentukan hasilnya justru mengisi Knowledge — dan itu bukan pekerjaan sepuluh menit, karena isinya cara bisnismu bicara. Kabar baiknya: kamu mengisinya dengan mengobrol, dan bisa dicicil.',
  ],
];

function Faq() {
  // Satu terbuka pada satu waktu, seperti perilaku halaman vanilla sebelumnya.
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
          Pelangganmu lagi ngetik.
          <br />
          CS-mu ga harus sendirian.
        </h2>
        <p className="mt-3 mb-6 text-white/65">
          Kuota promo {KUOTA_PROMO} perusahaan — ga perlu kartu kredit. Begitu penuh, harga ini ga balik.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href="/?signup=1"
            className="inline-block rounded-app bg-[#7fff4f] px-6 py-3 text-[15px] font-semibold text-[#0c1912] no-underline"
          >
            Ambil Slot Gratisku →
          </a>
          <a
            href="#ebook"
            className="inline-block rounded-app border border-white/25 px-6 py-3 text-[15px] font-semibold text-white no-underline"
          >
            Atau ambil ebook-nya dulu
          </a>
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
      ['/', 'Masuk'],
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
              Menangani pelangganmu, dan menopang orang yang menanganinya.
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

        {/*
          Kebijakan Privasi dan Syarat & Ketentuan sengaja belum dipasang di sini:
          keduanya belum ada halamannya, dan link mati ke "#" pada halaman yang
          mengumpulkan email lebih buruk daripada tidak ada link sama sekali.
          Pasang begitu halamannya jadi — wajib sebelum penampungan email hidup.
        */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#c6dcc0] pt-5 text-[12px] text-[#4e6e5e] dark:border-[#24403a] dark:text-[#7aaa8a]">
          <span>© 2026 Agnive. Hak cipta dilindungi.</span>
          <span>Dibuat di Indonesia 🇮🇩</span>
        </div>
      </div>
    </footer>
  );
}
