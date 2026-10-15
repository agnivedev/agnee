'use strict';

/**
 * Laporan hasil chat berkala untuk supervisor.
 *
 * Jadwal: pukul 08.00 zona waktu company. Harian = tiap hari, mingguan = tiap
 * Senin, bulanan = tiap tanggal 1. Periode laporan adalah jadwal sebelumnya
 * sampai jadwal ini (kemarin, 7 hari terakhir, bulan lalu).
 *
 * Server yang mati saat jam 08.00 tidak membuat laporan hilang: jadwal terbaru
 * yang belum terkirim tetap dikirim begitu server hidup. Jadwal SEBELUM
 * laporan diaktifkan tidak dikejar, supaya menyalakan laporan tidak langsung
 * memuntahkan laporan lama.
 */

const FREQUENCIES = ['off', 'daily', 'weekly', 'monthly'];
const SEND_HOUR = 8;

/** Selisih (ms) zona `tz` terhadap UTC pada instan `date`. */
function offsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function safeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'Asia/Jakarta'; }
}

/** Jam dinding `y-m-d h:00` di zona `tz` -> instan UTC. */
function zonedToUtc(y, m, d, h, tz) {
  const guess = Date.UTC(y, m - 1, d, h);
  let utc = guess - offsetMs(new Date(guess), tz);
  utc = guess - offsetMs(new Date(utc), tz);
  return new Date(utc);
}

/** Tanggal dinding (tahun, bulan, hari, hari-minggu 0=Min) di zona `tz`. */
function localParts(date, tz) {
  const shifted = new Date(date.getTime() + offsetMs(date, tz));
  return {
    y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate(),
    h: shifted.getUTCHours(), dow: shifted.getUTCDay(),
  };
}

/** Jadwal kirim terbaru yang sudah lewat (<= now) untuk frekuensi ini. */
function latestSlot(frequency, now, tz) {
  const zone = safeZone(tz);
  const p = localParts(now, zone);
  let y = p.y; let m = p.m; let d = p.d;
  if (frequency === 'monthly') d = 1;
  else if (frequency === 'weekly') d -= (p.dow + 6) % 7; // mundur ke Senin
  let slot = zonedToUtc(y, m, d, SEND_HOUR, zone);
  if (slot > now) {
    // Belum jam 08.00 pada hari jadwal: pakai jadwal sebelumnya.
    if (frequency === 'monthly') { m -= 1; if (m < 1) { m = 12; y -= 1; } d = 1; }
    else d -= frequency === 'weekly' ? 7 : 1;
    slot = zonedToUtc(y, m, d, SEND_HOUR, zone);
  }
  return slot;
}

/** Jadwal tepat sebelum `slot` untuk frekuensi yang sama. */
function previousSlot(frequency, slot, tz) {
  const zone = safeZone(tz);
  const p = localParts(slot, zone);
  if (frequency === 'monthly') {
    const m = p.m === 1 ? 12 : p.m - 1;
    return zonedToUtc(p.m === 1 ? p.y - 1 : p.y, m, 1, SEND_HOUR, zone);
  }
  return zonedToUtc(p.y, p.m, p.d - (frequency === 'weekly' ? 7 : 1), SEND_HOUR, zone);
}

/**
 * Apakah supervisor ini harus dikirimi laporan sekarang?
 * @returns {{from: Date, to: Date}|null} periode laporan, atau null kalau belum waktunya
 */
function dueWindow(row, now, tz) {
  if (!row || !FREQUENCIES.includes(row.frequency) || row.frequency === 'off') return null;
  if (!row.whatsappNumber) return null;
  const slot = latestSlot(row.frequency, now, tz);
  const baseline = new Date(row.lastSentAt || row.enabledAt || 0);
  if (slot <= baseline) return null;
  return { from: previousSlot(row.frequency, slot, tz), to: slot };
}

const FREQUENCY_LABEL = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan' };

const nf = new Intl.NumberFormat('id-ID');
const num = (n) => nf.format(Number(n) || 0);

function formatDay(date, tz) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: safeZone(tz), day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** Judul periode: satu hari ditulis sekali, selebihnya "a – b" (batas akhir eksklusif). */
function periodLabel(frequency, from, to, tz) {
  const last = new Date(to.getTime() - 60_000);
  const a = formatDay(from, tz);
  const b = formatDay(last, tz);
  return a === b ? a : `${a} – ${b}`;
}

