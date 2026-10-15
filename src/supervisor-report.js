'use strict';

/**
 * Laporan hasil chat berkala untuk supervisor.
 *
 * Jadwal: pukul 08.00 zona waktu company. Harian = tiap hari, mingguan = tiap
 * Senin, bulanan = tiap tanggal 1. Jadwal hanya menentukan KAPAN laporan
 * dikirim; isinya selalu sama: hari ini (sampai saat dikirim), kemarin, 7 dan
 * 30 hari, masing-masing dengan selisih terhadap periode sebelumnya.
 *
 * Server yang mati saat jam 08.00 tidak membuat laporan hilang: jadwal terbaru
 * yang belum terkirim tetap dikirim begitu server hidup. Jadwal SEBELUM
 * laporan diaktifkan tidak dikejar, supaya menyalakan laporan tidak langsung
 * memuntahkan laporan lama.
 */

const chatDetails = require('./report-chats');

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jam:menit zona company, mis. "10.16". */
function clockLabel(date, tz) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: safeZone(tz), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/**
 * Empat periode yang selalu ada di laporan, masing-masing dengan pembandingnya.
 * Hari ini = 00.00 zona company sampai sekarang (dibanding kemarin sampai jam
 * yang sama, supaya adil); kemarin = satu hari kalender penuh; 7 dan 30 hari =
 * mundur dari sekarang. Pembanding 7/30 hari adalah periode sebelumnya yang
 * sama panjang.
 */
function reportWindows(now, tz) {
  const zone = safeZone(tz);
  const p = localParts(now, zone);
  const midnight = (offset) => zonedToUtc(p.y, p.m, p.d + offset, 0, zone);
  const back = (days) => new Date(now.getTime() - days * DAY_MS);
  return [
    {
      key: 'today', label: `Hari ini (sampai ${clockLabel(now, zone)})`, versus: 'kemarin sampai jam yang sama',
      from: midnight(0), to: now, prevFrom: midnight(-1), prevTo: new Date(now.getTime() - DAY_MS),
    },
    { key: 'yesterday', label: 'Kemarin', versus: 'sehari sebelumnya', from: midnight(-1), to: midnight(0), prevFrom: midnight(-2), prevTo: midnight(-1) },
    { key: '7d', label: '7 hari terakhir', versus: '7 hari sebelumnya', from: back(7), to: now, prevFrom: back(14), prevTo: back(7) },
    { key: '30d', label: '30 hari terakhir', versus: '30 hari sebelumnya', from: back(30), to: now, prevFrom: back(60), prevTo: back(30) },
  ];
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
  '*Laporan Chat — {company}*',
  '{period}',
  '',
  '{overview}',
  '',
  '{topics}',
  '',
  '{chat_details}',
].join('\n');

const MAX_TEMPLATE_LENGTH = 1500;

