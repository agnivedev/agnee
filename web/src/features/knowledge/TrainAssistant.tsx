import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MessageSquarePlus, X, RotateCcw } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Markdown, diffLines } from './DocMarkdown';
import { productQuery } from './PlaybookProducts';

/**
 * Satu obrolan untuk mengubah semua tab Latih AI.
 *
 * Server (`/v1/train/chat`) hanya MENGUSULKAN. Tiap usulan tampil sebagai kartu
 * dan baru berlaku setelah Terapkan, yang memanggil rute biasa yang sama seperti
 * mengubah dengan tangan, jadi peran, batas ukuran, dan gerbang aktivasi tetap
 * berlaku. Dokumen yang dibaca AI ke semua customer tidak berubah karena
 * mengobrol.
 */

type Base = { id: string; summary: string };
export type Proposal =
  | (Base & { type: 'playbook_edit'; kind: string; productId: string | null; before: string; after: string })
  | (Base & { type: 'fact_upsert'; category: string; question: string; answer: string; priority: number; previousAnswer: string | null })
  | (Base & { type: 'fact_delete'; factId: string; previousAnswer: string | null })
  | (Base & { type: 'scenario_add'; name: string; persona: string; openingMessage: string; goal: string })
  | (Base & { type: 'scenario_delete'; scenarioId: string })
  | (Base & { type: 'brief_set'; before: string; after: string })
  | (Base & { type: 'ks_install'; code: string; source: string })
  | (Base & { type: 'ks_fill'; installId: string; categories: string[]; specific: Record<string, unknown>; problemsAfter: string[] })
  | (Base & { type: 'ks_simulate'; installId: string })
  | (Base & { type: 'ks_activate'; installId: string; active: boolean });

type Turn = { role: 'user' | 'assistant'; content: string };
type Message = { role: 'user' | 'assistant'; text: string; proposals?: Proposal[] };
type Outcome = { state: 'applying' | 'applied' | 'failed' | 'discarded'; note?: string };

/** Menerapkan satu usulan lewat rute yang sama dengan layar biasa. */
async function applyProposal(p: Proposal): Promise<string | undefined> {
  switch (p.type) {
    case 'playbook_edit':
      await api(`/v1/playbooks/${encodeURIComponent(p.kind)}${productQuery(p.productId)}`, { method: 'PUT', body: { contentMd: p.after } });
      return undefined;
    case 'fact_upsert':
      await api('/v1/coach/facts', { method: 'POST', body: { category: p.category, question: p.question, answer: p.answer, priority: p.priority } });
      return undefined;
    case 'fact_delete':
      await api(`/v1/coach/facts/${encodeURIComponent(p.factId)}`, { method: 'DELETE' });
      return undefined;
    case 'scenario_add':
      await api('/v1/coach/scenarios', { method: 'POST', body: { name: p.name, persona: p.persona, openingMessage: p.openingMessage, goal: p.goal } });
      return undefined;
    case 'scenario_delete':
      await api(`/v1/coach/scenarios/${encodeURIComponent(p.scenarioId)}`, { method: 'DELETE' });
      return undefined;
    case 'brief_set':
      await api('/v1/admin/playbook', { method: 'PUT', body: { brief: p.after } });
      return undefined;
    case 'ks_install':
      await api('/v1/ks/installs', { method: 'POST', body: { code: p.code, source: p.source } });
      return undefined;
    case 'ks_fill':
      await api(`/v1/ks/installs/${encodeURIComponent(p.installId)}/specific`, { method: 'PUT', body: { specific: p.specific } });
      return undefined;
    case 'ks_simulate':
      await api(`/v1/ks/installs/${encodeURIComponent(p.installId)}/simulate`, { method: 'POST' });
      return 'sim';
    case 'ks_activate':
      await api(`/v1/ks/installs/${encodeURIComponent(p.installId)}/activate`, { method: 'POST', body: { active: p.active } });
      return undefined;
  }
}

