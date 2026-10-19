import { Clock, Inbox, User } from 'lucide-react';
import { Avatar } from '@/features/inbox/Avatar';
import { notificationVerbKey } from '@/lib/notification-link';
import { useI18n } from '@/lib/i18n';
import type { Notification } from '@/lib/notifications';
import { cn } from '@/lib/utils';

/**
 * Isi satu baris notifikasi, dipakai lonceng dan halaman penuh: lencana
 * pemicu di kiri (inisial agent manusia, jam untuk sistem/SLA, kotak masuk
 * untuk Hub), lalu kalimat aktor, chip customer berikon orang, isi, waktu.
 */
export function NotificationItemBody({ item }: { item: Notification }) {
  const { t, dateLocale } = useI18n();
  const isSystem = item.kind === 'sla' || (item.kind !== 'hub' && !item.actorName);
  const actor = item.kind === 'hub' ? 'Agnive Hub' : item.actorName;

  return (
    <span className="flex w-full items-start gap-2.5">
      {item.kind === 'hub' ? (
        <TriggerBadge label="Agnive Hub"><Inbox className="size-[18px]" aria-hidden /></TriggerBadge>
      ) : isSystem ? (
        <TriggerBadge label={t('routing.system')}><Clock className="size-[18px]" aria-hidden /></TriggerBadge>
      ) : (
        <Avatar name={actor} className="size-9 shrink-0" />
      )}
      <span className="grid min-w-0 flex-1 gap-1">
        <span className={cn('text-[13px] leading-snug', item.kind === 'sla' && 'font-semibold')}>
          {isSystem ? null : <strong>{actor}</strong>}{isSystem ? null : ' '}
          {t(notificationVerbKey(item.kind)).replace(/^—\s*/, '')}
        </span>
        {item.chatName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-snug font-semibold">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#e3e8e3] text-ink" aria-hidden>
              <User className="size-3" />
            </span>
            <span className="min-w-0 truncate">{item.chatName}</span>
          </span>
        ) : null}
        {item.body ? <span className="line-clamp-2 text-[13px] leading-snug text-muted">{item.body}</span> : null}
        <time className="text-[11px] text-muted">{new Date(item.createdAt).toLocaleString(dateLocale)}</time>
      </span>
    </span>
  );
}

function TriggerBadge({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-white"
    >
      {children}
    </span>
  );
}
