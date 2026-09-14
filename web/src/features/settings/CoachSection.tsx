import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { SettingCard, StatusLine } from './parts';

type Fact = { id: string; category: string; question: string; answer?: string | null; priority?: number };
type Scenario = { id: string; name: string; persona?: string; openingMessage: string; goal?: string };
type Turn = { role: 'customer' | 'agent'; text: string };

type Judge = {
  verdict: 'pass' | 'fail';
  overall: number;
  scores: { accuracy: number; helpfulness: number; funnel: number; tone: number };
  strengths?: string[];
  issues?: string[];
  suggestedReply?: string;
};

type JudgeResult = {
  reply: string;
  aiReply?: string;
  judge?: Judge;
  rules?: { passed: boolean; warnings: string[] };
  newGaps?: { question: string }[];
};

type ReviewEntry = {
  id: string;
  author: string;
  authorName?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
  inReplyTo?: string | null;
  body: string;
};

type ReviewSummary = {
  name: string;
  mode: string;
  avgOverall: number | null;
  avgAccuracy: number | null;
  graded: number;
};

const CATEGORIES = ['profile', 'product', 'pricing', 'faq', 'funnel', 'objection', 'closing'] as const;
type CoachTab = 'truth' | 'scenarios' | 'simulate' | 'review';

