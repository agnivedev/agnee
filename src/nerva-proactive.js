'use strict';

/**
 * NervAgent proaktif: briefing terjadwal dan alert otomatis ke chat yang
 * terdaftar di NERVA_CHAT_SCOPES, sesuai perannya. BAWAAN MATI.
 *
 * Satu-satunya pengirim WhatsApp di sini adalah tick() yang sengaja dinyalakan
 * lewat env. Semua yang perlu bertahan saat restart (alert yang sudah
 * terkirim, briefing hari ini, hitungan per jam) disimpan lewat `store`
 * (tabel nerva_proactive_sent di Postgres); tes memakai store memori.
 *
 * Kegagalan NERVA atau WhatsApp tidak pernah melempar dari tick(): dicatat,
 * lalu dicoba lagi di putaran berikut.
 */

const nervaTools = require('./nerva-tools.js');

const WIB_OFFSET_MS = 7 * 3_600_000; // Asia/Jakarta, tanpa DST.
const BRIEFING_GRACE_MIN = 45; // briefing masih dikirim bila proses baru menyala sesudah jamnya, tapi tidak lebih lama.
const ALERT_LOOKBACK_MS = 12 * 3_600_000;
const MAX_ALERTS_PER_POLL = 5;
const SEV_RANK = Object.fromEntries(nervaTools.SEVERITIES.map((s, i) => [s, i]));

const truthy = (v) => /^(1|true|on|yes)$/i.test(String(v || '').trim());
const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
};
const int = (v, def, min, max) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/**
 * Env → konfigurasi. Waktu salah format berarti jenis itu mati, bukan ditebak.
 *   NERVA_BRIEFING_MORNING_AT=09:30   NERVA_BRIEFING_CLOSING_AT=22:15   (WIB, kosong = mati)
 *   NERVA_ALERTS_ENABLED=1            NERVA_ALERTS_MIN_SEVERITY=high
 *   NERVA_ALERTS_POLL_SECONDS=120     NERVA_ALERTS_MAX_PER_HOUR=6
 *   NERVA_ALERTS_QUIET=22:30-08:00    NERVA_PROACTIVE_COMPANY=<slug>
 */
function readProactiveConfig(env = process.env) {
  const quiet = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(String(env.NERVA_ALERTS_QUIET ?? '22:30-08:00').trim());
  const sev = String(env.NERVA_ALERTS_MIN_SEVERITY || 'high').trim().toLowerCase();
  return {
    morningAt: toMinutes(env.NERVA_BRIEFING_MORNING_AT),
    closingAt: toMinutes(env.NERVA_BRIEFING_CLOSING_AT),
    alertsEnabled: truthy(env.NERVA_ALERTS_ENABLED),
    minSeverity: nervaTools.SEVERITIES.includes(sev) ? sev : 'high',
    pollSeconds: int(env.NERVA_ALERTS_POLL_SECONDS, 120, 30, 3600),
    maxPerHour: int(env.NERVA_ALERTS_MAX_PER_HOUR, 6, 1, 60),
    quiet: quiet && toMinutes(quiet[1]) != null && toMinutes(quiet[2]) != null ? { from: toMinutes(quiet[1]), to: toMinutes(quiet[2]) } : null,
    companySlug: String(env.NERVA_PROACTIVE_COMPANY || '').trim(),
  };
}

const proactiveEnabled = (pc) => pc.morningAt != null || pc.closingAt != null || pc.alertsEnabled;

