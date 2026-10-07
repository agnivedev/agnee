import { useEffect, useMemo, useRef, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { MessageBubble } from './parts';
import { displayPhone, renderPreview, type Broadcast, type Candidate, type Pace } from './types';

type Audience = {
  recipients: Candidate[];
  excluded: { optedOut: number; outsideCloudWindow: number };
  products: { id: string; name: string }[];
  pace: Pace;
};

type Stage = 'any' | 'inbox' | 'qualified' | 'assigned' | 'none';
const STAGES: Stage[] = ['any', 'inbox', 'qualified', 'assigned', 'none'];
const RECENCY_DAYS = [0, 1, 7, 30, 90];
/** Daftar yang dirender sekaligus. Sisanya dicapai lewat pencarian. */
const LIST_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Perkiraan lama pengiriman dari tempo server. Bukan janji: yang dihitung
 * hanya jarak antar pesan dan jam kirim, bukan nomor yang terputus di tengah.
 */
function estimate(count: number, pace: Pace) {
  const avgGap = (pace.minGapSeconds + pace.maxGapSeconds) / 2;
  const windowSeconds = (pace.sendToHour - pace.sendFromHour) * 3600;
  const perDay = Math.min(pace.dailyCap, Math.floor(windowSeconds / avgGap));
  if (count <= perDay) return { days: 1, minutes: Math.max(1, Math.round((count * avgGap) / 60)), perDay };
  return { days: Math.ceil(count / perDay), minutes: 0, perDay };
}

export function BroadcastComposer({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const { t, dateLocale } = useI18n();
  const { confirm, error: showError } = useConfirm();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [audience, setAudience] = useState<Audience | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState(true);
  const [aiVariation, setAiVariation] = useState(false);
  const [stage, setStage] = useState<Stage>('any');
  const [recency, setRecency] = useState(30);
  const [product, setProduct] = useState('any');
  const [search, setSearch] = useState('');
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api<Audience>('/v1/broadcasts/audience')
      .then((data) => {
        setAudience(data);
        // Cloud API hanya bisa ke yang chat dalam 24 jam; server sudah
        // menyaring, jadi saringan hari tidak perlu mempersempit lagi.
        if (data.pace.provider === 'cloud_api') setRecency(0);
      })
      .catch((error) => setLoadError(messageFromError(error, '')));
  }, []);

  const matching = useMemo(() => {
    if (!audience) return [];
    const now = Date.now();
    return audience.recipients.filter((row) => {
      if (stage === 'none' ? row.leadStage : stage !== 'any' && row.leadStage !== stage) return false;
      if (recency && !(row.lastInboundAt && now - row.lastInboundAt * 1000 <= recency * DAY_MS)) return false;
      if (product === 'none' ? row.productId : product !== 'any' && row.productId !== product) return false;
      return true;
    });
  }, [audience, stage, recency, product]);

  const selected = useMemo(() => matching.filter((row) => !unchecked.has(row.chatId)), [matching, unchecked]);

  const listed = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = needle
      ? matching.filter((row) => (row.name || '').toLowerCase().includes(needle) || displayPhone(row).includes(needle.replace(/\D/g, '') || needle))
      : matching;
    return { all: rows, rows: rows.slice(0, LIST_LIMIT), total: rows.length };
  }, [matching, search]);

  if (loadError) {
    return (
      <Shell onCancel={onCancel}>
        <p className="m-0 text-sm text-danger">{loadError}</p>
      </Shell>
    );
  }
  if (!audience) {
    return (
      <Shell onCancel={onCancel}>
        <p className="m-0 text-sm text-muted">{t('broadcast.loadingAudience')}</p>
      </Shell>
    );
  }

  const { pace } = audience;
  const tooMany = selected.length > pace.maxRecipients;
  const scheduleInvalid = when === 'later' && !(scheduledAt && new Date(scheduledAt).getTime() > Date.now());
  const canSend = Boolean(name.trim() && body.trim() && selected.length && !tooMany && !scheduleInvalid && !sending);
  const previewName = selected[0]?.name ?? null;
  const eta = estimate(selected.length, pace);
  const hour = (h: number) => `${String(h).padStart(2, '0')}.00`;

  function insertName() {
    const area = bodyRef.current;
    const token = '{nama}';
    if (!area) { setBody((value) => value + token); return; }
    const start = area.selectionStart ?? body.length;
    const end = area.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function toggle(chatId: string) {
    setUnchecked((current) => {
      const next = new Set(current);
      if (next.has(chatId)) next.delete(chatId); else next.add(chatId);
      return next;
    });
  }

  /** Berlaku untuk semua yang cocok dengan pencarian, termasuk yang tidak dirender. */
  function setAll(checked: boolean) {
    setUnchecked((current) => {
      const next = new Set(current);
      for (const row of listed.all) {
        if (checked) next.delete(row.chatId); else next.add(row.chatId);
      }
      return next;
    });
  }

  async function submit() {
    if (!canSend) return;
    const whenText = when === 'later'
      ? t('broadcast.confirmLater', { when: new Date(scheduledAt).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }) })
      : t('broadcast.confirmNow');
    const ok = await confirm({
      title: t('broadcast.confirmTitle', { count: selected.length }),
      message: t('broadcast.confirmCopy', { when: whenText }),
      confirmLabel: when === 'later' ? t('broadcast.confirmSchedule') : t('broadcast.confirmStart'),
    });
    if (!ok) return;
    setSending(true);
    try {
      const data = await api<{ broadcast: Broadcast }>('/v1/broadcasts', {
        method: 'POST',
        body: {
          name: name.trim(),
          body: body.trim(),
          optOutFooter: footer,
          aiVariation,
          chatIds: selected.map((row) => row.chatId),
          scheduledAt: when === 'later' ? new Date(scheduledAt).toISOString() : null,
          audience: { stage, lastInboundDays: recency, productId: product === 'any' || product === 'none' ? null : product },
        },
      });
      onCreated(data.broadcast.id);
    } catch (error) {
      setSending(false);
      await showError(error);
    }
  }

  const select = 'min-h-[38px] rounded-[10px] border border-border bg-white px-2.5 py-1.5 text-[13px]';

  return (
    <Shell onCancel={onCancel}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-6">
          <Step number={1} title={t('broadcast.stepMessage')}>
            <label className="grid gap-1.5 text-[13px] font-semibold">
              {t('broadcast.nameLabel')}
              <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t('broadcast.namePlaceholder')} className="py-2.5" />
              <span className="text-xs font-normal text-muted">{t('broadcast.nameHint')}</span>
            </label>
            <label className="grid gap-1.5 text-[13px] font-semibold">
              {t('broadcast.bodyLabel')}
              <Textarea
                ref={bodyRef}
                value={body}
                maxLength={4000}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('broadcast.bodyPlaceholder')}
                className="min-h-40 py-3 font-normal"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={insertName}>{t('broadcast.insertName')}</Button>
              <span className="text-xs text-muted">{t('broadcast.insertNameHint')}</span>
              <span className="flex-1" />
              <span className="font-mono text-[11px] text-muted">{body.length}/4000</span>
            </div>
            <div className="grid gap-3 border-t border-border pt-4">
              <Option
                checked={aiVariation}
                onChange={setAiVariation}
                label={t('broadcast.variationLabel')}
                hint={aiVariation ? t('broadcast.variationOn') : null}
                help={t('broadcast.variationHelp')}
              />
              <Option
                checked={footer}
                onChange={setFooter}
                label={t('broadcast.footerLabel')}
                hint={footer ? t('broadcast.footerOn') : t('broadcast.footerOff')}
              />
            </div>
          </Step>

          <Step number={2} title={t('broadcast.stepAudience')}>
            <div className="flex flex-wrap gap-2">
              <label className="grid gap-1 text-xs text-muted">
                {t('broadcast.filterStage')}
                <select value={stage} onChange={(e) => setStage(e.target.value as Stage)} className={select}>
                  {STAGES.map((value) => <option key={value} value={value}>{t(`broadcast.stage.${value}`)}</option>)}
                </select>
              </label>
              {pace.provider === 'cloud_api' ? null : (
                <label className="grid gap-1 text-xs text-muted">
                  {t('broadcast.filterRecency')}
                  <select value={recency} onChange={(e) => setRecency(Number(e.target.value))} className={select}>
                    {RECENCY_DAYS.map((days) => (
                      <option key={days} value={days}>{days ? t('broadcast.recencyDays', { days }) : t('broadcast.recencyAny')}</option>
                    ))}
                  </select>
                </label>
              )}
              {audience.products.length ? (
                <label className="grid gap-1 text-xs text-muted">
                  {t('broadcast.filterProduct')}
                  <select value={product} onChange={(e) => setProduct(e.target.value)} className={select}>
                    <option value="any">{t('broadcast.productAny')}</option>
                    {audience.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    <option value="none">{t('broadcast.productNone')}</option>
                  </select>
                </label>
              ) : null}
            </div>

            <div className="grid gap-1 text-xs text-muted">
              {audience.excluded.optedOut ? <span>{t('broadcast.excludedOptOut', { count: audience.excluded.optedOut })}</span> : null}
              {audience.excluded.outsideCloudWindow ? <span>{t('broadcast.excludedCloud', { count: audience.excluded.outsideCloudWindow })}</span> : null}
              <span>{t('broadcast.audienceRule')}</span>
            </div>

            <div className="rounded-xl border border-border bg-white">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                <strong className="text-[13px]">{t('broadcast.selectedCount', { selected: selected.length, matching: matching.length })}</strong>
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => setAll(true)}>{t('broadcast.checkAll')}</Button>
                <Button variant="ghost" size="sm" onClick={() => setAll(false)}>{t('broadcast.uncheckAll')}</Button>
              </div>
              <div className="border-b border-border px-3 py-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('broadcast.searchPlaceholder')} className="py-2" aria-label={t('broadcast.searchPlaceholder')} />
              </div>
              {listed.rows.length ? (
                <ul className="m-0 max-h-[360px] list-none overflow-auto p-0">
                  {listed.rows.map((row) => (
                    <li key={row.chatId} className="border-b border-border last:border-b-0">
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-[#f6f9f5]">
                        <input type="checkbox" checked={!unchecked.has(row.chatId)} onChange={() => toggle(row.chatId)} />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate', !row.name && 'text-muted italic')}>{row.name || t('broadcast.noName')}</span>
                          <span className="block font-mono text-[11px] text-muted">{displayPhone(row)}</span>
                        </span>
                        <span className="hidden text-right text-[11px] text-muted sm:block">
                          {row.productName ? <span className="block">{row.productName}</span> : null}
                          {row.lastInboundAt
                            ? t('broadcast.lastChat', { when: new Date(row.lastInboundAt * 1000).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' }) })
                            : t('broadcast.lastChatUnknown')}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 px-3 py-4 text-[13px] text-muted">{matching.length ? t('broadcast.searchEmpty') : t('broadcast.audienceEmpty')}</p>
              )}
              {listed.total > listed.rows.length ? (
                <p className="m-0 border-t border-border px-3 py-2 text-xs text-muted">
                  {t('broadcast.listTruncated', { shown: listed.rows.length, total: listed.total })}
                </p>
              ) : null}
            </div>
            {tooMany ? <p className="m-0 text-[13px] text-danger">{t('broadcast.tooMany', { max: pace.maxRecipients })}</p> : null}
          </Step>

          <Step number={3} title={t('broadcast.stepWhen')}>
            <div className="flex flex-wrap gap-4 text-[13px]">
              <label className="flex items-center gap-2">
                <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} />
                {t('broadcast.whenNow')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} />
                {t('broadcast.whenLater')}
              </label>
            </div>
            {when === 'later' ? (
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="max-w-[260px] py-2.5" aria-label={t('broadcast.whenLater')} />
            ) : null}
            <p className="m-0 text-xs leading-[1.55] text-muted">
              {t('broadcast.paceNote', { from: hour(pace.sendFromHour), to: hour(pace.sendToHour), min: pace.minGapSeconds, max: pace.maxGapSeconds, cap: pace.dailyCap })}
            </p>
          </Step>
        </div>

        <aside className="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-panel border border-border bg-[#ece5dd] p-4">
            <p className="mt-0 mb-3 font-mono text-[11px] font-semibold tracking-[.04em] text-ink/60 uppercase">
              {t('broadcast.previewFor', { name: previewName || t('broadcast.previewNoName') })}
            </p>
            {body.trim()
              ? <MessageBubble text={renderPreview(body, previewName, footer, pace.optOutLine)} />
              : <p className="m-0 text-[13px] text-ink/50">{t('broadcast.previewEmpty')}</p>}
            {body.trim() && aiVariation
              ? <p className="mt-3 mb-0 text-xs text-ink/60">{t('broadcast.previewVariation')}</p>
              : null}
          </div>

          <div className="grid gap-3 rounded-panel border border-border bg-card p-4">
            <div className="grid gap-0.5">
              <span className="font-mono text-[11px] font-semibold text-muted uppercase">{t('broadcast.summaryRecipients')}</span>
              <strong className="text-2xl tracking-[-.02em]">{selected.length}</strong>
            </div>
            {selected.length ? (
              <p className="m-0 text-xs leading-[1.55] text-muted">
                {eta.days > 1
                  ? t('broadcast.etaDays', { days: eta.days, cap: eta.perDay })
                  : eta.minutes >= 60
                    ? t('broadcast.etaHours', { hours: Math.floor(eta.minutes / 60), minutes: eta.minutes % 60 })
                    : t('broadcast.etaMinutes', { minutes: eta.minutes })}
              </p>
            ) : null}
            <Button onClick={() => void submit()} disabled={!canSend}>
              {sending
                ? t('broadcast.submitting')
                : when === 'later' ? t('broadcast.submitSchedule', { count: selected.length }) : t('broadcast.submitNow', { count: selected.length })}
            </Button>
            {!name.trim() || !body.trim() ? <p className="m-0 text-xs text-muted">{t('broadcast.needNameBody')}</p> : null}
            {scheduleInvalid ? <p className="m-0 text-xs text-muted">{t('broadcast.needSchedule')}</p> : null}
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ onCancel, children }: { onCancel: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      {/* Tautan kembali di kiri, bukan kanan atas: pil ID/EN menempel di pojok
          kanan atas setiap halaman dan menimpanya. */}
      <header className="grid justify-items-start gap-3">
        <button type="button" onClick={onCancel} className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-green-dark hover:underline">
          ← {t('broadcast.backToList')}
        </button>
        <div>
          <p className="eyebrow">{t('broadcast.eyebrow')}</p>
          <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('broadcast.newHeading')}</h1>
        </div>
      </header>
      <div className="mt-8">{children}</div>
    </>
  );
}

/**
 * Satu baris pilihan: saklar, label, dan penjelasan yang dibuka dengan (?).
 * Penjelasannya diklik, bukan di-hover: tooltip hover tidak bisa dibuka di
 * ponsel, padahal supervisor sering menyusun broadcast dari HP.
 */
function Option({
  checked, onChange, label, hint, help,
}: { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string | null; help?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2.5">
        <Switch checked={checked} onChange={onChange} label={label} />
        <span className="text-[13px] font-semibold">{label}</span>
        {help ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={t('broadcast.whatIsThis')}
            className={cn(
              'grid size-5 cursor-pointer place-items-center rounded-full border p-0 font-mono text-[11px] font-semibold transition',
              open ? 'border-ink bg-ink text-white' : 'border-ink/25 bg-transparent text-ink/60 hover:border-ink/50 hover:text-ink',
            )}
          >
            ?
          </button>
        ) : null}
      </div>
      {help && open ? (
        <p className="m-0 ml-[50px] rounded-[10px] bg-ink/5 px-3 py-2 text-xs leading-[1.55] text-ink/75">{help}</p>
      ) : null}
      {hint ? <p className="m-0 ml-[50px] text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-panel border border-border bg-card p-5">
      <h2 className="m-0 flex items-baseline gap-2.5 text-base tracking-[-.01em]">
        <span className="font-mono text-[11px] font-semibold text-green-dark">0{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
