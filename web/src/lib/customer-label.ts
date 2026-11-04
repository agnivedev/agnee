type Translate = (key: string) => string;

export type CustomerLabelInput = {
  chatId?: string | null;
  name?: string | null;
  phone?: string | null;
  isGroup?: boolean | null;
};

export type CustomerLabel = {
  title: string;
  subtitle: string | null;
  phone: string | null;
  isGroup: boolean;
  hasName: boolean;
};

const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

export function isGroupChatId(chatId?: string | null) {
  return Boolean(chatId && chatId.endsWith('@g.us'));
}

/** Digit nomor HP bila masuk akal (E.164: 8-15 digit); id @lid/@g.us dan angka panjang lain jadi null. */
export function validPhoneDigits(raw?: string | null, chatId?: string | null) {
  if (chatId && (chatId.endsWith('@lid') || chatId.endsWith('@g.us')) && !raw) return null;
  const value = String(raw || '');
  if (/@(lid|g\.us)$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) return null;
  if (/^(\d)\1+$/.test(digits)) return null;
  return digits;
}

/** `628123456789` menjadi `+62 812 3456 789`; kode negara selain 62 tampil apa adanya. */
export function formatPhoneDigits(digits?: string | null) {
  if (!digits) return '';
  const plain = `+${digits}`;
  return digits.startsWith('62') ? plain.replace(/^(\+62)(\d{3})(\d{3,4})(\d+)$/, '$1 $2 $3 $4') : plain;
}

function phoneFromId(chatId?: string | null) {
  if (!chatId || chatId.endsWith('@g.us') || chatId.endsWith('@lid')) return null;
  return validPhoneDigits(chatId.replace(/@.*$/, ''));
}

/** Nama yang sebenarnya id mentah (angka panjang, atau sama dengan bagian depan chatId) bukan nama. */
function usableName(name?: string | null, chatId?: string | null) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  const bare = String(chatId || '').replace(/@.*$/, '');
  if (bare && trimmed === bare) return null;
  if (/^[+\d\s().-]+$/.test(trimmed) && digits.length > MAX_PHONE_DIGITS) return null;
  return trimmed;
}

/**
 * Satu aturan tampilan customer untuk semua layar: nama WhatsApp sebagai
 * judul, nomor HP asli sebagai baris kedua. Angka yang bukan nomor telepon
 * (id @lid, id grup) tidak pernah ditampilkan.
 */
export function customerLabel(input: CustomerLabelInput, t: Translate): CustomerLabel {
  const isGroup = Boolean(input.isGroup) || isGroupChatId(input.chatId);
  const name = usableName(input.name, input.chatId);

  if (isGroup) {
    return {
      title: name || t('customer.group'),
      subtitle: name ? t('customer.group') : null,
      phone: null,
      isGroup: true,
      hasName: Boolean(name),
    };
  }

  const digits = validPhoneDigits(input.phone, input.chatId) || phoneFromId(input.chatId);
  const formatted = digits ? formatPhoneDigits(digits) : null;
  const nameIsPhone = Boolean(name && digits && name.replace(/\D/g, '') === digits);

  if (name && !nameIsPhone) {
    return { title: name, subtitle: formatted || t('customer.phoneUnresolved'), phone: digits, isGroup: false, hasName: true };
  }
  if (formatted) {
    return { title: formatted, subtitle: null, phone: digits, isGroup: false, hasName: false };
  }
  return { title: t('customer.unnamed'), subtitle: t('customer.phoneUnresolved'), phone: null, isGroup: false, hasName: false };
}
