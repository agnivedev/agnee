import { notificationVerbKey } from '@/lib/notification-link';
import { useNotifications } from '@/lib/notifications';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';


/**
 * Halaman "lihat semua" untuk notifikasi — dropdown lonceng (`NotificationBell.tsx`)
 * cuma menampilkan 8 terbaru. Sama-sama baca `/v1/notifications`, cuma dengan
 * limit lebih tinggi (batas server 100, tidak ada cursor pagination).
 */
export function NotificationsPage() {
  const { t, dateLocale } = useI18n();
  usePageTitle('notif.title');

  const { items, unread, error, loaded, markAllRead, openItem } = useNotifications(100);
  const status = loaded ? error : t('common.loading');

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
                      <strong>{item.kind === 'hub' ? 'Agnive Hub' : item.actorName || t('routing.system')}</strong>{' '}
                      {t(notificationVerbKey(item.kind))}
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
