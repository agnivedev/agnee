'use strict';

/**
 * Pemantau "customer menulis, tidak ada yang membalas".
 *
 * Latar: ESBEJE, 13–16 Nov 2026. Trial company habis, paket otomatis berstatus
 * `suspended`, dan AI berhenti membalas di semua jalur. Pesan masuk tetap
 * tercatat, koneksi WhatsApp sehat, /health hijau — tiga hari tidak ada satu
 * pun orang yang tahu karena tidak ada yang melaporkan DIAM-nya. Insiden
 * saldo OpenRouter (10–11 Nov) dan WhatsApp tuli (12 Nov) punya bentuk yang
 * sama: semua pemeriksaan teknis lulus, customer tidak dijawab.
 *
 * Pemantau ini tidak peduli penyebabnya. Ia melihat hasilnya: chat pribadi
 * yang pesan terakhirnya dari customer, sudah lebih dari beberapa jam, dan
 * tak ada balasan apa pun (AI maupun manusia) sesudahnya. Penyebab hanya
 * dipakai untuk kalimat kabarnya.
 */

const DEFAULTS = {
  minAgeMinutes: 180, // diam lebih dari 3 jam
  maxAgeHours: 48, // chat yang lebih tua dari ini sudah bukan urusan peringatan
  cooldownMs: 6 * 3600_000, // satu kabar per company per 6 jam
  openHour: 8, // jam lokal company: kabar hanya dikirim di rentang ini
  closeHour: 20,
};

/** Jam lokal (0–23) pada zona waktu; zona tak dikenal jatuh ke Asia/Jakarta. */
function localHour(date, timeZone) {
  for (const zone of [timeZone, 'Asia/Jakarta']) {
    try {
      const part = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: zone })
        .formatToParts(date).find((p) => p.type === 'hour');
      return Number(part.value);
    } catch { /* zona tak dikenal */ }
  }
  return date.getUTCHours();
}

function withinOpenWindow(date, timeZone, { openHour, closeHour }) {
  const hour = localHour(date, timeZone);
  return hour >= openHour && hour < closeHour;
}

/**
 * Alasan yang bisa dibaca staf. `reason` dari getCompanyAi: 'suspended',
 * 'credit', null (AI menyala), atau 'off' (sengaja dimatikan — tidak dikabari).
 */
function causeText(reason) {
  if (reason === 'suspended') {
    return 'Penyebab: paket company ini berstatus berhenti (trial habis atau dihentikan), jadi AI tidak membalas. Aktifkan paketnya di konsol Agnee.';
  }
  if (reason === 'credit') {
    return 'Penyebab: credit AI habis, jadi AI tidak membalas. Top-up credit untuk mengaktifkannya kembali.';
  }
  return 'AI menyala tetapi tidak membalas. Kemungkinan nomor WhatsApp terputus/tuli atau model gagal; periksa nomor di Agnee dan balas manual sementara.';
}

function buildMessage({ reason, chats, oldestAt, now = new Date() }) {
  const hours = Math.max(1, Math.round((now.getTime() - new Date(oldestAt).getTime()) / 3600_000));
  const head = `${chats} chat customer belum dibalas${hours >= 2 ? `, yang terlama sekitar ${hours} jam` : ''}.`;
  return `${head} ${causeText(reason)} Balas customer secara manual sambil menunggu.`;
}

/**
 * @param {object} deps
 * @param {() => Promise<Array<{companyId, name, timezone, chats, oldestAt}>>} deps.listUnanswered
 * @param {(companyId: string) => Promise<{enabled: boolean, reason: string|null}>} deps.getCompanyAi
 * @param {(companyId: string, text: string) => Promise<void>} deps.notify
 */
function createSilentChatWatch({ listUnanswered, getCompanyAi, notify, log = console, now = () => new Date(), options = {} }) {
  const opts = { ...DEFAULTS, ...options };
  const lastNotified = new Map();

  async function tick() {
    const current = now();
    const rows = await listUnanswered({ minAgeMinutes: opts.minAgeMinutes, maxAgeHours: opts.maxAgeHours });
    const sent = [];
    for (const row of rows) {
      if (!withinOpenWindow(current, row.timezone, opts)) continue;
      const last = lastNotified.get(row.companyId) || 0;
      if (current.getTime() - last < opts.cooldownMs) continue;
      const ai = await getCompanyAi(row.companyId).catch(() => ({ enabled: true, reason: null }));
      // AI sengaja dimatikan: company membalas sendiri, diam bukan kerusakan.
      if (ai?.reason === 'off') continue;
      const text = buildMessage({ reason: ai?.reason || null, chats: row.chats, oldestAt: row.oldestAt, now: current });
      try {
        await notify(row.companyId, text);
        lastNotified.set(row.companyId, current.getTime());
        sent.push({ companyId: row.companyId, chats: row.chats, reason: ai?.reason || null });
        log.warn?.({ companyId: row.companyId, chats: row.chats, reason: ai?.reason || null },
          'Customer menunggu tanpa balasan; staf diberi tahu');
      } catch (error) {
        log.warn?.({ err: error, companyId: row.companyId }, 'Kabar customer tak terbalas gagal dikirim');
      }
    }
    return sent;
  }

  return { tick };
}

module.exports = { createSilentChatWatch, buildMessage, causeText, withinOpenWindow, DEFAULTS };
