import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm';
import { LeadDetailDialog } from './LeadDetailDialog';
import { cn } from '@/lib/utils';

type Column = { key: string; label: string };
// Sel tabel selalu string (server sudah memformatnya lewat exportCell), tapi
// rute JSON menyertakan dua bidang non-kolom: chatId untuk menindaklanjuti
// baris, dan isGroup untuk menandai baris yang tidak punya nomor.
type Row = Record<string, string> & { chatId?: string; isGroup?: boolean; mayarTotalAmount?: number | null };
type SortDirection = 'asc' | 'desc';

/** Keadaan satu proses impor chat, persis seperti yang dilaporkan server. */
type ImportRun = {
  phase: 'starting' | 'listing' | 'reading' | 'products' | 'done' | 'error';
  eligible: number; toDo: number; done: number; replied: number; unproven: number;
  remaining: number; productsAssigned: number; productsTried: number; failed: number;
  stoppedBecause: 'cancelled' | 'disconnected' | 'client_unstable' | null;
  error: string | null;
};
const IMPORT_AKTIF = new Set(['starting', 'listing', 'reading', 'products']);

/** Numbers sort as numbers; everything else as Indonesian text. */
function compareValues(a: string, b: string) {
  const numA = Number(a);
  const numB = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
  // Empty rows always sink, whichever way the column is sorted: a row with no
  // value is not "the smallest", it is simply not filled in yet.
  if (a === '' && b !== '') return 1;
  if (b === '' && a !== '') return -1;
  return String(a).localeCompare(String(b), 'id-ID');
}

