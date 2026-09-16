import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError, ApiError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { LeadDetailDialog } from './LeadDetailDialog';
import { cn } from '@/lib/utils';

type Column = { key: string; label: string };
type Row = Record<string, string>;
type SortDirection = 'asc' | 'desc';

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
  const [choiceRow, setChoiceRow] = useState<Row | null>(null);
  const [editRow, setEditRow] = useState<Row | null>(null);

  function openInInbox(row: Row) {
    setChoiceRow(null);
    navigate(`/?chat=${encodeURIComponent(row.chatId)}&title=${encodeURIComponent(row.phone || row.chatId)}`);
  }

  const load = useCallback(async () => {
    setStatus(t('common.loading'));
    try {
      const data = await api<{ columns: Column[]; rows: Row[] }>('/v1/export/contacts');
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setStatus(data.rows?.length ? '' : t('leads.empty'));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setStatus(t('leads.supervisorOnly'));
        return;
      }
      setStatus(messageFromError(caught, t('leads.empty')));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const stages = useMemo(
    () => [...new Set(rows.map((row) => row.leadStage).filter(Boolean))].sort(),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id-ID');
    let filtered = rows.filter((row) => {
      if (stage && row.leadStage !== stage) return false;
      if (handling && row.handlingMode !== handling) return false;
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
  }, [rows, query, stage, handling, sort]);

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
                {visibleRows.map((row, index) => (
                  <tr
                    key={row.chatId || index}
                    role="button"
                    tabIndex={0}
                    onClick={() => row.chatId && setChoiceRow(row)}
                    onKeyDown={(event) => {
                      if ((event.key === 'Enter' || event.key === ' ') && row.chatId) {
                        event.preventDefault();
                        setChoiceRow(row);
                      }
                    }}
                    className="group cursor-pointer"
                  >
                    {columns.map((column) => {
                      const value = row[column.key] ?? '';
                      return (
                        <td
                          key={column.key}
                          // Message bodies and summaries can be long: clipped in
                          // the table, whole in the tooltip and the export file.
                          title={String(value).length > 60 ? value : undefined}
                          className={cn(
                            'max-w-[320px] overflow-hidden border-b border-border px-3 py-2 align-top text-ellipsis whitespace-nowrap group-hover:bg-[#f6f9f5]',
                            'first:sticky first:left-0 first:z-[1] first:bg-white first:font-mono first:text-xs first:font-semibold first:group-hover:bg-[#f6f9f5]',
                          )}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
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
                {t('leads.rowChoiceTitle', { phone: choiceRow.phone })}
              </h2>
              <DialogClose onClick={() => setChoiceRow(null)} label={t('lead.close')} />
            </div>
            <button
              type="button"
              onClick={() => openInInbox(choiceRow)}
              className="grid gap-0.5 rounded-[12px] border border-border bg-white px-4 py-3 text-left transition hover:border-green"
            >
              <strong className="text-sm">{t('leads.rowGoInbox')}</strong>
              <span className="text-xs text-muted">{t('leads.rowGoInboxHint')}</span>
            </button>
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
          </div>
        ) : null}
      </Dialog>

      <LeadDetailDialog row={editRow} onClose={() => setEditRow(null)} onSaved={() => void load()} />
    </div>
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
