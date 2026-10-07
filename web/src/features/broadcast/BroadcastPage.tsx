import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { subscribeLiveEvent } from '@/lib/live-events';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { BroadcastComposer } from './BroadcastComposer';
import { BroadcastDetail } from './BroadcastDetail';
import { ProgressBar, StatusBadge } from './parts';
import { displayPhone, type Broadcast, type OptOut, type Pace } from './types';

/**
 * Broadcast: daftar, penyusun, dan detail dalam satu halaman. Tampilan mana
 * yang terbuka disimpan di URL (`?baru`, `?id=`), jadi memuat ulang halaman
 * di tengah pengiriman tetap menampilkan broadcast yang sama.
 */
export function BroadcastPage() {
  const { t } = useI18n();
  usePageTitle('broadcast.title');
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  const composing = params.has('baru');

  const show = useCallback((next: { id?: string; baru?: boolean } | null) => {
    const search = new URLSearchParams();
    if (next?.id) search.set('id', next.id);
    if (next?.baru) search.set('baru', '');
    setParams(search);
  }, [setParams]);

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-10">
        {composing ? (
          <BroadcastComposer onCancel={() => show(null)} onCreated={(id) => show({ id })} />
        ) : openId ? (
          <BroadcastDetail id={openId} onBack={() => show(null)} />
        ) : (
          <BroadcastList onOpen={(id) => show({ id })} onNew={() => show({ baru: true })} heading={t('broadcast.heading')} />
        )}
      </main>
    </div>
  );
}

function BroadcastList({ onOpen, onNew, heading }: { onOpen: (id: string) => void; onNew: () => void; heading: string }) {
  const { t, dateLocale } = useI18n();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [pace, setPace] = useState<Pace | null>(null);
  const [status, setStatus] = useState(t('common.loading'));

  const load = useCallback(async () => {
    try {
      const data = await api<{ broadcasts: Broadcast[]; pace: Pace }>('/v1/broadcasts');
      setBroadcasts(data.broadcasts || []);
      setPace(data.pace);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeLiveEvent('broadcast', () => { void load(); }), [load]);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('broadcast.eyebrow')}</p>
          <h1 className="m-0 text-[28px] tracking-[-.03em]">{heading}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            {pace
              ? t(pace.provider === 'cloud_api' ? 'broadcast.subtitleCloud' : 'broadcast.subtitle', {
                min: pace.minGapSeconds, max: pace.maxGapSeconds,
                from: String(pace.sendFromHour).padStart(2, '0'), to: String(pace.sendToHour).padStart(2, '0'),
                cap: pace.dailyCap,
              })
              : t('broadcast.subtitleLoading')}
          </p>
        </div>
        <Button onClick={onNew}>{t('broadcast.new')}</Button>
      </header>

      <section className="mt-8 rounded-panel border border-border bg-card p-5">
        {status ? <p className="m-0 text-[13px] text-muted">{status}</p> : null}

        {!status && !broadcasts.length ? (
          <div className="grid gap-4 py-4 sm:grid-cols-3">
            {(['empty1', 'empty2', 'empty3'] as const).map((key, index) => (
              <div key={key} className="grid content-start gap-1.5">
                <span className="font-mono text-[11px] font-semibold text-green-dark">0{index + 1}</span>
                <strong className="text-sm">{t(`broadcast.${key}Title`)}</strong>
                <p className="m-0 text-[13px] leading-[1.55] text-muted">{t(`broadcast.${key}Copy`)}</p>
              </div>
            ))}
          </div>
        ) : null}

        {broadcasts.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {broadcasts.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onOpen(b.id)}
                  className="grid w-full cursor-pointer gap-2 rounded-xl border border-border bg-white p-4 text-left transition hover:border-green"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="min-w-0 text-sm [overflow-wrap:anywhere]">{b.name}</strong>
                    <StatusBadge status={b.status} kind="broadcast" />
                    <span className="flex-1" />
                    <span className="font-mono text-[11px] text-muted">
                      {t('broadcast.sentOfTotal', { sent: b.sent, total: b.total })}
                    </span>
                  </span>
                  <ProgressBar broadcast={b} />
                  <span className="text-xs text-muted">
                    {b.status === 'scheduled' && b.scheduledAt
                      ? t('broadcast.scheduledFor', { when: new Date(b.scheduledAt).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }) })
                      : t('broadcast.createdBy', {
                        who: b.createdByName || '—',
                        when: new Date(b.createdAt).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }),
                      })}
                    {b.pauseReason ? <span className="text-[#7a5410]"> · {b.pauseReason}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <OptOutList />
    </>
  );
}

/**
 * Customer yang membalas STOP. Ditampilkan supaya supervisor tahu kenapa
 * seseorang tidak pernah muncul di daftar penerima, dan bisa memasukkannya
 * kembali kalau customer itu sendiri yang meminta.
 */
function OptOutList() {
  const { t, dateLocale } = useI18n();
  const { confirm, error: showError } = useConfirm();
  const [rows, setRows] = useState<OptOut[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ optOuts: OptOut[] }>('/v1/broadcasts/opt-outs');
      setRows(data.optOuts || []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function remove(row: OptOut) {
    const ok = await confirm({
      title: t('broadcast.optOutRemoveTitle'),
      message: t('broadcast.optOutRemoveCopy', { who: row.name || displayPhone(row) }),
      confirmLabel: t('broadcast.optOutRemoveConfirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/broadcasts/opt-outs/${encodeURIComponent(row.chatId)}`, { method: 'DELETE' });
      await load();
    } catch (error) {
      await showError(error);
    }
  }

  if (!rows) return null;
  return (
    <section className="mt-5 rounded-panel border border-border bg-card p-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 text-left"
      >
        <strong className="text-sm">{t('broadcast.optOutTitle')}</strong>
        <span className="font-mono text-xs text-muted">{rows.length}</span>
        <span className="flex-1" />
        <span className="text-xs font-semibold text-green-dark">{open ? t('broadcast.hide') : t('broadcast.show')}</span>
      </button>
      {open ? (
        <>
          <p className="mt-2 mb-3 text-[13px] text-muted">{t('broadcast.optOutCopy')}</p>
          {rows.length ? (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {rows.map((row) => (
                <li key={row.chatId} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-[13px]">
                  <strong>{row.name || t('broadcast.noName')}</strong>
                  <span className="font-mono text-xs text-muted">{displayPhone(row)}</span>
                  <span className="text-xs text-muted">
                    · {t('broadcast.optOutSince', { word: row.keyword || 'STOP', when: new Date(row.createdAt).toLocaleDateString(dateLocale, { dateStyle: 'medium' }) })}
                  </span>
                  <span className="flex-1" />
                  <Button variant="ghost" size="sm" onClick={() => void remove(row)}>{t('broadcast.optOutRemove')}</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-muted">{t('broadcast.optOutEmpty')}</p>
          )}
        </>
      ) : null}
    </section>
  );
}