export function LeadsPage() {
  const { t } = useI18n();
  const { isSupervisor } = useSession();
  const navigate = useNavigate();
  usePageTitle('leads.title');

  const [columns, setColumns] = useState<Column[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState(t('common.loading'));
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('');
  const [handling, setHandling] = useState('');
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const { confirm, error: showError } = useConfirm();
  const [relation, setRelation] = useState('');
  const [activity, setActivity] = useState('');
  const [waLabel, setWaLabel] = useState('');
  const [importRun, setImportRun] = useState<ImportRun | null>(null);
  const [importBusyElsewhere, setImportBusyElsewhere] = useState(false);
  const [choiceRow, setChoiceRow] = useState<Row | null>(null);
  const [editRow, setEditRow] = useState<Row | null>(null);

  /**
   * Membuka percakapan di aplikasi WhatsApp perangkat ini.
   *
   * Diberi peringatan lebih dulu karena akibatnya tidak terlihat dari tombolnya:
   * chat terkirim dari akun WhatsApp yang terpasang di perangkat agent, bukan
   * dari nomor perusahaan. Customer melihat nomor pribadi agent, dan balasannya
   * tidak pernah masuk kembali ke Agnee.
   */
  async function openInWhatsapp(row: Row) {
    if (!row.phone) return;
    const ok = await confirm({
      title: t('leads.waMeWarnTitle'),
      message: t('leads.waMeWarnBody'),
      confirmLabel: t('leads.waMeWarnConfirm'),
      danger: true,
    });
    if (!ok) return;
    setChoiceRow(null);
    // Dicatat lebih dulu, baru tabnya dibuka: peringatan saja tidak
    // meninggalkan jejak, dan supervisor tidak punya cara lain tahu bahwa
    // percakapan ini pindah ke WhatsApp pribadi agent. Kalau pencatatannya
    // gagal, tabnya tetap dibuka — menghalangi pekerjaan karena audit gagal
    // adalah harga yang lebih mahal daripada satu baris yang hilang.
    await api('/v1/audit/wa-me', {
      method: 'POST',
      body: { chatId: row.chatId || row.phone, phone: row.phone, contactName: row.name || '' },
    }).catch(() => {});
    window.open(`https://wa.me/${row.phone.replace(/[^\d]/g, '')}`, '_blank', 'noopener,noreferrer');
  }

  function openInInbox(row: Row) {
    if (!row.chatId) return;
    setChoiceRow(null);
    // Judul memakai nama kalau ada: itu yang dikenali agent, bukan nomornya.
    const title = row.name || row.phone || row.chatId;
    navigate(`/?chat=${encodeURIComponent(row.chatId)}&title=${encodeURIComponent(title)}`);
  }

  const load = useCallback(async () => {
    setStatus(t('common.loading'));
    try {
      const data = await api<{ columns: Column[]; rows: Row[] }>('/v1/export/contacts');
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setStatus(data.rows?.length ? '' : t('leads.empty'));
    } catch (caught) {
      // Tabel ini terbuka untuk agent (barisnya disaring per peran di server),
      // jadi tidak ada cabang 403 di sini — dulu ada, dan tidak pernah jalan.
      setStatus(messageFromError(caught, t('leads.empty')));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const importing = importRun !== null && IMPORT_AKTIF.has(importRun.phase);

  const loadImport = useCallback(async () => {
    if (!isSupervisor) return null;
    try {
      const data = await api<{ run: ImportRun | null; busyElsewhere: boolean }>('/v1/contacts/import');
      setImportRun(data.run);
      setImportBusyElsewhere(data.busyElsewhere);
      return data.run;
    } catch {
      return null;
    }
  }, [isSupervisor]);

  useEffect(() => {
    void loadImport();
  }, [loadImport]);

  // Dipantau selama berjalan, dan daftarnya dimuat ulang begitu selesai supaya
  // baris hasil impor langsung tampil tanpa menekan Refresh.
  useEffect(() => {
    if (!importing) return undefined;
    const timer = window.setInterval(() => {
      void loadImport().then((run) => {
        if (run && !IMPORT_AKTIF.has(run.phase)) void load();
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [importing, loadImport, load]);

  async function startImport() {
    const ok = await confirm({
      title: t('leads.importConfirmTitle'),
      message: t('leads.importConfirmCopy'),
      confirmLabel: t('leads.importConfirmGo'),
    });
    if (!ok) return;
    try {
      const data = await api<{ run: ImportRun }>('/v1/contacts/import', { method: 'POST', body: {} });
      setImportRun(data.run);
    } catch (caught) {
      await showError(caught);
    }
  }

  async function cancelImport() {
    try {
      await api('/v1/contacts/import', { method: 'DELETE' });
    } catch (caught) {
      await showError(caught);
    }
  }

  const stages = useMemo(
    () => [...new Set(rows.map((row) => row.leadStage).filter(Boolean))].sort(),
    [rows],
  );

  // Pilihan saringan diambil dari yang benar-benar ada di daftar, jadi saringan
  // yang tidak punya isi (mis. label di akun WhatsApp biasa) tidak tampil.
  const relations = useMemo(() => [...new Set(rows.map((row) => row.relation).filter(Boolean))].sort(), [rows]);
  const activities = useMemo(() => [...new Set(rows.map((row) => row.activity).filter(Boolean))], [rows]);
  const waLabels = useMemo(
    () => [...new Set(rows.flatMap((row) => String(row.waLabels || '').split(', ')).filter(Boolean))].sort(),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id-ID');
    let filtered = rows.filter((row) => {
      if (stage && row.leadStage !== stage) return false;
      if (handling && row.handlingMode !== handling) return false;
      if (relation && row.relation !== relation) return false;
      if (activity && row.activity !== activity) return false;
      if (waLabel && !String(row.waLabels || '').split(', ').includes(waLabel)) return false;
      if (!needle) return true;
      return Object.values(row).some((value) =>
        String(value).toLocaleLowerCase('id-ID').includes(needle),
      );
    });
    if (sort) {
      const direction = sort.direction === 'asc' ? 1 : -1;
      filtered = [...filtered].sort(
        (a, b) => compareValues(a[sort.key] ?? '', b[sort.key] ?? '') * direction,
      );
    }
    return filtered;
  }, [rows, query, stage, handling, relation, activity, waLabel, sort]);

  function toggleSort(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />

      <main className="min-w-0 flex-1 px-6 py-8 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{t('leads.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('leads.heading')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{t('leads.subtitle')}</p>
          </div>
          <a href="/" className="text-sm font-semibold text-green-dark no-underline hover:underline">
            ← {t('conversation.back')}
          </a>
        </header>

        <section className="mt-8 rounded-panel border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('leads.searchPlaceholder')}
              aria-label={t('leads.searchPlaceholder')}
              className="min-h-[38px] flex-[1_1_240px] rounded-[10px] bg-white px-3 py-1.5"
            />
            <Select value={stage} onChange={setStage} aria-label={t('leads.filterStage')}>
              <option value="">{t('leads.allStages')}</option>
              {stages.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <Select value={handling} onChange={setHandling} aria-label={t('leads.filterHandling')}>
              <option value="">{t('leads.allHandling')}</option>
              <option value="AI">{t('leads.onlyAi')}</option>
              <option value="Manusia">{t('leads.onlyHuman')}</option>
            </Select>
            {relations.length ? (
              <Select value={relation} onChange={setRelation} aria-label={t('leads.filterRelation')}>
                <option value="">{t('leads.allRelations')}</option>
                {relations.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            ) : null}
            {activities.length ? (
              <Select value={activity} onChange={setActivity} aria-label={t('leads.filterActivity')}>
                <option value="">{t('leads.allActivities')}</option>
                {activities.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            ) : null}
            {waLabels.length ? (
              <Select value={waLabel} onChange={setWaLabel} aria-label={t('leads.filterLabel')}>
                <option value="">{t('leads.allLabels')}</option>
                {waLabels.map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            ) : null}
            <span className="font-mono text-xs font-semibold whitespace-nowrap text-muted">
              {visibleRows.length === rows.length
                ? t('leads.count', { count: rows.length })
                : t('leads.countFiltered', { shown: visibleRows.length, total: rows.length })}
            </span>
            <span className="flex-1" />
            {/* Downloads ride the same session cookie as every other request here.
                Hanya supervisor: satu berkas berisi seluruh daftar customer
                adalah hal yang berbeda dari melihat percakapan sendiri, dan
                server menolak agent di kedua rute itu. */}
            {isSupervisor ? (
              <>
                <Button size="sm" variant="outline" onClick={() => void startImport()} disabled={importing || importBusyElsewhere}>
                  {t('leads.importButton')}
                </Button>
                <Button size="sm" onClick={() => { window.location.href = '/v1/export/contacts.xlsx'; }}>
                  {t('leads.downloadXlsx')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { window.location.href = '/v1/export/contacts.csv'; }}>
                  {t('leads.downloadCsv')}
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {t('common.refresh')}
            </Button>
          </div>

          {status ? <p className="mt-2 mb-0 text-[13px] text-muted">{status}</p> : null}

          {isSupervisor && (importRun || importBusyElsewhere) ? (
            <div role="status" aria-live="polite" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-border bg-white px-3 py-2 text-[13px]">
              {importing ? (
                <>
                  <span>
                    {importRun?.phase === 'products'
                      ? t('leads.importProducts', { tried: importRun.productsTried })
                      : t('leads.importRunning', { done: importRun?.done ?? 0, total: importRun?.toDo ?? 0 })}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void cancelImport()}>{t('leads.importCancel')}</Button>
                </>
              ) : importRun?.phase === 'error' ? (
                <span>{importRun.error}</span>
              ) : importRun ? (
                <span>
                  {t('leads.importDone', { done: importRun.done, replied: importRun.replied, unproven: importRun.unproven })}
                  {importRun.productsAssigned ? ` ${t('leads.importDoneProducts', { count: importRun.productsAssigned })}` : ''}
                  {importRun.stoppedBecause ? ` ${t(`leads.importStopped.${importRun.stoppedBecause}`)}` : ''}
                  {importRun.remaining ? ` ${t('leads.importRemaining', { count: importRun.remaining })}` : ''}
                </span>
              ) : null}
              {importBusyElsewhere && !importing ? <span className="text-muted">{t('leads.importBusyElsewhere')}</span> : null}
            </div>
          ) : null}

          {/* 23 columns will not fit on any screen, so the table scrolls itself.
              The page outside it must never shift sideways. */}
          <div className="mt-3 max-h-[68vh] overflow-auto rounded-xl border border-border">
            <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSort(column.key)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleSort(column.key);
                        }
                      }}
                      className={cn(
                        'sticky top-0 z-[1] cursor-pointer border-b border-border bg-[#eef2ec] px-3 py-2 text-left font-mono text-[11px] font-semibold tracking-[.04em] text-[#285248] uppercase select-none hover:bg-[#e2e9df]',
                        'first:sticky first:left-0 first:z-[2]',
                      )}
                    >
                      {column.label}
                      {sort?.key === column.key ? (
                        <span className="text-[9px]"> {sort.direction === 'asc' ? '▲' : '▼'}</span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => {
                  // Baris Mayar-murni tidak punya chatId (belum ada percakapan
                  // WhatsApp), tapi tetap punya phone — jadi tetap bisa diklik
                  // untuk "Buka di WhatsApp", hanya tidak untuk "Buka di Inbox".
                  const clickable = Boolean(row.chatId || row.phone);
                  return (
                  <tr
                    key={row.chatId || index}
                    role="button"
                    tabIndex={0}
                    onClick={() => clickable && setChoiceRow(row)}
                    onKeyDown={(event) => {
                      if ((event.key === 'Enter' || event.key === ' ') && clickable) {
                        event.preventDefault();
                        setChoiceRow(row);
                      }
                    }}
                    className="group cursor-pointer"
                  >
                    {columns.map((column) => {
                      const raw = row[column.key] ?? '';
                      // Grup tidak punya nomor, dan namanya belum terekam
                      // (notifyName di pesan grup adalah nama pengirim). Tanpa
                      // penanda, baris grup tampil sebagai dua sel kosong dan
                      // terbaca seperti data rusak.
                      const isBlankIdentity = !raw && (column.key === 'name' || column.key === 'phone');
                      const value = isBlankIdentity
                        ? (row.isGroup ? (column.key === 'name' ? t('leads.groupRow') : '—') : t('leads.noName'))
                        : raw;
                      const muted = isBlankIdentity;
                      return (
                        <td
                          key={column.key}
                          // Message bodies and summaries can be long: clipped in
                          // the table, whole in the tooltip and the export file.
                          title={String(value).length > 60 ? value : undefined}
                          className={cn(
                            'max-w-[320px] overflow-hidden border-b border-border px-3 py-2 align-top text-ellipsis whitespace-nowrap group-hover:bg-[#f6f9f5]',
                            'first:sticky first:left-0 first:z-[1] first:bg-white first:font-mono first:text-xs first:font-semibold first:group-hover:bg-[#f6f9f5]',
                            muted && 'text-muted italic',
                          )}
                        >
                          {column.key === 'source' && value ? <SourceBadge source={value} /> : value}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <Dialog open={Boolean(choiceRow)} onClose={() => setChoiceRow(null)} labelledBy="row-choice-title" className="w-[min(92vw,380px)]">
        {choiceRow ? (
          <div className="grid gap-3 p-6">
            <div className="flex items-center justify-between">
              <h2 id="row-choice-title" className="m-0 text-base">
                {t('leads.rowChoiceTitle', { phone: choiceRow.phone || choiceRow.name || t('leads.groupRow') })}
              </h2>
              <DialogClose onClick={() => setChoiceRow(null)} label={t('lead.close')} />
            </div>
            {/* Baris Mayar-murni belum punya percakapan WhatsApp — tidak ada
                chatId, jadi tidak ada inbox untuk dibuka dan tidak ada
                lead_state untuk diedit. Satu-satunya aksi yang masuk akal
                adalah menghubunginya lewat WhatsApp (di bawah). */}
            {choiceRow.mayarProducts ? (
              <p className="m-0 rounded-[10px] bg-[#eef5ee] px-3 py-2 text-xs text-ink">
                {t('leads.fromMayar', {
                  products: choiceRow.mayarProducts,
                  amount: choiceRow.mayarTotalAmount
                    ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(choiceRow.mayarTotalAmount)
                    : '—',
                })}
              </p>
            ) : null}
            {choiceRow.chatId ? (
              <button
                type="button"
                onClick={() => openInInbox(choiceRow)}
                className="grid gap-0.5 rounded-[12px] border border-border bg-white px-4 py-3 text-left transition hover:border-green"
              >
                <strong className="text-sm">{t('leads.rowGoInbox')}</strong>
                <span className="text-xs text-muted">{t('leads.rowGoInboxHint')}</span>
              </button>
            ) : null}
            {choiceRow.chatId ? (
              <button
                type="button"
                onClick={() => {
                  setEditRow(choiceRow);
                  setChoiceRow(null);
                }}
                className="grid gap-0.5 rounded-[12px] border border-border bg-white px-4 py-3 text-left transition hover:border-green"
              >
                <strong className="text-sm">{t('leads.rowEdit')}</strong>
                <span className="text-xs text-muted">{t('leads.rowEditHint')}</span>
              </button>
            ) : null}
            {/* Grup tidak punya nomor, jadi tidak ada yang bisa dibuka di WhatsApp. */}
            {choiceRow.phone ? (
              <button
                type="button"
                onClick={() => void openInWhatsapp(choiceRow)}
                className="grid gap-0.5 rounded-[12px] border border-border bg-white px-4 py-3 text-left transition hover:border-green"
              >
                <strong className="text-sm">{t('leads.rowWaMe')}</strong>
                <span className="text-xs text-muted">{t('leads.rowWaMeHint')}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <LeadDetailDialog row={editRow} onClose={() => setEditRow(null)} onSaved={() => void load()} />
    </div>
  );
}

/** Sumber baris: hijau untuk WhatsApp (bawaan), warna lain untuk Mayar. */
function SourceBadge({ source }: { source: string }) {
  const isWhatsappOnly = source === 'WhatsApp';
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold whitespace-nowrap',
        isWhatsappOnly ? 'bg-green/10 text-green-dark' : 'bg-lime/40 text-ink',
      )}
    >
      {source}
    </span>
  );
}

function Select({
  value,
  onChange,
  children,
  ...props
}: {
  value: string;
  onChange: (next: string) => void;
  children: React.ReactNode;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'>) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-[38px] rounded-[10px] border border-border bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-[#285248]"
      {...props}
    >
      {children}
    </select>
  );
}
