import { useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Avatar } from './Avatar';
import { formatTime } from './format';
import type { Chat } from './types';
import type { InboxApi } from './useInbox';

export function ChatList({ inbox, demoMode }: { inbox: InboxApi; demoMode: boolean }) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);

  // Infinite scroll: the same "near the end" threshold the vanilla inbox used.
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const onScroll = () => {
      const nearEnd = element.scrollHeight - element.clientHeight - element.scrollTop < 100;
      if (nearEnd && inbox.hasMoreChats) void inbox.loadMoreChats();
    };
    element.addEventListener('scroll', onScroll);
    return () => element.removeEventListener('scroll', onScroll);
  }, [inbox]);

  return (
    <>
      <div ref={listRef} aria-live="polite" className="grid min-h-0 content-start gap-[3px] overflow-y-auto pr-[3px] overscroll-contain">
        {inbox.listError ? (
          <p className="px-3 py-6 text-center text-xs text-danger">{inbox.listError}</p>
        ) : inbox.chats.length ? (
          inbox.chats.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              demoMode={demoMode}
              active={inbox.activeChat?.id === chat.id}
              onSelect={() => void inbox.openChat(chat)}
            />
          ))
        ) : (
          <EmptyInbox inbox={inbox} />
        )}
      </div>
      {inbox.hasMoreChats ? (
        <button
          type="button"
          onClick={() => void inbox.loadMoreChats()}
          className="mt-2 w-full cursor-pointer border-0 bg-transparent p-2.5 font-mono text-[11px] font-medium text-green-dark hover:underline"
        >
          {t('inbox.more')}
        </button>
      ) : null}
    </>
  );
}

function EmptyInbox({ inbox }: { inbox: InboxApi }) {
  const { t } = useI18n();
  const waNotReady = inbox.waPhaseForList && inbox.waPhaseForList !== 'ready';
  const message = waNotReady
    ? t('inbox.emptyConnecting')
    : inbox.search.trim()
      ? t('inbox.emptySearch')
      : inbox.tab === 'archived'
        ? t('inbox.emptyArchived')
        : inbox.filter === 'qualified'
          ? t('inbox.emptyQualified')
          : inbox.filter === 'unread'
            ? t('inbox.emptyUnread')
            : t('inbox.emptyNone');
  return <div className="px-3 py-[26px] text-center text-xs text-muted">{message}</div>;
}

function ChatItem({
  chat,
  active,
  demoMode,
  onSelect,
}: {
  chat: Chat;
  active: boolean;
  demoMode: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const preview = chat.preview || t('inbox.noMessageYet');
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'grid min-h-[58px] w-full cursor-pointer grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[13px] border-0 px-[9px] py-2 text-left transition duration-200',
        active ? 'bg-white shadow-[0_12px_30px_rgba(30,53,45,.09)]' : 'bg-transparent hover:translate-x-[3px] hover:bg-white/70',
      )}
    >
      <Avatar
        name={chat.name}
        isGroup={chat.isGroup}
        src={demoMode ? null : `/v1/chats/${encodeURIComponent(chat.id)}/avatar`}
      />
      <span className="min-w-0">
        <strong className="block truncate text-[13px]">{chat.name}</strong>
        <span className="mt-[3px] block truncate text-[11px] text-muted">
          {chat.isGroup && chat.lastSenderName ? `${chat.lastSenderName} ▸ ${preview}` : preview}
        </span>
      </span>
      <span className="flex h-full flex-col items-end justify-between font-mono text-[10px] text-muted">
        <time>{formatTime(chat.timestamp)}</time>
        <span className="flex min-h-[19px] items-center justify-end gap-[5px]">
          {chat.pinned ? (
            <span className="grid size-[18px] place-items-center text-muted" title={t('chat.pinned')} aria-label={t('chat.pinned')}>
              <svg viewBox="0 0 24 24" aria-hidden className="size-[15px] fill-none stroke-current stroke-[1.8]" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 3h10l-2 3v5l3 4v2H6v-2l3-4V6L7 3Zm5 14v4" />
              </svg>
            </span>
          ) : null}
          {chat.unreadCount ? (
            <b className="grid h-[19px] min-w-[19px] place-items-center rounded-[9px] bg-green font-semibold text-[#071d13]">
              {chat.unreadCount}
            </b>
          ) : null}
        </span>
      </span>
    </button>
  );
}
