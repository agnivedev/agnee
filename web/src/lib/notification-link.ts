/**
 * Where a notification leads, and how it is worded — one place for the bell
 * and the Notifications page, which used to repeat the same chain.
 *
 * Agnive Hub conversations borrow the notes machinery under a "hub:<id>" chat
 * id; they open the Hub page, not the WhatsApp inbox.
 */
export type NotificationKind = 'mention' | 'reply' | 'task' | 'sla' | 'hub';

export function notificationHref(chatId: string, chatName?: string | null): string {
  if (chatId.startsWith('hub:')) return `/hub?thread=${encodeURIComponent(chatId.slice(4))}`;
  const title = chatName || chatId.replace(/@.*$/, '');
  return `/?chat=${encodeURIComponent(chatId)}&title=${encodeURIComponent(title)}`;
}

export function notificationVerbKey(kind: NotificationKind): string {
  if (kind === 'task') return 'notif.assigned';
  if (kind === 'sla') return 'notif.overdue';
  if (kind === 'reply') return 'notif.replied';
  if (kind === 'hub') return 'notif.hub';
  return 'notif.mentioned';
}