function ProposalCard({ proposal, outcome, onApply, onDiscard }: {
  proposal: Proposal;
  outcome?: Outcome;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  const textDiff = proposal.type === 'playbook_edit' || proposal.type === 'brief_set'
    ? diffLines(proposal.before, proposal.after)
    : null;

  const label = proposal.type === 'ks_activate'
    ? t(`trainChat.type.ks_activate_${proposal.active ? 'on' : 'off'}`)
    : t(`trainChat.type.${proposal.type}`);
  const heading = proposal.type === 'playbook_edit' ? `${label} · ${t(`playbook.kind.${proposal.kind}`)}` : label;
  const live = proposal.type === 'playbook_edit' || proposal.type === 'brief_set' || proposal.type === 'fact_upsert'
    || proposal.type === 'fact_delete' || proposal.type === 'ks_activate' || proposal.type === 'ks_fill';
  const settled = outcome?.state === 'applied' || outcome?.state === 'discarded';

  return (
    <div className={cn('grid gap-2 rounded-xl border p-3 text-[12px]', settled ? 'border-border bg-white/50 opacity-80' : 'border-green/40 bg-green/5')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-[12px]">{heading}</strong>
        {textDiff ? (
          <span className="font-mono text-[10px] text-muted">
            {t('trainChat.lines', { added: textDiff.added.size, removed: textDiff.removed })}
          </span>
        ) : null}
      </div>
      <p className="m-0 text-ink/80">{proposal.summary}</p>

      {proposal.type === 'fact_upsert' ? (
        <div className="grid gap-1 rounded-lg bg-white p-2">
          <span className="text-muted">{proposal.question}</span>
          {proposal.previousAnswer ? <span className="text-muted line-through">{proposal.previousAnswer}</span> : null}
          <strong>{proposal.answer}</strong>
        </div>
      ) : null}
      {proposal.type === 'fact_delete' && proposal.previousAnswer ? (
        <p className="m-0 rounded-lg bg-white p-2 text-muted line-through">{proposal.previousAnswer}</p>
      ) : null}
      {proposal.type === 'scenario_add' ? (
        <div className="grid gap-1 rounded-lg bg-white p-2">
          <span>“{proposal.openingMessage}”</span>
          {proposal.persona ? <span className="text-muted">{proposal.persona}</span> : null}
          {proposal.goal ? <span className="text-muted">→ {proposal.goal}</span> : null}
        </div>
      ) : null}
      {proposal.type === 'ks_fill' ? (
        <div className="grid gap-1 rounded-lg bg-white p-2">
          <span className="font-mono text-[11px]">{proposal.categories.join(', ')}</span>
          <span className={proposal.problemsAfter.length ? 'text-amber-900' : 'text-green-dark'}>
            {proposal.problemsAfter.length
              ? t('trainChat.fillProblems', { n: proposal.problemsAfter.length })
              : t('trainChat.fillComplete')}
          </span>
        </div>
      ) : null}
      {textDiff && (proposal.type === 'playbook_edit' || proposal.type === 'brief_set') ? (
        <details className="rounded-lg bg-white">
          <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-medium">{t('trainChat.showResult')}</summary>
          <div className="max-h-[36vh] overflow-y-auto p-2">
            <Markdown source={proposal.after} added={textDiff.added} />
          </div>
        </details>
      ) : null}

      {live && !settled ? <p className="m-0 text-[11px] text-amber-900/80">{t('trainChat.liveWarn')}</p> : null}

      {outcome?.state === 'applied' ? (
        <p className="m-0 font-medium text-green-dark">
          ✓ {t('trainChat.applied')}{outcome.note ? ` · ${outcome.note}` : ''}
        </p>
      ) : outcome?.state === 'discarded' ? (
        <p className="m-0 text-muted">{t('trainChat.discarded')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={outcome?.state === 'applying'} onClick={onApply}>
            {outcome?.state === 'applying' ? t('trainChat.applying') : t('trainChat.apply')}
          </Button>
          <Button size="sm" variant="outline" disabled={outcome?.state === 'applying'} onClick={onDiscard}>
            {t('trainChat.discard')}
          </Button>
          {outcome?.state === 'failed' ? <span className="text-danger">{outcome.note || t('trainChat.failedApply')}</span> : null}
        </div>
      )}
    </div>
  );
}

export function TrainAssistant({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  // Yang dikirim ke server: balasan asisten + catatan usulan yang ia buat.
  const [history, setHistory] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);

  const pending = useMemo(
    () => messages.flatMap((m) => m.proposals || []).filter((p) => !['applied', 'discarded'].includes(outcomes[p.id]?.state || '')).length,
    [messages, outcomes],
  );

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError('');
    setDraft('');
    setMessages((current) => [...current, { role: 'user', text: message }]);
    try {
      const result = await api<{ reply: string; memo: string; proposals: Proposal[] }>('/v1/train/chat', {
        method: 'POST', body: { message, history: history.slice(-20) },
      });
      setMessages((current) => [...current, { role: 'assistant', text: result.reply, proposals: result.proposals }]);
      setHistory((current) => [...current, { role: 'user', content: message }, { role: 'assistant', content: result.memo }]);
    } catch (failure) {
      setError(messageFromError(failure, t('trainChat.failed')));
    } finally {
      setBusy(false);
    }
  }

  async function apply(proposal: Proposal) {
    setOutcomes((current) => ({ ...current, [proposal.id]: { state: 'applying' } }));
    try {
      const note = await applyProposal(proposal);
      setOutcomes((current) => ({
        ...current,
        [proposal.id]: { state: 'applied', note: note === 'sim' ? t('trainChat.simStarted') : undefined },
      }));
      onChanged();
    } catch (failure) {
      setOutcomes((current) => ({
        ...current,
        [proposal.id]: { state: 'failed', note: messageFromError(failure, t('trainChat.failedApply')) },
      }));
    }
  }

  function reset() {
    setMessages([]);
    setHistory([]);
    setOutcomes({});
    setError('');
  }

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-5 bottom-5 z-40 flex cursor-pointer items-center gap-2 rounded-full border-0 bg-ink px-4 py-3 text-[13px] font-medium text-white shadow-lg transition hover:opacity-90"
        >
          <MessageSquarePlus aria-hidden className="size-4" />
          {t('trainChat.open')}
          {pending ? <span className="rounded-full bg-green px-1.5 text-[11px] text-ink">{pending}</span> : null}
        </button>
      ) : null}

      <aside
        aria-label={t('trainChat.title')}
        aria-hidden={!open}
        className={cn(
          'fixed top-0 right-0 z-50 flex h-dvh w-[min(440px,100vw)] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200',
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        )}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="m-0 text-[15px]">{t('trainChat.title')}</h2>
          <div className="flex gap-1">
            <button
              type="button" onClick={reset} disabled={busy || !messages.length} title={t('trainChat.reset')} aria-label={t('trainChat.reset')}
              className="cursor-pointer rounded-lg border-0 bg-transparent p-2 text-muted hover:text-ink disabled:opacity-40"
            >
              <RotateCcw aria-hidden className="size-4" />
            </button>
            <button
              type="button" onClick={() => setOpen(false)} title={t('trainChat.close')} aria-label={t('trainChat.close')}
              className="cursor-pointer rounded-lg border-0 bg-transparent p-2 text-muted hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </header>

        <div ref={listRef} className="grid flex-1 content-start gap-3 overflow-y-auto px-4 py-4">
          {!messages.length ? (
            <div className="grid gap-2 text-[13px] text-muted">
              <p className="m-0">{t('trainChat.intro')}</p>
              <p className="m-0 text-[12px]">{t('trainChat.examples')}</p>
            </div>
          ) : null}
          {messages.map((message, index) => (
            <div key={`${index}-${message.text.slice(0, 8)}`} className="grid gap-2">
              <div
                className={cn(
                  'max-w-[88%] rounded-[14px] px-3 py-2 text-[13px] whitespace-pre-wrap',
                  message.role === 'user' ? 'justify-self-end bg-[#d9ffd6]' : 'justify-self-start bg-white',
                )}
              >
                {message.text}
              </div>
              {(message.proposals || []).map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  outcome={outcomes[proposal.id]}
                  onApply={() => void apply(proposal)}
                  onDiscard={() => setOutcomes((current) => ({ ...current, [proposal.id]: { state: 'discarded' } }))}
                />
              ))}
            </div>
          ))}
          {busy ? <p className="m-0 animate-pulse text-[12px] text-muted">{t('trainChat.thinking')}</p> : null}
          {error ? <p className="m-0 text-[12px] text-danger">{error}</p> : null}
        </div>

        <form onSubmit={send} className="flex gap-2 border-t border-border p-3">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('trainChat.placeholder')}
            maxLength={4000}
            disabled={busy}
            className="min-w-0 flex-1 rounded-xl border border-border bg-white px-3 py-2 text-[13px]"
          />
          <Button type="submit" size="sm" disabled={busy || !draft.trim()}>{t('trainChat.send')}</Button>
        </form>
      </aside>
    </>
  );
}
