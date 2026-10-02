import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { notificationVerbKey } from '@/lib/notification-link';
import { useNotifications, type Notification } from '@/lib/notifications';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';


/**
 * Kotak notifikasi mention. Hanya berisi kejadian antar pengguna Agnee —
 * customer tidak pernah menghasilkan baris di sini.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { t, dateLocale } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { items, unread, load, markAllRead, openItem: openNotification } = useNotifications(8);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Posisi panel dihitung dari rect tombol bell, bukan CSS `absolute` yang
  // terikat ke wrapper-nya sendiri — bell ini hidup di dalam rail navigasi
  // sempit yang menempel di tepi layar (Rail.tsx dan AppSidebar.tsx), dan
  // panel selebar 320px yang di-anchor `right-0` ke wrapper sesempit itu
  // meluncur jauh ke luar viewport. `fixed` juga lolos dari `overflow-hidden`
  // rail mobile, sama seperti pola tooltip di AppSidebar.tsx.
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);

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

  function toggleOpen() {
    setOpen((current) => {
      const next = !current;
      if (next && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const width = Math.min(320, window.innerWidth * 0.88);
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
        const opensUp = window.innerHeight - rect.bottom < rect.top;
        setPanelStyle(
          opensUp
            ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + 4, width }
            : { position: 'fixed', left, top: rect.bottom + 4, width },
        );
      }
      return next;
    });
  }

  function openItem(item: Notification) {
    setOpen(false);
    openNotification(item);
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
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

      {open && panelStyle ? (
        <div
          style={panelStyle}
          className="z-30 max-h-[70vh] overflow-auto rounded-panel border border-border bg-card p-2 shadow-panel"
        >
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <strong className="text-xs">{t('notif.title')}</strong>
            <div className="flex items-center gap-2">
              {unread ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="cursor-pointer border-0 bg-transparent p-0 text-[10px] text-muted underline"
                >
                  {t('notif.markAllRead')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => { setOpen(false); navigate('/notifications'); }}
                className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-semibold text-green-dark underline"
              >
                {t('notif.viewAll')}
              </button>
            </div>
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
                      <strong>{item.kind === 'hub' ? 'Agnive Hub' : item.actorName || t('routing.system')}</strong>{' '}
                      {t(notificationVerbKey(item.kind))}
                      {item.chatName ? ` · ${item.chatName}` : ''}
                    </span>
                    {item.body ? (
                      <span className="line-clamp-2 text-[11px] text-muted">{item.body}</span>
                    ) : null}
                    <time className="font-mono text-[9px] text-muted">
                      {new Date(item.createdAt).toLocaleString(dateLocale)}
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