/** Penanda yang boleh dipakai di template: nama, isi, dan contoh untuk pratinjau. */
const PLACEHOLDERS = [
  { key: 'name', label: 'Nama penerima', example: 'Hanny' },
  { key: 'company', label: 'Nama perusahaan', example: 'Beweix Digital' },
  { key: 'frequency', label: 'Jadwal: Harian / Mingguan / Bulanan', example: 'Harian' },
  { key: 'period', label: 'Waktu laporan dibuat', example: 'Kamis, 15 Okt 2026 10.16' },
  { key: 'overview', label: 'Angka hari ini, kemarin, 7 dan 30 hari, lengkap dengan selisih terhadap periode sebelumnya', example: null },
  { key: 'inbound', label: 'Pesan masuk dari customer (7 hari terakhir)', example: '128' },
  { key: 'chats', label: 'Customer yang chat (7 hari terakhir)', example: '23' },
  { key: 'new_chats', label: 'Customer baru (7 hari terakhir)', example: '6' },
  { key: 'ai_replies', label: 'Dibalas AI (7 hari terakhir)', example: '97' },
  { key: 'human_replies', label: 'Dibalas tim (7 hari terakhir)', example: '14' },
  { key: 'handoffs', label: 'Diambil alih tim (7 hari terakhir)', example: '3' },
  { key: 'hot_leads', label: 'Lead panas/closing (7 hari terakhir)', example: '4' },
  { key: 'stats', label: 'Angka 7 hari terakhir di atas sebagai daftar', example: null },
  { key: 'topics', label: 'Topik terbanyak 7 hari terakhir (judul + daftar, kosong kalau tidak ada)', example: null },
  { key: 'waiting', label: 'Chat yang menunggu balasan kita sekarang', example: '5' },
  { key: 'chat_details', label: 'Chat yang perlu di-follow up: isi, status, dan tindakan oleh siapa (kosong kalau tidak ada; bila panjang dikirim sebagai pesan terpisah)', example: null },
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

const quietStats = (stats) => !stats.inboundMessages && !stats.aiReplies && !stats.humanReplies;

/** "(+4)", "(-2)" atau "(sama)": selisih terhadap periode pembanding. */
function deltaLabel(current, previous) {
  const diff = (Number(current) || 0) - (Number(previous) || 0);
  if (diff === 0) return '(sama)';
  return `(${diff > 0 ? '+' : '-'}${num(Math.abs(diff))})`;
}

const METRICS = [
  ['Pesan masuk dari customer', (s) => s.inboundMessages],
  ['Customer yang chat', (s) => s.activeChats],
  ['Customer baru', (s) => s.newChats],
  ['Dibalas AI', (s) => s.aiReplies],
  ['Dibalas tim', (s) => s.humanReplies],
  ['Diambil alih tim', (s) => s.handoffs],
  ['Lead panas/closing', (s) => s.hotLeads],
];

/**
 * Ringkasan semua periode, tiap angka dengan selisih terhadap periode sebelumnya.
 * @param overview {{label, versus, stats, prev}[]} urutan seperti reportWindows
 * @param waiting jumlah chat yang menunggu balasan saat ini (tanpa pembanding: kondisi sekarang)
 */
function formatOverview(overview, waiting = 0) {
  const blocks = overview.map(({ label, versus, stats, prev }) => {
    const head = `*${label}*${versus ? ` — dibanding ${versus}` : ''}`;
    if (quietStats(stats) && quietStats(prev)) return `${head}\n${EMPTY_PERIOD}`;
    const lines = METRICS.map(([name, pick]) => `• ${name}: ${num(pick(stats))} ${deltaLabel(pick(stats), pick(prev))}`);
    return [head, ...lines].join('\n');
  });
  if (waiting) blocks.push(`*Saat ini*\n• Menunggu balasan kita: ${num(waiting)} chat`);
  return blocks.join('\n\n');
}

/** Nilai tiap penanda untuk satu laporan. `stats` = angka 7 hari terakhir. */
function placeholderValues({ recipientName, companyName, frequency, tz, now, stats, overviewText, highlights, chatText }) {
  const statLines = quietStats(stats) ? [EMPTY_PERIOD] : [
    `• Pesan masuk dari customer: ${num(stats.inboundMessages)}`,
    `• Customer yang chat: ${num(stats.activeChats)} (${num(stats.newChats)} baru)`,
    `• Dibalas AI: ${num(stats.aiReplies)}`,
    `• Dibalas tim: ${num(stats.humanReplies)}`,
    `• Diambil alih tim: ${num(stats.handoffs)}`,
    `• Lead panas/closing: ${num(stats.hotLeads)}`,
  ];
  const points = quietStats(stats) ? [] : highlights.map((h) => stripFormatting(h).trim()).filter(Boolean).slice(0, 5);
  const stamp = new Intl.DateTimeFormat('id-ID', {
    timeZone: safeZone(tz), weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);
  return {
    name: stripFormatting(recipientName),
    company: stripFormatting(companyName),
    frequency: FREQUENCY_LABEL[frequency] || 'Chat',
    period: stamp,
    overview: overviewText,
    inbound: num(stats.inboundMessages),
    chats: num(stats.activeChats),
    new_chats: num(stats.newChats),
    ai_replies: num(stats.aiReplies),
    human_replies: num(stats.humanReplies),
    handoffs: num(stats.handoffs),
    hot_leads: num(stats.hotLeads),
    stats: statLines.join('\n'),
    topics: points.length ? [TOPICS_HEADING, ...points.map((p) => `– ${p}`)].join('\n') : '',
    waiting: num(stats.waiting),
    chat_details: chatText,
  };
}

/**
 * @param overview {{label, versus, stats, prev}[]} hari ini, kemarin, 7 dan 30 hari (lihat reportWindows);
 *   stats entri '7d' menjadi nilai penanda {inbound}, {stats}, dst.
 * @param highlights string[] poin ringkas dari AI (boleh kosong)
 * @param template teks dengan penanda {name} dst.; kosong = DEFAULT_TEMPLATE
 * @param recipientName nama penerima untuk {name}
 * @param sample true = laporan dari tombol "Kirim sekarang" (diberi label CONTOH)
 * @param chats chat yang perlu di-follow up, paling penting dulu (lihat report-chats.js)
 * @param followUpTotal jumlah SEMUA chat yang perlu di-follow up (bisa lebih banyak dari `chats`)
 * @param waiting jumlah chat yang menunggu balasan kita
 * @returns {string[]} pesan pertama = laporan; bila daftar chat tidak muat di satu pesan WhatsApp,
 *   daftar itu menjadi pesan-pesan berikutnya (penomoran lanjut)
 */
function buildReportMessages({
  companyName, frequency, tz, now = new Date(), overview, waiting = 0, highlights = [], template = null, recipientName = '',
  sample = false, chats = [], followUpTotal = chats.length,
}) {
  const weekly = overview.find((entry) => entry.key === '7d') || overview[overview.length - 1];
  const stats = { ...weekly.stats, waiting };
  const overviewText = formatOverview(overview, waiting);
  const source = String(template || DEFAULT_TEMPLATE);
  const render = (chatText) => {
    const values = placeholderValues({ recipientName, companyName, frequency, tz, now, stats, overviewText, highlights, chatText });
    // Satu lintasan, jadi isi nilai (nama company yang memuat "{name}") tidak ikut diganti lagi.
    let text = source.replace(/\{([a-z_]+)\}/g, (match, key) => (Object.hasOwn(values, key) ? values[key] : match));
    // Penanda kosong (mis. {topics}) meninggalkan baris kosong berlipat.
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (sample) {
      text = `*CONTOH* — dikirim manual lewat tombol "Kirim sekarang".\n\n${text}`;
    }
    return text;
  };
  if (!source.includes('{chat_details}') || !chats.length) return [render('')];
  const single = render(chatDetails.formatChatDetails(chats, now, followUpTotal));
  if (single.length <= chatDetails.MAX_MESSAGE_LENGTH) return [single];
  // Tidak muat: laporan tanpa daftar, lalu daftar chat di pesan tersendiri.
  return [render(''), ...chatDetails.chunkChatDetails(chats, now, followUpTotal)];
}

/** Seluruh pesan sebagai satu teks (pratinjau dan tes); pesan dipisah garis. */
function buildReport(options) {
  return buildReportMessages(options).join('\n\n──────────\n\n');
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
  buildReportMessages, reportWindows, formatOverview, deltaLabel,
};
