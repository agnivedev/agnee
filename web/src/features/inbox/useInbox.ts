import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { Chat, Message, WhatsappStatus } from './types';

export type InboxTab = 'inbox' | 'archived';
export type InboxFilter = 'all' | 'unread' | 'qualified';

const CHAT_PAGE_SIZE = 12;
const MESSAGE_PAGE = 30;
const MESSAGE_CEILING = 600;

type ChatsResponse = { chats: Chat[]; hasMore: boolean; phase?: string | null };
type MessagesResponse = { messages: Message[]; hasMore: boolean };

/**
 * Owns everything the three panes read: the chat list, the open conversation's
 * messages, and the WhatsApp connection phase. Kept in one hook because the
 * server-sent events refresh all three together and splitting them would mean
 * three subscriptions racing each other.
 */
export function useInbox() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [hasMoreChats, setHasMoreChats] = useState(false);
  const [waPhaseForList, setWaPhaseForList] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [whatsapp, setWhatsapp] = useState<WhatsappStatus | null>(null);
  const [tab, setTab] = useState<InboxTab>('inbox');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');
  const [listError, setListError] = useState<string>();

  const messageLimit = useRef(MESSAGE_PAGE);
  const loadingChats = useRef(false);
  const pendingChatReset = useRef(false);
  const activeChatId = useRef<string | null>(null);
  // Chats the operator opened in this tab. The server still counts them unread
  // until it processes mark-read, and a refresh in between would make the badge
  // reappear on a conversation that is plainly open on screen.
  const locallyRead = useRef(new Set<string>());

  activeChatId.current = activeChat?.id ?? null;

  const loadChats = useCallback(
    async (reset = false) => {
      if (loadingChats.current) {
        if (reset) pendingChatReset.current = true;
        return;
      }
      loadingChats.current = true;
      try {
        const currentCount = reset ? 0 : chats.length;
        const params = new URLSearchParams({
          limit: String(CHAT_PAGE_SIZE),
          offset: String(currentCount),
          q: search.trim(),
          filter: tab === 'archived' ? 'archived' : filter === 'all' ? 'inbox' : filter,
        });
        const data = await api<ChatsResponse>(`/v1/chats?${params}`);
        const received = (data.chats || []).map((chat) =>
          locallyRead.current.has(chat.id) ? { ...chat, unreadCount: 0 } : chat,
        );
        setChats((current) => (reset ? received : [...current, ...received]));
        setHasMoreChats(Boolean(data.hasMore));
        // The server returns `phase` instead of an error while WhatsApp is not
        // ready, so an empty list can mean "still connecting" rather than
        // "genuinely no conversations". The empty state needs to tell them apart.
        setWaPhaseForList(data.phase || null);
        setListError(undefined);
      } catch (error) {
        if (reset) setListError(error instanceof Error ? error.message : String(error));
      } finally {
        loadingChats.current = false;
        if (pendingChatReset.current) {
          pendingChatReset.current = false;
          void loadChats(true);
        }
      }
    },
    [chats.length, search, tab, filter],
  );

  const loadMessages = useCallback(async (chatId: string) => {
    const data = await api<MessagesResponse>(
      `/v1/chats/${encodeURIComponent(chatId)}/messages?limit=${messageLimit.current}`,
    );
    if (activeChatId.current !== chatId) return;
    setMessages(data.messages || []);
    setHasMoreMessages(Boolean(data.hasMore) && messageLimit.current < MESSAGE_CEILING);
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (!activeChatId.current || !hasMoreMessages) return;
    messageLimit.current = Math.min(messageLimit.current + MESSAGE_PAGE, MESSAGE_CEILING);
    await loadMessages(activeChatId.current);
  }, [hasMoreMessages, loadMessages]);

  /** Pulls the whole history in so a quoted message can be scrolled to. */
  const loadFullHistory = useCallback(async () => {
    if (!activeChatId.current) return;
    messageLimit.current = MESSAGE_CEILING;
    await loadMessages(activeChatId.current);
  }, [loadMessages]);

  const openChat = useCallback(
    async (chat: Chat) => {
      const switching = activeChatId.current !== chat.id;
      if (switching) {
        setMessages([]);
        messageLimit.current = MESSAGE_PAGE;
      }
      setActiveChat(chat);
      activeChatId.current = chat.id;
      sessionStorage.setItem('agnee_active_chat', chat.id);
      locallyRead.current.add(chat.id);
      setChats((current) =>
        filter === 'unread' && tab === 'inbox'
          ? current.filter((item) => item.id !== chat.id)
          : current.map((item) => (item.id === chat.id ? { ...item, unreadCount: 0 } : item)),
      );
      void api(`/v1/chats/${encodeURIComponent(chat.id)}/mark-read`, { method: 'POST' }).catch(() => {});
      await loadMessages(chat.id);
    },
    [filter, tab, loadMessages],
  );

  const refreshStatus = useCallback(async () => {
    const status = await api<WhatsappStatus>('/v1/whatsapp/status');
    setWhatsapp(status);
    return status;
  }, []);

  // Initial workspace load, and the reload after every filter/tab/search change.
  useEffect(() => {
    void loadChats(true);
    // loadChats changes identity with chats.length, which would loop; the inputs
    // that must trigger a reload are listed explicitly instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filter, search]);

  useEffect(() => {
    void refreshStatus().catch(() => {});
  }, [refreshStatus]);

  // Restore the conversation that was open before a reload, or fall back to the
  // newest one, once the first page of chats has arrived.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !chats.length || activeChat) return;
    restored.current = true;
    const preferredId = sessionStorage.getItem('agnee_active_chat');
    const preferred = chats.find((chat) => chat.id === preferredId) || chats[0];
    if (preferred) void openChat(preferred);
  }, [chats, activeChat, openChat]);

  return {
    chats,
    hasMoreChats,
    waPhaseForList,
    listError,
    activeChat,
    setActiveChat,
    messages,
    hasMoreMessages,
    whatsapp,
    setWhatsapp,
    tab,
    setTab,
    filter,
    setFilter,
    search,
    setSearch,
    loadChats,
    loadMessages,
    loadOlderMessages,
    loadFullHistory,
    openChat,
    refreshStatus,
    locallyRead,
    loadMoreChats: () => loadChats(false),
  };
}

export type InboxApi = ReturnType<typeof useInbox>;
