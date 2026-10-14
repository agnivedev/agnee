import { useEffect, useMemo, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/** Baris Lead List dari /v1/export/contacts; sel sudah berupa teks terformat. */
type LeadRow = Record<string, string> & { broadcastChatId?: string | null; isGroup?: boolean };

/** Daftar yang dirender sekaligus. Sisanya dicapai lewat pencarian dan saringan. */
const LIST_LIMIT = 200;

const select = 'min-h-11 rounded-[10px] border border-border bg-white px-2.5 py-1.5 text-[13px]';

/** Memilih kontak Lead List di penyusun. Yang keluar hanya id chat; server tetap menyaring penerima. */
export function LeadListPicker({ open, onClose, onImport }: {
  open: boolean;
  onClose: () => void;
  onImport: (chatIds: string[]) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('');
  const [relation, setRelation] = useState('');
  const [activity, setActivity] = useState('');
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError('');
    setPicked(new Set());
    api<{ rows: LeadRow[] }>('/v1/export/contacts')
      .then((data) => setRows(data.rows || []))
      .catch((caught) => setError(messageFromError(caught, t('broadcast.leadsPickerFailed'))));
  }, [open, t]);

  // Hanya baris yang punya jalan ke WhatsApp: grup dan baris tanpa nomor tidak bisa dipilih.
  const usable = useMemo(() => (rows ?? []).filter((row) => row.broadcastChatId && !row.isGroup), [rows]);
  const options = (key: string) => [...new Set(usable.map((row) => row[key]).filter(Boolean))].sort();
  const stages = useMemo(() => options('leadStage'), [usable]); // eslint-disable-line react-hooks/exhaustive-deps
  const relations = useMemo(() => options('relation'), [usable]); // eslint-disable-line react-hooks/exhaustive-deps
  const activities = useMemo(() => options('activity'), [usable]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels = useMemo(
    () => [...new Set(usable.flatMap((row) => String(row.waLabels || '').split(', ')).filter(Boolean))].sort(),
    [usable],
  );

  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id-ID');
    return usable.filter((row) => {
      if (stage && row.leadStage !== stage) return false;
      if (relation && row.relation !== relation) return false;
      if (activity && row.activity !== activity) return false;
      if (label && !String(row.waLabels || '').split(', ').includes(label)) return false;
      if (!needle) return true;
      return `${row.name || ''} ${row.phone || ''}`.toLocaleLowerCase('id-ID').includes(needle);
    });
  }, [usable, query, stage, relation, activity, label]);

  const shown = matching.slice(0, LIST_LIMIT);
  const allMatchingPicked = matching.length > 0 && matching.every((row) => picked.has(row.broadcastChatId as string));

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Berlaku untuk semua yang cocok dengan saringan, termasuk yang tidak dirender. */
  function setAllMatching(checked: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const row of matching) {
        if (checked) next.add(row.broadcastChatId as string); else next.delete(row.broadcastChatId as string);
      }
      return next;
    });
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="lead-picker-title" className="w-[min(94vw,860px)]">
      <div className="grid gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="lead-picker-title" className="m-0 text-lg">{t('broadcast.leadsPickerTitle')}</h2>
            <p className="m-0 max-w-xl text-xs leading-[1.55] text-muted">{t('broadcast.leadsPickerCopy')}</p>
          </div>
          <DialogClose onClick={onClose} label={t('lead.close')} />
        </div>

        {error ? <p role="alert" className="m-0 text-sm text-danger">{error}</p> : null}
        {!rows && !error ? <p className="m-0 text-sm text-muted">{t('common.loading')}</p> : null}

        {rows ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('leads.searchPlaceholder')}
                aria-label={t('leads.searchPlaceholder')}
                className="min-h-11 flex-[1_1_200px] rounded-[10px] bg-white px-3 py-1.5"
              />
              {stages.length ? (
                <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t('leads.filterStage')} className={select}>
                  <option value="">{t('leads.allStages')}</option>
                  {stages.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              ) : null}
              {relations.length ? (
                <select value={relation} onChange={(e) => setRelation(e.target.value)} aria-label={t('leads.filterRelation')} className={select}>
                  <option value="">{t('leads.allRelations')}</option>
                  {relations.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              ) : null}
              {activities.length ? (
                <select value={activity} onChange={(e) => setActivity(e.target.value)} aria-label={t('leads.filterActivity')} className={select}>
                  <option value="">{t('leads.allActivities')}</option>
                  {activities.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              ) : null}
              {labels.length ? (
                <select value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('leads.filterLabel')} className={select}>
                  <option value="">{t('leads.allLabels')}</option>
                  {labels.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              ) : null}
            </div>

            <div className="rounded-xl border border-border bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <strong className="text-[13px]">{t('broadcast.leadsPickerCount', { picked: picked.size, matching: matching.length })}</strong>
                <span className="flex-1" />
                <Button variant="ghost" size="sm" disabled={!matching.length} onClick={() => setAllMatching(!allMatchingPicked)}>
                  {allMatchingPicked ? t('broadcast.uncheckAll') : t('broadcast.checkAll')}
                </Button>
              </div>
              {shown.length ? (
                <ul className="m-0 max-h-[340px] list-none overflow-auto p-0">
                  {shown.map((row) => {
                    const id = row.broadcastChatId as string;
                    return (
                      <li key={id} className="border-b border-border last:border-b-0">
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-[#f6f9f5]">
                          <input type="checkbox" checked={picked.has(id)} onChange={() => toggle(id)} />
                          <span className="min-w-0 flex-1">
                            <span className={cn('block truncate', !row.name && 'text-muted italic')}>{row.name || t('broadcast.noName')}</span>
                            <span className="block font-mono text-[11px] text-muted">{row.phone || t('broadcast.phoneUnknown')}</span>
                          </span>
                          <span className="hidden text-right text-[11px] text-muted sm:block">
                            {row.relation ? <span className="block">{row.relation}</span> : null}
                            {row.activity ? <span className="block">{row.activity}</span> : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="m-0 px-3 py-4 text-[13px] text-muted">{usable.length ? t('broadcast.searchEmpty') : t('broadcast.leadsPickerEmpty')}</p>
              )}
              {matching.length > shown.length ? (
                <p className="m-0 border-t border-border px-3 py-2 text-xs text-muted">
                  {t('broadcast.leadsPickerTruncated', { shown: shown.length, total: matching.length })}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>{t('broadcast.leadsPickerCancel')}</Button>
              <Button disabled={!picked.size} onClick={() => onImport([...picked])}>
                {t('broadcast.leadsPickerImport', { count: picked.size })}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
