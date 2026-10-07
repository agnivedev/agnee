import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { subscribeLiveEvent } from '@/lib/live-events';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { MessageBubble, ProgressBar, StatusBadge, progressOf } from './parts';
import { displayPhone, type Broadcast, type Recipient, type RecipientStatus } from './types';

const FILTERS: (RecipientStatus | 'all')[] = ['all', 'pending', 'sent', 'failed', 'skipped', 'unknown'];

export function BroadcastDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, dateLocale } = useI18n();
  const { confirm, error: showError } = useConfirm();
  const navigate = useNavigate();
  const [data, setData] = useState<{ broadcast: Broadcast; recipients: Recipient[] } | null>(null);
  const [status, setStatus] = useState(t('common.loading'));
  const [filter, setFilter] = useState<RecipientStatus | 'all'>('all');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<{ broadcast: Broadcast; recipients: Recipient[] }>(`/v1/broadcasts/${encodeURIComponent(id)}`));
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeLiveEvent('broadcast', (event) => {
    try {
      if (JSON.parse(event.data)?.id === id) void load();
    } catch { /* event rusak: abaikan, muat ulang manual tetap bisa */ }
  }), [id, load]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: 0 };
    for (const row of data?.recipients || []) {
      result.all += 1;
      // `sending` hanya sekejap; digabung ke menunggu supaya tidak ada tab
      // yang berkedip muncul-hilang.
      const key = row.status === 'sending' ? 'pending' : row.status;
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }, [data]);

  const rows = useMemo(() => (data?.recipients || []).filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return row.status === 'pending' || row.status === 'sending';
    return row.status === filter;
  }), [data, filter]);

  async function act(action: 'pause' | 'resume' | 'cancel') {
    if (action === 'cancel') {
      const ok = await confirm({
        title: t('broadcast.cancelTitle'),
        message: t('broadcast.cancelCopy', { pending: data?.broadcast.pending ?? 0, sent: data?.broadcast.sent ?? 0 }),
        confirmLabel: t('broadcast.cancelConfirm'),
        cancelLabel: t('broadcast.cancelKeep'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api(`/v1/broadcasts/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      await load();
    } catch (error) {
      await showError(error);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function openChat(row: Recipient) {
    navigate(`/?chat=${encodeURIComponent(row.chatId)}&title=${encodeURIComponent(row.name || displayPhone(row))}`);
  }

  const back = (
    <button type="button" onClick={onBack} className="cursor-pointer justify-self-start border-0 bg-transparent p-0 text-sm font-semibold text-green-dark hover:underline">
      ← {t('broadcast.backToList')}
    </button>
  );

  if (!data) {
    return (
      <>
        {back}
        <p className="mt-6 text-sm text-muted">{status}</p>
      </>
    );
  }

  const b = data.broadcast;
  const { settled, percent } = progressOf(b);
  const fmt = (value: string | null) => (value ? new Date(value).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const live = b.status === 'sending' || b.status === 'scheduled' || b.status === 'paused';

  return (
    <>
      <header className="grid gap-3">
        {back}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 min-w-0 text-[26px] tracking-[-.03em] [overflow-wrap:anywhere]">{b.name}</h1>
          <StatusBadge status={b.status} kind="broadcast" />
          <span className="flex-1" />
          {b.status === 'sending' || b.status === 'scheduled' ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void act('pause')}>{t('broadcast.pause')}</Button>
          ) : null}
          {b.status === 'paused' ? (
            <Button size="sm" disabled={busy} onClick={() => void act('resume')}>{t('broadcast.resume')}</Button>
          ) : null}
          {live ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act('cancel')} className="text-danger hover:text-danger">
              {t('broadcast.cancel')}
            </Button>
          ) : null}
        </div>
        <p className="m-0 text-xs text-muted">
          {t('broadcast.createdBy', { who: b.createdByName || '—', when: fmt(b.createdAt) })}
          {b.status === 'scheduled' && b.scheduledAt ? ` · ${t('broadcast.scheduledFor', { when: fmt(b.scheduledAt) })}` : ''}
          {b.finishedAt ? ` · ${t('broadcast.finishedAt', { when: fmt(b.finishedAt) })}` : ''}
        </p>
      </header>

      {b.status === 'paused' ? (
        <p className="mt-5 mb-0 rounded-xl border border-[#e8d3a6] bg-[#fbf3e2] px-4 py-3 text-[13px] text-[#5e4210]">
          {b.pauseReason ? t('broadcast.pausedBySystem', { reason: b.pauseReason }) : t('broadcast.pausedByUser')}
        </p>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid min-w-0 content-start gap-4 rounded-panel border border-border bg-card p-5">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <strong className="text-sm">{t('broadcast.progress', { settled, total: b.total })}</strong>
              <span className="font-mono text-xs text-muted">{percent}%</span>
            </div>
            <ProgressBar broadcast={b} className="h-2" />
          </div>

          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('broadcast.filterRecipients')}>
            {FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  'cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition',
                  filter === key ? 'border-ink bg-ink text-white' : 'border-border bg-white text-ink/70 hover:border-green',
                )}
              >
                {key === 'all' ? t('broadcast.filterAll') : t(`broadcast.recipientStatus.${key}`)}
                <span className="ml-1.5 font-mono opacity-70">{counts[key] || 0}</span>
              </button>
            ))}
          </div>

          {rows.length ? (
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-border">
              <table className="w-full border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    {(['colName', 'colStatus', 'colNote'] as const).map((key) => (
                      <th key={key} className="sticky top-0 border-b border-border bg-[#eef2ec] px-3 py-2 text-left font-mono text-[11px] font-semibold tracking-[.04em] text-[#285248] uppercase">
                        {t(`broadcast.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.chatId} className="hover:bg-[#f6f9f5]">
                      <td className="border-b border-border px-3 py-2 align-top">
                        <button type="button" onClick={() => openChat(row)} className="cursor-pointer border-0 bg-transparent p-0 text-left hover:underline" title={t('broadcast.openChat')}>
                          <span className={cn('block', !row.name && 'text-muted italic')}>{row.name || t('broadcast.noName')}</span>
                          <span className="block font-mono text-[11px] text-muted">{displayPhone(row)}</span>
                        </button>
                      </td>
                      <td className="border-b border-border px-3 py-2 align-top">
                        <StatusBadge status={row.status === 'sending' ? 'pending' : row.status} kind="recipient" />
                      </td>
                      <td className="min-w-40 border-b border-border px-3 py-2 align-top text-xs text-muted [overflow-wrap:break-word]">
                        {row.error || (row.sentAt ? new Date(row.sentAt).toLocaleString(dateLocale, { dateStyle: 'short', timeStyle: 'short' }) : '')}
                        {/* Dengan variasi AI, tiap orang menerima kalimat yang
                            berbeda; supervisor harus bisa membaca persis apa yang
                            ditulis atas nama perusahaannya. */}
                        {b.aiVariation && row.sentBody ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer font-semibold text-green-dark">{t('broadcast.showSent')}</summary>
                            <p className="mt-1.5 mb-0 rounded-[10px] bg-[#dcf3d6] px-2.5 py-2 whitespace-pre-wrap text-ink">{row.sentBody}</p>
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="m-0 text-[13px] text-muted">{t('broadcast.filterEmpty')}</p>
          )}
        </section>

        <aside className="grid content-start gap-3 self-start rounded-panel border border-border bg-[#ece5dd] p-4">
          <p className="m-0 font-mono text-[11px] font-semibold tracking-[.04em] text-ink/60 uppercase">{t('broadcast.messageSent')}</p>
          <MessageBubble text={b.body} />
          <p className="m-0 text-xs text-ink/60">
            {b.optOutFooter ? t('broadcast.footerIncluded') : t('broadcast.footerExcluded')}
            {b.aiVariation ? ` ${t('broadcast.variationIncluded')}` : ''}
            {/\{\s*nama\s*\}/i.test(b.body) ? ` ${t('broadcast.nameReplaced')}` : ''}
          </p>
        </aside>
      </div>
    </>
  );
}
