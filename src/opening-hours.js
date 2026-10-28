'use strict';

/**
 * Jam buka terstruktur per hari, seperti Google Business: tiap hari buka
 * (satu atau dua rentang jam), buka 24 jam, atau tutup.
 *
 * Bentuk yang disimpan:
 *   { days: { mon: { state: 'open', ranges: [['08:00', '17:00']] },
 *             tue: { state: '24h', ranges: [] },
 *             sun: { state: 'closed', ranges: [] }, ... } }
 *
 * Teks "Senin–Jumat 08.00–17.00; Minggu tutup" dibuat dari jadwal ini di
 * server dan disimpan di kolom `opening_hours` lama, jadi semua yang sudah
 * membaca teks (AI, tombol bagikan lokasi, alat toko terdekat) ikut mendapat
 * jam yang rapi tanpa diubah. Status "sekarang buka/tutup" dihitung di kode
 * dari jadwal dan zona waktu company, bukan ditebak model dari teks.
 */

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_NAMES = { mon: 'Senin', tue: 'Selasa', wed: 'Rabu', thu: 'Kamis', fri: 'Jumat', sat: 'Sabtu', sun: 'Minggu' };
const STATES = ['open', 'closed', '24h'];
const MAX_RANGES = 2;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const dotted = (hhmm) => hhmm.replace(':', '.');

/**
 * Merapikan dan memeriksa jadwal dari klien. Mengembalikan `{ schedule }`
 * atau `{ error }` (kalimat yang bisa dibaca pengguna). `null`/`undefined`
 * bukan jadwal: pemanggil yang memutuskan artinya.
 */
function normalizeSchedule(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.days !== 'object' || raw.days === null) {
    return { error: 'Jadwal jam buka tidak valid.' };
  }
  const days = {};
  for (const day of DAYS) {
    const entry = raw.days[day];
    if (!entry || typeof entry !== 'object') return { error: `Jadwal hari ${DAY_NAMES[day]} belum lengkap.` };
    if (!STATES.includes(entry.state)) return { error: `Status hari ${DAY_NAMES[day]} tidak dikenal.` };
    if (entry.state !== 'open') {
      days[day] = { state: entry.state, ranges: [] };
      continue;
    }
    const ranges = Array.isArray(entry.ranges) ? entry.ranges : [];
    if (ranges.length < 1 || ranges.length > MAX_RANGES) {
      return { error: `Hari ${DAY_NAMES[day]}: isi satu atau dua rentang jam.` };
    }
    const clean = [];
    for (const range of ranges) {
      const [from, to] = Array.isArray(range) ? range : [];
      if (typeof from !== 'string' || typeof to !== 'string' || !TIME.test(from) || !TIME.test(to)) {
        return { error: `Hari ${DAY_NAMES[day]}: jam harus berformat 08:00.` };
      }
      if (from === to) return { error: `Hari ${DAY_NAMES[day]}: jam buka dan tutup tidak boleh sama. Pilih "24 jam" untuk buka sehari penuh.` };
      clean.push([from, to]);
    }
    // Rentang tidak boleh tumpang tindih (rentang lewat tengah malam diperpanjang melewati 24.00).
    const spans = clean.map(([from, to]) => {
      const start = minutesOf(from);
      const end = minutesOf(to);
      return [start, end > start ? end : end + 1440];
    }).sort((a, b) => a[0] - b[0]);
    if (spans.length === 2 && spans[1][0] < spans[0][1]) {
      return { error: `Hari ${DAY_NAMES[day]}: dua rentang jam saling tumpang tindih.` };
    }
    clean.sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
    days[day] = { state: 'open', ranges: clean };
  }
  return { schedule: { days } };
}

function signature(entry) {
  return entry.state === 'open' ? `open:${entry.ranges.map(([a, b]) => `${a}-${b}`).join(',')}` : entry.state;
}

function describe(entry) {
  if (entry.state === 'closed') return 'tutup';
  if (entry.state === '24h') return '24 jam';
  return entry.ranges.map(([from, to]) => `${dotted(from)}–${dotted(to)}`).join(' dan ');
}

