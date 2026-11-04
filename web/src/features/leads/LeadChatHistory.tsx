import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { InlineMarkdown } from '@/features/inbox/InlineMarkdown';
import { dayLabel, formatMessageTime, messagePreview } from '@/features/inbox/format';
import type { Message } from '@/features/inbox/types';

const SESSION_COUNT = 3;
// WhatsApp has no session concept: a new session starts after this much silence.
const SESSION_GAP_SECONDS = 6 * 60 * 60;
const FETCH_LIMIT = 150;

function lastSessions(all: Message[]): Message[][] {
  const sessions: Message[][] = [];
  for (const message of all) {
    const current = sessions[sessions.length - 1];
    const last = current?.[current.length - 1];
    if (current && last && message.timestamp - last.timestamp < SESSION_GAP_SECONDS) current.push(message);
    else sessions.push([message]);
  }
  return sessions.slice(-SESSION_COUNT);
}

/**
 * Read-only slice of the last few sessions, drawn with the same bubbles as
 * the inbox so a lead can be judged without leaving the table. No reply,
 * edit or delete controls: those belong to the inbox.
 */
export function LeadChatHistory({ chatId }: { chatId: string | null }) {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<Message[][]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    setState('loading');
    api<{ messages: Message[] }>(`/v1/chats/${encodeURIComponent(chatId)}/messages?limit=${FETCH_LIMIT}`)
      .then((data) => {
        if (cancelled) return;
        setSessions(lastSessions(data.messages || []));
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f3f2ec]">
      <h3 className="m-0 border-b border-border px-4 py-3 text-[10px] font-semibold tracking-wide text-muted uppercase">
        {t('leads.history')}
      </h3>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-4">
        {state === 'loading' ? <p className="m-0 text-sm text-muted">{t('common.loading')}</p> : null}
        {state === 'error' ? <p className="m-0 text-sm text-muted">{t('leads.historyFailed')}</p> : null}
        {state === 'ready' && sessions.length === 0 ? (
          <p className="m-0 text-sm text-muted">{t('leads.historyEmpty')}</p>
        ) : null}
        {state === 'ready'
          ? sessions.map((session) => (
              <div key={session[0].id || session[0].timestamp} className="contents">
                <div className="self-center rounded-full border border-ink/8 bg-white/82 px-2.5 py-[5px] font-mono text-[9px] font-medium text-muted">
                  {dayLabel(session[0].timestamp, t)} · {new Date(session[0].timestamp * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </div>
                {session.map((message, index) => (
                  <HistoryBubble key={message.id || `${message.timestamp}-${index}`} message={message} />
                ))}
              </div>
            ))
          : null}
      </div>
    </div>
  );
}

function HistoryBubble({ message }: { message: Message }) {
  const { t } = useI18n();
  const mine = message.fromMe;
  const revoked = message.type === 'revoked';
  const text = revoked
    ? message.revokedBody || (mine ? t('message.deletedByMe') : t('message.deletedByOther'))
    : messagePreview(message, t);

  return (
    <div className={cn('flex', mine && 'justify-end')}>
      <div
        className={cn(
          'max-w-[88%] px-3 pt-2.5 pb-1.5 shadow-[0_7px_18px_rgba(28,50,42,.06)]',
          mine ? 'rounded-[18px_8px_18px_18px] bg-[#d9ffd6]' : 'rounded-[8px_18px_18px_18px] bg-white',
          revoked && 'bg-white/55 shadow-none',
        )}
      >
        {mine && message.authorKind ? (
          <strong className="mb-1 block text-[10px] font-semibold tracking-wide text-ink/45 uppercase">
            {message.authorKind === 'human'
              ? message.authorName || t('message.byAgent')
              : message.authorKind === 'broadcast' ? t('message.byBroadcast') : t('message.byAi')}
          </strong>
        ) : null}
        <p className={cn('m-0 text-[13px] leading-[1.45] whitespace-pre-wrap break-words', revoked && 'text-muted line-through')}>
          <InlineMarkdown text={text} />
        </p>
        <time className="mt-1 block text-right font-mono text-[9px] text-muted">{formatMessageTime(message.timestamp)}</time>
      </div>
    </div>
  );
}
