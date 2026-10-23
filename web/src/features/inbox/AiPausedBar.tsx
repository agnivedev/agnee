import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { subscribeLiveEvent } from '@/lib/live-events';
import { useSession } from '@/lib/session';

type Routing = {
  mode: 'ai' | 'human';
  assigneeUserId: string | null;
  assigneeName?: string | null;
  autoReturnAt?: string | null;
};

/**
 * Strip above the composer while a person holds the chat: says the AI is
 * silent, until when, and hands it back in one click.
 *
 * Before this the only way back to AI was the context panel, which is hidden
 * below xl and on phones, so chats an agent had answered once stayed silent
 * with nobody noticing.
 */
export function AiPausedBar({ chatId, reloadToken }: { chatId: string; reloadToken: number }) {
  const { t } = useI18n();
  const { user } = useSession();
  const [routing, setRouting] = useState<Routing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const data = await api<{ routing: Routing }>(`/v1/chats/${encodeURIComponent(chatId)}/routing`).catch(() => null);
    if (data) setRouting(data.routing);
  }, [chatId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  // A reply from anyone on the team pushes the return time back, and the
  // sweeper or another agent can flip the mode while this chat is open.
  useEffect(() => {
    const stopRouting = subscribeLiveEvent('routing', () => void load());
    const stopMessage = subscribeLiveEvent('message', (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        if (payload.chatId === chatId && payload.fromMe) void load();
      } catch {
        /* ignore malformed frames */
      }
    });
    return () => {
      stopRouting();
      stopMessage();
    };
  }, [chatId, load]);

  const returnAt = routing?.autoReturnAt ? new Date(routing.autoReturnAt).getTime() : null;
  useEffect(() => {
    if (!returnAt) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [returnAt]);

  if (routing?.mode !== 'human') return null;

  async function handBack() {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ routing: Routing }>(`/v1/chats/${encodeURIComponent(chatId)}/routing`, {
        method: 'POST',
        body: { mode: 'ai', note: t('aiPaused.note') },
      });
      setRouting(data.routing);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiPaused.failed'));
    } finally {
      setBusy(false);
    }
  }

  const mine = routing.assigneeUserId === user?.userId;
  let detail: string;
  if (returnAt) {
    // Rounded, not ceiled: the server and the browser clocks differ by a few
    // seconds, and "31 min" on a 30-minute window reads as a bug.
    const left = returnAt - now;
    const minutes = left > 0 ? Math.max(1, Math.round(left / 60_000)) : 0;
    detail = minutes <= 0
      ? t('aiPaused.returningNow')
      : t('aiPaused.returnsIn', { minutes: String(minutes) });
  } else {
    detail = mine ? t('aiPaused.heldByYou') : t('aiPaused.heldBy', { name: routing.assigneeName || t('aiPaused.someone') });
  }

  return (
    <div
      role="status"
      className="mx-4 mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[13px] border border-border bg-warm px-3 py-2 text-xs sm:mx-6"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted" />
      <span className="min-w-0 flex-1">
        <strong className="text-ink">{mine && returnAt ? t('aiPaused.youReplying') : t('aiPaused.title')}</strong>
        <span className="text-muted"> · {detail}</span>
        {error ? <span className="block text-danger">{error}</span> : null}
      </span>
      <button
        type="button"
        onClick={() => void handBack()}
        disabled={busy}
        className="h-8 shrink-0 cursor-pointer rounded-[10px] border border-green-dark bg-white px-3 text-xs font-bold text-green-dark transition hover:bg-green-dark hover:text-white disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? t('aiPaused.handingBack') : t('aiPaused.handBack')}
      </button>
    </div>
  );
}
