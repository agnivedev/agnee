import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ChatList } from './ChatList';
import { ConnectionDialog } from './ConnectionDialog';
import { ContextPanel } from './ContextPanel';
import { ConversationPane } from './ConversationPane';
import { MediaViewer } from './MediaViewer';
import { Rail, type RailAction } from './Rail';
import { DialogShell, UtilityDialog, type UtilityState } from './UtilityDialog';
import { messagePreview } from './format';
import type { Chat, MediaTarget, Message } from './types';
import { useInbox, type InboxFilter, type InboxTab } from './useInbox';
import { useLiveEvents } from './useLiveEvents';

export function InboxPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { isSupervisor, signOut } = useSession();
  usePageTitle('login.title');

  const inbox = useInbox();
  const [utility, setUtility] = useState<UtilityState>(null);
  const [media, setMedia] = useState<MediaTarget | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [qrFromEvent, setQrFromEvent] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [mobileView, setMobileView] = useState<'list' | 'conversation'>('list');
  const [pinned, setPinned] = useState<Message[]>([]);
  const [routingToken, setRoutingToken] = useState(0);
  const [usageWarning, setUsageWarning] = useState<{ text: string; danger: boolean } | null>(null);
  const [suspended, setSuspended] = useState(false);

  const activeChatId = inbox.activeChat?.id ?? null;

  // ── Pinned messages for the open conversation ──────────────────────────────
  const loadPinned = useCallback(async (chatId: string) => {
    try {
      const data = await api<{ messages: Message[] }>(`/v1/chats/${encodeURIComponent(chatId)}/pinned`);
      setPinned([...(data.messages || [])].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)));
    } catch {
      setPinned([]);
    }
  }, []);

  useEffect(() => {
    if (!activeChatId) {
      setPinned([]);
      return;
    }
    void loadPinned(activeChatId);
  }, [activeChatId, loadPinned]);

  // ── Plan and quota banner ──────────────────────────────────────────────────
  const checkUsage = useCallback(async () => {
    if (!isSupervisor) return;
    try {
      const data = await api<{
        planStatus?: string;
        trialEndsAt?: string;
        aiMessageLimit?: number;
        aiMessageCount?: number;
      }>('/v1/admin/company');

      if (data.planStatus === 'suspended') {
        setSuspended(true);
        return;
      }
      if (data.planStatus === 'trial' && data.trialEndsAt) {
        const daysLeft = Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / 86_400_000);
        if (daysLeft <= 3) {
          setUsageWarning({
            text: daysLeft <= 0 ? t('plan.trialEndsToday') : t('plan.trialEndsIn', { days: daysLeft }),
            danger: daysLeft <= 1,
          });
          return;
        }
      }
      const limit = data.aiMessageLimit ?? 0;
      const count = data.aiMessageCount ?? 0;
      if (limit <= 0) {
        setUsageWarning(null);
        return;
      }
      const pct = Math.round((count / limit) * 100);
      setUsageWarning(
        pct >= 80
          ? {
              text: t('plan.aiUsage', { count: count.toLocaleString(), limit: limit.toLocaleString(), pct }),
              danger: pct >= 90,
            }
          : null,
      );
    } catch {
      /* the banner is advisory; a failed check must not block the inbox */
    }
  }, [isSupervisor, t]);

  useEffect(() => {
    void checkUsage();
    const timer = setInterval(() => void checkUsage(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [checkUsage]);

  // ── Live updates ───────────────────────────────────────────────────────────
  const inboxRef = useRef(inbox);
  inboxRef.current = inbox;

  useLiveEvents({
    onActivity: (payload, type) => {
      const current = inboxRef.current;
      const openId = current.activeChat?.id;
      void current.loadChats(true);
      if (openId && (!payload.chatId || payload.chatId === openId || type === 'ack')) {
        void current.loadMessages(openId);
        void loadPinned(openId);
      }
      if (payload.chatId && !payload.fromMe) current.locallyRead.current.delete(payload.chatId);
    },
    onRouting: () => setRoutingToken((token) => token + 1),
    onTeam: () => setRoutingToken((token) => token + 1),
    onWhatsappPhase: (payload) => {
      const phase = String(payload.phase || '');
      // While the dialog is pairing one number, phase events from another number
      // must not change what it shows — otherwise the second number's QR gets
      // overwritten by the first number's progress.
      if (connectionId && payload.connectionId && payload.connectionId !== connectionId) return;
      inbox.setWhatsapp((current) => ({
        ...(current || { phase }),
        phase,
        ...(payload.account !== undefined ? { account: payload.account as string } : {}),
        ...(payload.percent !== undefined ? { syncPercent: Number(payload.percent) } : {}),
        ...(payload.error !== undefined ? { lastError: String(payload.error) } : {}),
      }));
      if (phase === 'waiting_for_qr' && payload.qrDataUrl) setQrFromEvent(String(payload.qrDataUrl));
      if (phase === 'ready') void inbox.loadChats(true);
    },
  });

  // Settings links here with ?connect=<id> so a supervisor can pair a specific
  // number. The parameter is cleared so a refresh does not reopen the dialog.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('connect');
    if (!requested) return;
    window.history.replaceState({}, '', window.location.pathname);
    setConnectionId(requested);
    setConnectionOpen(true);
  }, []);

  // ── Rail actions ───────────────────────────────────────────────────────────
  async function onRailAction(action: RailAction) {
    switch (action) {
      case 'inbox':
        inbox.setTab('inbox');
        inbox.setFilter('all');
        inbox.setSearch('');
        setMobileView('list');
        break;
      case 'contacts':
        setUtility({
          eyebrow: t('utility.directoryEyebrow'),
          title: t('nav.contacts'),
          message: inbox.chats.length ? undefined : t('utility.noContacts'),
          items: inbox.chats.map((chat) => ({
            title: chat.name,
            detail: chat.isGroup ? t('group.whatsapp') : chat.preview || 'WhatsApp',
            onSelect: () => {
              setUtility(null);
              void openChat(chat);
            },
          })),
        });
        break;
      case 'funnel': {
        setUtility({ eyebrow: t('utility.funnelEyebrow'), title: t('utility.funnelTitle'), message: t('common.loading') });
        try {
          const data = await api<{ chats: Chat[] }>('/v1/chats?limit=50&offset=0&filter=qualified');
          setUtility({
            eyebrow: t('utility.funnelEyebrow'),
            title: t('utility.funnelTitle'),
            message: data.chats.length ? undefined : t('utility.noQualified'),
            items: data.chats.map((chat) => ({
              title: chat.name,
              detail: t('utility.qualifiedAssigned'),
              onSelect: () => {
                setUtility(null);
                void openChat(chat);
              },
            })),
          });
        } catch (error) {
          setUtility({
            eyebrow: t('utility.funnelEyebrow'),
            title: t('utility.funnelTitle'),
            message: messageFromError(error, ''),
          });
        }
        break;
      }
      case 'leads':
        navigate('/leads');
        break;
      // Train AI dan Admin dulu sama-sama membuka /admin, jadi menekan Train AI
      // saat sudah di sana terasa tidak melakukan apa-apa.
      case 'playground':
        window.location.href = '/knowledge';
        break;
      case 'admin':
        window.location.href = '/admin';
        break;
      case 'settings':
        window.location.href = '/settings';
        break;
      case 'logout':
        await signOut();
        break;
    }
  }

  async function openChat(chat: Chat) {
    await inbox.openChat(chat);
    setMobileView('conversation');
  }

  function openConversationMenu() {
    const chat = inbox.activeChat;
    if (!chat) return;
    setUtility({
      eyebrow: t('utility.thisChat'),
      title: t('utility.conversationActions'),
      items: [
        {
          title: chat.archived ? t('utility.backInbox') : t('utility.archive'),
          detail: chat.archived ? t('utility.backInboxDetail') : t('utility.archiveDetail'),
          onSelect: async () => {
            await api(`/v1/chats/${encodeURIComponent(chat.id)}/archive`, {
              method: 'POST',
              body: { archived: !chat.archived },
            });
            setUtility(null);
            inbox.setActiveChat(null);
            await inbox.loadChats(true);
          },
        },
        {
          title: t('utility.refreshConversation'),
          detail: t('utility.refreshConversationDetail'),
          onSelect: async () => {
            setUtility(null);
            await inbox.loadMessages(chat.id);
          },
        },
        {
          title: t('utility.leadContext'),
          detail: t('utility.leadContextDetail'),
          onSelect: () => {
            setUtility(null);
            setContextOpen(true);
          },
        },
        {
          title: t('utility.copyReference'),
          detail: t('utility.copyReferenceDetail'),
          onSelect: async () => {
            try {
              await navigator.clipboard.writeText(chat.id);
              setUtility({ eyebrow: t('utility.thisChat'), title: t('common.copied'), message: chat.id });
            } catch {
              setUtility({ eyebrow: t('utility.thisChat'), title: t('utility.copyReference'), message: chat.id });
            }
          },
        },
      ],
    });
  }

  if (suspended) return <UpgradeWall onSignOut={() => void signOut()} />;

  return (
    <div className="grid h-dvh w-full grid-cols-1 overflow-hidden bg-background pb-16 md:grid-cols-[88px_minmax(280px,340px)_minmax(440px,1fr)] md:pb-0 xl:grid-cols-[88px_minmax(280px,340px)_minmax(440px,1fr)_290px]">
      <Rail active="inbox" onAction={(action) => void onRailAction(action)} />

      <section
        className={cn(
          'grid min-h-0 min-w-0 grid-rows-[auto_auto_auto_auto_auto_minmax(0,1fr)_auto] overflow-hidden border-r border-border bg-white/38 px-4 pt-[22px] pb-3.5',
          mobileView === 'conversation' && 'hidden md:grid',
        )}
      >
        {usageWarning ? (
          <div
            className={cn(
              'mb-2.5 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px]',
              usageWarning.danger
                ? 'border-danger/30 bg-danger/10'
                : 'border-[rgba(255,180,0,.35)] bg-[rgba(255,180,0,.12)]',
            )}
          >
            <span className="flex-1">{usageWarning.text}</span>
            <a href="/settings" className="text-xs font-semibold text-inherit no-underline opacity-75 hover:opacity-100">
              {t('plan.seePlan')}
            </a>
          </div>
        ) : (
          <div />
        )}

        {/* The ID/EN switch is fixed 16px from the viewport edge and is 80px
            wide, so on a phone it sits over this corner and swallows taps meant
            for the new-conversation button. 96px of clearance moves the button
            clear. From md up the rail becomes a sidebar and the header is no
            longer flush with the viewport edge, so the padding comes off. */}
        <header className="flex items-center justify-between pr-24 md:pr-0">
          <div>
            <p className="eyebrow">{t('inbox.eyebrow')}</p>
            <h1 className="m-0 text-3xl tracking-[-.04em]">
              {inbox.tab === 'archived' ? t('inbox.tabArchived') : t('inbox.title')}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setNewChatOpen(true)}
            aria-label={t('inbox.new')}
            className="grid size-9 cursor-pointer place-items-center rounded-xl border-0 bg-ink/6 text-[17px] transition hover:rotate-3 hover:bg-ink/10"
          >
            ＋
          </button>
        </header>

        <label className="my-2.5 flex items-center gap-2.5 rounded-[13px] border border-border bg-white/55 px-3 py-2.5">
          <span aria-hidden className="text-muted">
            ⌕
          </span>
          <input
            type="search"
            value={inbox.search}
            placeholder={t('inbox.search')}
            onChange={(event) => inbox.setSearch(event.target.value)}
            className="w-full border-0 bg-transparent text-ink outline-none"
          />
        </label>

        <div className="mb-2.5 flex border-b border-border" aria-label={t('inbox.tabs')}>
          {(['inbox', 'archived'] as InboxTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => inbox.setTab(tab)}
              className={cn(
                'cursor-pointer border-0 border-b-2 bg-transparent px-4 py-3 text-[13px] font-medium transition-colors',
                inbox.tab === tab ? 'border-b-green text-ink' : 'border-b-transparent text-muted hover:text-ink',
              )}
            >
              {tab === 'inbox' ? t('inbox.tabInbox') : t('inbox.tabArchived')}
            </button>
          ))}
        </div>

        {inbox.tab === 'archived' ? (
          <div />
        ) : (
          <div className="mb-2.5 flex gap-1.5">
            {(['all', 'unread', 'qualified'] as InboxFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => inbox.setFilter(filter)}
                className={cn(
                  'cursor-pointer rounded-[9px] border-0 px-[11px] py-[7px] text-xs',
                  inbox.filter === filter ? 'bg-ink text-white' : 'bg-transparent text-muted hover:text-ink',
                )}
              >
                {filter === 'all' ? t('inbox.all') : filter === 'unread' ? t('inbox.unread') : t('inbox.qualified')}
              </button>
            ))}
          </div>
        )}

        <ChatList inbox={{ ...inbox, openChat }} demoMode={Boolean(inbox.whatsapp?.demoMode)} />
      </section>

      <div className={cn('h-full min-h-0 min-w-0', mobileView === 'list' && 'hidden md:block')}>
        <ConversationPane
          inbox={inbox}
          pinnedCount={pinned.length}
          pinnedPreview={pinned[0] ? messagePreview(pinned[0], t) : ''}
          onBack={() => setMobileView('list')}
          onOpenConnection={() => {
            setConnectionId(null);
            setConnectionOpen(true);
          }}
          onOpenMenu={openConversationMenu}
          onToggleContext={() => setContextOpen((open) => !open)}
          onOpenMedia={setMedia}
          onOpenPinned={() =>
            setUtility({
              eyebrow: t('utility.thisChat'),
              title: t('conversation.pinned'),
              items: pinned.map((message) => ({
                title: messagePreview(message, t),
                detail: message.fromMe ? t('group.you') : message.senderName || inbox.activeChat?.name || '',
                onSelect: () => setUtility(null),
              })),
            })
          }
        />
      </div>

      <div className={cn('hidden h-full min-h-0 min-w-0 xl:block', contextOpen ? 'xl:block' : 'xl:hidden')}>
        <ContextPanel
          chat={inbox.activeChat}
          reloadToken={routingToken}
          onClose={() => setContextOpen(false)}
          onRoutingSaved={async () => {
            if (inbox.activeChat) await inbox.loadMessages(inbox.activeChat.id);
          }}
        />
      </div>

      <UtilityDialog state={utility} onClose={() => setUtility(null)} />
      <MediaViewer target={media} onClose={() => setMedia(null)} />
      <ConnectionDialog
        open={connectionOpen}
        connectionId={connectionId}
        whatsapp={inbox.whatsapp}
        qrFromEvent={qrFromEvent}
        onClose={() => {
          setConnectionOpen(false);
          setQrFromEvent(null);
        }}
        onReady={() => void inbox.loadChats(true)}
      />
      <NewConversationDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onCreated={() => void inbox.loadChats(true)}
      />
    </div>
  );
}

