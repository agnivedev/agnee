import { useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusLine } from '@/features/settings/parts';
import { FACT_CATEGORIES, type FactCategory } from './factCategories';

type Draft = { question: string; answer: string; category: FactCategory };
type DraftResponse = {
  decision: 'fact' | 'discard';
  reason: string;
  draft: Draft | null;
  problems: string[];
  needsEdit: boolean;
};
type SimRow = {
  question: string;
  before: string | null;
  after: string | null;
  judge?: { verdict: 'pass' | 'fail' } | null;
};
type SimResponse = { rows: SimRow[]; blocked: boolean; reasons: string[]; judgeWarnings: number };

type Phase = 'idle' | 'rejected' | 'discarded' | 'draft' | 'applied';

type Props = {
  customerMessage: string;
  suggestedReply: string;
  aiReply?: string;
  issues?: string[];
};

/**
 * Aksi atas saran balasan: Terima perbaikan, Biar AI putuskan, Tolak.
 * Saran disaring jadi satu Fakta, disimulasikan sebelum/sesudah, baru diterapkan;
 * server menolak "Terapkan" tanpa simulasi segar untuk isi yang sama.
 */
export function SuggestionActions({ customerMessage, suggestedReply, aiReply, issues }: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState<'draft' | 'simulate' | 'apply' | null>(null);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState<Draft>({ question: '', answer: '', category: 'faq' });
  const [problems, setProblems] = useState<string[]>([]);
  const [sim, setSim] = useState<SimResponse | null>(null);
  // Isi yang sudah disimulasikan; beda dengan isi sekarang = simulasi kedaluwarsa.
  const [simulated, setSimulated] = useState('');

  const signature = (value: Draft) => JSON.stringify([value.question.trim(), value.answer.trim(), value.category]);
  const stale = Boolean(sim) && simulated !== signature(draft);

  function edit(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setProblems([]);
  }

  async function simulate(value: Draft) {
    setBusy('simulate');
    setStatus('');
    try {
      const data = await api<SimResponse>('/v1/coach/suggestion/simulate', {
        method: 'POST',
        body: { ...value, customerMessage },
      });
      setSim(data);
      setSimulated(signature(value));
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(null);
    }
  }

  async function start(mode: 'accept' | 'auto') {
    setBusy('draft');
    setStatus('');
    setSim(null);
    try {
      const data = await api<DraftResponse>('/v1/coach/suggestion/draft', {
        method: 'POST',
        body: { mode, customerMessage, suggestedReply, aiReply: aiReply || undefined, issues },
      });
      if (data.decision === 'discard' || !data.draft) {
        setReason(data.reason);
        setPhase('discarded');
        return;
      }
      setDraft(data.draft);
      setReason(data.reason);
      setProblems(data.problems);
      setPhase('draft');
      // "Biar AI putuskan" jalan terus sampai simulasi bila drafnya bersih.
      if (mode === 'auto' && !data.problems.length) {
        setBusy(null);
        await simulate(data.draft);
      }
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy('apply');
    setStatus('');
    try {
      await api('/v1/coach/suggestion/apply', { method: 'POST', body: { ...draft, customerMessage } });
      setPhase('applied');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(null);
    }
  }

  if (phase === 'rejected') {
    return (
      <div className="mt-2 flex items-center gap-3 text-[12px] text-muted">
        <span>{t('coach.sug.rejected')}</span>
        <Button size="sm" variant="outline" onClick={() => setPhase('idle')}>
          {t('coach.sug.undo')}
        </Button>
      </div>
    );
  }

  if (phase === 'applied') {
    return <p className="mt-2 mb-0 text-[12px] font-semibold text-green-dark">{t('coach.sug.applied')}</p>;
  }

  const canApply = Boolean(sim) && !stale && !sim?.blocked && !problems.length;

  return (
    <div className="mt-2 grid gap-2">
      {phase === 'idle' || phase === 'discarded' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void start('accept')}>
            {t('coach.sug.accept')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void start('auto')}>
            {t('coach.sug.auto')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setPhase('rejected')}>
            {t('coach.sug.reject')}
          </Button>
          {busy === 'draft' ? <StatusLine>{t('coach.sug.working')}</StatusLine> : null}
        </div>
      ) : null}

      {phase === 'discarded' ? <StatusLine>{t('coach.sug.discarded', { reason })}</StatusLine> : null}

      {phase === 'draft' ? (
        <div className="grid gap-2 rounded-xl border border-border bg-white p-3">
          <h5 className="m-0 text-[12px] font-semibold">{t('coach.sug.draftTitle')}</h5>
          {reason ? <p className="m-0 text-[12px] text-muted">{reason}</p> : null}

          <label className="grid gap-1 text-[12px] font-semibold">
            <span>{t('coach.sug.category')}</span>
            <select
              value={draft.category}
              onChange={(event) => edit({ category: event.target.value as FactCategory })}
              className="w-fit rounded-app border border-input bg-white px-2 py-2 text-sm font-normal"
            >
              {FACT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`coach.cat.${category}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">
            <span>{t('coach.sug.question')}</span>
            <Input
              value={draft.question}
              maxLength={400}
              onChange={(event) => edit({ question: event.target.value })}
              className="py-2 font-normal"
            />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">
            <span>{t('coach.sug.answer')}</span>
            <textarea
              rows={3}
              maxLength={1200}
              value={draft.answer}
              onChange={(event) => edit({ answer: event.target.value })}
              className="w-full rounded-app border border-input bg-white p-2 text-sm font-normal"
            />
          </label>

          {problems.length ? (
            <ul className="m-0 grid gap-1 pl-4 text-[12px] text-danger">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void simulate(draft)}>
              {busy === 'simulate' ? t('coach.sug.simulating') : t('coach.sug.simulate')}
            </Button>
            <Button size="sm" disabled={busy !== null || !canApply} onClick={() => void apply()}>
              {busy === 'apply' ? t('coach.sug.applying') : t('coach.sug.apply')}
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setPhase('rejected')}>
              {t('coach.sug.reject')}
            </Button>
          </div>

          {stale ? <StatusLine>{t('coach.sug.stale')}</StatusLine> : null}
          {sim?.blocked ? <StatusLine tone="error">{t('coach.sug.blocked', { reasons: sim.reasons.join(' ') })}</StatusLine> : null}
          {sim && !sim.blocked && sim.judgeWarnings ? (
            <StatusLine>{t('coach.sug.judgeWarn', { count: String(sim.judgeWarnings) })}</StatusLine>
          ) : null}

          {sim ? (
            <div className="grid gap-2">
              {sim.rows.map((row) => (
                <div key={row.question} className="rounded-xl border border-border bg-white/70 p-2.5">
                  <p className="m-0 mb-1.5 font-mono text-[11px] text-muted">“{row.question}”</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {[
                      [t('coach.sug.before'), row.before],
                      [t('coach.sug.after'), row.after],
                    ].map(([title, body]) => (
                      <div key={title} className="rounded-lg border border-border bg-white p-2">
                        <h6 className="m-0 mb-0.5 text-[11px] font-semibold">{title}</h6>
                        <p className="m-0 text-[12px] leading-[1.5]">{body || '–'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <StatusLine tone="error">{status}</StatusLine>
    </div>
  );
}