/** Teks ringkas untuk customer: hari berurutan yang jamnya sama digabung. */
function summarize(schedule) {
  const days = schedule?.days;
  if (!days) return '';
  const groups = [];
  for (const day of DAYS) {
    const sig = signature(days[day]);
    const last = groups[groups.length - 1];
    if (last && last.sig === sig) last.to = day;
    else groups.push({ sig, from: day, to: day, entry: days[day] });
  }
  if (groups.length === 1) {
    const [only] = groups;
    if (only.entry.state === '24h') return 'Buka 24 jam setiap hari';
    if (only.entry.state === 'closed') return 'Tutup setiap hari';
    return `Setiap hari ${describe(only.entry)}`;
  }
  return groups.map((g) => {
    const label = g.from === g.to ? DAY_NAMES[g.from] : `${DAY_NAMES[g.from]}–${DAY_NAMES[g.to]}`;
    return `${label} ${describe(g.entry)}`;
  }).join('; ');
}

/** Teks yang disimpan di `opening_hours`: ringkasan jadwal, lalu catatan bebas. */
function compose(schedule, note) {
  const summary = schedule ? summarize(schedule) : '';
  const extra = String(note || '').trim();
  if (summary && extra) return `${summary}. ${extra}`;
  return summary || extra;
}

/** Hari dan menit setempat di zona waktu company. */
function localParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'Asia/Jakarta', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { dayIndex: index < 0 ? 0 : index, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Buka atau tutup pada saat `now`. Rentang lewat tengah malam (18.00–02.00)
 * ikut dihitung dari hari sebelumnya. Kalau tutup, `next` berisi pembukaan
 * berikutnya dalam tujuh hari ke depan.
 *
 * @returns {{ open: boolean, closesAt?: string, always?: boolean, next?: { dayName: string, today: boolean, time: string } | null }}
 */
function statusAt(schedule, now = new Date(), timeZone = 'Asia/Jakarta') {
  const days = schedule?.days;
  if (!days) return null;
  const { dayIndex, minutes } = localParts(now, timeZone);
  const today = days[DAYS[dayIndex]];
  const yesterday = days[DAYS[(dayIndex + 6) % 7]];

  if (today.state === '24h') return { open: true, always: true };
  // Sisa rentang semalam: kemarin buka sampai lewat tengah malam.
  if (yesterday.state === 'open') {
    for (const [from, to] of yesterday.ranges) {
      if (minutesOf(to) < minutesOf(from) && minutes < minutesOf(to)) return { open: true, closesAt: dotted(to) };
    }
  }
  if (today.state === 'open') {
    for (const [from, to] of today.ranges) {
      const start = minutesOf(from);
      const end = minutesOf(to);
      if (end > start ? minutes >= start && minutes < end : minutes >= start) {
        return { open: true, closesAt: dotted(to) };
      }
    }
  }

  // Tutup sekarang: cari pembukaan berikutnya.
  for (let offset = 0; offset < 8; offset += 1) {
    const day = days[DAYS[(dayIndex + offset) % 7]];
    if (day.state === 'closed') continue;
    const dayName = DAY_NAMES[DAYS[(dayIndex + offset) % 7]];
    if (day.state === '24h') {
      if (offset === 0) continue;
      return { open: false, next: { dayName, today: false, time: '00.00' } };
    }
    for (const [from] of day.ranges) {
      if (offset === 0 && minutesOf(from) <= minutes) continue;
      return { open: false, next: { dayName, today: offset === 0, time: dotted(from) } };
    }
  }
  return { open: false, next: null };
}

/** Kalimat status untuk AI: "buka, tutup pukul 17.00" / "tutup, buka lagi Senin pukul 08.00". */
function statusLine(schedule, now, timeZone) {
  const status = statusAt(schedule, now, timeZone);
  if (!status) return '';
  if (status.open) return status.always ? 'buka 24 jam' : `buka, tutup pukul ${status.closesAt}`;
  if (!status.next) return 'tutup';
  return status.next.today
    ? `tutup, buka lagi hari ini pukul ${status.next.time}`
    : `tutup, buka lagi ${status.next.dayName} pukul ${status.next.time}`;
}

module.exports = { DAYS, DAY_NAMES, normalizeSchedule, summarize, compose, statusAt, statusLine };
