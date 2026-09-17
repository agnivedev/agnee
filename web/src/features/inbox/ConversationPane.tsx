import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { MessageRow } from './MessageRow';
import { dayKey, dayLabel, formatPhone, messagePreview, phoneFromChatId, runPosition } from './format';
import type { Chat, MediaTarget, Message, WhatsappStatus } from './types';
import type { InboxApi } from './useInbox';

export function ConversationPane({
  inbox,
  onOpenConnection,
  onOpenMenu,
  onOpenPinned,
  onToggleContext,
  onBack,
  onOpenMedia,
  pinnedCount,
  pinnedPreview,
}: {
  inbox: InboxApi;
  onOpenConnection: () => void;
  onOpenMenu: () => void;
  onOpenPinned: () => void;
  onToggleContext: () => void;
  onBack: () => void;
  onOpenMedia: (target: MediaTarget) => void;
  pinnedCount: number;
  pinnedPreview: string;
}) {
  const { t } = useI18n();
  const { isSupervisor } = useSession();
  const confirm = useConfirm();
  const chat = inbox.activeChat;
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  /**
   * Edit dan hapus lewat evaluate murni di server — tidak ada API "diff
   * lokal" untuk membatalkannya kalau gagal, jadi setelah sukses kita muat
   * ulang seluruh riwayat alih-alih menambal state di sini. Riwayatnya sudah
   * dibaca dari `getMessagesForUi()` yang sama dengan balasan otomatis, jadi
   * satu sumber kebenaran untuk keduanya.
   */
  async function editMessage(message: Message, text: string) {
    if (!chat) return;
    try {
      await api(`/v1/messages/${encodeURIComponent(message.id)}`, {
        method: 'PATCH', body: { chatId: chat.id, text },
      });
      setEditingId(null);
      await inbox.loadMessages(chat.id);
    } catch (error) {
      await confirm.error(error, t('message.editFailed'));
    }
  }

  async function deleteMessage(message: Message, everyone: boolean) {
    if (!chat) return;
    const ok = await confirm.confirm({
      title: everyone ? t('message.deleteEveryoneTitle') : t('message.deleteMeTitle'),
      message: everyone ? t('message.deleteEveryoneCopy') : t('message.deleteMeCopy'),
      confirmLabel: t('message.deleteConfirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/messages/${encodeURIComponent(message.id)}`, {
        method: 'DELETE', body: { chatId: chat.id, everyone },
      });
      await inbox.loadMessages(chat.id);
    } catch (error) {
      await confirm.error(error, t('message.deleteFailed'));
    }
  }
  const [groupMeta, setGroupMeta] = useState<string>('');
  // Nomor customer menggantikan label "lead aktif" yang tidak memberi
  // informasi apa pun. Agent sering perlu nomornya untuk mencocokkan lead
  // dengan catatan atau data di luar Agnee.
  const headerPhone = formatPhone(phoneFromChatId(chat?.id));
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Nothing from the previous conversation may follow us into this one. A
  // quote left over from another chat would be sent to the wrong person, and
  // the composer is focused on open, so it is one Enter away.
  useEffect(() => {
    setReplyingTo(null);
    setHighlighted(null);
  }, [chat?.id]);

  // Group header: who is in the room. Falls back to a plain count when the
  // participant names cannot be read.
  useEffect(() => {
    if (!chat?.isGroup) {
      setGroupMeta('');
      return;
    }
    let cancelled = false;
    setGroupMeta(t('group.loading'));
    void api<{ participantNames?: string[]; participantCount?: number }>(
      `/v1/chats/${encodeURIComponent(chat.id)}/info`,
    )
      .then((info) => {
        if (cancelled) return;
        const names = (info.participantNames || []).map((name) => (name === 'Anda' ? t('group.you') : name));
        const hidden = Math.max(0, Number(info.participantCount || 0) - names.length);
        setGroupMeta(
          names.length
            ? `${names.join(', ')}${hidden ? ` +${hidden}` : ''}`
            : t('group.members', { count: info.participantCount || '' }).trim(),
        );
      })
      .catch(() => {
        if (!cancelled) setGroupMeta(t('group.whatsapp'));
      });
    return () => {
      cancelled = true;
    };
  }, [chat?.id, chat?.isGroup, t]);

  // Scroll handling: pin to the bottom unless the operator has scrolled up to
  // read history, in which case new messages must not yank the view away.
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [inbox.messages]);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const onScroll = () => {
      stickToBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop < 80;
      if (element.scrollTop < 100 && inbox.hasMoreMessages) void inbox.loadOlderMessages();
    };
    element.addEventListener('scroll', onScroll);
    return () => element.removeEventListener('scroll', onScroll);
  }, [inbox]);

  async function focusMessage(messageId: string) {
    await inbox.loadFullHistory();
    requestAnimationFrame(() => {
      const row = listRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlighted(messageId);
      setTimeout(() => setHighlighted(null), 1800);
    });
  }

  const ready = inbox.whatsapp?.phase === 'ready' || inbox.whatsapp?.phase === 'demo';

  return (
    <section className="relative grid h-full min-h-0 min-w-0 grid-rows-[80px_auto_minmax(0,1fr)_auto] overflow-hidden bg-[#f3f2ec] bg-[radial-gradient(circle_at_15%_20%,rgba(8,125,76,.055)_0_1px,transparent_1.5px),radial-gradient(circle_at_78%_68%,rgba(20,36,31,.04)_0_1.5px,transparent_2px),linear-gradient(135deg,rgba(255,255,255,.48),rgba(239,243,233,.72))] bg-[length:30px_30px,46px_46px,100%_100%]">
      <header className="flex min-w-0 items-center border-b border-border py-0 pr-24 pl-4 sm:pl-6 xl:pr-6">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('conversation.back')}
          className="mr-2 cursor-pointer border-0 bg-transparent text-xl md:hidden"
        >
          ←
        </button>
        <Avatar
          name={chat?.name}
          isGroup={chat?.isGroup}
          src={chat && !inbox.whatsapp?.demoMode ? `/v1/chats/${encodeURIComponent(chat.id)}/avatar` : null}
          className="size-[42px] text-sm"
        />
        <div className="ml-3 min-w-0 flex-1">
          <h2 className="m-0 truncate text-base">{chat?.name || t('conversation.choose')}</h2>
          <p className="mt-[3px] mb-0 truncate font-mono text-[10px] text-muted">
            {chat ? (chat.isGroup ? groupMeta : headerPhone || t('conversation.activeLead')) : 'WhatsApp'}
          </p>
        </div>
        {isSupervisor ? (
          <button
            type="button"
            onClick={onOpenConnection}
            aria-label={t('conversation.connection')}
            className="ml-auto flex shrink-0 cursor-pointer items-center gap-[7px] rounded-full border border-border bg-white/60 px-2.5 py-2 text-[11px] sm:px-[11px]"
          >
            <span className={cn('size-[7px] rounded-full', ready ? 'bg-green' : 'bg-[#d59b34]')} />
            <strong className="hidden sm:inline">{ready ? t('wa.connected') : t('wa.connectAction')}</strong>
          </button>
        ) : null}
        <HeadIcon onClick={onToggleContext} label={t('conversation.context')} glyph="◫" className="ml-2 xl:hidden" />
        <HeadIcon onClick={onOpenMenu} label={t('conversation.menu')} glyph="•••" className="ml-2" />
      </header>

      {pinnedCount ? (
        <button
          type="button"
          onClick={onOpenPinned}
          className="grid w-full min-w-0 cursor-pointer grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 border-0 border-b border-border bg-white/78 px-4 py-[9px] sm:px-6 text-left backdrop-blur-md hover:bg-white/94"
        >
          <span className="grid size-7 place-items-center rounded-[9px] bg-green/12 text-green-dark">⌖</span>
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-[11px]">
              {pinnedCount === 1 ? t('conversation.pinned') : t('conversation.pinnedCount', { count: pinnedCount })}
            </strong>
            <small className="truncate text-[11px] text-muted">{pinnedPreview}</small>
          </span>
          <b className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-green/12 font-mono text-[10px] font-semibold text-green-dark">
            {pinnedCount}
          </b>
        </button>
      ) : (
        <div />
      )}

      {chat ? (
        <div
          ref={listRef}
          aria-live="polite"
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto px-[clamp(16px,5vw,70px)] py-[30px] overscroll-contain"
        >
          {inbox.hasMoreMessages ? (
            <button
              type="button"
              onClick={() => void inbox.loadOlderMessages()}
              className="cursor-pointer self-center rounded-[9px] border border-border bg-white/65 px-3 py-2 font-mono text-[10px] font-medium text-green-dark"
            >
              {t('conversation.loadOlder')}
            </button>
          ) : null}
          {inbox.messages.map((message, index) => {
            const previous = inbox.messages[index - 1];
            const showDivider = !previous || dayKey(previous.timestamp) !== dayKey(message.timestamp);
            return (
              <div key={message.id || `${message.timestamp}-${index}`} className="contents">
                {showDivider ? (
                  <div className="self-center rounded-full border border-ink/8 bg-white/82 px-2.5 py-[5px] font-mono text-[9px] font-medium text-muted backdrop-blur-md">
                    {dayLabel(message.timestamp, t)}
                  </div>
                ) : null}
                <MessageRow
                  message={message}
                  chatId={chat.id}
                  isGroup={Boolean(chat.isGroup)}
                  demoMode={Boolean(inbox.whatsapp?.demoMode)}
                  position={chat.isGroup ? runPosition(previous, message, inbox.messages[index + 1]) : 'single'}
                  highlighted={highlighted === message.id}
                  editing={editingId === message.id}
                  onStartEdit={() => setEditingId(message.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSaveEdit={(text) => void editMessage(message, text)}
                  onDeleteForMe={() => void deleteMessage(message, false)}
                  onDeleteForEveryone={() => void deleteMessage(message, true)}
                  onReply={setReplyingTo}
                  onOpenMedia={onOpenMedia}
                  onOpenQuoted={(id) => void focusMessage(id)}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState whatsapp={inbox.whatsapp} isSupervisor={isSupervisor} />
      )}

      {/* Composer di-key per percakapan supaya teks, lampiran, dan status
          pengiriman tidak ikut berpindah. Tanpa ini, draf untuk satu orang
          duduk di composer orang lain. */}
      {chat ? (
        <Composer
          key={chat.id}
          chat={chat}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          onSent={async () => {
            stickToBottom.current = true;
            await inbox.loadMessages(chat.id);
            await inbox.loadChats(true);
          }}
          onPreviewAttachment={onOpenMedia}
        />
      ) : (
        <div />
      )}
    </section>
  );
}

function HeadIcon({
  onClick,
  label,
  glyph,
  className,
}: {
  onClick: () => void;
  label: string;
  glyph: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'grid size-9 cursor-pointer place-items-center rounded-xl border-0 bg-ink/6 text-[17px] transition hover:rotate-3 hover:bg-ink/10',
        className,
      )}
    >
      {glyph}
    </button>
  );
}

function EmptyState({ whatsapp, isSupervisor }: { whatsapp: WhatsappStatus | null; isSupervisor: boolean }) {
  const { t } = useI18n();
  const ready = whatsapp?.phase === 'ready' || whatsapp?.phase === 'demo';
  // An agent cannot fix a disconnected WhatsApp, so they are told who can
  // rather than being pointed at a conversation list that will stay empty.
  const notSetupForAgent = !isSupervisor && !ready;
  return (
    <div className="max-w-[310px] self-center justify-self-center text-center text-muted">
      <img src="/brand/agnee-mark.svg" alt="" className="mx-auto w-[58px] opacity-70" />
      <h2 className="mt-4 mb-1.5 text-ink">{notSetupForAgent ? t('agent.notSetupTitle') : t('conversation.emptyTitle')}</h2>
      <p className="m-0 leading-[1.5]">{notSetupForAgent ? t('agent.notSetupCopy') : t('conversation.emptyCopy')}</p>
    </div>
  );
}

export function pinnedSummaryText(messages: Message[], t: (key: string) => string) {
  const latest = [...messages].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0];
  return latest ? messagePreview(latest, t as never) : '';
}

export type { Chat };