/** Jam dinding WIB dari timestamp ms: { date: 'YYYY-MM-DD', minutes }. */
function wib(ms) {
  const d = new Date(ms + WIB_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Jam senyap bisa melewati tengah malam (22:30-08:00). */
function inQuietHours(quiet, minutes) {
  if (!quiet || quiet.from === quiet.to) return false;
  return quiet.from < quiet.to ? minutes >= quiet.from && minutes < quiet.to : minutes >= quiet.from || minutes < quiet.to;
}

/** Store memori dengan antarmuka yang sama dengan versi Postgres (database.js). */
function createMemoryStore({ now = Date.now } = {}) {
  const sent = new Map();
  const audits = [];
  const k = (c, chat, kind, key) => `${c}|${chat}|${kind}|${key}`;
  return {
    async claim(companyId, chat, kind, key) {
      const id = k(companyId, chat, kind, key);
      if (sent.has(id)) return false;
      sent.set(id, { companyId, chat, kind, at: now() });
      return true;
    },
    async release(companyId, chat, kind, key) { sent.delete(k(companyId, chat, kind, key)); },
    async countSince(companyId, chat, kind, sinceMs) {
      return [...sent.values()].filter((r) => r.companyId === companyId && r.chat === chat && r.kind === kind && r.at >= sinceMs).length;
    },
    async audit(entry) { audits.push({ ...entry, at: new Date(now()).toISOString() }); },
    sent, audits,
  };
}

/** Teks alert/briefing dari field yang tersedia; NERVA yang menentukan isinya. */
function messageText(item) {
  const text = item?.whatsappMessage || item?.message || item?.text || item?.summary || '';
  return String(text).trim().slice(0, 3500);
}

/**
 * deps: {
 *   nervaCfg, pc, store, resolveCompany(slug)→companyId, toChatId(number)→chatId,
 *   sendText(companyId, chatId, text)→receipt, sendMedia(companyId, chatId, items)→void,
 *   fetchImpl, now, log
 * }
 */
function createProactive(deps) {
  const { nervaCfg, pc, store, fetchImpl = fetch, now = Date.now, log = null } = deps;
  const recipients = () => (nervaCfg.chatScopes || []).map((s) => ({ ...s, chatId: deps.toChatId(s.chat) })).filter((s) => s.chatId);
  const companyId = async () => {
    const slug = pc.companySlug || nervaCfg.companySlugs?.[0];
    if (!slug || !nervaCfg.companySlugs.includes(slug)) return null;
    return deps.resolveCompany(slug);
  };
  const ready = () => Boolean(nervaCfg.apiUrl && nervaCfg.token && nervaCfg.companySlugs?.length);
  const roleQuery = (role) => {
    const q = new URLSearchParams();
    q.set('level', role.level);
    if (role.level !== 'national') q.set('id', role.id);
    return q;
  };
  const warn = (obj, msg) => log?.warn?.(obj, msg);
  const maskChat = (chat) => `…${String(chat).slice(-4)}`;

  async function deliver(cid, target, body, attachments) {
    await deps.sendText(cid, target.chatId, body);
    const items = (attachments || []).map((a) => ({ id: a?.id, kind: a?.kind, mimetype: a?.mimetype, sizeKb: a?.sizeKb, caption: a?.caption })).slice(0, nervaTools.MEDIA_PER_REPLY);
    if (items.length) await deps.sendMedia(cid, target.chatId, items).catch((error) => warn({ err: error?.message }, 'nerva proaktif: media tidak terkirim (teks sudah terkirim)'));
  }

  /** Briefing yang jamnya sudah lewat hari ini (WIB) dan belum terkirim ke chat itu. */
  async function runBriefings() {
    const sent = [];
    if (!ready()) return sent;
    const slots = [['morning', pc.morningAt], ['closing', pc.closingAt]].filter(([, at]) => at != null);
    if (!slots.length) return sent;
    const t = wib(now());
    const due = slots.filter(([, at]) => t.minutes >= at && t.minutes < at + BRIEFING_GRACE_MIN);
    if (!due.length) return sent;
    const cid = await companyId().catch(() => null);
    if (!cid) return sent;
    const [method, path] = nervaTools.ENDPOINTS.briefing;
    for (const target of recipients()) {
      for (const [kind] of due) {
        const key = `${kind}:${t.date}`;
        if (!(await store.claim(cid, target.chat, 'briefing', key))) continue;
        try {
          const q = roleQuery(target);
          q.set('kind', kind);
          const result = await nervaTools.callNerva({ ...nervaCfg, log }, method, `${path}?${q}`, fetchImpl);
          const body = messageText(result);
          if (!body || result?.error) throw new Error(result?.error || 'briefing kosong');
          await deliver(cid, target, body, result.attachments);
          sent.push({ chat: target.chat, kind });
        } catch (error) {
          // Lepas klaim supaya putaran berikut (masih dalam jendela) mencoba lagi.
          await store.release(cid, target.chat, 'briefing', key).catch(() => {});
          warn({ kind, chat: maskChat(target.chat), err: String(error?.message || error) }, 'nerva proaktif: briefing gagal terkirim');
        }
      }
    }
    return sent;
  }

  /** Alert baru per chat: dedupe_key, ambang severity, jam senyap, batas per jam. */
  async function pollAlerts() {
    const sent = [];
    if (!ready() || !pc.alertsEnabled) return sent;
    const t = wib(now());
    if (inQuietHours(pc.quiet, t.minutes)) return sent;
    const cid = await companyId().catch(() => null);
    if (!cid) return sent;
    const [method, path] = nervaTools.ENDPOINTS.alertsFeed;
    for (const target of recipients()) {
      let budget = pc.maxPerHour - await store.countSince(cid, target.chat, 'alert', now() - 3_600_000).catch(() => pc.maxPerHour);
      if (budget <= 0) continue;
      const q = roleQuery(target);
      q.set('since', new Date(now() - ALERT_LOOKBACK_MS).toISOString());
      q.set('min_severity', pc.minSeverity);
      const result = await nervaTools.callNerva({ ...nervaCfg, log }, method, `${path}?${q}`, fetchImpl);
      if (result?.error) { warn({ chat: maskChat(target.chat), err: result.error }, 'nerva proaktif: umpan alert gagal dibaca'); continue; }
      const alerts = nervaTools.rowsOf(result, ['alerts', 'items'])
        .filter((a) => a && (a.dedupe_key || a.dedupeKey || a.id))
        // NERVA seharusnya sudah menyaring; saringan ini menjaga kalau tidak.
        .filter((a) => (SEV_RANK[String(a.severity || '').toLowerCase()] ?? -1) >= SEV_RANK[pc.minSeverity])
        .sort((a, b) => (SEV_RANK[String(b.severity).toLowerCase()] ?? 0) - (SEV_RANK[String(a.severity).toLowerCase()] ?? 0))
        .slice(0, MAX_ALERTS_PER_POLL);
      for (const alert of alerts) {
        if (budget <= 0) break;
        const body = messageText(alert) || [alert.title, alert.detail].filter(Boolean).join(' - ');
        if (!body) continue;
        const key = String(alert.dedupe_key || alert.dedupeKey || alert.id).slice(0, 160);
        if (!(await store.claim(cid, target.chat, 'alert', key))) continue;
        try {
          await deliver(cid, target, body, alert.attachments);
          budget -= 1;
          sent.push({ chat: target.chat, key });
        } catch (error) {
          await store.release(cid, target.chat, 'alert', key).catch(() => {});
          warn({ chat: maskChat(target.chat), err: String(error?.message || error) }, 'nerva proaktif: alert gagal terkirim');
        }
      }
    }
    return sent;
  }

  let lastAlertPoll = 0;
  let running = false;
  /** Satu putaran: briefing (cek tiap tick) dan alert (sesuai pollSeconds). Tidak pernah melempar. */
  async function tick() {
    if (running) return { skipped: true };
    running = true;
    try {
      const briefings = await runBriefings().catch((error) => { warn({ err: String(error?.message || error) }, 'nerva proaktif: putaran briefing gagal'); return []; });
      let alerts = [];
      if (pc.alertsEnabled && now() - lastAlertPoll >= pc.pollSeconds * 1000) {
        lastAlertPoll = now();
        alerts = await pollAlerts().catch((error) => { warn({ err: String(error?.message || error) }, 'nerva proaktif: putaran alert gagal'); return []; });
      }
      return { briefings, alerts };
    } finally {
      running = false;
    }
  }

  return { tick, runBriefings, pollAlerts, recipients };
}

module.exports = { readProactiveConfig, proactiveEnabled, createProactive, createMemoryStore, inQuietHours, wib, messageText };
