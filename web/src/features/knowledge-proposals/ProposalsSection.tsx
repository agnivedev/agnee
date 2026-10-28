import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { subscribeLiveEvent } from '@/lib/live-events';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { notificationHref } from '@/lib/notification-link';
import { PROPOSAL_CATEGORIES, type Proposal, type ProposalCategory } from './types';

type Filter = 'pending' | 'decided';
const field = 'w-full rounded-app border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green focus:ring-4 focus:ring-green/20';

/** Jumlah usulan yang menunggu tinjauan, untuk lencana di tab. */
export function usePendingProposals() {
  const [pending, setPending] = useState(0);
  const load = useCallback(async () => {
    try {
      const data = await api<{ pending: number }>('/v1/knowledge-proposals?limit=1');
      setPending(data.pending || 0);
    } catch {
      /* lencana hanyalah petunjuk */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeLiveEvent('knowledge', () => { void load(); }), [load]);
  return { pending, reload: load };
}

/**
 * Tinjauan usulan knowledge: supervisor membaca usulan, melihat simulasi
 * sebelum/sesudah, lalu menerapkan atau menolak. Tombol Terapkan mati sampai
 * simulasinya ada; server menolak penerapan tanpa simulasi juga.
 */
export function ProposalsSection({ onChanged }: { onChanged?: () => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [origin, setOrigin] = useState<string>('all');
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const status = filter === 'pending' ? 'submitted' : 'applied,rejected,dismissed';
      const data = await api<{ enabled: boolean; proposals: Proposal[] }>(`/v1/knowledge-proposals?status=${status}`);
      setEnabled(data.enabled);
      setItems(data.proposals || []);
      setError('');
    } catch (caught) {
      setError(messageFromError(caught, t('kp.loadFailed')));
      setItems((current) => current ?? []);
    }
  }, [filter, t]);

  useEffect(() => { setItems(null); void load(); }, [load]);
  useEffect(() => subscribeLiveEvent('knowledge', () => { void load(); }), [load]);

  async function toggle(next: boolean) {
    try {
      const data = await api<{ enabled: boolean }>('/v1/knowledge/settings', { method: 'PUT', body: { enabled: next } });
      setEnabled(data.enabled);
    } catch (caught) {
      await confirm.error(caught);
    }
  }

  // Asal tersedia sebagai filter hanya bila ada usulan dari departemen.
  const originOf = (proposal: Proposal) => (proposal.origin === 'department' ? `dept:${proposal.departmentName || '?'}` : 'chat');
  const origins = (items || []).some((item) => item.origin === 'department')
    ? Array.from(new Set((items || []).map(originOf))).sort()
    : [];
  const visible = (items || []).filter((item) => origin === 'all' || originOf(item) === origin);

  function replaceItem(proposal: Proposal) {
    setItems((current) => (current || []).map((item) => (item.id === proposal.id ? proposal : item)));
  }

  return (
    <div className="grid max-w-4xl gap-6 pb-24">
      <p className="m-0 max-w-2xl text-sm text-muted">{t('kp.reviewIntro')}</p>

      {/* Kartu saklar menunggu status dari server; tanpa itu ia berkedip "mati" sebelum terbaca. */}
      {enabled === null ? null : (
        <div className="flex items-start gap-3 rounded-panel border border-border bg-card p-4">
          <Switch checked={enabled} onChange={(next) => void toggle(next)} label={t('kp.toggleLabel')} className="mt-0.5" />
          <div className="grid gap-1">
            <strong className="text-[14px]">{t('kp.toggleLabel')}</strong>
            <span className="text-[13px] leading-snug text-muted">{t('kp.toggleHelp')}</span>
          </div>
        </div>
      )}

      <div role="group" className="flex flex-wrap gap-1.5">
        {(['pending', 'decided'] as Filter[]).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={cn(
              'cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
              filter === id ? 'border-ink bg-ink text-white' : 'border-ink/15 bg-white/60 text-ink hover:border-green',
            )}
          >
            {t(`kp.filter.${id}`)}
          </button>
        ))}
      </div>

      {origins.length > 0 ? (
        <div role="group" aria-label={t('kp.origin.all')} className="flex flex-wrap gap-1.5">
          {['all', ...origins].map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={origin === id}
              onClick={() => setOrigin(id)}
              className={cn(
                'cursor-pointer rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                origin === id ? 'border-green-dark bg-green-dark text-white' : 'border-ink/15 bg-white/60 text-ink hover:border-green',
              )}
            >
              {id === 'all' ? t('kp.origin.all') : id === 'chat' ? t('kp.origin.chat') : t('kp.origin.department', { name: id.slice('dept:'.length) })}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p role="alert" className="m-0 text-[13px] font-semibold text-danger">{error}</p> : null}
      {items === null ? <p className="m-0 text-[13px] text-muted">{t('common.loading')}</p> : null}
      {items?.length === 0 && !error ? <p className="m-0 text-[13px] text-muted">{t(`kp.empty.${filter}`)}</p> : null}

      <ul className="m-0 grid list-none gap-4 p-0">
        {visible.map((proposal) => (
          <li key={proposal.id}>
            <ProposalCard proposal={proposal} onUpdate={replaceItem} onDecided={() => { void load(); onChanged?.(); }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProposalCard({
  proposal,
  onUpdate,
  onDecided,
}: {
  proposal: Proposal;
  onUpdate: (proposal: Proposal) => void;
  onDecided: () => void;
}) {
  const { t, dateLocale } = useI18n();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<'simulate' | 'apply' | 'reject' | 'save' | null>(null);
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(proposal.question);
  const [answer, setAnswer] = useState(proposal.answer);
  const [category, setCategory] = useState<ProposalCategory>(proposal.category);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const open = proposal.status === 'submitted';
  const simulation = proposal.simulation;

  async function run<T>(kind: NonNullable<typeof busy>, task: () => Promise<T>): Promise<T | undefined> {
    setBusy(kind);
    try {
      return await task();
    } catch (caught) {
      await confirm.error(caught);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const simulate = () => run('simulate', async () => {
    const data = await api<{ proposal: Proposal }>(`/v1/knowledge-proposals/${proposal.id}/simulate`, { method: 'POST', body: {} });
    onUpdate(data.proposal);
  });

  const apply = () => run('apply', async () => {
    await api(`/v1/knowledge-proposals/${proposal.id}/apply`, { method: 'POST', body: {} });
    onDecided();
  });

  const reject = () => run('reject', async () => {
    await api(`/v1/knowledge-proposals/${proposal.id}/reject`, { method: 'POST', body: { reason: reason.trim() || undefined } });
    onDecided();
  });

  const save = () => run('save', async () => {
    const data = await api<{ proposal: Proposal }>(`/v1/knowledge-proposals/${proposal.id}`, {
      method: 'PATCH', body: { question, answer, category },
    });
    onUpdate(data.proposal);
    setEditing(false);
  });

  return (
    <article className="grid gap-3.5 rounded-panel border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span className="rounded-full bg-ink/8 px-2.5 py-1 font-semibold text-ink">{t(`kp.category.${proposal.category}`)}</span>
        {open ? (
          <span className={cn('rounded-full px-2.5 py-1 font-semibold', proposal.conflictStatus === 'conflict' ? 'bg-[#fdeccb] text-[#7a4a00]' : 'bg-lime/40 text-ink')}>
            {proposal.conflictStatus === 'conflict' ? t('kp.conflict') : t('kp.isNew')}
          </span>
        ) : (
          <span className="rounded-full bg-ink/8 px-2.5 py-1 font-semibold text-ink">
            {t(`kp.status.${proposal.status}`)}
            {proposal.reviewedByName ? ` ${t('kp.decidedBy', { name: proposal.reviewedByName })}` : ''}
          </span>
        )}
        {proposal.origin === 'department' ? (
          <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 font-semibold text-[#1e3a8a]">
            {t('kp.badge.department', { name: proposal.departmentName || '' })}
          </span>
        ) : (
          <span>{proposal.proposedByName ? t('kp.from', { name: proposal.proposedByName }) : t('kp.fromChat')}</span>
        )}
        <span className="flex-1" />
        <time>{new Date(proposal.submittedAt || proposal.createdAt).toLocaleString(dateLocale)}</time>
      </header>

      {proposal.origin === 'department' ? <CaseBlock proposal={proposal} /> : null}
      {proposal.origin === 'department' ? (
        <span className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">{t('kp.case.proposal')}</span>
      ) : null}

      {editing ? (
        <div className="grid gap-2.5">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={200} aria-label={t('kp.question')} className={field} />
          <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={600} rows={3} aria-label={t('kp.answer')} className={field} />
          <select value={category} onChange={(event) => setCategory(event.target.value as ProposalCategory)} aria-label={t('kp.category')} className={field}>
            {PROPOSAL_CATEGORIES.map((id) => <option key={id} value={id}>{t(`kp.category.${id}`)}</option>)}
          </select>
          <p className="m-0 text-[12px] text-muted">{t('kp.editResets')}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void save()}>{t('kp.save')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-1">
          <strong className="text-[15px] leading-snug">{proposal.question}</strong>
          <p className="m-0 text-[14px] leading-snug text-ink/80">{proposal.answer}</p>
        </div>
      )}

      {proposal.conflictNote && open ? (
        <p className="m-0 rounded-app bg-[#fdf3dd] px-3 py-2 text-[13px] leading-snug text-[#7a4a00]">{proposal.conflictNote}</p>
      ) : null}
      {proposal.rejectReason && !open ? <p className="m-0 text-[13px] text-muted">{proposal.rejectReason}</p> : null}

      {proposal.chatExcerpt && proposal.origin !== 'department' ? (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-semibold text-green-dark">{t('kp.source')}</summary>
          <pre className="mt-2 mb-0 max-h-48 overflow-auto whitespace-pre-wrap rounded-app bg-ink/5 p-3 font-sans text-[12px] leading-relaxed">{proposal.chatExcerpt}</pre>
        </details>
      ) : null}

      {open ? (
        <section className="grid gap-3 border-t border-border pt-3.5" aria-label={t('kp.simulate')}>
          <p className="m-0 text-[12px] text-muted">{t('kp.simulationHint')}</p>
          {simulation ? (
            <div className="grid gap-3">
              {simulation.rows.map((row, index) => (
                <div key={`${row.question}-${index}`} className="grid gap-2 rounded-app border border-border p-3">
                  <p className="m-0 text-[13px] font-semibold">“{row.question}”</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Reply label={t('kp.before')} text={row.before} />
                    <Reply label={t('kp.after')} text={row.after} highlight>
                      {row.judge ? (
                        <span className={cn('mt-1.5 inline-block w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold', row.judge.verdict === 'pass' ? 'bg-lime/40' : 'bg-[#fdeccb] text-[#7a4a00]')}>
                          {row.judge.verdict === 'pass' ? t('kp.judge.pass') : t('kp.judge.revise')}
                          {row.judge.overall ? ` · ${row.judge.overall}/5` : ''}
                        </span>
                      ) : null}
                    </Reply>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {rejecting ? (
            <div className="grid gap-2">
              <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder={t('kp.rejectReason')} aria-label={t('kp.rejectReason')} className={field} />
              <div className="flex gap-2">
                <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void reject()}>{t('kp.rejectConfirm')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>{t('common.cancel')}</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void simulate()}>
                {busy === 'simulate' ? t('kp.simulating') : simulation ? t('kp.simulateAgain') : t('kp.simulate')}
              </Button>
              <Button size="sm" disabled={busy !== null || !simulation} title={simulation ? undefined : t('kp.applyNeedsSim')} onClick={() => void apply()}>
                {busy === 'apply' ? t('kp.applying') : t('kp.apply')}
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>{t('kp.edit')}</Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRejecting(true)}>{t('kp.reject')}</Button>
            </div>
          )}
        </section>
      ) : null}
    </article>
  );
}

function Reply({ label, text, highlight, children }: { label: string; text: string | null; highlight?: boolean; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={cn('grid content-start gap-1 rounded-app p-3', highlight ? 'bg-lime/20' : 'bg-ink/5')}>
      <span className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      <p className="m-0 whitespace-pre-wrap text-[13px] leading-snug">{text || t('kp.noReply')}</p>
      {children}
    </div>
  );
}

/**
 * Kasus lengkap di balik usulan dari jawaban departemen, berurutan: pesan
 * customer, pertanyaan AI, siapa menjawab apa, lalu tautan ke chat sumbernya.
 * Supervisor tidak perlu membuka apa pun untuk memutuskan; tautannya untuk
 * memeriksa konteks bila ragu.
 */
function CaseBlock({ proposal }: { proposal: Proposal }) {
  const { t, dateLocale } = useI18n();
  const when = proposal.answeredAt ? new Date(proposal.answeredAt).toLocaleString(dateLocale) : '';
  const who = proposal.answeredByName || t('kp.case.unknownWho');
  const channel = proposal.answerChannel === 'group' ? t('kp.case.channel.group') : t('kp.case.channel.web');
  const department = proposal.departmentName || '';
  return (
    <section aria-label={t('kp.case.title')} className="grid gap-2.5 rounded-app border border-[#bfdbfe] bg-[#eff6ff]/60 p-3 text-[13px]">
      <div className="grid gap-0.5">
        <span className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">{t('kp.case.customer')}</span>
        <p className="m-0 leading-snug">{proposal.customerMessage ? `“${proposal.customerMessage}”` : t('kp.case.noCustomer')}</p>
      </div>
      <div className="grid gap-0.5">
        <span className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">{t('kp.case.asked', { name: department })}</span>
        <p className="m-0 leading-snug">{proposal.askedQuestion}</p>
      </div>
      <div className="grid gap-0.5">
        <span className="font-mono text-[10px] font-semibold tracking-wide text-muted uppercase">{t('kp.case.answered')}</span>
        <p className="m-0 text-[12px] text-muted">{t('kp.case.answeredBy', { who, channel, when })}</p>
        <p className="m-0 whitespace-pre-wrap rounded-app bg-white px-3 py-2 leading-snug">{proposal.rawAnswer}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <a
          href={notificationHref(proposal.chatId)}
          target="_blank"
          rel="noreferrer"
          className="font-bold text-green-dark underline underline-offset-2"
        >
          {t('kp.case.openChat')}
        </a>
        {proposal.answerGroupId ? (
          <a
            href={notificationHref(proposal.answerGroupId, department)}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-green-dark underline underline-offset-2"
          >
            {t('kp.case.openGroup', { name: department })}
          </a>
        ) : null}
      </div>
    </section>
  );
}
