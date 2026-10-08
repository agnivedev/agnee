export type BroadcastStatus = 'scheduled' | 'sending' | 'paused' | 'done' | 'cancelled';
export type RecipientStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'unknown';

export type Broadcast = {
  id: string;
  name: string;
  body: string;
  optOutFooter: boolean;
  aiVariation: boolean;
  status: BroadcastStatus;
  scheduledAt: string | null;
  pauseReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdByName: string | null;
  total: number;
  pending: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
  unknown: number;
};

export type Recipient = {
  chatId: string;
  name: string | null;
  phone: string | null;
  status: RecipientStatus;
  error: string | null;
  sentAt: string | null;
  /** Teks yang benar-benar diterima customer, termasuk variasi AI. */
  sentBody: string | null;
};

export type Candidate = {
  chatId: string;
  name: string | null;
  phone: string | null;
  /** Detik epoch pesan terakhir customer; null untuk chat lama sebelum pencatatan. */
  lastInboundAt: number | null;
  leadStage: 'inbox' | 'qualified' | 'assigned' | null;
  productId: string | null;
  productName: string | null;
  /**
   * 'replied' = ada pesan masuk dari kontak ini. 'unproven' = belum terlihat
   * membalas (hasil impor chat), bukan "tidak pernah": jendela baca terbatas.
   */
  relation: 'replied' | 'unproven';
  /** Label WhatsApp Business; kosong untuk akun biasa. */
  waLabels: string[];
};

/** Tempo pengirim, persis seperti yang dipakai server. */
export type Pace = {
  provider: 'whatsapp_web' | 'cloud_api';
  minGapSeconds: number;
  maxGapSeconds: number;
  dailyCap: number;
  sendFromHour: number;
  sendToHour: number;
  maxRecipients: number;
  optOutLine: string;
};

export type OptOut = {
  chatId: string;
  name: string | null;
  phone: string | null;
  keyword: string | null;
  createdAt: string;
};

/**
 * Nomor yang ditampilkan untuk satu penerima, atau '' kalau memang belum
 * diketahui. Chat '@lid' membawa id samaran: deretan angkanya BUKAN nomor
 * telepon, dan menampilkannya seolah nomor menyesatkan orang yang sedang
 * memilih siapa yang akan dikirimi. Kesalahan yang sama pernah terjadi di
 * Lead List dan diperbaiki di sana lebih dulu.
 */
export function displayPhone(row: { phone: string | null; chatId: string }) {
  if (row.phone) return row.phone;
  if (row.chatId.endsWith('@lid')) return '';
  return row.chatId.replace(/@.*$/, '');
}

/** Pratinjau sama persis dengan yang disusun server (`susunPesan`). */
export function renderPreview(body: string, name: string | null, footer: boolean, optOutLine: string) {
  const clean = String(name || '')
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.'-]+|[.'-]+$/g, '')
    .trim();
  const greeting = /\p{L}/u.test(clean) ? clean.slice(0, 40).trim() : 'Kak';
  const text = body.replace(/\{\s*nama\s*\}/gi, greeting).trim();
  return footer ? `${text}\n\n${optOutLine}` : text;
}
