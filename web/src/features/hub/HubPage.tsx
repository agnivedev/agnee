import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, ExternalLink, Handshake, Loader2, Sparkles, StickyNote } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { subscribeLiveEvent } from '@/lib/live-events';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NoteThread } from '@/components/mentions/NoteThread';
import { cn } from '@/lib/utils';

/**
 * Agnee Express, Fase 1: the Agnive Hub inbox for Agnive staff.
 *
 * A copy of each funder ↔ research-team conversation, delivered by Insight
 * (see /webhook/insight). Read-only on purpose: the research team owns the
 * conversation and replies from Agnive Insight. Here supervisors follow it,
 * talk it over in internal notes (with @mentions and @AI), and can ask for a
 * draft to pass on to the team.
 */

type HubContext = {
  listingSlug?: string;
  listingTitle?: string | null;
  productName?: string | null;
  teamName?: string | null;
  listingUrl?: string;
  kind?: string;
  amount?: number | null;
};

type ThreadSummary = {
  id: string;
  status: 'open' | 'closed';
  contactName: string | null;
  contactEmail: string | null;
  contactOrg: string | null;
  context: HubContext;
  anonymizedAt: string | null;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  lastAuthor: 'contact' | 'team' | null;
};

type ThreadDetail = Omit<ThreadSummary, 'messageCount' | 'lastAuthor'> & {
  messages: { externalId: string; author: 'contact' | 'team'; authorName: string | null; body: string; occurredAt: string }[];
};

type Source = { source: string; name: string; enabled: boolean; lastReceivedAt: string | null; threadCount: number };

type Filter = 'awaiting' | 'open' | 'all' | 'closed';
const FILTERS: Filter[] = ['awaiting', 'open', 'all', 'closed'];

/** Server-sent events carry their payload as JSON text. */
function eventData<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