const stripFormatting = (value) => String(value || '').replace(/[*_~`]/g, '');

const EMPTY_PERIOD = 'Tidak ada percakapan pada periode ini.';
const TOPICS_HEADING = '*Yang paling banyak dibahas*';

/**
 * Template bawaan. Sama persis dengan bentuk laporan sebelum template bisa
 * diganti, jadi company yang tidak mengubah apa pun tidak melihat bedanya.
 */
const DEFAULT_TEMPLATE = [
  '*Laporan {frequency} — {company}*',
  '{period}',
  '',
  '{stats}',
  '',
  '{topics}',
].join('\n');

const MAX_TEMPLATE_LENGTH = 1500;

/** Penanda yang boleh dipakai di template: nama, isi, dan contoh untuk pratinjau. */
const PLACEHOLDERS = [
  { key: 'name', label: 'Nama penerima', example: 'Hanny' },
  { key: 'company', label: 'Nama perusahaan', example: 'Beweix Digital' },
  { key: 'frequency', label: 'Harian / Mingguan / Bulanan', example: 'Harian' },
  { key: 'period', label: 'Periode laporan', example: '14 Okt 2026' },
  { key: 'inbound', label: 'Pesan masuk dari customer', example: '128' },
  { key: 'chats', label: 'Customer yang chat', example: '23' },
  { key: 'new_chats', label: 'Customer baru', example: '6' },
  { key: 'ai_replies', label: 'Dibalas AI', example: '97' },
  { key: 'human_replies', label: 'Dibalas tim', example: '14' },
  { key: 'handoffs', label: 'Diambil alih tim', example: '3' },
  { key: 'hot_leads', label: 'Lead panas/closing', example: '4' },
  { key: 'stats', label: 'Semua angka di atas sebagai daftar (atau "tidak ada percakapan")', example: null },
  { key: 'topics', label: 'Topik terbanyak (judul + daftar, kosong kalau tidak ada)', example: null },
];
const PLACEHOLDER_KEYS = new Set(PLACEHOLDERS.map((p) => p.key));

/**
 * Template yang ditolak atau diterima. Penanda tak dikenal (typo seperti {nama})
 * ditolak saat disimpan, bukan dibiarkan terkirim mentah ke WhatsApp supervisor.
 * @returns {string|null} pesan kesalahan, atau null kalau valid
 */
function validateTemplate(template) {
  const text = String(template ?? '');
  if (!text.trim()) return 'Template tidak boleh kosong.';
  if (text.length > MAX_TEMPLATE_LENGTH) return `Template terlalu panjang (maksimal ${MAX_TEMPLATE_LENGTH} karakter).`;
  const unknown = [...new Set([...text.matchAll(/\{([^{}\s]*)\}/g)].map((m) => m[1]).filter((key) => !PLACEHOLDER_KEYS.has(key)))];
  if (unknown.length) return `Penanda tidak dikenal: ${unknown.map((k) => `{${k}}`).join(', ')}.`;
  return null;
}

/** Nilai tiap penanda untuk satu laporan. */
function placeholderValues({ recipientName, companyName, frequency, from, to, tz, stats, highlights }) {
  const quiet = !stats.inboundMessages && !stats.aiReplies && !stats.humanReplies;
  const statLines = quiet ? [EMPTY_PERIOD] : [
    `• Pesan masuk dari customer: ${num(stats.inboundMessages)}`,
    `• Customer yang chat: ${num(stats.activeChats)} (${num(stats.newChats)} baru)`,
    `• Dibalas AI: ${num(stats.aiReplies)}`,
    `• Dibalas tim: ${num(stats.humanReplies)}`,
    `• Diambil alih tim: ${num(stats.handoffs)}`,
    `• Lead panas/closing: ${num(stats.hotLeads)}`,
  ];
  const points = quiet ? [] : highlights.map((h) => stripFormatting(h).trim()).filter(Boolean).slice(0, 5);
  return {
    name: stripFormatting(recipientName),
    company: stripFormatting(companyName),
    frequency: FREQUENCY_LABEL[frequency] || 'Chat',
    period: periodLabel(frequency, from, to, tz),
    inbound: num(stats.inboundMessages),
    chats: num(stats.activeChats),
    new_chats: num(stats.newChats),
    ai_replies: num(stats.aiReplies),
    human_replies: num(stats.humanReplies),
    handoffs: num(stats.handoffs),
    hot_leads: num(stats.hotLeads),
    stats: statLines.join('\n'),
    topics: points.length ? [TOPICS_HEADING, ...points.map((p) => `– ${p}`)].join('\n') : '',
  };
}

/**
 * @param stats {{inboundMessages, activeChats, newChats, aiReplies, humanReplies, handoffs, hotLeads}}
 * @param highlights string[] poin ringkas dari AI (boleh kosong)
 * @param template teks dengan penanda {name} dst.; kosong = DEFAULT_TEMPLATE
 * @param recipientName nama penerima untuk {name}
 * @param sample true = laporan contoh dari tombol "Kirim contoh" (diberi label; periodenya 7 hari terakhir)
 */
function buildReport({ companyName, frequency, from, to, tz, stats, highlights = [], template = null, recipientName = '', sample = false }) {
  const values = placeholderValues({ recipientName, companyName, frequency, from, to, tz, stats, highlights });
  // Satu lintasan, jadi isi nilai (nama company yang memuat "{name}") tidak ikut diganti lagi.
  let text = String(template || DEFAULT_TEMPLATE).replace(/\{([a-z_]+)\}/g, (match, key) => (
    Object.hasOwn(values, key) ? values[key] : match
  ));
  // Penanda kosong (mis. {topics}) meninggalkan baris kosong berlipat.
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (sample) {
    text = `*CONTOH* — memakai 7 hari terakhir supaya isinya terlihat; laporan asli memakai periode jadwalnya.\n\n${text}`;
  }
  return text;
}

/** Balasan model -> daftar poin pendek; baris bernomor/berbutir dibersihkan. */
function parseHighlights(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-–•*]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length >= 4 && line.length <= 160)
    .slice(0, 5);
}

module.exports = {
  FREQUENCIES, SEND_HOUR, latestSlot, previousSlot, dueWindow, buildReport, parseHighlights, periodLabel, zonedToUtc,
  DEFAULT_TEMPLATE, PLACEHOLDERS, MAX_TEMPLATE_LENGTH, validateTemplate,
};
