import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { subscribeLiveEvent } from '@/lib/live-events';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Notification = {
  id: number;
  kind: 'mention' | 'reply' | 'task' | 'sla';
  chatId: string | null;
  chatName: string | null;
  actorName: string | null;
  actorKind: 'human' | 'ai';
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Halaman "lihat semua" untuk notifikasi — dropdown lonceng (`NotificationBell.tsx`)
 * cuma menampilkan 8 terbaru. Sama-sama baca `/v1/notifications`, cuma dengan
 * limit lebih tinggi (batas server 100, tidak ada cursor pagination).
 */
export function NotificationsPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  usePageTitle('notif.title');

  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState(t('common.loading'));

  const load = useCallback(async () => {
    try {
      const data = await api<{ notifications: Notification[]; unread: number }>('/v1/notifications?limit=100');
      setItems(data.notifications || []);
      setUnread(data.unread || 0);
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeLiveEvent('notification', () => { void load(); }), [load]);

  async function markAllRead() {
    await api('/v1/notifications/read', { method: 'POST', body: {} }).catch(() => {});
    await load();
  }

  function openItem(item: Notification) {
    void api('/v1/notifications/read', { method: 'POST', body: { ids: [item.id] } })
      .catch(() => {})
      .then(load);
    if (item.chatId) {
      const title = item.chatName || item.chatId.replace(/@.*$/, '');
      navigate(`/?chat=${encodeURIComponent(item.chatId)}&title=${encodeURIComponent(title)}`);
    }
  }

  const dateLocale = locale === 'en' ? 'en-US' : 'id-ID';

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />

      <main className="min-w-0 flex-1 px-6 py-8 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{t('notif.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('notif.title')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{t('notif.subtitle')}</p>
          </div>
          <a href="/" className="text-sm font-semibold text-green-dark no-underline hover:underline">
            ← {t('conversation.back')}
          </a>
        </header>

        <section className="mt-8 rounded-panel border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs font-semibold text-muted">
              {t('notif.count', { count: items.length })}
            </span>
            <span className="flex-1" />
            {unread ? (
              <Button size="sm" variant="outline" onClick={() => void markAllRead()}>
                {t('notif.markAllRead')}
              </Button>
            ) : null}
          </div>

          {status ? <p className="mt-3 mb-0 text-[13px] text-muted">{status}</p> : null}

          {items.length ? (
            <ul className="m-0 mt-4 grid list-none gap-2 p-0">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      'grid w-full cursor-pointer gap-0.5 rounded-app border-0 p-3 text-left',
                      item.readAt ? 'bg-transparent' : 'bg-[#eef5ee]',
                    )}
                  >
                    <span className="text-[13px]">
                      <strong>{item.actorName || t('routing.system')}</strong>{' '}
                      {t(item.kind === 'task' ? 'notif.assigned'
                        : item.kind === 'sla' ? 'notif.overdue'
                        : item.kind === 'reply' ? 'notif.replied' : 'notif.mentioned')}
                      {item.chatName ? ` · ${item.chatName}` : ''}
                    </span>
                    {item.body ? (
                      <span className="line-clamp-2 text-[13px] text-muted">{item.body}</span>
                    ) : null}
                    <time className="font-mono text-[10px] text-muted">
                      {new Date(item.createdAt).toLocaleString(dateLocale)}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 mb-0 text-[13px] text-muted">{t('notif.empty')}</p>
          )}
        </section>
      </main>
    </div>
  );
}
