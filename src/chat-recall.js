'use strict';

/**
 * Ingatan percakapan dari database.
 *
 * Model hanya menerima 5-14 pesan terakhir sebagai `history`. Customer yang
 * sudah menyebut lokasi, luas atau barang di awal percakapan lalu ditanyai
 * ulang. Seluruh percakapan ada di `inbound_messages` + `outbound_replies` +
 * `phone_replies`; modul ini mengubah bagian yang jatuh di luar jendela itu
 * menjadi blok teks untuk system prompt, dan menyediakan riwayat dasar dari DB
 * bila WhatsApp tidak mengembalikan apa pun (Cloud API, gagal baca).
 */

const staffContext = require('./staff-context');

const HISTORY_LIMIT = 14;
const LABEL = { customer: 'Customer', ai: 'Anda', staf: 'Staf' };

function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function line(turn, lineMax) {
  return `${LABEL[turn.from] || 'Staf'}: ${clip(turn.body, lineMax)}`;
}

/** Pesan berkas tanpa caption diganti penanda dari `markerFn`; yang tetap kosong dibuang. */
function withMedia(turns, markerFn) {
  return (Array.isArray(turns) ? turns : [])
    .map((t) => (String(t.body || '').trim() ? t : { ...t, body: (t.type && markerFn({ type: t.type, body: '' })) || '' }))
    .filter((t) => String(t.body || '').trim());
}

/** Buang pesan customer terakhir bila itu pesan yang sedang dibalas (sudah tersimpan di DB). */
function dropCurrent(turns, currentBody) {
  const list = Array.isArray(turns) ? turns : [];
  const last = list[list.length - 1];
  if (last && last.from === 'customer' && String(last.body || '').trim() === String(currentBody || '').trim()) {
    return list.slice(0, -1);
  }
  return list;
}

/** Riwayat berperan (user/assistant) dari giliran DB; dasar bila WhatsApp kosong. */
function historyFromTurns(turns, limit = HISTORY_LIMIT) {
  return (Array.isArray(turns) ? turns : []).slice(-limit).map((t) => (
    t.from === 'customer'
      ? { role: 'user', content: t.body }
      : { role: 'assistant', content: t.from === 'staf' ? staffContext.labelStaffContent(t.body) : t.body }
  ));
}

/**
 * Blok untuk system prompt: percakapan lama (di luar `skipLast` giliran terakhir
 * yang sudah ada di riwayat). Pesan pertama selalu ikut; sisanya diisi dari yang
 * paling baru sampai anggaran habis, bagian tengah dilewati.
 */
function buildMemoryBlock(turns, { skipLast = HISTORY_LIMIT, maxChars = 6000, lineMax = 280 } = {}) {
  const all = Array.isArray(turns) ? turns : [];
  const older = all.slice(0, Math.max(0, all.length - Math.max(0, skipLast)));
  if (!older.length) return '';

  const first = line(older[0], lineMax);
  let used = first.length;
  const tail = [];
  let skipped = false;
  for (let i = older.length - 1; i >= 1; i -= 1) {
    const l = line(older[i], lineMax);
    if (used + l.length + 1 > maxChars) { skipped = true; break; }
    tail.unshift(l);
    used += l.length + 1;
  }
  const body = [first, ...(skipped ? ['(… bagian tengah dilewati …)'] : []), ...tail].join('\n');
  return [
    '## Ingatan percakapan (dari database, bagian yang lebih lama)',
    'Ini yang sudah dibahas SEBELUM pesan-pesan terbaru di bawah. Anggap semua yang customer sebutkan di sini sudah kamu ketahui: jangan menanyakan ulang, jangan memperkenalkan diri lagi, jangan menawarkan ulang yang sudah ditolak atau dijawab.',
    body,
  ].join('\n');
}

module.exports = { HISTORY_LIMIT, buildMemoryBlock, dropCurrent, historyFromTurns, withMedia };
