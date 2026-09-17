import type { Message } from './types';
import type { Translate } from '@/lib/i18n';

export function initials(name?: string | null) {
  return String(name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function formatTime(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

export function dayKey(timestamp?: number) {
  return new Date(Number(timestamp || 0) * 1000).toDateString();
}

export function dayLabel(timestamp: number, t: Translate) {
  const date = new Date(Number(timestamp || 0) * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t('day.today');
  if (date.toDateString() === yesterday.toDateString()) return t('day.yesterday');
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export function formatDuration(seconds?: number | null, t?: Translate) {
  const total = Math.max(0, Number(seconds) || 0);
  if (!total) return '';
  const minutes = Math.floor(total / 60);
  const remainder = Math.floor(total % 60);
  const min = t ? t('call.minuteShort') : 'mnt';
  const sec = t ? t('call.secondShort') : 'dtk';
  return minutes ? `${minutes} ${min} ${String(remainder).padStart(2, '0')} ${sec}` : `${remainder} ${sec}`;
}

export function callDescription(message: Message, t: Translate) {
  const result = String(message.call?.result || '').toLowerCase();
  const missed = /miss|reject|decline|no.?answer/.test(result);
  if (missed) return message.fromMe ? t('call.unanswered') : t('call.missed');
  return message.fromMe ? t('call.outgoing') : t('call.incoming');
}

export type Delivery = { text: string; state: string; labelKey: string };

export function ackLabel(ack: number): Delivery {
  if (ack === 4) return { text: '✓✓', state: 'played', labelKey: 'ack.played' };
  if (ack === 3) return { text: '✓✓', state: 'read', labelKey: 'ack.read' };
  if (ack === 2) return { text: '✓✓', state: 'delivered', labelKey: 'ack.delivered' };
  if (ack === 1) return { text: '✓', state: 'sent', labelKey: 'ack.sent' };
  if (ack === -1) return { text: '!', state: 'error', labelKey: 'ack.failed' };
  return { text: '◷', state: 'pending', labelKey: 'ack.pending' };
}

const MEDIA_KEYS: Record<string, string> = {
  image: 'media.photo',
  video: 'media.video',
  sticker: 'media.sticker',
  audio: 'media.audio',
  ptt: 'media.voice',
  document: 'media.document',
  interactive: 'media.interactive',
};

export function messagePreview(message: Pick<Message, 'body' | 'type'> | null | undefined, t: Translate) {
  const body = String(message?.body || '').trim();
  // A bare base64 JPEG payload is not a message body — WhatsApp sometimes puts
  // the inline thumbnail there, and printing it fills the row with noise.
  if (body && !/^\/9j\/[A-Za-z0-9+/=]{80,}$/.test(body)) return body;
  const key = message?.type ? MEDIA_KEYS[message.type] : undefined;
  return key ? t(key) : 'WhatsApp';
}

const GROUP_SENDER_COLORS = [
  '#d7446c',
  '#8b57c7',
  '#c87817',
  '#087d8c',
  '#557a16',
  '#3d67b1',
  '#a34b22',
  '#00886f',
];

/**
 * Per-sender colour as a Tailwind class rather than an inline style: the app's
 * Content-Security-Policy forbids style attributes, and the palette is a fixed
 * set of eight, so eight literal classes cost nothing and keep the policy tight.
 */
const SENDER_TEXT_CLASSES = [
  'text-[#d7446c]',
  'text-[#8b57c7]',
  'text-[#c87817]',
  'text-[#087d8c]',
  'text-[#557a16]',
  'text-[#3d67b1]',
  'text-[#a34b22]',
  'text-[#00886f]',
];

function senderIndex(identity?: string | null) {
  let hash = 0;
  for (const character of String(identity || 'participant')) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % GROUP_SENDER_COLORS.length;
}

export function senderColor(identity?: string | null) {
  return GROUP_SENDER_COLORS[senderIndex(identity)];
}

export function senderTextClass(identity?: string | null) {
  return SENDER_TEXT_CLASSES[senderIndex(identity)];
}

/** LIDs carry no dialable number, so they render as nothing rather than as a fake one. */
export function participantPhone(contactId?: string | null) {
  const digits = String(contactId || '').split('@')[0].replace(/\D/g, '');
  if (!digits || String(contactId).includes('@lid')) return '';
  const country = digits.startsWith('62') ? `+62 ${digits.slice(2)}` : `+${digits}`;
  return country.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

/** Two messages belong to one visual run: same sender, same day, within 5 minutes. */
export function sameGroupSequence(left?: Message, right?: Message) {
  if (!left || !right || left.type === 'call_log' || right.type === 'call_log') return false;
  if (dayKey(left.timestamp) !== dayKey(right.timestamp)) return false;
  const leftSender = left.fromMe ? 'me' : left.senderId || left.senderName;
  const rightSender = right.fromMe ? 'me' : right.senderId || right.senderName;
  return Boolean(
    leftSender && leftSender === rightSender && Math.abs(Number(right.timestamp) - Number(left.timestamp)) <= 300,
  );
}

export type RunPosition = 'first' | 'middle' | 'last' | 'single';

export function runPosition(previous: Message | undefined, message: Message, next: Message | undefined): RunPosition {
  const joinsPrevious = sameGroupSequence(previous, message);
  const joinsNext = sameGroupSequence(message, next);
  if (joinsPrevious) return joinsNext ? 'middle' : 'last';
  return joinsNext ? 'first' : 'single';
}

export function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Nomor telepon dari id chat WhatsApp (`628123@c.us` → `628123`).
 *
 * Grup mengembalikan null: idnya (`1203...@g.us`) bukan nomor telepon, dan
 * menampilkannya sebagai nomor adalah cara paling cepat membuat orang
 * menyalin angka yang tidak bisa dihubungi.
 */
export function phoneFromChatId(chatId?: string | null) {
  if (!chatId || chatId.endsWith('@g.us')) return null;
  const digits = chatId.replace(/@.*$/, '').replace(/[^\d]/g, '');
  return digits || null;
}

/** `628123456789` → `+62 812 3456 789`, supaya terbaca dan mudah dicocokkan. */
export function formatPhone(digits?: string | null) {
  if (!digits) return '';
  return `+${digits}`.replace(/^(\+\d{2})(\d{3})(\d{3,4})(\d+)$/, '$1 $2 $3 $4');
}
