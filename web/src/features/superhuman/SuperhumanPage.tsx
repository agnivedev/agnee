/**
 * Superhuman — konsol platform Agnee.
 *
 * Halaman ini bukan untuk pelanggan. Ia melihat SEMUA tenant sekaligus, dan itu
 * satu-satunya tempat di aplikasi ini yang sengaja melewati isolasi tenant.
 *
 * Copy-nya ditulis langsung dalam bahasa Indonesia, tidak lewat messages.ts —
 * sama seperti LandingPage. Alasannya bukan malas: kamus itu melayani dua
 * bahasa untuk pelanggan, dan mengisinya dengan puluhan kunci yang hanya dibaca
 * staf kami sendiri membuat berkas itu lebih sulit dirawat untuk pekerjaan yang
 * sebenarnya.
 *
 * Yang sengaja TIDAK ada di sini: isi percakapan pelanggan, dan tombol "masuk
 * sebagai tenant". Keduanya mengubah halaman ini dari alat mengurus langganan
 * menjadi pintu ke data pelanggan.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AreaChart, BarList, ColumnChart } from './charts';

type CompanyRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  planStatus: string;
  trialEndsAt: string | null;
  createdAt: string;
  aiMessageCount: number;
  aiMessageLimit: number;
  aiCountResetAt: string | null;
  maxUsers: number;
  maxPlaybooks: number;
  maxWhatsapp: number;
  activeUsers: number;
  whatsappNumbers: number;
  lastInboundAt: string | null;
  costUsd30d: number;
};

type CompanyDetail = {
  company: CompanyRow & {
    timezone: string;
    knowledgeClient: string;
    inbound30d: number;
  };
  members: {
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    status: string;
    lastLoginAt: string | null;
    isPlatformAdmin: boolean;
  }[];
  connections: {
    id: string;
    provider: string;
    label: string | null;
    phoneNumber: string | null;
    status: string;
    connectedAt: string | null;
    lastError: string | null;
  }[];
  usage: {
    purpose: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    calls: number;
  }[];
};

type Overview = {
  totals: {
    companies: number; active: number; suspended: number; trial: number;
    members: number; inbound30d: number; costUsd30d: number; costUsdToday: number;
  };
  tenantGrowth: { month: string; added: number; cumulative: number }[];
  dailyCost: { day: string; costUsd: number }[];
  dailyInbound: { day: string; count: number }[];
  topTenants: { id: string; slug: string; name: string; costUsd: number; calls: number }[];
  costByPurpose: { purpose: string; costUsd: number; calls: number }[];
  trialsEnding: { id: string; slug: string; name: string; trialEndsAt: string }[];
  planMix: { plan: string; planStatus: string; count: number }[];
};

const PLANS = ['personal', 'company', 'lifetime'];
const PLAN_STATUSES = ['trial', 'beta', 'active', 'suspended'];
const STATUSES = ['active', 'suspended', 'closed'];

const numberFormat = new Intl.NumberFormat('id-ID');

function formatUsd(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * "3 hari lalu" mengalahkan tanggal penuh di kolom yang dibaca sekilas: yang
 * dicari di daftar tenant bukan tanggalnya, melainkan apakah tenant ini masih
 * hidup.
 */
function formatRelative(value: string | null | undefined) {
  if (!value) return 'belum pernah';
  const diffMs = Date.now() - new Date(value).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days > 60) return formatDate(value);
  if (days >= 1) return `${days} hari lalu`;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 1) return `${hours} jam lalu`;
  const minutes = Math.max(1, Math.floor(diffMs / 60_000));
  return `${minutes} menit lalu`;
}

/** Sisa hari trial, negatif kalau sudah lewat. */
function daysUntil(value: string | null | undefined) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
}

function toDateInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function SuperhumanPage() {
  usePageTitle('Agnee — Superhuman');
  const { status, user, isPlatformAdmin } = useSession();
  const [view, setView] = useState<'dashboard' | 'tenants'>('dashboard');
  const [selected, setSelected] = useState<string | null>(null);

  if (status === 'loading') {
    return <ConsoleFrame><p className="text-sm text-muted">Memuat…</p></ConsoleFrame>;
  }

  // Pintu yang sama untuk yang belum login dan yang bukan staf: konsol ini tidak
  // perlu memberi tahu orang asing bahwa ia ada, apalagi bahwa ia berisi apa.
  if (status === 'anonymous' || !isPlatformAdmin) {
    return (
      <ConsoleFrame>
        <div className="mx-auto max-w-md py-20 text-center">
          <p className="eyebrow">AKSES DITOLAK</p>
          <h1 className="m-0 text-[24px] tracking-[-.03em]">Konsol ini untuk administrator platform Agnee</h1>
          <a href="/" className="mt-4 inline-block text-sm font-semibold text-green-dark no-underline hover:underline">
            Kembali ke ruang kerja →
          </a>
        </div>
      </ConsoleFrame>
    );
  }

  // Detail sebuah tenant mengalahkan tab mana pun yang sedang aktif: ia dibuka
  // dari beranda maupun dari daftar, dan tombol kembalinya mengembalikan ke
  // tempat asalnya.
  return (
    <ConsoleFrame email={user?.email} view={view} onView={setView}>
      {selected ? (
        <CompanyDetailView companyId={selected} onBack={() => setSelected(null)} />
      ) : view === 'dashboard' ? (
        <DashboardView onOpen={setSelected} onSeeAll={() => setView('tenants')} />
      ) : (
        <CompanyListView onOpen={setSelected} />
      )}
    </ConsoleFrame>
  );
}

/**
 * Kerangka konsol: satu bilah gelap, lalu isinya.
 *
 * Sengaja tidak memakai AppSidebar. Sidebar itu menu sebuah ruang kerja — tiap
 * itemnya menuju data SATU perusahaan, yaitu perusahaan sesi yang sedang
 * berjalan. Halaman ini justru berbicara tentang semua perusahaan sekaligus,
 * jadi memasangnya di sini akan membuat dua kebenaran yang berbeda tampak
 * seperti bagian dari layar yang sama.
 */