/**
 * Kolom tujuan untuk percakapan baru: ketik nomor bebas, atau pilih dari
 * percakapan yang sudah ada.
 *
 * Nomor telepon TIDAK tersimpan di sisi kita — id chat WhatsApp berbentuk
 * `@lid`, bukan nomor. Jadi daftar ini bukan buku kontak ponsel; ini daftar
 * percakapan yang sudah pernah masuk, dan yang dikirim ke server adalah id
 * chat-nya, bukan nomornya. Untuk orang yang belum pernah menghubungi, nomor
 * yang diketik tetap satu-satunya jalan.
 */
function ContactPicker({
  query,
  picked,
  onQuery,
  onPick,
}: {
  query: string;
  picked: { id: string; name: string } | null;
  onQuery: (value: string) => void;
  onPick: (chat: { id: string; name: string }) => void;
}) {
  const { t } = useI18n();
  const [results, setResults] = useState<Chat[]>([]);
  const [open, setOpen] = useState(false);

  // Daftar awal dimuat begitu kolomnya disentuh, jadi memilih orang yang baru
  // saja chat tidak menuntut mengetik apa pun dulu.
  useEffect(() => {
    if (picked) { setResults([]); return; }
    // `dibatalkan` menjaga hasil permintaan lama tidak menimpa yang baru.
    // Membersihkan timer saja tidak cukup: permintaan yang SUDAH terbang tidak
    // ikut dibatalkan, dan yang dikirim untuk kolom kosong bisa mendarat
    // sesudah yang dikirim untuk "Nad" — daftarnya lalu tampak tidak menyaring.
    let dibatalkan = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: '6', offset: '0', q: query.trim(), filter: 'all' });
      void api<{ chats?: Chat[] }>(`/v1/chats?${params}`)
        .then((data) => { if (!dibatalkan) setResults(data.chats || []); })
        .catch(() => { if (!dibatalkan) setResults([]); });
    }, 220);
    return () => { dibatalkan = true; clearTimeout(timer); };
  }, [query, picked]);

  const terlihat = open && !picked && results.length > 0;

  return (
    <div className="grid gap-2 text-[13px] font-semibold">
      <span>{t('new.number')}</span>
      <div className="relative">
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          // Ditunda supaya klik pada daftar sempat terdaftar sebelum ditutup.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          inputMode="tel"
          autoComplete="off"
          placeholder={t('new.numberPlaceholder')}
          aria-expanded={terlihat}
        />
        {terlihat ? (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 list-none overflow-y-auto rounded-app border border-border bg-white p-1 shadow-lg">
            {results.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => { onPick({ id: chat.id, name: chat.name }); setOpen(false); }}
                  className="w-full cursor-pointer rounded-[8px] border-0 bg-transparent px-2 py-1.5 text-left text-xs font-normal hover:bg-warm"
                >
                  <span className="block truncate font-semibold">{chat.name}</span>
                  <span className="block truncate text-[10px] text-muted">{chat.preview}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <small className="text-[10px] font-normal text-muted">
        {picked ? t('new.picked', { name: picked.name }) : t('new.numberHint')}
      </small>
    </div>
  );
}

function NewConversationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  // Apa yang diketik, dan percakapan yang dipilih dari daftar — kalau ada.
  // Keduanya dipisah karena yang dikirim ke server berbeda: percakapan yang
  // dipilih dikirim lewat id chat-nya, ketikan bebas dikirim apa adanya.
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);

  // Dialog dipakai berulang kali dalam satu sesi; tanpa ini pilihan terakhir
  // masih tertinggal saat dibuka lagi untuk orang yang berbeda.
  useEffect(() => {
    if (!open) { setQuery(''); setPicked(null); setError(''); }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const tujuan = picked?.id || query.trim();
    if (!tujuan) { setError(t('new.numberRequired')); return; }
    setSending(true);
    setError(t('composer.sending'));
    try {
      await api('/v1/messages/send', {
        method: 'POST',
        body: {
          to: tujuan,
          text: String(form.get('text') || '').trim(),
          clientRequestId: crypto.randomUUID(),
        },
      });
      onClose();
      onCreated();
      setError('');
    } catch (caught) {
      setError(messageFromError(caught, ''));
    } finally {
      setSending(false);
    }
  }

  return (
    <DialogShell open={open} onClose={onClose} eyebrow={t('new.eyebrow')} title={t('new.title')}>
      <form onSubmit={submit} className="grid gap-4">
        <ContactPicker
          query={query}
          picked={picked}
          onQuery={(value) => { setQuery(value); setPicked(null); }}
          onPick={(chat) => { setPicked(chat); setQuery(chat.name); }}
        />
        <label className="grid gap-2 text-[13px] font-semibold">
          <span>{t('new.firstMessage')}</span>
          <textarea
            name="text"
            rows={4}
            maxLength={4096}
            required
            placeholder={t('new.placeholder')}
            className="w-full rounded-app border border-input bg-white/60 p-3 text-sm outline-none focus:border-green"
          />
        </label>
        <p role="alert" className="m-0 min-h-[18px] text-[13px] text-danger">
          {error}
        </p>
        <Button type="submit" size="lg" disabled={sending} className="justify-between">
          <span>{t('common.send')}</span>
          <span aria-hidden>→</span>
        </Button>
      </form>
    </DialogShell>
  );
}

function UpgradeWall({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-dvh place-items-center bg-ink px-6 text-center text-white">
      <div className="max-w-md">
        <img src="/brand/agnee-mark.svg" alt="" className="mx-auto w-12" />
        <h1 className="mt-6 text-3xl tracking-[-.03em]">{t('upgrade.title')}</h1>
        <p className="mt-3 text-white/70">{t('upgrade.copy')}</p>
        <a
          href="https://wa.me/6281218700276?text=Halo%2C%20saya%20mau%20langganan%20Agnee"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block rounded-app bg-lime px-5 py-3 font-semibold text-ink no-underline"
        >
          {t('upgrade.activateBtn')}
        </a>
        <button type="button" onClick={onSignOut} className="mt-4 block w-full cursor-pointer border-0 bg-transparent text-sm text-white/60 underline">
          {t('nav.logout')}
        </button>
      </div>
    </div>
  );
}
