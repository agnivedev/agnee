import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Building2, Check } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

type CompanyOption = { id: string; name: string; role: string };

/** Ganti company = ganti seluruh ruang kerja, jadi halaman dimuat ulang agar tak ada data company lama yang tersisa. */
function reloadIntoWorkspace() {
  window.location.assign('/');
}

/**
 * Satu email bisa menjadi anggota beberapa company. Daftar ini hanya tampil kalau
 * memang ada lebih dari satu; server memeriksa ulang keanggotaan di setiap pindah.
 */
export function CompanySwitcher({ variant = 'popover', compact = false }: { variant?: 'popover' | 'list'; compact?: boolean }) {
  const { t } = useI18n();
  const { user } = useSession();
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api<{ companies: CompanyOption[] }>('/v1/auth/companies')
      .then((data) => { if (alive) setCompanies(data.companies || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (companies.length < 2) return null;
  const current = companies.find((company) => company.id === user?.companyId);

  async function switchTo(companyId: string) {
    if (companyId === user?.companyId) { setOpen(null); return; }
    setBusy(true);
    setError('');
    try {
      await api('/v1/auth/switch-company', { method: 'POST', body: { companyId } });
      reloadIntoWorkspace();
    } catch (failure) {
      setError(messageFromError(failure, ''));
      setBusy(false);
    }
  }

  const options = (
    <ul className="m-0 grid list-none gap-1 p-0">
      {companies.map((company) => (
        <li key={company.id}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void switchTo(company.id)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-ink/6 disabled:opacity-60"
          >
            <span className="min-w-0 flex-1 truncate font-semibold">{company.name}</span>
            {company.id === user?.companyId ? <Check aria-label={t('company.current')} className="size-4 shrink-0 text-green-dark" /> : null}
          </button>
        </li>
      ))}
      {error ? <li role="alert" className="px-2.5 text-[11px] text-red-700">{error}</li> : null}
    </ul>
  );

  if (variant === 'list') {
    return (
      <div className="mt-3 rounded-xl border border-border bg-white/60 p-2">
        <p className="m-0 mb-1 px-2.5 pt-1 font-mono text-[10px] tracking-[.1em] text-muted uppercase">{t('company.mine')}</p>
        {options}
      </div>
    );
  }

  function toggle(event: ReactMouseEvent<HTMLButtonElement>) {
    if (open) { setOpen(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    // Sidebar di-scroll (overflow), jadi daftar `fixed` dari rect tombol, bukan `absolute`.
    setOpen({ top: rect.top, left: rect.right + 8 });
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={Boolean(open)}
        aria-label={t('company.switch')}
        title={t('company.switch')}
        className={cn(
          'flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white',
          compact && 'justify-center px-0',
        )}
      >
        <Building2 aria-hidden className="size-[18px] shrink-0" strokeWidth={2} />
        {compact ? null : <span className="min-w-0 flex-1 truncate font-semibold">{current?.name || t('company.switch')}</span>}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(null)} aria-hidden />
          <div
            role="listbox"
            style={{ top: open.top, left: open.left }}
            className="fixed z-50 w-64 rounded-xl border border-border bg-white p-1.5 shadow-lg"
          >
            {options}
          </div>
        </>
      ) : null}
    </>
  );
}