const awaitingTeam = (t: ThreadSummary) => t.status === 'open' && t.lastAuthor === 'contact';
const rupiah = (n: number) => `Rp${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;

export function HubPage() {
  const { t, locale } = useI18n();
  const { isSupervisor } = useSession();
  usePageTitle('hub.title');
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('thread');

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [filter, setFilter] = useState<Filter>('awaiting');
  const [status, setStatus] = useState(t('common.loading'));

  const loadList = useCallback(async () => {
    try {
      const [list, sources] = await Promise.all([
        api<{ threads: ThreadSummary[] }>('/v1/external/threads?source=hub&limit=100'),
        api<{ sources: Source[] }>('/v1/integrations/sources'),
      ]);
      setThreads(list.threads || []);
      setSource(sources.sources.find((s) => s.source === 'hub') || null);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, []);

  useEffect(() => {
    if (isSupervisor) void loadList();
  }, [isSupervisor, loadList]);
  useEffect(() => subscribeLiveEvent('hub', () => { void loadList(); }), [loadList]);

  const visible = useMemo(() => threads.filter((th) => {
    if (filter === 'awaiting') return awaitingTeam(th);
    if (filter === 'open') return th.status === 'open';
    if (filter === 'closed') return th.status === 'closed';
    return true;
  }), [threads, filter]);
  const counts = useMemo(() => ({
    awaiting: threads.filter(awaitingTeam).length,
    open: threads.filter((th) => th.status === 'open').length,
    all: threads.length,
    closed: threads.filter((th) => th.status === 'closed').length,
  }), [threads]);

  const dateLocale = locale === 'en' ? 'en-US' : 'id-ID';
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const open = (id: string | null) => setParams(id ? { thread: id } : {}, { replace: false });

  if (!isSupervisor) {
    return (
      <div className="flex min-h-dvh flex-col bg-background md:flex-row">
        <AppSidebar />
        <main className="min-w-0 flex-1 px-6 py-8 sm:px-10">
          <p className="text-sm text-muted">{t('hub.teamReplies')}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <header className={cn('mb-5', selectedId && 'max-lg:hidden')}>
          <p className="eyebrow">{t('hub.eyebrow')}</p>
          <h1 className="m-0 text-[26px] tracking-[-.03em]">{t('hub.title')}</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted">{t('hub.subtitle')}</p>
        </header>

        {source && !source.enabled && (
          <p className="mb-4 rounded-app border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {t('hub.sourceOff')}{' '}
            <Link to="/settings#data" className="font-semibold text-green-dark">{t('sources.open')} →</Link>
          </p>
        )}
        {status && <p className="text-sm text-muted">{status}</p>}

        <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <section className={cn('min-w-0', selectedId && 'max-lg:hidden')}>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'cursor-pointer rounded-full border px-3 py-1.5 text-[13px] font-semibold',
                    filter === f ? 'border-ink bg-ink text-white' : 'border-ink/15 bg-white/60 text-ink/70 hover:border-green',
                  )}
                >
                  {t(`hub.filter.${f}`)} <span className="opacity-60">{counts[f]}</span>
                </button>
              ))}
            </div>
            {visible.length === 0 ? (
              <div className="rounded-panel border border-ink/10 bg-white/70 p-6 text-center text-sm text-muted">
                <Handshake className="mx-auto mb-2 size-7 opacity-50" />
                {t('hub.empty')}
              </div>
            ) : (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {visible.map((th) => (
                  <li key={th.id}>
                    <button
                      type="button"
                      onClick={() => open(th.id)}
                      className={cn(
                        'grid w-full cursor-pointer gap-0.5 rounded-app border p-3 text-left',
                        th.id === selectedId ? 'border-green bg-[#eef5ee]' : 'border-ink/10 bg-white/70 hover:border-green',
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <strong className="truncate text-sm">{th.anonymizedAt ? '—' : th.contactName || t('hub.funder')}</strong>
                        <time className="shrink-0 font-mono text-[10px] text-muted">{when(th.lastMessageAt)}</time>
                      </span>
                      <span className="truncate text-xs text-muted">
                        {th.context.productName || th.context.listingSlug}
                        {th.contactOrg ? ` · ${th.contactOrg}` : ''}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <StatusPill thread={th} />
                        {th.context.kind && <span className="text-muted">{t(`hub.kind.${th.context.kind}`)}</span>}
                        {th.context.amount ? <span className="text-muted">· {rupiah(th.context.amount)}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={cn('min-w-0', !selectedId && 'max-lg:hidden')}>
            {selectedId ? (
              <ThreadView id={selectedId} onBack={() => open(null)} when={when} />
            ) : (
              <div className="grid h-full min-h-[240px] place-items-center rounded-panel border border-dashed border-ink/15 text-sm text-muted">
                {t('hub.pick')}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function StatusPill({ thread }: { thread: Pick<ThreadSummary, 'status' | 'lastAuthor'> }) {
  const { t } = useI18n();
  const waiting = thread.status === 'open' && thread.lastAuthor === 'contact';
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 font-semibold',
        thread.status === 'closed' ? 'bg-ink/[.06] text-ink/60' : waiting ? 'bg-amber-100 text-amber-800' : 'bg-[#e3f1e3] text-green-dark',
      )}
    >
      {thread.status === 'closed' ? t('hub.closed') : waiting ? t('hub.awaitingTeam') : t('hub.awaitingFunder')}
    </span>
  );
}

function ThreadView({ id, onBack, when }: { id: string; onBack: () => void; when: (iso: string) => string }) {
  const { t } = useI18n();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState('');
  const [notesKey, setNotesKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await api<{ thread: ThreadDetail }>(`/v1/external/threads/${encodeURIComponent(id)}`);
      setThread(data.thread);
      setError('');
    } catch (err) {
      setError(messageFromError(err, ''));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeLiveEvent('hub', (event) => {
    const threadId = eventData<{ threadId?: string }>(event)?.threadId;
    if (!threadId || threadId === id) void load();
  }), [id, load]);
  useEffect(() => subscribeLiveEvent('note', (event) => {
    if (eventData<{ chatId?: string }>(event)?.chatId === `hub:${id}`) setNotesKey((k) => k + 1);
  }), [id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!thread) return <p className="text-sm text-muted"><Loader2 className="mr-1 inline size-4 animate-spin" />{t('common.loading')}</p>;

  const c = thread.context || {};
  const team = c.teamName || (c.productName ? `Tim ${c.productName}` : 'Tim');
  const last = thread.messages[thread.messages.length - 1];

  return (
    <div className="grid gap-4">
      <button type="button" onClick={onBack} className="flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-green-dark lg:hidden">
        <ArrowLeft className="size-4" /> {t('hub.back')}
      </button>

      <div className="rounded-panel border border-ink/10 bg-white/80 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-lg">{c.productName || c.listingSlug}</h2>
            <p className="m-0 mt-0.5 text-sm text-muted">{team}</p>
          </div>
          <StatusPill thread={{ status: thread.status, lastAuthor: last?.author ?? null }} />
        </div>
        {thread.anonymizedAt ? (
          <p className="mb-0 mt-3 text-sm text-muted">{t('hub.anonymized')}</p>
        ) : (
          <dl className="m-0 mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Detail label={t('hub.funder')}>
              {thread.contactName}
              {thread.contactOrg ? <span className="text-muted"> · {thread.contactOrg}</span> : null}
              {thread.contactEmail ? <span className="block text-xs text-muted">{thread.contactEmail}</span> : null}
            </Detail>
            <Detail label={t('hub.kindLabel')}>
              {c.kind ? t(`hub.kind.${c.kind}`) : '—'}
              {c.amount ? <span className="text-muted"> · {rupiah(c.amount)}</span> : null}
            </Detail>
            <Detail label={t('hub.started')}>{when(thread.startedAt)}</Detail>
            <Detail label={t('hub.listing')}>
              {c.listingUrl ? (
                <a href={c.listingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-green-dark">
                  {t('hub.viewListing')} <ExternalLink className="size-3.5" />
                </a>
              ) : '—'}
            </Detail>
          </dl>
        )}
      </div>

      <div className="rounded-panel border border-ink/10 bg-white/80 p-4 sm:p-5">
        <h3 className="m-0 mb-3 text-sm">{t('hub.messages')}</h3>
        <ol className="m-0 grid list-none gap-3 p-0">
          {thread.messages.map((m) => (
            <li
              key={m.externalId}
              className={cn(
                'max-w-[88%] rounded-[14px] px-3.5 py-2.5 text-sm',
                m.author === 'contact' ? 'bg-ink/[.05]' : 'ml-auto bg-[#e3f1e3]',
              )}
            >
              <p className="m-0 text-[11px] text-muted">
                {m.author === 'contact' ? (m.authorName || t('hub.funder')) : `${team}${m.authorName ? ` · ${m.authorName}` : ''}`} · {when(m.occurredAt)}
              </p>
              <p className="m-0 mt-1 whitespace-pre-line">{m.body || '—'}</p>
            </li>
          ))}
        </ol>
        <p className="mb-0 mt-4 text-xs text-muted">{t('hub.teamReplies')}</p>
      </div>

      {!thread.anonymizedAt && <DraftCard threadId={id} onSavedAsNote={() => setNotesKey((k) => k + 1)} />}

      <div className="rounded-panel border border-ink/10 bg-white/80 p-4 sm:p-5">
        <h3 className="m-0 mb-3 text-sm">{t('hub.notes')}</h3>
        <NoteThread chatId={`hub:${id}`} reloadKey={notesKey} />
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="m-0 mt-0.5 break-words">{children}</dd>
    </div>
  );
}

/** "Draft a reply for the team" — the 9c draft, never sent anywhere. */
function DraftCard({ threadId, onSavedAsNote }: { threadId: string; onSavedAsNote: () => void }) {
  const { t } = useI18n();
  const [guidance, setGuidance] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'copied' | 'saved' | null>(null);

  async function make() {
    setBusy(true);
    setError('');
    setDone(null);
    try {
      const data = await api<{ draft: string }>(`/v1/external/threads/${encodeURIComponent(threadId)}/draft`, {
        method: 'POST',
        body: guidance.trim() ? { guidance: guidance.trim() } : {},
      });
      setDraft(data.draft);
    } catch (err) {
      setError(messageFromError(err, ''));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard?.writeText(draft).catch(() => {});
    setDone('copied');
  }

  async function saveAsNote() {
    try {
      await api(`/v1/chats/${encodeURIComponent(`hub:${threadId}`)}/notes`, {
        method: 'POST',
        body: { body: `${t('hub.draftPrefix')}\n\n${draft}`.slice(0, 2000) },
      });
      setDone('saved');
      onSavedAsNote();
    } catch (err) {
      setError(messageFromError(err, ''));
    }
  }

  return (
    <div className="rounded-panel border border-ink/10 bg-white/80 p-4 sm:p-5">
      <h3 className="m-0 mb-3 flex items-center gap-1.5 text-sm"><Sparkles className="size-4 text-green-dark" /> {t('hub.draft')}</h3>
      <label className="grid gap-1.5 text-xs font-semibold text-muted">
        {t('hub.draftGuidance')}
        <Input value={guidance} onChange={(e) => setGuidance(e.target.value)} maxLength={1000} placeholder={t('hub.draftGuidancePlaceholder')} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void make()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {draft ? t('hub.draftAgain') : t('hub.draftMake')}
        </Button>
      </div>
      {error && <p className="mb-0 mt-2 text-sm text-danger">{error}</p>}
      {draft && (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={7}
            className="w-full rounded-app border border-ink/15 bg-white p-3 text-sm"
          />
          <p className="m-0 mt-1 text-xs text-muted">{t('hub.draftNote')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              {done === 'copied' ? <Check className="size-4" /> : <Copy className="size-4" />}
              {done === 'copied' ? t('hub.copied') : t('hub.copy')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void saveAsNote()}>
              {done === 'saved' ? <Check className="size-4" /> : <StickyNote className="size-4" />}
              {done === 'saved' ? t('hub.savedAsNote') : t('hub.saveAsNote')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
