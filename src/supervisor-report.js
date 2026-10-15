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

/**
 * @param stats {{inboundMessages, activeChats, newChats, aiReplies, humanReplies, handoffs, hotLeads}}
 * @param highlights string[] poin ringkas dari AI (boleh kosong)
 * @param sample true = laporan contoh dari tombol "Kirim contoh" (diberi label dan periodenya 7 hari terakhir)
 */
function buildReport({ companyName, frequency, from, to, tz, stats, highlights = [], sample = false }) {
  const lines = [
    `*${sample ? 'CONTOH — ' : ''}Laporan ${FREQUENCY_LABEL[frequency] || 'Chat'} — ${stripFormatting(companyName)}*`,
    periodLabel(frequency, from, to, tz),
    ...(sample ? ['_Contoh memakai 7 hari terakhir supaya isinya terlihat; laporan asli memakai periode jadwalnya._'] : []),
    '',
  ];
  if (!stats.inboundMessages && !stats.aiReplies && !stats.humanReplies) {
    lines.push('Tidak ada percakapan pada periode ini.');
    return lines.join('\n');
  }
  lines.push(
    `• Pesan masuk dari customer: ${num(stats.inboundMessages)}`,
    `• Customer yang chat: ${num(stats.activeChats)} (${num(stats.newChats)} baru)`,
    `• Dibalas AI: ${num(stats.aiReplies)}`,
    `• Dibalas tim: ${num(stats.humanReplies)}`,
    `• Diambil alih tim: ${num(stats.handoffs)}`,
    `• Lead panas/closing: ${num(stats.hotLeads)}`,
  );
  const points = highlights.map((h) => stripFormatting(h).trim()).filter(Boolean).slice(0, 5);
  if (points.length) {
    lines.push('', '*Yang paling banyak dibahas*', ...points.map((p) => `– ${p}`));
  }
  return lines.join('\n');
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
};