function ConsoleFrame({
  children,
  email,
  view,
  onView,
}: {
  children: React.ReactNode;
  email?: string;
  view?: 'dashboard' | 'tenants';
  onView?: (next: 'dashboard' | 'tenants') => void;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 bg-ink px-5 py-3 text-white sm:px-10">
        <span className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] font-bold tracking-[.14em] uppercase">Superhuman</span>
            <span className="font-mono text-[10px] tracking-[.1em] text-white/50 uppercase">Agnee platform</span>
          </span>
          {onView && view ? (
            <span className="flex gap-1">
              <ConsoleTab active={view === 'dashboard'} onClick={() => onView('dashboard')}>Beranda</ConsoleTab>
              <ConsoleTab active={view === 'tenants'} onClick={() => onView('tenants')}>Tenant</ConsoleTab>
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-4">
          {email ? <span className="font-mono text-[11px] text-white/60">{email}</span> : null}
          <a href="/" className="text-[12px] font-semibold text-white/80 no-underline hover:text-white hover:underline">
            Ruang kerja →
          </a>
        </span>
      </header>
      <main className="px-5 py-8 sm:px-10">{children}</main>
    </div>
  );
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/**
 * "2026-09" → "Sep '26"
 *
 * Apostrofnya bukan hiasan: tanpa itu "Sep 26" terbaca sebagai tanggal 26
 * September, persis di halaman yang juga memuat sumbu bertanggal.
 */
function monthLabel(value: string) {
  const [year, month] = value.split('-');
  return `${MONTH_NAMES[Number(month) - 1] || month} '${year.slice(2)}`;
}

/** "2026-09-17" → "17 Sep" */
function dayLabel(value: string) {
  const [, month, day] = value.split('-');
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1] || month}`;
}

function DashboardView({
  onOpen,
  onSeeAll,
}: {
  onOpen: (companyId: string) => void;
  onSeeAll: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setOverview(await api<Overview>('/v1/superhuman/overview'));
      setError('');
    } catch (caught) {
      setError(messageFromError(caught, 'Gagal memuat ringkasan.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p role="status" className="text-[13px] text-danger">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">Memuat…</p>;

  const { totals } = overview;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">BERANDA</p>
          <h1 className="m-0 text-[28px] tracking-[-.03em]">Agnee, seluruhnya</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            Pertumbuhan, biaya, dan beban — dari data yang benar-benar sudah kita punya.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Muat ulang
        </Button>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Tenant aktif" value={`${totals.active} dari ${totals.companies}`} />
        <Tile label="Anggota aktif" value={numberFormat.format(totals.members)} />
        <Tile label="Biaya AI 30 hari" value={formatUsd(totals.costUsd30d)} />
        <Tile label="Biaya AI hari ini" value={formatUsd(totals.costUsdToday)} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          eyebrow="PERTUMBUHAN"
          title="Tenant kumulatif"
          description="Jumlah perusahaan terdaftar pada akhir tiap bulan, 12 bulan terakhir."
        >
          <AreaChart
            points={overview.tenantGrowth.map((row) => ({ label: monthLabel(row.month), value: row.cumulative }))}
            formatValue={(value) => `${numberFormat.format(value)} tenant`}
            emptyMessage="Belum ada tenant."
          />
        </Card>

        <Card
          eyebrow="BIAYA"
          title="Biaya AI harian"
          description="30 hari terakhir. Hari tanpa pemakaian tetap digambar sebagai nol, supaya jeda terlihat sebagai jeda."
        >
          <ColumnChart
            points={overview.dailyCost.map((row) => ({ label: dayLabel(row.day), value: row.costUsd }))}
            formatValue={formatUsd}
            emptyMessage="Belum ada pemakaian AI 30 hari terakhir."
          />
        </Card>

        <Card
          eyebrow="BEBAN"
          title="Pesan masuk harian"
          description="30 hari terakhir, seluruh tenant."
        >
          <ColumnChart
            points={overview.dailyInbound.map((row) => ({ label: dayLabel(row.day), value: row.count }))}
            formatValue={(value) => `${numberFormat.format(value)} pesan`}
            emptyMessage="Belum ada pesan masuk tercatat 30 hari terakhir."
          />
        </Card>

        <Card
          eyebrow="BIAYA"
          title="Tenant paling boros"
          description="Total biaya AI 30 hari terakhir, delapan teratas."
        >
          <BarList
            rows={overview.topTenants.map((row) => ({
              label: row.name,
              sub: `${numberFormat.format(row.calls)} panggilan`,
              value: row.costUsd,
            }))}
            formatValue={formatUsd}
            emptyMessage="Belum ada pemakaian AI 30 hari terakhir."
            onSelect={(index) => onOpen(overview.topTenants[index].id)}
          />
          <button
            type="button"
            onClick={onSeeAll}
            className="mt-4 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-green-dark hover:underline"
          >
            Lihat semua tenant →
          </button>
        </Card>

        <Card
          eyebrow="BIAYA"
          title="Untuk apa biayanya keluar"
          description="Balasan otomatis melayani customer; ringkasan, coach, dan playground adalah biaya internal kita."
        >
          <BarList
            rows={overview.costByPurpose.map((row) => ({
              label: row.purpose,
              sub: `${numberFormat.format(row.calls)} panggilan`,
              value: row.costUsd,
            }))}
            formatValue={formatUsd}
            emptyMessage="Belum ada pemakaian AI 30 hari terakhir."
          />
        </Card>

        <Card eyebrow="LANGGANAN" title="Sebaran paket">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <Th>Paket</Th><Th>Status</Th><Th>Tenant</Th>
                </tr>
              </thead>
              <tbody>
                {overview.planMix.map((row) => (
                  <tr key={`${row.plan}-${row.planStatus}`} className="border-b border-border/60 last:border-b-0">
                    <Td>{row.plan}</Td>
                    <Td><Pill tone={row.planStatus === 'suspended' ? 'bad' : row.planStatus === 'active' ? 'ok' : 'warn'}>{row.planStatus}</Pill></Td>
                    <Td><span className="font-mono tabular-nums">{row.count}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totals.suspended ? (
            <p className="mt-3 mb-0 text-[12px] text-danger">{totals.suspended} tenant berstatus suspended.</p>
          ) : null}
        </Card>
      </div>

      <Card
        eyebrow="PERLU TINDAKAN"
        title="Trial yang segera berakhir"
        description="Dua minggu ke depan, termasuk yang sudah lewat."
      >
        {overview.trialsEnding.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">Tidak ada trial yang berakhir dalam dua minggu ke depan.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {overview.trialsEnding.map((row) => {
              const left = daysUntil(row.trialEndsAt) ?? 0;
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white/60 px-3 py-2"
                >
                  <span>
                    <button
                      type="button"
                      onClick={() => onOpen(row.id)}
                      className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-green-dark hover:underline"
                    >
                      {row.name}
                    </button>
                    <span className="ml-2 font-mono text-[11px] text-muted">{row.slug}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[12px]">
                    <span className="text-muted">{formatDate(row.trialEndsAt)}</span>
                    <Pill tone={left < 0 ? 'bad' : left <= 3 ? 'warn' : 'neutral'}>
                      {left < 0 ? `lewat ${Math.abs(left)} hari` : `sisa ${left} hari`}
                    </Pill>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

function ConsoleTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'cursor-pointer rounded-full border-0 px-3 py-1 text-[12px] font-semibold transition-colors',
        active ? 'bg-white/15 text-white' : 'bg-transparent text-white/55 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

function CompanyListView({ onOpen }: { onOpen: (companyId: string) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [planStatus, setPlanStatus] = useState('');
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    if (planStatus) params.set('planStatus', planStatus);
    try {
      const query = params.toString();
      const data = await api<{ companies: CompanyRow[]; total: number }>(
        `/v1/superhuman/companies${query ? `?${query}` : ''}`,
      );
      setRows(data.companies);
      setTotal(data.total);
      setError('');
    } catch (caught) {
      setRows([]);
      setError(messageFromError(caught, 'Gagal memuat daftar tenant.'));
    }
  }, [search, status, planStatus]);

  // Pencarian menunggu ketikan berhenti; tanpa jeda ini setiap huruf menjadi
  // satu query lintas seluruh tabel companies.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const totals = useMemo(() => {
    const list = rows || [];
    return {
      aktif: list.filter((row) => row.status === 'active').length,
      trial: list.filter((row) => row.planStatus === 'trial').length,
      biaya: list.reduce((sum, row) => sum + Number(row.costUsd30d || 0), 0),
    };
  }, [rows]);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">KONSOL PLATFORM</p>
          <h1 className="m-0 text-[28px] tracking-[-.03em]">Semua tenant Agnee</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            Langganan, plafon, dan tanda-tanda hidup setiap perusahaan yang memakai Agnee.
            Membuka detail sebuah tenant tercatat di jejak audit tenant itu.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Muat ulang
        </Button>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Tile label="Tenant tampil" value={`${rows?.length ?? 0} dari ${total}`} />
        <Tile label="Berstatus aktif" value={String(totals.aktif)} />
        <Tile label="Biaya AI 30 hari" value={formatUsd(totals.biaya)} />
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-[13px] font-semibold">
          <span>Cari nama atau slug</span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="tradersmastermind"
            className="w-64 py-2.5"
          />
        </label>
        <FilterSelect label="Status akun" value={status} onChange={setStatus} options={STATUSES} />
        <FilterSelect label="Status paket" value={planStatus} onChange={setPlanStatus} options={PLAN_STATUSES} />
        {totals.trial ? (
          <p className="m-0 pb-2.5 text-[12px] text-muted">{totals.trial} tenant sedang trial</p>
        ) : null}
      </div>

      {error ? <p role="status" className="mt-4 text-[13px] text-danger">{error}</p> : null}

      <div className="mt-4 overflow-x-auto rounded-panel border border-border bg-card">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Tenant</Th>
              <Th>Paket</Th>
              <Th>Pesan AI bulan ini</Th>
              <Th>Tim</Th>
              <Th>Nomor WA</Th>
              <Th>Biaya 30 hari</Th>
              <Th>Pesan masuk terakhir</Th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><Td colSpan={7}><span className="text-muted">Memuat…</span></Td></tr>
            ) : rows.length === 0 ? (
              <tr><Td colSpan={7}><span className="text-muted">Tidak ada tenant yang cocok.</span></Td></tr>
            ) : (
              rows.map((row) => <CompanyRowView key={row.id} row={row} onOpen={onOpen} />)
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CompanyRowView({ row, onOpen }: { row: CompanyRow; onOpen: (companyId: string) => void }) {
  const trialLeft = row.planStatus === 'trial' ? daysUntil(row.trialEndsAt) : null;
  return (
    <tr className="border-b border-border/60 last:border-b-0 hover:bg-warm/40">
      <Td>
        <button
          type="button"
          onClick={() => onOpen(row.id)}
          className="cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-green-dark hover:underline"
        >
          {row.name}
        </button>
        <span className="block font-mono text-[11px] text-muted">{row.slug}</span>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="neutral">{row.plan}</Pill>
          <Pill tone={row.planStatus === 'suspended' ? 'bad' : row.planStatus === 'active' ? 'ok' : 'warn'}>
            {row.planStatus}
          </Pill>
          {row.status !== 'active' ? <Pill tone="bad">{row.status}</Pill> : null}
        </div>
        {trialLeft !== null ? (
          <span className={cn('mt-1 block text-[11px]', trialLeft <= 3 ? 'text-danger' : 'text-muted')}>
            {trialLeft >= 0 ? `sisa ${trialLeft} hari` : `lewat ${Math.abs(trialLeft)} hari`}
          </span>
        ) : null}
      </Td>
      <Td><QuotaBar used={row.aiMessageCount} limit={row.aiMessageLimit} /></Td>
      <Td><Ratio used={row.activeUsers} limit={row.maxUsers} /></Td>
      <Td><Ratio used={row.whatsappNumbers} limit={row.maxWhatsapp} /></Td>
      <Td><span className="font-mono text-[12px]">{formatUsd(row.costUsd30d)}</span></Td>
      <Td>
        <span className={cn('text-[12px]', row.lastInboundAt ? 'text-ink' : 'text-muted')}>
          {formatRelative(row.lastInboundAt)}
        </span>
      </Td>
    </tr>
  );
}

function CompanyDetailView({ companyId, onBack }: { companyId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setDetail(await api<CompanyDetail>(`/v1/superhuman/companies/${companyId}`));
      setError('');
    } catch (caught) {
      setError(messageFromError(caught, 'Gagal memuat tenant.'));
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <>
        <BackLink onBack={onBack} />
        <p role="status" className="mt-4 text-[13px] text-danger">{error}</p>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <BackLink onBack={onBack} />
        <p className="mt-4 text-sm text-muted">Memuat…</p>
      </>
    );
  }

  const { company } = detail;
  return (
    <>
      <BackLink onBack={onBack} />
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">TENANT</p>
          <h1 className="m-0 text-[28px] tracking-[-.03em]">{company.name}</h1>
          <p className="mt-1.5 font-mono text-[12px] text-muted">
            {company.slug} · {company.id} · dibuat {formatDate(company.createdAt)} · {company.timezone}
          </p>
        </div>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Tile label="Pesan masuk 30 hari" value={numberFormat.format(company.inbound30d)} />
        <Tile label="Pesan masuk terakhir" value={formatRelative(company.lastInboundAt)} />
        <Tile label="Anggota aktif" value={`${company.activeUsers} / ${company.maxUsers}`} />
        <Tile label="Biaya AI 30 hari" value={formatUsd(company.costUsd30d)} />
      </div>

      <SubscriptionForm detail={detail} onSaved={setDetail} />
      <MembersCard members={detail.members} />
      <ConnectionsCard connections={detail.connections} />
      <UsageCard usage={detail.usage} />
    </>
  );
}

function SubscriptionForm({
  detail,
  onSaved,
}: {
  detail: CompanyDetail;
  onSaved: (next: CompanyDetail) => void;
}) {
  const { company } = detail;
  const [form, setForm] = useState({
    plan: company.plan,
    planStatus: company.planStatus,
    status: company.status,
    trialEndsAt: toDateInput(company.trialEndsAt),
    aiMessageLimit: String(company.aiMessageLimit),
    aiMessageCount: String(company.aiMessageCount),
    maxUsers: String(company.maxUsers),
    maxPlaybooks: String(company.maxPlaybooks),
    maxWhatsapp: String(company.maxWhatsapp),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setFailed(false);
    try {
      const next = await api<CompanyDetail>(`/v1/superhuman/companies/${company.id}`, {
        method: 'PATCH',
        body: {
          plan: form.plan,
          planStatus: form.planStatus,
          status: form.status,
          // Tanggal dari <input type="date"> berarti "trial masih berlaku
          // sepanjang hari itu". Mengirimnya apa adanya akan memutus trial pada
          // tengah malam awal hari — sehari lebih cepat dari yang dijanjikan.
          trialEndsAt: form.trialEndsAt ? `${form.trialEndsAt}T23:59:59` : null,
          aiMessageLimit: Number(form.aiMessageLimit),
          aiMessageCount: Number(form.aiMessageCount),
          maxUsers: Number(form.maxUsers),
          maxPlaybooks: Number(form.maxPlaybooks),
          maxWhatsapp: Number(form.maxWhatsapp),
        },
      });
      onSaved(next);
      setForm((current) => ({ ...current, trialEndsAt: toDateInput(next.company.trialEndsAt) }));
      setMessage('Tersimpan ✓');
    } catch (caught) {
      setFailed(true);
      setMessage(messageFromError(caught, 'Gagal menyimpan.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      eyebrow="LANGGANAN & PLAFON"
      title="Apa yang dibeli tenant ini"
      description="Hanya kolom komersial yang bisa diubah dari sini. Nama, isi playbook, dan percakapannya tetap milik tenant. Setiap perubahan tercatat di jejak auditnya."
    >
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid items-start gap-4 md:grid-cols-3">
          <SelectField label="Paket" value={form.plan} onChange={set('plan')} options={PLANS} />
          <SelectField label="Status paket" value={form.planStatus} onChange={set('planStatus')} options={PLAN_STATUSES} />
          <SelectField
            label="Status akun"
            hint="suspended memutus akses tenant; closed untuk yang sudah berhenti."
            value={form.status}
            onChange={set('status')}
            options={STATUSES}
          />
        </div>
        <div className="grid items-start gap-4 md:grid-cols-3">
          <NumberField
            label="Trial berakhir"
            type="date"
            hint="Kosongkan untuk menghapus batas trial."
            value={form.trialEndsAt}
            onChange={set('trialEndsAt')}
          />
          <NumberField
            label="Plafon pesan AI / bulan"
            value={form.aiMessageLimit}
            onChange={set('aiMessageLimit')}
          />
          <NumberField
            label="Pemakaian bulan ini"
            hint={`Reset otomatis ${formatDate(company.aiCountResetAt)}. Isi 0 untuk mereset sekarang.`}
            value={form.aiMessageCount}
            onChange={set('aiMessageCount')}
          />
        </div>
        <div className="grid items-start gap-4 md:grid-cols-3">
          <NumberField label="Maks. anggota tim" value={form.maxUsers} onChange={set('maxUsers')} />
          <NumberField label="Maks. playbook" value={form.maxPlaybooks} onChange={set('maxPlaybooks')} />
          <NumberField label="Maks. nomor WhatsApp" value={form.maxWhatsapp} onChange={set('maxWhatsapp')} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Menyimpan…' : 'Simpan perubahan'}
          </Button>
          {message ? (
            <span role="status" className={cn('font-mono text-[11px] font-semibold', failed ? 'text-danger' : 'text-green-dark')}>
              {message}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function MembersCard({ members }: { members: CompanyDetail['members'] }) {
  return (
    <Card eyebrow="AKUN" title={`Anggota (${members.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Nama</Th><Th>Email</Th><Th>Peran</Th><Th>Status</Th><Th>Login terakhir</Th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr><Td colSpan={5}><span className="text-muted">Belum ada anggota.</span></Td></tr>
            ) : (
              members.map((member) => (
                <tr key={member.id} className="border-b border-border/60 last:border-b-0">
                  <Td>
                    {member.displayName || '—'}
                    {member.isPlatformAdmin ? <Pill tone="neutral">staf Agnive</Pill> : null}
                  </Td>
                  <Td><span className="font-mono text-[12px]">{member.email}</span></Td>
                  <Td>{member.role}</Td>
                  <Td>
                    <Pill tone={member.status === 'active' ? 'ok' : 'warn'}>{member.status}</Pill>
                  </Td>
                  <Td><span className="text-[12px] text-muted">{formatRelative(member.lastLoginAt)}</span></Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ConnectionsCard({ connections }: { connections: CompanyDetail['connections'] }) {
  return (
    <Card eyebrow="WHATSAPP" title={`Koneksi (${connections.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Label</Th><Th>Nomor</Th><Th>Jalur</Th><Th>Status</Th><Th>Tersambung</Th>
            </tr>
          </thead>
          <tbody>
            {connections.length === 0 ? (
              <tr><Td colSpan={5}><span className="text-muted">Belum ada nomor yang terhubung.</span></Td></tr>
            ) : (
              connections.map((connection) => (
                <tr key={`${connection.provider}-${connection.id}`} className="border-b border-border/60 last:border-b-0">
                  <Td>{connection.label || '—'}</Td>
                  <Td><span className="font-mono text-[12px]">{connection.phoneNumber || '—'}</span></Td>
                  <Td>{connection.provider === 'cloud_api' ? 'Cloud API' : 'QR / WhatsApp Web'}</Td>
                  <Td>
                    <Pill tone={['ready', 'connected', 'authenticated'].includes(connection.status) ? 'ok' : connection.status === 'error' ? 'bad' : 'warn'}>
                      {connection.status}
                    </Pill>
                    {connection.lastError ? (
                      <span className="mt-1 block text-[11px] text-danger">{connection.lastError}</span>
                    ) : null}
                  </Td>
                  <Td><span className="text-[12px] text-muted">{formatRelative(connection.connectedAt)}</span></Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UsageCard({ usage }: { usage: CompanyDetail['usage'] }) {
  const total = usage.reduce((sum, row) => sum + Number(row.costUsd || 0), 0);
  return (
    <Card
      eyebrow="BIAYA AI"
      title="30 hari terakhir"
      description="Biaya yang dilaporkan penyedia, bukan hasil hitungan kita — harga per model berubah dan token masuk tidak sama dengan token keluar."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left">
              <Th>Keperluan</Th><Th>Model</Th><Th>Panggilan</Th><Th>Token</Th><Th>Biaya</Th>
            </tr>
          </thead>
          <tbody>
            {usage.length === 0 ? (
              <tr><Td colSpan={5}><span className="text-muted">Belum ada pemakaian AI 30 hari terakhir.</span></Td></tr>
            ) : (
              usage.map((row) => (
                <tr key={`${row.purpose}-${row.model}`} className="border-b border-border/60 last:border-b-0">
                  <Td>{row.purpose}</Td>
                  <Td><span className="font-mono text-[11px]">{row.model}</span></Td>
                  <Td>{numberFormat.format(row.calls)}</Td>
                  <Td>
                    <span className="font-mono text-[11px] text-muted">
                      {numberFormat.format(row.inputTokens)} → {numberFormat.format(row.outputTokens)}
                    </span>
                  </Td>
                  <Td><span className="font-mono text-[12px]">{formatUsd(row.costUsd)}</span></Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {usage.length ? (
        <p className="mt-3 mb-0 text-[13px] font-semibold">Total: {formatUsd(total)}</p>
      ) : null}
    </Card>
  );
}

// ── Bagian tampilan kecil ───────────────────────────────────────────────────

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-green-dark hover:underline"
    >
      ← Semua tenant
    </button>
  );
}

function Card({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-panel border border-border bg-card p-6 shadow-[0_10px_30px_rgba(24,48,39,.05)]">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="m-0 text-xl tracking-[-.02em]">{title}</h2>
      {description ? <p className="mt-2 mb-4 text-[13px] leading-[1.6] text-muted">{description}</p> : <div className="h-4" />}
      {children}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel border border-border bg-card px-4 py-3">
      <p className="m-0 font-mono text-[10px] font-semibold tracking-[.06em] text-muted uppercase">{label}</p>
      <p className="m-0 mt-1 text-[15px] font-semibold">{value}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-mono text-[10px] font-semibold tracking-[.06em] text-muted uppercase">{children}</th>;
}

function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-3 py-2.5 align-top">{children}</td>;
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  return (
    <span
      className={cn(
        'ml-1 inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[.04em] uppercase first:ml-0',
        tone === 'ok' && 'bg-green/14 text-green-dark',
        tone === 'warn' && 'bg-lime/40 text-ink',
        tone === 'bad' && 'bg-danger/12 text-danger',
        tone === 'neutral' && 'bg-ink/8 text-muted',
      )}
    >
      {children}
    </span>
  );
}

function Ratio({ used, limit }: { used: number; limit: number }) {
  const over = limit > 0 && used > limit;
  return (
    <span className={cn('font-mono text-[12px]', over && 'font-semibold text-danger')}>
      {used} / {limit || '∞'}
    </span>
  );
}

/**
 * Batang kuota. Lebarnya disetel lewat prop `style` React, yang memakai CSSOM —
 * bukan atribut style di HTML, sehingga tidak tersandung `style-src 'self'` di
 * CSP aplikasi ini.
 */
function QuotaBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? used / limit : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const tone = ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-lime' : 'bg-green';
  return (
    <span className="block w-40">
      <span className="flex items-baseline justify-between font-mono text-[11px]">
        <span className={cn(ratio >= 1 && 'font-semibold text-danger')}>{numberFormat.format(used)}</span>
        <span className="text-muted">{limit > 0 ? numberFormat.format(limit) : '∞'}</span>
      </span>
      <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-semibold">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-app border border-input bg-white/60 px-3 py-2.5 text-sm outline-none focus:border-green"
      >
        <option value="">Semua</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
}) {
  return (
    <label className="grid content-start gap-1.5 text-[13px] font-semibold">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-app border border-input bg-white/60 px-3 py-2.5 text-sm outline-none focus:border-green"
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      {hint ? <small className="font-normal text-[11px] text-muted">{hint}</small> : null}
    </label>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  type = 'number',
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
}) {
  return (
    <label className="grid content-start gap-1.5 text-[13px] font-semibold">
      <span>{label}</span>
      <Input
        type={type}
        min={type === 'number' ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="py-2.5"
      />
      {hint ? <small className="font-normal text-[11px] text-muted">{hint}</small> : null}
    </label>
  );
}