export function CoachSection() {
  const { t } = useI18n();
  const [tab, setTab] = useState<CoachTab>('truth');
  const [facts, setFacts] = useState<Fact[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  const loadFacts = useCallback(async () => {
    const data = await api<{ facts: Fact[] }>('/v1/coach/facts');
    setFacts(data.facts || []);
  }, []);

  const loadScenarios = useCallback(async () => {
    const data = await api<{ scenarios: Scenario[] }>('/v1/coach/scenarios');
    setScenarios(data.scenarios || []);
  }, []);

  useEffect(() => {
    void loadFacts().catch(() => {});
    void loadScenarios().catch(() => {});
  }, [loadFacts, loadScenarios]);

  const answered = facts.filter((fact) => fact.answer && fact.answer.trim());

  const TABS: { id: CoachTab; label: string }[] = [
    { id: 'truth', label: t('coach.tabTruth') },
    { id: 'scenarios', label: t('coach.tabScenarios') },
    { id: 'simulate', label: t('coach.tabSimulate') },
    { id: 'review', label: t('coach.tabReview') },
  ];

  return (
    <SettingCard
      id="coachSection"
      eyebrow={t('coach.eyebrow')}
      title={t('coach.title')}
      badge={facts.length ? t('coach.coverage', { answered: answered.length, total: facts.length }) : t('coach.notReady')}
      badgeTone={facts.length ? 'on' : 'off'}
    >
      <div className="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              'cursor-pointer border-0 border-b-2 bg-transparent px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              tab === entry.id ? 'border-b-green text-ink' : 'border-b-transparent text-muted hover:text-ink',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'truth' ? <TruthPane facts={facts} reload={loadFacts} /> : null}
      {tab === 'scenarios' ? <ScenarioPane scenarios={scenarios} reload={loadScenarios} /> : null}
      {tab === 'simulate' ? <SimulatePane scenarios={scenarios} onNewGaps={() => void loadFacts()} /> : null}
      {tab === 'review' ? <ReviewPane onNewGaps={() => void loadFacts()} /> : null}
    </SettingCard>
  );
}

// ── Source of truth ─────────────────────────────────────────────────────────

function TruthPane({ facts, reload }: { facts: Fact[]; reload: () => Promise<void> }) {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  const [focus, setFocus] = useState('');
  const [asking, setAsking] = useState(false);
  const [showAnswered, setShowAnswered] = useState(false);

  const open = facts.filter((fact) => !fact.answer || !fact.answer.trim());
  const answered = facts.filter((fact) => fact.answer && fact.answer.trim());

  async function ask() {
    setAsking(true);
    setStatus(t('coach.asking'));
    try {
      const data = await api<{ questions?: unknown[] }>('/v1/coach/interview', {
        method: 'POST',
        body: focus ? { focus } : {},
      });
      const count = (data.questions || []).length;
      setStatus(count ? t('coach.askedNew', { count }) : t('coach.askedNone'));
      await reload();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setAsking(false);
    }
  }

  async function addManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    try {
      await api('/v1/coach/facts', {
        method: 'POST',
        body: {
          category: form.get('category'),
          question: String(form.get('question')).trim(),
          answer: String(form.get('answer') || '').trim() || null,
        },
      });
      element.reset();
      setStatus(t('coach.factSaved'));
      await reload();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={asking} onClick={() => void ask()}>
          {t('coach.askButton')}
        </Button>
        <select
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          className="rounded-[10px] border border-border bg-white px-2.5 py-2 font-mono text-xs"
        >
          <option value="">{t('coach.focusAll')}</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`coach.cat.${category}`)}
            </option>
          ))}
        </select>
        <StatusLine>{status}</StatusLine>
      </div>

      <div className="grid gap-2">
        {open.length ? (
          open.map((fact) => <FactRow key={fact.id} fact={fact} reload={reload} onStatus={setStatus} editable />)
        ) : (
          <p className="m-0 text-[13px] text-muted">{facts.length ? t('coach.allAnswered') : t('coach.nothingYet')}</p>
        )}
      </div>

      <form onSubmit={addManual} className="grid gap-2 rounded-xl border border-border bg-white/40 p-4 md:grid-cols-[140px_1fr]">
        <select name="category" defaultValue="faq" className="rounded-app border border-input bg-white px-2 py-2 text-sm">
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {t(`coach.cat.${category}`)}
            </option>
          ))}
        </select>
        <Input name="question" required placeholder={t('coach.questionPlaceholder')} className="py-2" />
        <textarea
          name="answer"
          rows={2}
          maxLength={4000}
          placeholder={t('coach.answerPlaceholder')}
          className="w-full rounded-app border border-input bg-white p-2 text-sm md:col-span-2"
        />
        <Button type="submit" size="sm" className="md:col-span-2 md:justify-self-start">
          {t('coach.addFact')}
        </Button>
      </form>

      <div>
        <button
          type="button"
          onClick={() => setShowAnswered((current) => !current)}
          className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-green-dark"
        >
          {showAnswered ? '▾' : '▸'} {t('coach.answeredCount', { count: answered.length })}
        </button>
        {showAnswered ? (
          <div className="mt-2 grid gap-2">
            {answered.map((fact) => (
              <FactRow key={fact.id} fact={fact} reload={reload} onStatus={setStatus} editable={false} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FactRow({
  fact,
  editable,
  reload,
  onStatus,
}: {
  fact: Fact;
  editable: boolean;
  reload: () => Promise<void>;
  onStatus: (message: string) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [answer, setAnswer] = useState(fact.answer || '');
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-white/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold',
            fact.priority === 1 ? 'bg-lime text-ink' : 'bg-ink/8 text-muted',
          )}
        >
          {t(`coach.cat.${fact.category}`)}
        </span>
        <span className="text-[13px] font-semibold">{fact.question}</span>
      </div>

      {editable ? (
        <>
          <textarea
            rows={2}
            maxLength={4000}
            value={answer}
            placeholder={t('coach.answerPlaceholder')}
            onChange={(event) => setAnswer(event.target.value)}
            className="w-full rounded-app border border-input bg-white p-2 text-sm"
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={saving}
              onClick={async () => {
                if (!answer.trim()) {
                  onStatus(t('coach.answerEmpty'));
                  return;
                }
                setSaving(true);
                try {
                  await api('/v1/coach/facts', {
                    method: 'POST',
                    body: { category: fact.category, question: fact.question, answer: answer.trim(), priority: fact.priority },
                  });
                  onStatus(t('settings.saved'));
                  await reload();
                } catch (error) {
                  onStatus(messageFromError(error, ''));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {t('common.save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const ok = await confirm.confirm({
                  title: t('dialog.deleteFactTitle'),
                  message: t('dialog.deleteFactCopy'),
                  confirmLabel: t('dialog.deleteConfirm'),
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api(`/v1/coach/facts/${fact.id}`, { method: 'DELETE' });
                  await reload();
                } catch (error) {
                  onStatus(messageFromError(error, ''));
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </div>
        </>
      ) : (
        <p className="m-0 text-[13px] leading-[1.55] text-muted">{fact.answer}</p>
      )}
    </div>
  );
}

// ── Scenarios ───────────────────────────────────────────────────────────────

function ScenarioPane({ scenarios, reload }: { scenarios: Scenario[]; reload: () => Promise<void> }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [status, setStatus] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    try {
      await api('/v1/coach/scenarios', {
        method: 'POST',
        body: {
          name: String(form.get('name')).trim(),
          persona: String(form.get('persona') || '').trim(),
          openingMessage: String(form.get('openingMessage')).trim(),
          goal: String(form.get('goal') || '').trim(),
        },
      });
      element.reset();
      setStatus(t('coach.scenarioSaved'));
      await reload();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        {scenarios.length ? (
          scenarios.map((scenario) => (
            <div key={scenario.id} className="rounded-xl border border-border bg-white/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-[13px]">{scenario.name}</strong>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm.confirm({
                      title: t('dialog.deleteScenarioTitle'),
                      message: t('dialog.deleteScenarioCopy', { name: scenario.name }),
                      confirmLabel: t('dialog.deleteConfirm'),
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await api(`/v1/coach/scenarios/${scenario.id}`, { method: 'DELETE' });
                      await reload();
                    } catch (error) {
                      setStatus(messageFromError(error, ''));
                    }
                  }}
                >
                  {t('common.delete')}
                </Button>
              </div>
              <p className="mt-1.5 mb-0 text-[12px] leading-[1.55] text-muted">
                {[
                  scenario.persona && t('coach.persona', { value: scenario.persona }),
                  t('coach.opening', { value: scenario.openingMessage }),
                  scenario.goal && t('coach.goal', { value: scenario.goal }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          ))
        ) : (
          <p className="m-0 text-[13px] text-muted">{t('coach.noScenarios')}</p>
        )}
      </div>

      <form onSubmit={save} className="grid gap-2 rounded-xl border border-border bg-white/40 p-4 md:grid-cols-2">
        <Input name="name" required placeholder={t('coach.scenarioName')} className="py-2" />
        <Input name="persona" placeholder={t('coach.scenarioPersona')} className="py-2" />
        <Input name="openingMessage" required placeholder={t('coach.scenarioOpening')} className="py-2 md:col-span-2" />
        <Input name="goal" placeholder={t('coach.scenarioGoal')} className="py-2 md:col-span-2" />
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" size="sm">
            {t('coach.addScenario')}
          </Button>
          <StatusLine>{status}</StatusLine>
        </div>
      </form>
    </div>
  );
}

// ── Simulation ──────────────────────────────────────────────────────────────

function SimulatePane({ scenarios, onNewGaps }: { scenarios: Scenario[]; onNewGaps: () => void }) {
  const { t } = useI18n();
  // The running simulated conversation, so the AI sees real multi-turn context.
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [scenarioId, setScenarioId] = useState('');
  const [mode, setMode] = useState<'ai' | 'human'>('ai');
  const [customerMessage, setCustomerMessage] = useState('');
  const [humanReply, setHumanReply] = useState('');
  const [compare, setCompare] = useState(true);
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);

  function reset(nextScenarioId = scenarioId) {
    setTranscript([]);
    setResult(null);
    setHumanReply('');
    setStatus('');
    const scenario = scenarios.find((item) => item.id === nextScenarioId);
    setCustomerMessage(scenario?.openingMessage || '');
  }

  async function run() {
    const message = customerMessage.trim();
    if (!message) {
      setStatus(t('coach.needCustomerMessage'));
      return;
    }
    if (mode === 'human' && !humanReply.trim()) {
      setStatus(t('coach.needYourReply'));
      return;
    }
    setRunning(true);
    setStatus(t('coach.grading'));
    try {
      const data = await api<JudgeResult>('/v1/coach/simulate', {
        method: 'POST',
        body: {
          mode,
          customerMessage: message,
          humanReply: mode === 'human' ? humanReply.trim() : undefined,
          transcript,
          scenarioId: scenarioId || null,
          compareWithAi: mode === 'human' && compare,
        },
      });
      setTranscript((current) => [...current, { role: 'customer', text: message }, { role: 'agent', text: data.reply }]);
      setResult(data);
      setCustomerMessage('');
      setHumanReply('');
      setStatus('');
      if (data.newGaps?.length) onNewGaps();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={scenarioId}
          onChange={(event) => {
            setScenarioId(event.target.value);
            reset(event.target.value);
          }}
          className="rounded-[10px] border border-border bg-white px-2.5 py-2 font-mono text-xs"
        >
          <option value="">{t('coach.noScenario')}</option>
          {scenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => reset()}>
          {t('coach.restart')}
        </Button>
      </div>

      <div aria-live="polite" className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-border bg-white/50 p-3">
        {transcript.length ? (
          transcript.map((turn, index) => (
            <div
              key={index}
              className={cn(
                'max-w-[80%] rounded-xl px-3 py-2 text-[13px]',
                turn.role === 'customer' ? 'self-start bg-white' : 'self-end bg-[#d9ffd6]',
              )}
            >
              <small className="mb-0.5 block font-mono text-[9px] text-muted">
                {turn.role === 'customer' ? 'Customer' : 'CS'}
              </small>
              {turn.text}
            </div>
          ))
        ) : (
          <p className="m-0 text-[12px] text-muted">{t('coach.transcriptEmpty')}</p>
        )}
      </div>

      <label className="grid gap-1.5 text-[13px] font-semibold">
        <span>{t('coach.customerMessage')}</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={customerMessage}
          placeholder={t('coach.customerPlaceholder')}
          onChange={(event) => setCustomerMessage(event.target.value)}
          className="w-full rounded-app border border-input bg-white p-2 text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-3 text-[13px]">
        {(['ai', 'human'] as const).map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name="coachMode"
              checked={mode === option}
              onChange={() => setMode(option)}
              className="accent-green"
            />
            <span>{option === 'ai' ? t('coach.modeAi') : t('coach.modeHuman')}</span>
          </label>
        ))}
      </div>

      {mode === 'human' ? (
        <div className="grid gap-2">
          <textarea
            rows={3}
            maxLength={4000}
            value={humanReply}
            placeholder={t('coach.yourReplyPlaceholder')}
            onChange={(event) => setHumanReply(event.target.value)}
            className="w-full rounded-app border border-input bg-white p-2 text-sm"
          />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} className="accent-green" />
            <span>{t('coach.compareWithAi')}</span>
          </label>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={running} onClick={() => void run()}>
          {t('coach.sendAndGrade')}
        </Button>
        <StatusLine>{status}</StatusLine>
      </div>

      {result ? <JudgeView data={result} /> : null}
    </div>
  );
}

// ── Judge rendering, shared by simulate and review ──────────────────────────

function ScoreTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div
      className={cn(
        'grid place-items-center rounded-xl border border-border bg-white p-2.5 text-center',
        value !== null && value <= 2 && 'border-danger/35 bg-danger/6',
        value !== null && value === 3 && 'border-[#d59b34]/35 bg-[#d59b34]/8',
      )}
    >
      <b className="text-lg">{value === null ? '–' : value}</b>
      <span className="font-mono text-[9px] text-muted">{label}</span>
    </div>
  );
}

function FeedbackList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <h4 className="m-0 mb-1 text-[12px] font-semibold">{title}</h4>
      <ul className="m-0 grid gap-1 pl-4 text-[12px] leading-[1.5] text-muted">
        {items.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </div>
  );
}

function JudgeView({ data }: { data: JudgeResult }) {
  const { t } = useI18n();
  const judge = data.judge;
  return (
    <div className="rounded-xl border border-border bg-white/70 p-4">
      {judge ? (
        <>
          <span
            className={cn(
              'inline-block rounded-full px-3 py-1 font-mono text-[10px] font-semibold',
              judge.verdict === 'pass' ? 'bg-green/14 text-green-dark' : 'bg-danger/12 text-danger',
            )}
          >
            {judge.verdict === 'pass'
              ? t('coach.verdictPass', { overall: judge.overall })
              : t('coach.verdictFail', { overall: judge.overall })}
          </span>
          <div className="mt-3 grid grid-cols-4 gap-2">
            <ScoreTile label={t('coach.scoreAccuracy')} value={judge.scores.accuracy} />
            <ScoreTile label={t('coach.scoreHelpfulness')} value={judge.scores.helpfulness} />
            <ScoreTile label={t('coach.scoreFunnel')} value={judge.scores.funnel} />
            <ScoreTile label={t('coach.scoreTone')} value={judge.scores.tone} />
          </div>
        </>
      ) : null}

      {data.rules && !data.rules.passed ? <FeedbackList title={t('coach.styleIssues')} items={data.rules.warnings} /> : null}
      <FeedbackList title={t('coach.strengths')} items={judge?.strengths} />
      <FeedbackList title={t('coach.issues')} items={judge?.issues} />
      <FeedbackList title={t('coach.newGaps')} items={data.newGaps?.map((gap) => gap.question)} />

      {judge?.suggestedReply ? (
        <div className="mt-3 rounded-xl border border-border bg-white p-3">
          <h5 className="m-0 mb-1 text-[12px] font-semibold">{t('coach.suggestedReply')}</h5>
          <p className="m-0 text-[13px] leading-[1.55]">{judge.suggestedReply}</p>
        </div>
      ) : null}

      {/* Only simulate mode has a second reply to compare against. */}
      {data.aiReply ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {[
            [t('coach.aiReply'), data.aiReply],
            [t('coach.yourReply'), data.reply],
          ].map(([title, body]) => (
            <div key={title} className="rounded-xl border border-border bg-white p-3">
              <h5 className="m-0 mb-1 text-[12px] font-semibold">{title}</h5>
              <p className="m-0 text-[13px] leading-[1.55]">{body}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Review queue ────────────────────────────────────────────────────────────

function ReviewPane({ onNewGaps }: { onNewGaps: () => void }) {
  const { t } = useI18n();
  // The server's enum is human|ai with no "all" — sending an empty value is a 400.
  const [author, setAuthor] = useState<'human' | 'ai'>('human');
  const [includeDone, setIncludeDone] = useState(false);
  const [summary, setSummary] = useState<ReviewSummary[]>([]);
  const [replies, setReplies] = useState<ReviewEntry[]>([]);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setStatus(t('common.loading'));
    try {
      const params = new URLSearchParams({ author, includeReviewed: String(includeDone) });
      const data = await api<{ summary?: ReviewSummary[]; replies?: ReviewEntry[] }>(
        `/v1/coach/review-queue?${params}`,
      );
      setSummary(data.summary || []);
      setReplies(data.replies || []);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, [author, includeDone, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={author}
          onChange={(event) => setAuthor(event.target.value as 'human' | 'ai')}
          className="rounded-[10px] border border-border bg-white px-2.5 py-2 font-mono text-xs"
        >
          <option value="human">{t('coach.authorAgent')}</option>
          <option value="ai">{t('coach.authorAi')}</option>
        </select>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={includeDone} onChange={(event) => setIncludeDone(event.target.checked)} className="accent-green" />
          <span>{t('coach.showGraded')}</span>
        </label>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
        <StatusLine>{status}</StatusLine>
      </div>

      {summary.length ? (
        <div className="grid gap-2">
          {summary.map((row, index) => (
            <div key={index} className="rounded-xl border border-border bg-white/60 p-3">
              <strong className="text-[13px]">{`${row.name} · ${row.mode}`}</strong>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <ScoreTile label={t('coach.scoreAverage')} value={row.avgOverall === null ? null : Math.round(Number(row.avgOverall))} />
                <ScoreTile label={t('coach.scoreAccuracy')} value={row.avgAccuracy === null ? null : Math.round(Number(row.avgAccuracy))} />
                <ScoreTile label={t('coach.scoreGraded')} value={row.graded} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2">
        {replies.length ? (
          replies.map((entry) => <ReviewRow key={entry.id} entry={entry} onNewGaps={onNewGaps} onStatus={setStatus} />)
        ) : (
          <p className="m-0 text-[13px] text-muted">{includeDone ? t('coach.noReplies') : t('coach.nothingToGrade')}</p>
        )}
      </div>
    </div>
  );
}

function ReviewRow({
  entry,
  onNewGaps,
  onStatus,
}: {
  entry: ReviewEntry;
  onNewGaps: () => void;
  onStatus: (message: string) => void;
}) {
  const { t } = useI18n();
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<JudgeResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [graded, setGraded] = useState(Boolean(entry.reviewedAt));

  return (
    <div className="rounded-xl border border-border bg-white/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink/8 px-2 py-0.5 font-mono text-[10px] font-semibold">
          {entry.authorName || (entry.author === 'ai' ? 'AI' : 'Agent')}
        </span>
        <span className="font-mono text-[11px] text-muted">{new Date(entry.createdAt).toLocaleString('id-ID')}</span>
        {graded ? (
          <span className="rounded-full bg-green/14 px-2 py-0.5 font-mono text-[10px] font-semibold text-green-dark">
            {t('coach.alreadyGraded')}
          </span>
        ) : null}
      </div>

      {entry.inReplyTo ? (
        <p className="m-0 text-[12px] text-muted">{t('coach.customerSaid', { text: entry.inReplyTo })}</p>
      ) : null}
      <p className="mt-1 mb-2 text-[13px] leading-[1.55]">{t('coach.replyWas', { text: entry.body })}</p>

      {/* Older replies predate attribution, so the customer message may be missing. */}
      {!entry.inReplyTo ? (
        <Input
          value={manual}
          maxLength={4000}
          placeholder={t('coach.manualCustomerMessage')}
          onChange={(event) => setManual(event.target.value)}
          className="mb-2 py-2"
        />
      ) : null}

      <Button
        size="sm"
        disabled={grading}
        onClick={async () => {
          setGrading(true);
          try {
            const data = await api<JudgeResult>(`/v1/coach/review/${entry.id}`, {
              method: 'POST',
              body: manual.trim() ? { customerMessage: manual.trim() } : {},
            });
            setResult(data);
            setGraded(true);
            if (data.newGaps?.length) onNewGaps();
          } catch (error) {
            onStatus(messageFromError(error, ''));
          } finally {
            setGrading(false);
          }
        }}
      >
        {graded ? t('coach.regrade') : t('coach.grade')}
      </Button>

      {result ? (
        <div className="mt-3">
          <JudgeView data={result} />
        </div>
      ) : null}
    </div>
  );
}
