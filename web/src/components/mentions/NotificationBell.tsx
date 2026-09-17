import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { subscribeLiveEvent } from '@/lib/live-events';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Notification = {
  id: number;
  kind: 'mention' | 'reply' | 'task';
  chatId: string | null;
  chatName: string | null;
  actorName: string | null;
  actorKind: 'human' | 'ai';
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Kotak notifikasi mention. Hanya berisi kejadian antar pengguna Agnee —
 * customer tidak pernah menghasilkan baris di sini.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await api<{ notifications: Notification[]; unread: number }>('/v1/notifications?limit=30')
      .catch(() => null);
    if (!data) return;
    setItems(data.notifications || []);
    setUnread(data.unread || 0);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Didorong lewat aliran SSE yang sama dengan inbox, bukan ditarik tiap menit:
  // sejak AI ikut menjawab di catatan dan penugasan ikut memberi notifikasi,
  // keterlambatan satu menit terasa seperti fitur yang tidak jalan.
  //
  // Frame-nya tidak membawa isi apa pun (server hanya mengirim penanda ke
  // aliran milik pengguna ini), jadi daftarnya tetap ditarik lewat rute yang
  // sudah memeriksa siapa pemanggilnya.
  useEffect(() => subscribeLiveEvent('notification', () => { void load(); }), [load]);

  // Jaring pengaman kalau alirannya putus tanpa terdeteksi: jarang, dan
  // 5 menit cukup karena jalur utamanya sudah langsung.
  useEffect(() => {
    const timer = setInterval(() => { void load(); }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onAway(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onAway);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  async function markAllRead() {
    await api('/v1/notifications/read', { method: 'POST', body: {} }).catch(() => {});
    await load();
  }

  function openItem(item: Notification) {
    setOpen(false);
    void api('/v1/notifications/read', { method: 'POST', body: { ids: [item.id] } })
      .catch(() => {})
      .then(load);
    if (item.chatId) {
      const title = item.chatName || item.chatId.replace(/@.*$/, '');
      navigate(`/?chat=${encodeURIComponent(item.chatId)}&title=${encodeURIComponent(title)}`);
    }
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notif.title')}
        aria-expanded={open}
        className="relative flex cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-2"
      >
        <Bell className="size-[18px]" />
        {unread ? (
          <span className="absolute top-0.5 right-0.5 grid min-w-[15px] place-items-center rounded-full bg-green px-1 font-mono text-[9px] leading-[15px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-1 max-h-[70vh] w-[min(88vw,320px)] overflow-auto rounded-xl border border-border bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between px-1">
            <strong className="text-xs">{t('notif.title')}</strong>
            {unread ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="cursor-pointer border-0 bg-transparent p-0 text-[10px] text-muted underline"
              >
                {t('notif.markAllRead')}
              </button>
            ) : null}
          </div>
          {items.length ? (
            <ul className="grid gap-1">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      'grid w-full cursor-pointer gap-0.5 rounded-lg border-0 p-2 text-left',
                      item.readAt ? 'bg-transparent' : 'bg-[#eef5ee]',
                    )}
                  >
                    <span className="text-[11px]">
                      <strong>{item.actorName || t('routing.system')}</strong>{' '}
                      {t(item.kind === 'task' ? 'notif.assigned'
                        : item.kind === 'reply' ? 'notif.replied' : 'notif.mentioned')}
                      {item.chatName ? ` · ${item.chatName}` : ''}
                    </span>
                    {item.body ? (
                      <span className="line-clamp-2 text-[11px] text-muted">{item.body}</span>
                    ) : null}
                    <time className="font-mono text-[9px] text-muted">
                      {new Date(item.createdAt).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID')}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 px-1 py-3 text-[11px] text-muted">{t('notif.empty')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
