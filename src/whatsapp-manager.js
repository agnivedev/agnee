'use strict';

const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Watchdog pemulihan sesi. Angka-angka ini yang menentukan berapa lama sebuah
// client boleh "menggantung" sebelum dianggap wedged dan dilaporkan sebagai
// error — diam selamanya jauh lebih buruk daripada error yang kelihatan.
const RESUME_TICK_MS = 5_000;
// Anggaran total sampai client harus mencapai 'ready'. Sinkronisasi akun besar
// bisa lewat satu menit, jadi budget lama 12 x 5 detik terlalu pendek.
const RESUME_DEADLINE_MS = 5 * 60_000;
// Selama fase 'syncing', selama persennya masih bergerak kita biarkan
// whatsapp-web.js menyelesaikan sendiri. Berhenti bergerak selama ini =
// halamannya macet, bukan sedang sibuk.
const SYNC_STALL_MS = 45_000;

function resolveBrowserExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = process.platform === 'darwin'
    ? [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    : process.platform === 'win32'
      ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

/**
 * WhatsappManager — one WA Client per company.
 *
 * Each company entry holds:
 *   { client, state, sseClients, qrMirrorTimer, restoredSessionTimer }
 *
 * Callbacks passed to startFor / _createClient:
 *   { log, onMessage(companyId, message, { connectionId }), onStatusUpdate(companyId, status, phoneNumber, connectionId),
 *     findDuplicate(companyId, account, connectionId) -> { companyName, connectionId } | null }
 */
const PAIRING_COOLDOWN_MS = 20_000;

function pairingError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Nomor HP untuk pairing: hanya digit, format internasional tanpa '+'.
 * Awalan 0 dibaca sebagai Indonesia (0812… → 62812…). Null bila bentuknya
 * tak masuk akal (E.164 maksimal 15 digit).
 */
function normalizePairingPhone(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** "Beweix Digital" -> "Be*** Di***": cukup untuk dikenali pemiliknya, tidak untuk orang lain. */
function maskCompanyName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '***';
  return words.map((w) => `${[...w].slice(0, w.length > 3 ? 2 : 1).join('')}***`).join(' ');
}

// ── Watchdog tuli ───────────────────────────────────────────────────────────
// Status 'ready' tidak menjamin pendengar pesan masih terpasang: halaman WA Web
// bisa memuat ulang modulnya (SPA re-injection) atau helper hilang, lalu pesan
// masuk tidak terdeteksi dan sendMessage mengembalikan model kosong. Probe ini
// hanya membaca keadaan halaman, tidak mengirim apa pun.
const DEAF_PROBE_INTERVAL_MS = 60_000;
const DEAF_FAILS_TO_RESTART = 2;
const DEAF_MAX_RESTARTS_PER_HOUR = 3;

// Kasus nyatanya (Beweix, 12 Nov): sesudah tiga restart berturut-turut
// whatsapp-web.js berhenti di tengah attachEventListeners — sembilan binding
// pertama terpasang, sisanya dan seluruh `Msg.on(...)` tidak pernah. Event
// 'ready' bawaannya tidak pernah datang, tapi watchdog sesi di startFor
// menyatakan 'ready' karena socket CONNECTED dan helper ada. Hasilnya nomor
// "Connected" yang tidak mendengar satu pesan pun seharian.

/**
 * Dijalankan di dalam halaman WA Web. whatsapp-web.js 1.34 tidak lagi memakai
 * `window.Store`; koleksinya diambil lewat `window.require`. Pendengar event
 * WA disimpan di properti termampatkan (sekarang `$1`) berbentuk
 * `{ add: [{ callback, context }], ... }`, jadi tabelnya dicari menurut
 * bentuknya, bukan namanya. Tidak ketemu = versi tak dikenal (`null`).
 */
function deafProbeInPage() {
  const out = {
    helper: Boolean(window.WWebJS),
    binding: typeof window.onAddMessageEvent === 'function',
    addListeners: null,
    changeListeners: null,
  };
  try {
    const { Msg } = window.require('WAWebCollections');
    const tables = Object.values(Msg).filter((v) => v && typeof v === 'object' && !Array.isArray(v)
      && Array.isArray(v.add) && v.add.every((l) => l && typeof l.callback === 'function'));
    if (tables.length === 1) {
      const count = (ev, fn) => (tables[0][ev] || []).filter((l) => String(l.callback).includes(fn)).length;
      out.addListeners = count('add', 'onAddMessageEvent');
      out.changeListeners = count('change', 'onChangeMessageEvent');
    }
  } catch { /* versi WA Web tak dikenal */ }
  return out;
}

/**
 * true bila client tidak akan menerima pesan dengan benar. `null` = halaman
 * tidak menjawab. Lebih dari satu pendengar juga rusak: tiap pesan diproses
 * dua kali dan AI membalas dobel.
 */
function isDeafProbe(result) {
  if (!result || typeof result !== 'object') return true;
  if (!result.helper || !result.binding) return true;
  if (result.addListeners == null) return false; // versi WA Web tak dikenal, anggap sehat
  return result.addListeners !== 1;
}

/**
 * Pendengar yang belum dipasang sama sekali bisa dipasang ulang di halaman
 * yang sama, tanpa restart. Yang terpasang sebagian atau dobel tidak: memasang
 * lagi hanya menambah duplikat, jadi itu jatah restart.
 */
function canReattach(result) {
  return Boolean(result && result.helper && result.addListeners === 0 && result.changeListeners === 0);
}

const REATTACH_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 15_000;

function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function probeClient(wa) {
  if (!wa?.pupPage) return null;
  return withTimeout(wa.pupPage.evaluate(deafProbeInPage).catch(() => null), PROBE_TIMEOUT_MS);
}

/**
 * Pasang ulang pendengar whatsapp-web.js bila belum ada sama sekali, lalu
 * probe lagi. Mengembalikan hasil probe terakhir; tidak pernah melempar.
 */
async function repairListeners(wa, { log, connectionId } = {}) {
  const before = await probeClient(wa);
  if (!isDeafProbe(before) || !canReattach(before) || typeof wa.attachEventListeners !== 'function') return before;
  log?.warn({ connectionId, probe: before }, 'Pendengar pesan WhatsApp tidak terpasang; dipasang ulang');
  const ok = await withTimeout(
    wa.attachEventListeners().then(() => true, (err) => { log?.warn({ err, connectionId }, 'Memasang ulang pendengar gagal'); return false; }),
    REATTACH_TIMEOUT_MS,
    false,
  );
  const after = await probeClient(wa);
  if (ok && !isDeafProbe(after)) log?.info({ connectionId, probe: after }, 'Pendengar pesan WhatsApp terpasang lagi');
  return after;
}

class WhatsappManager {
  // Satu aliran per tab peramban (satu `EventSource` dipakai bersama di dalam
  // tab, lihat web/src/lib/live-events.ts), jadi 25 sudah longgar untuk tim
  // terbesar yang ada sekarang. Plafon global melindungi proses, dan sengaja
  // jauh di atas plafon per company supaya satu tenant tidak bisa mencapainya
  // sendiri.
  static SSE_MAX_PER_COMPANY = 25;

  static SSE_MAX_TOTAL = 200;

  constructor() {
    // Kunci entry adalah connectionId (satu baris whatsapp_connections), BUKAN
    // companyId: satu company boleh punya beberapa nomor, masing-masing dengan
    // profil Chromium sendiri.
    this._entries = new Map(); // connectionId -> entry
    // Pendengar SSE tetap per company. Antarmukanya memang company-scoped —
    // supervisor melihat satu inbox, bukan satu inbox per nomor.
    this._sse = new Map(); // companyId -> Set<raw>
    this._sseUsers = new WeakMap(); // raw -> userId, untuk event yang pribadi
  }

  _makeState(phase = 'disabled') {
    return {
      phase,
      qrDataUrl: null,
      qrPayload: null,
      qrGeneratedAt: null,
      // Kode pairing 8 karakter (tautkan lewat nomor HP, tanpa QR). Sengaja
      // tidak masuk `publicState` maupun siaran SSE: status terbuka untuk agent.
      pairingCode: null,
      pairingCodeAt: null,
      pairingRequestedAt: 0,
      connectedAt: null,
      account: null,
      syncPercent: null,
      lastError: null,
      // Kapan terakhir kali ada kemajuan nyata (fase berubah / persen naik).
      // Dipakai watchdog untuk membedakan "sedang sibuk" dari "macet".
      lastProgressAt: null,
    };
  }

  /**
   * @param connectionId kunci entry
   * @param companyId wajib saat entry pertama kali dibuat; entry perlu tahu
   *   miliknya siapa supaya bisa menyiarkan ke pendengar SSE company itu.
   */
  _getEntry(connectionId, companyId = null) {
    if (!this._entries.has(connectionId)) {
      this._entries.set(connectionId, {
        connectionId,
        companyId,
        client: null,
        state: this._makeState(),
        qrMirrorTimer: null,
        restoredSessionTimer: null,
      });
    }
    const entry = this._entries.get(connectionId);
    if (companyId && !entry.companyId) entry.companyId = companyId;
    return entry;
  }

  /** Semua connectionId milik satu company yang pernah disentuh manager. */
  listConnectionIds(companyId) {
    return [...this._entries.values()]
      .filter((entry) => entry.companyId === companyId)
      .map((entry) => entry.connectionId);
  }

  /** connectionId untuk tiap client yang hidup di satu company. */
  liveConnectionIds(companyId) {
    return [...this._entries.values()]
      .filter((entry) => entry.companyId === companyId && entry.client)
      .map((entry) => entry.connectionId);
  }

  /** Returns the live WA Client instance for one connection, or null. */
  getClient(connectionId) {
    return this._entries.get(connectionId)?.client || null;
  }

  /** Returns the live state object (by reference) for one connection. */
  getState(connectionId) {
    return this._getEntry(connectionId).state;
  }

  /** Returns the public-facing state snapshot for one connection. */
  publicState(connectionId, demoMode = false) {
    const s = this.getState(connectionId);
    return {
      phase: s.phase,
      connectedAt: s.connectedAt,
      account: s.account,
      syncPercent: s.syncPercent,
      hasQr: Boolean(s.qrDataUrl) || demoMode,
      demoMode,
      lastError: s.lastError,
    };
  }

  /**
   * Satu-satunya tempat sebuah company dinyatakan 'ready'.
   *
   * Sebelumnya ada dua jalur yang menulis fase ini sendiri-sendiri (event
   * 'ready' dari whatsapp-web.js dan watchdog sesi yang dipulihkan), dan jalur
   * watchdog lupa membersihkan `qrDataUrl`/`syncPercent` — sehingga status
   * publik masih melaporkan `hasQr: true` padahal sudah tersambung.
   */
  _markReady(connectionId, account, log, onStatusUpdate, findDuplicate) {
    const entry = this._getEntry(connectionId);
    const state = entry.state;
    const resolved = account || null;
    if (resolved && findDuplicate) {
      if (entry.rejecting) return;
      entry.rejecting = true; // menahan 'ready' ganda dari watchdog selama pengecekan
      Promise.resolve(findDuplicate(entry.companyId, resolved, connectionId)).catch(() => null).then((holder) => {
        if (holder) return this._rejectDuplicate(connectionId, holder, log, onStatusUpdate);
        entry.rejecting = false;
        return this._markReady(connectionId, account, log, onStatusUpdate, null);
      });
      return;
    }
    // Watchdog dan event 'ready' bawaan whatsapp-web.js bisa sampai duluan
    // bergantian. Tanpa penjaga ini keduanya menyiarkan 'ready', dan setiap
    // browser yang terhubung memuat ulang workspace dua kali.
    if (state.phase === 'ready' && state.account === resolved) return;
    this._clearQrMirror(connectionId);
    clearTimeout(entry.restoredSessionTimer);
    entry.restoredSessionTimer = null;
    state.phase = 'ready';
    state.connectedAt = new Date().toISOString();
    state.account = resolved;
    state.qrDataUrl = null;
    state.qrPayload = null;
    state.qrGeneratedAt = null;
    state.pairingCode = null;
    state.pairingCodeAt = null;
    state.syncPercent = 100;
    state.lastError = null;
    state.lastProgressAt = Date.now();
    log?.info({ account: state.account, connectionId }, 'WhatsApp ready');
    this.broadcast(entry.companyId, 'whatsapp_phase', {
      phase: 'ready', account: state.account, connectionId,
    });
    onStatusUpdate?.(entry.companyId, 'ready', state.account, connectionId)?.catch?.(() => {});
  }

  /**
   * Nomor yang sama sudah dipakai company lain: putuskan perangkat tertaut ini
   * dari WhatsApp dan minta pengguna sign out di tempat lain dulu.
   */
  async _rejectDuplicate(connectionId, holder, log, onStatusUpdate) {
    const entry = this._getEntry(connectionId);
    const state = entry.state;
    const message = `Nomor ini masih tersambung di akun ${maskCompanyName(holder.companyName)}. `
      + 'Satu nomor hanya boleh dipakai di satu akun Agnee. '
      + `Sign out dulu nomor ini dari WhatsApp di akun ${maskCompanyName(holder.companyName)}, lalu sambungkan lagi di sini.`;
    log?.warn({ connectionId, holderConnectionId: holder.connectionId }, 'WhatsApp number already connected in another company; rejecting');
    entry.rejecting = true;
    clearTimeout(entry.restoredSessionTimer);
    entry.restoredSessionTimer = null;
    try { await entry.client?.logout(); } catch { /* sudah putus */ }
    await this.stopClient(connectionId).catch(() => {});
    this._clearQrMirror(connectionId);
    state.phase = 'error';
    state.account = null;
    state.connectedAt = null;
    state.qrDataUrl = null;
    state.syncPercent = null;
    state.lastError = message;
    this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'error', error: message, connectionId });
    onStatusUpdate?.(entry.companyId, 'disconnected', null, connectionId)?.catch?.(() => {});
    // 'disconnected' dari logout bisa datang terlambat; jangan biarkan memulai ulang client.
    setTimeout(() => { entry.rejecting = false; }, 8000).unref?.();
  }

  /**
   * Putus atas perintah supervisor: logout dari WhatsApp lalu biarkan mati.
   * Beda dengan logout biasa, tidak ada client baru dengan QR — klien hanya
   * dinyalakan lagi saat supervisor membuka dialog QR (`qr-refresh`).
   */
  async disconnect(connectionId, log, onStatusUpdate) {
    const entry = this._getEntry(connectionId);
    const state = entry.state;
    entry.rejecting = true; // menahan handler 'disconnected' yang memulai ulang client
    clearTimeout(entry.restoredSessionTimer);
    entry.restoredSessionTimer = null;
    try { await entry.client?.logout(); } catch { /* sudah putus */ }
    await this.stopClient(connectionId).catch(() => {});
    this._clearQrMirror(connectionId);
    state.phase = 'disconnected';
    state.account = null;
    state.connectedAt = null;
    state.qrDataUrl = null;
    state.qrPayload = null;
    state.qrGeneratedAt = null;
    state.pairingCode = null;
    state.pairingCodeAt = null;
    state.syncPercent = null;
    state.lastError = null;
    log?.info({ connectionId }, 'WhatsApp disconnected by supervisor');
    this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'disconnected', connectionId });
    await onStatusUpdate?.(entry.companyId, 'disconnected', null, connectionId)?.catch?.(() => {});
    setTimeout(() => { entry.rejecting = false; }, 8000).unref?.();
  }

  /** Broadcast an SSE event to every listener of a company. */
  broadcast(companyId, event, payload) {
    const listeners = this._sse.get(companyId);
    if (!listeners?.size) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const raw of listeners) {
      try {
        raw.write(frame);
      } catch {
        listeners.delete(raw);
      }
    }
  }

  /**
   * Kirim event ke aliran milik SATU pengguna saja.
   *
   * Notifikasi bersifat pribadi: siapa menyebut siapa, dan siapa ditugaskan ke
   * chat mana, bukan sesuatu yang boleh sampai ke semua orang di company.
   * Karena itu ini menyaring per userId, bukan memakai broadcast biasa.
   */
  broadcastToUser(companyId, userId, event, payload) {
    if (!userId) return;
    const listeners = this._sse.get(companyId);
    if (!listeners?.size) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const raw of listeners) {
      if (this._sseUsers.get(raw) !== userId) continue;
      try {
        raw.write(frame);
      } catch {
        listeners.delete(raw);
      }
    }
  }

  addSseClient(companyId, raw, userId = null) {
    if (!this._sse.has(companyId)) this._sse.set(companyId, new Set());
    this._sse.get(companyId).add(raw);
    // WeakMap, bukan properti di objek stream: pemiliknya aliran itu sendiri,
    // dan entrinya hilang sendiri begitu streamnya dikumpulkan.
    if (userId) this._sseUsers.set(raw, userId);
  }

  removeSseClient(companyId, raw) {
    this._sse.get(companyId)?.delete(raw);
    this._sseUsers.delete(raw);
  }

  totalSseClients() {
    let n = 0;
    for (const listeners of this._sse.values()) n += listeners.size;
    return n;
  }

  /** Berapa aliran SSE hidup milik SATU company. */
  sseClientCount(companyId) {
    return this._sse.get(companyId)?.size || 0;
  }

  /**
   * Boleh tidak company ini menambah satu aliran SSE lagi.
   *
   * Plafonnya dulu satu angka global (50 untuk seluruh server), jadi company
   * yang ramai menghabiskan jatah company lain: pelanggan yang tidak melakukan
   * apa pun kehilangan pembaruan realtime karena tetangganya membuka banyak
   * tab. Sekarang plafon per company yang menggigit lebih dulu — yang kena
   * batas adalah yang menyebabkannya — dan plafon global tetap ada di atasnya
   * untuk melindungi proses, bukan untuk membagi jatah antar tenant.
   */
  canAcceptSseClient(companyId) {
    if (this.sseClientCount(companyId) >= WhatsappManager.SSE_MAX_PER_COMPANY) {
      return { ok: false, reason: 'company' };
    }
    if (this.totalSseClients() >= WhatsappManager.SSE_MAX_TOTAL) {
      return { ok: false, reason: 'total' };
    }
    return { ok: true };
  }

  /**
   * Berapa company yang punya minimal satu client hidup — dipakai health yang
   * tidak terikat tenant. Dihitung per company, bukan per koneksi: satu company
   * dengan tiga nomor tetap satu company.
   */
  activeCompanyCount() {
    const companies = new Set();
    for (const e of this._entries.values()) if (e.client) companies.add(e.companyId);
    return companies.size;
  }

  // ── QR mirror helpers ──────────────────────────────────────────────────────

  _clearQrMirror(connectionId) {
    const entry = this._entries.get(connectionId);
    if (!entry) return;
    clearInterval(entry.qrMirrorTimer);
    entry.qrMirrorTimer = null;
  }

  async _setCurrentQr(connectionId, payload, source, log) {
    if (!payload) return false;
    const entry = this._getEntry(connectionId);
    const officialQr = String(payload).startsWith('https://wa.me/settings/linked_devices#')
      ? String(payload)
      : `https://wa.me/settings/linked_devices#${payload}`;
    if (officialQr === entry.state.qrPayload) return false;
    entry.state.phase = 'waiting_for_qr';
    entry.state.qrPayload = officialQr;
    entry.state.qrDataUrl = await QRCode.toDataURL(officialQr, { margin: 1, width: 320 });
    entry.state.qrGeneratedAt = new Date().toISOString();
    entry.state.syncPercent = null;
    entry.state.lastError = null;
    log?.info({ source, connectionId }, 'WhatsApp QR generated');
    this.broadcast(entry.companyId, 'whatsapp_phase', {
      phase: 'waiting_for_qr',
      connectionId,
      qrDataUrl: entry.state.qrDataUrl,
      qrGeneratedAt: entry.state.qrGeneratedAt,
    });
    return true;
  }

  async mirrorCurrentQrFromBrowser(connectionId, log) {
    const entry = this._entries.get(connectionId);
    if (!entry) return false;
    const { client, state } = entry;
    if (state.phase !== 'waiting_for_qr' || !client?.pupPage || client.pupPage.isClosed()) return false;
    try {
      const currentQr = await client.pupPage.evaluate(() => (
        document.querySelector('[data-ref^="https://wa.me/settings/linked_devices#"]')?.getAttribute('data-ref') || null
      ));
      return await this._setCurrentQr(connectionId, currentQr, 'browser', log);
    } catch (error) {
      log?.debug({ err: error }, 'Could not mirror current WhatsApp QR');
      return false;
    }
  }

  _startQrMirror(connectionId, log) {
    const entry = this._getEntry(connectionId);
    if (entry.qrMirrorTimer) return;
    entry.qrMirrorTimer = setInterval(() => {
      this.mirrorCurrentQrFromBrowser(connectionId, log).catch(() => {});
    }, 2_000);
    entry.qrMirrorTimer.unref?.();
  }

  // ── Pairing lewat nomor HP ─────────────────────────────────────────────────

  /**
   * Minta kode 8 karakter untuk menautkan nomor tanpa QR (di HP: WhatsApp →
   * Perangkat Tertaut → Tautkan dengan nomor telepon). Hanya masuk akal selagi
   * client menunggu pairing. Tiap permintaan menyalakan notifikasi di HP
   * tujuan, jadi ada jeda minimum supaya tombolnya tidak bisa dipakai
   * membombardir sebuah nomor.
   */
  async requestPairingCode(connectionId, phoneNumber, log) {
    const entry = this._entries.get(connectionId);
    const client = entry?.client;
    const state = entry?.state;
    if (!client?.pupPage || client.pupPage.isClosed() || state.phase !== 'waiting_for_qr') {
      throw pairingError(409, 'Nomor belum siap dipasangkan. Tunggu sebentar sampai kode QR muncul, lalu coba lagi.');
    }
    const wait = PAIRING_COOLDOWN_MS - (Date.now() - state.pairingRequestedAt);
    if (wait > 0) {
      throw pairingError(429, `Tunggu ${Math.ceil(wait / 1000)} detik sebelum meminta kode lagi.`);
    }
    state.pairingRequestedAt = Date.now();
    let code;
    try {
      code = await client.requestPairingCode(phoneNumber, true);
    } catch (error) {
      log?.warn({ err: error, connectionId }, 'Could not request WhatsApp pairing code');
      throw pairingError(502, 'WhatsApp tidak memberi kode. Pastikan nomornya benar dan terdaftar di WhatsApp, lalu coba lagi.');
    }
    state.pairingCode = String(code);
    state.pairingCodeAt = new Date().toISOString();
    return { code: state.pairingCode, generatedAt: state.pairingCodeAt };
  }

  /** Kode pairing terbaru untuk satu nomor, atau null bila belum/tidak berlaku. */
  currentPairingCode(connectionId) {
    const state = this._entries.get(connectionId)?.state;
    if (!state?.pairingCode || state.phase !== 'waiting_for_qr') return null;
    return { code: state.pairingCode, generatedAt: state.pairingCodeAt };
  }

  // ── Session quarantine ─────────────────────────────────────────────────────

  quarantineProfile(connectionId, sessionPath, clientId, log) {
    const profilePath = path.join(sessionPath, `session-${clientId}`);
    if (!fs.existsSync(profilePath)) return null;
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `session-${clientId}-stale-${suffix}`;
    fs.renameSync(profilePath, path.join(sessionPath, backupName));
    log?.warn({ backupName }, 'Corrupt WhatsApp session moved aside for fresh pairing');
    return backupName;
  }

  // ── Client creation ────────────────────────────────────────────────────────

  _createClient(connectionId, clientId, sessionPath, callbacks) {
    const entry = this._getEntry(connectionId);
    const companyId = entry.companyId;
    const { log, onMessage, onOwnMessage, onStatusUpdate, findDuplicate } = callbacks;
    const state = entry.state;

    // Remove Chromium singleton locks left over from container restarts
    const profilePath = path.join(sessionPath, `session-${clientId}`);
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { fs.rmSync(path.join(profilePath, f), { force: true }); } catch { /* profile may not exist yet */ }
    }

    const wa = new Client({
      authStrategy: new LocalAuth({ clientId, dataPath: sessionPath }),
      // Default 'local' writes ./.wwebjs_cache next to cwd; in the container /app
      // is root-owned and we run as uid 1000, so that mkdir throws EACCES before
      // the page helpers get injected and the client never reaches 'ready'.
      webVersionCache: { type: 'none' },
      puppeteer: {
        headless: true,
        executablePath: resolveBrowserExecutable(),
        protocolTimeout: 240_000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      },
    });

    entry.client = wa;
    // Client baru = pairing baru; kode dari client sebelumnya sudah tidak berlaku.
    state.pairingCode = null;
    state.pairingCodeAt = null;

    wa.on('qr', async (qr) => {
      await this._setCurrentQr(connectionId, qr, 'event', log);
      this._startQrMirror(connectionId, log);
      onStatusUpdate?.(companyId, 'waiting_for_qr', null, connectionId).catch(() => {});
    });

    // whatsapp-web.js menembakkan ulang 'code' tiap ±3 menit selama nomor
    // belum tertaut; simpan yang terbaru supaya dialog tidak menampilkan kode basi.
    wa.on('code', (code) => {
      state.pairingCode = String(code);
      state.pairingCodeAt = new Date().toISOString();
    });

    wa.on('authenticated', () => {
      if (state.phase === 'ready') return;
      this._clearQrMirror(connectionId);
      state.phase = 'authenticated';
      state.qrDataUrl = null;
      state.qrPayload = null;
      state.qrGeneratedAt = null;
      state.pairingCode = null;
      state.pairingCodeAt = null;
      state.lastError = null;
      state.lastProgressAt = Date.now();
      log?.info({ connectionId }, 'WhatsApp authenticated');
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'authenticated', connectionId });
    });

    wa.on('loading_screen', (percent) => {
      if (state.phase === 'ready') return;
      this._clearQrMirror(connectionId);
      state.phase = 'syncing';
      state.qrDataUrl = null;
      state.qrPayload = null;
      state.qrGeneratedAt = null;
      state.pairingCode = null;
      state.pairingCodeAt = null;
      const next = Number(percent);
      // Hanya persen yang benar-benar berubah yang dihitung sebagai kemajuan.
      // WhatsApp Web menembakkan 100% berkali-kali; kalau itu ikut dihitung,
      // watchdog tidak akan pernah melihat client yang macet di 100%.
      if (next !== state.syncPercent) state.lastProgressAt = Date.now();
      state.syncPercent = next;
      state.lastError = null;
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'syncing', percent: state.syncPercent, connectionId });
    });

    wa.on('ready', () => {
      this._markReady(connectionId, wa.info?.wid?._serialized, log, onStatusUpdate, findDuplicate);
    });

    wa.on('auth_failure', (msg) => {
      state.phase = 'auth_failure';
      state.syncPercent = null;
      state.lastError = String(msg);
      log?.warn({ msg, connectionId }, 'WhatsApp auth_failure');
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'auth_failure', connectionId });
    });

    wa.on('disconnected', (reason) => {
      if (entry.rejecting) return;
      this._clearQrMirror(connectionId);
      state.phase = 'disconnected';
      state.pairingCode = null;
      state.pairingCodeAt = null;
      state.connectedAt = null;
      state.account = null;
      state.syncPercent = null;
      state.lastError = String(reason);
      log?.warn({ reason, connectionId }, 'WhatsApp disconnected');
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'disconnected', connectionId });
      onStatusUpdate?.(companyId, 'disconnected', null, connectionId).catch(() => {});
      setTimeout(async () => {
        try { await entry.client?.destroy().catch(() => {}); } catch { /* ignore */ }
        entry.client = null;
        state.phase = 'starting';
        state.syncPercent = null;
        state.lastError = null;
        log?.info({ connectionId }, 'WhatsApp restarting after disconnect');
        this.broadcast(companyId, 'whatsapp_phase', { phase: 'starting', connectionId });
        this._createClient(connectionId, clientId, sessionPath, callbacks);
        entry.client.initialize().catch((error) => {
          state.phase = 'error';
          state.lastError = error.message;
          log?.error({ err: error }, 'WhatsApp re-initialization failed');
        });
      }, 3000);
    });

    wa.on('message', async (message) => {
      if (message.fromMe || message.from === 'status@broadcast') return;
      try {
        // Objek, bukan string: penerimanya membaca `meta.connectionId`. Selama
        // ini string yang dikirim, jadi `inbound_messages.connection_id`
        // selalu kosong dan tidak ada yang tahu nomor mana yang menerima.
        await onMessage?.(companyId, message, { connectionId });
      } catch (error) {
        log?.error({ err: error }, 'Inbound message handling failed');
      }
    });

    wa.on('message_create', (message) => {
      if (message.from === 'status@broadcast') return;
      this.broadcast(companyId, 'message', {
        id: message.id?._serialized || null,
        chatId: message.fromMe ? message.to : message.from,
        fromMe: Boolean(message.fromMe),
        timestamp: message.timestamp || Math.floor(Date.now() / 1000),
        type: message.type || 'chat',
      });
      // Pesan kita sendiri: kiriman Agnee DAN yang diketik tim langsung di HP.
      // Penerimanya yang membedakan keduanya.
      if (message.fromMe) {
        Promise.resolve(onOwnMessage?.(companyId, message, { connectionId }))
          .catch((error) => log?.warn({ err: error }, 'Own message handling failed'));
      }
    });

    wa.on('message_ack', (message, ack) => {
      this.broadcast(companyId, 'ack', { id: message.id?._serialized || null, ack: Number(ack) });
    });

    wa.on('chat_archived', (chat, archived) => {
      this.broadcast(companyId, 'chat', {
        chatId: chat.id?._serialized || null,
        archived: Boolean(archived),
      });
    });

    return wa;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start a WA client for a company. No-op if already running.
   * @param {string} companyId
   * @param {{ clientId: string, sessionPath: string }} connConfig
   * @param {{ log, onMessage, onOwnMessage, onStatusUpdate }} callbacks
   */
  async startFor(connectionId, { companyId, clientId, sessionPath }, callbacks = {}) {
    const entry = this._getEntry(connectionId, companyId);
    if (entry.client) return; // already running

    const { log } = callbacks;
    entry.state.phase = 'starting';

    let initRetries = 0;
    const initWithRetry = () => {
      this._createClient(connectionId, clientId, sessionPath, callbacks);
      entry.client.initialize().catch((error) => {
        entry.state.phase = 'error';
        entry.state.lastError = error.message;
        log?.error({ err: error }, 'WhatsApp initialization failed');
        this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'error', error: error.message, connectionId });
        if (initRetries < 2) {
          initRetries += 1;
          const delay = initRetries * 10_000;
          log?.info(`WhatsApp will auto-retry in ${delay / 1000}s (attempt ${initRetries}/2)`);
          setTimeout(() => {
            if (entry.state.phase !== 'error') return;
            const stale = entry.client;
            entry.client = null;
            stale?.destroy().catch(() => {});
            entry.state.phase = 'starting';
            entry.state.lastError = null;
            this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'starting', connectionId });
            initWithRetry();
          }, delay);
        }
      });
    };
    initWithRetry();

    // ── Watchdog sampai 'ready' ────────────────────────────────────────────
    //
    // Versi lama hanya berjalan selama fase 'starting' atau 'authenticated'.
    // Begitu WhatsApp menembakkan `loading_screen`, fase berubah jadi 'syncing'
    // dan tick berikutnya langsung keluar sambil menghapus timernya — jadi
    // kalau 'ready' tidak pernah datang setelah itu (renderer Chromium mati,
    // helper WWebJS gagal ter-inject), tidak ada lagi yang memulihkan. Fase
    // bertahan di 'syncing' 100% selamanya dan UI berputar tanpa ujung sampai
    // container di-restart. Itu persis gejala yang berulang.
    //
    // Sekarang watchdog ikut mengawasi 'syncing', punya batas waktu nyata, dan
    // kalau menyerah ia melaporkan 'error' — bukan diam. Fase error bisa
    // ditindaklanjuti UI dan `/v1/whatsapp/qr-refresh` (yang memang mem-
    // quarantine profil lalu memulai ulang), sedangkan 'syncing' tidak.
    const PENDING_PHASES = ['starting', 'authenticated', 'syncing'];
    let startedAt = Date.now();
    // Halaman yang hang menjawab getState()/evaluate() tidak pernah. Tanpa
    // batas, tick menunggu selamanya, tidak menjadwal ulang, dan batas 5 menit
    // di bawah tidak pernah tercapai: Citilux (11 Okt) tertahan di
    // 'authenticated' tanpa satu baris log pun.
    const PAGE_CALL_TIMEOUT_MS = 15_000;
    const within = (promise, fallback) => {
      let timer;
      return Promise.race([
        promise,
        new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), PAGE_CALL_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
    };
    // Dua kali, bukan sekali: Citilux (11 Okt) di-restart karena helper belum
    // dimuat, lalu client barunya hang di 'authenticated' dan tidak ada yang
    // mengawasinya lagi karena restart tidak menjadwal tick baru.
    const MAX_RESTARTS = 2;
    // Halaman yang baru tersambung memang belum memuat helper-nya; dulu
    // keempat nomor di-restart di setiap deploy karena dicek terlalu cepat.
    const HELPER_GRACE_MS = 60_000;
    // whatsapp-web.js biasanya selesai memasang pendengar dalam beberapa detik
    // setelah helper dimuat; 30 detik tanpa pendengar berarti ia macet.
    const LISTENER_GRACE_MS = 30_000;
    let listenersMissingSince = 0;
    let restarts = 0;
    let crashHandlersAttached = false;

    const restartOnce = async (reason) => {
      restarts += 1;
      listenersMissingSince = 0;
      // Client baru mendapat jatah 5 menit sendiri, dan pengawas crash-nya sendiri.
      startedAt = Date.now();
      crashHandlersAttached = false;
      log?.warn({ reason, connectionId }, 'Restarting WhatsApp client');
      entry.restoredSessionTimer = null;
      const stale = entry.client;
      entry.client = null;
      await stale?.destroy().catch(() => {});
      entry.state.phase = 'starting';
      entry.state.lastError = null;
      entry.state.lastProgressAt = Date.now();
      this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'starting', connectionId });
      this._createClient(connectionId, clientId, sessionPath, callbacks);
      entry.client.initialize().catch((error) => {
        entry.state.phase = 'error';
        entry.state.lastError = error.message;
        log?.error({ err: error }, 'WhatsApp re-initialization failed');
        this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'error', error: error.message, connectionId });
      });
      // Tanpa ini pengawasan berakhir di sini: client baru yang hang tidak
      // pernah dicek lagi.
      schedule();
    };

    const giveUp = (reason) => {
      entry.restoredSessionTimer = null;
      entry.state.phase = 'error';
      entry.state.syncPercent = null;
      entry.state.lastError = reason;
      log?.error({ reason, connectionId }, 'WhatsApp never reached ready; marking connection as failed');
      this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'error', error: reason, connectionId });
      callbacks.onStatusUpdate?.(entry.companyId, 'error', null, connectionId)?.catch?.(() => {});
    };

    /**
     * Renderer Chromium yang mati tidak memicu event `disconnected` milik
     * whatsapp-web.js — event itu hanya untuk logout di sisi WhatsApp. Tanpa
     * ini, browser yang kena OOM-kill menggantung tanpa jejak apa pun.
     */
    const attachCrashHandlers = () => {
      if (crashHandlersAttached) return;
      const wa = entry.client;
      const page = wa?.pupPage;
      if (!page) return;
      crashHandlersAttached = true;
      // Hanya bertindak kalau client ini masih client yang aktif — `destroy()`
      // yang kita panggil sendiri selalu menyetel `entry.client = null` lebih
      // dulu, jadi penutupan yang disengaja tidak ikut tertangkap di sini.
      const onDead = (why) => {
        if (entry.client !== wa) return;
        if (!PENDING_PHASES.includes(entry.state.phase) && entry.state.phase !== 'ready') return;
        log?.error({ why }, 'WhatsApp browser died');
        if (restarts >= MAX_RESTARTS) return giveUp(`Browser WhatsApp berhenti: ${why}`);
        restartOnce(why).catch(() => {});
      };
      page.once('close', () => onDead('halaman tertutup'));
      page.on('error', (err) => onDead(err?.message || 'halaman crash'));
      wa.pupBrowser?.once?.('disconnected', () => onDead('browser terputus'));
    };

    const tick = async () => {
      entry.restoredSessionTimer = null;
      const state = entry.state;
      if (!PENDING_PHASES.includes(state.phase)) return; // ready / error / disconnected
      if (Date.now() - startedAt > RESUME_DEADLINE_MS) {
        if (restarts < MAX_RESTARTS) return restartOnce('tidak siap dalam 5 menit');
        return giveUp('WhatsApp tidak selesai tersambung dalam 5 menit. Coba hubungkan ulang.');
      }
      if (!entry.client?.pupPage) return schedule(); // client sedang dibuat ulang

      attachCrashHandlers();

      try {
        const connectionState = await within(entry.client.getState().catch(() => null), null);
        if (connectionState === 'CONNECTED') {
          const injected = await within(entry.client.pupPage
            .evaluate(() => Boolean(window.WWebJS)).catch(() => false), false);

          if (!injected) {
            if (Date.now() - startedAt < HELPER_GRACE_MS) return schedule();
            if (restarts < MAX_RESTARTS) return restartOnce('socket tersambung tapi helper halaman tidak pernah dimuat');
            log?.warn('WhatsApp page helpers still missing after restart; will keep waiting');
            return schedule();
          }

          // Selama persennya masih bergerak, biarkan whatsapp-web.js
          // menyelesaikan sinkronisasinya sendiri — memaksa 'ready' di tengah
          // sync yang sehat hanya menukar satu bug dengan bug lain.
          const stalled = Date.now() - (state.lastProgressAt || startedAt) > SYNC_STALL_MS;
          if (state.phase === 'syncing' && !stalled) return schedule();

          // Helper ada belum berarti pendengar pesan terpasang: whatsapp-web.js
          // bisa berhenti di tengah attachEventListeners dan tidak pernah
          // menembakkan 'ready'. Menyatakan 'ready' di sini tanpa memeriksa
          // menghasilkan nomor "Connected" yang tuli.
          //
          // Helper muncul SEBELUM whatsapp-web.js selesai memasang pendengar,
          // jadi pada start normal probe pertama memang 0. Memasang ulang saat
          // itu = dua attachEventListeners bersamaan = pendengar dobel. Baru
          // turun tangan setelah LISTENER_GRACE_MS tanpa kemajuan.
          const wa = entry.client;
          let probe = await probeClient(wa);
          if (entry.client !== wa) return schedule();
          if (isDeafProbe(probe)) {
            listenersMissingSince ||= Date.now();
            if (Date.now() - listenersMissingSince < LISTENER_GRACE_MS) return schedule();
            probe = await repairListeners(wa, { log, connectionId });
            if (entry.client !== wa) return schedule();
          }
          if (isDeafProbe(probe)) {
            if (restarts < MAX_RESTARTS) return restartOnce('tersambung tapi pendengar pesan tidak terpasang');
            log?.error({ connectionId, probe }, 'WhatsApp listeners still missing after restart; marking ready, watchdog keeps checking');
          }

          return this._markReady(
            connectionId,
            entry.client.info?.wid?._serialized,
            log,
            callbacks.onStatusUpdate,
            callbacks.findDuplicate,
          );
        }
      } catch (error) {
        log?.warn({ err: error }, 'Could not resume WhatsApp session');
      }
      return schedule();
    };

    const schedule = () => {
      entry.restoredSessionTimer = setTimeout(() => { tick().catch(() => {}); }, RESUME_TICK_MS);
      entry.restoredSessionTimer.unref?.();
    };

    schedule();
    this._startDeafWatchdog(connectionId, { clientId, sessionPath }, callbacks);
  }

  /**
   * Penjaga tuli per koneksi: saat fase 'ready', probe halaman tiap menit.
   * Dua probe gagal beruntun -> hanya client ini yang dibuat ulang; koneksi
   * lain tidak tersentuh. Maks 3 restart per jam, lalu menyerah ke 'error'.
   */
  _startDeafWatchdog(connectionId, { clientId, sessionPath }, callbacks) {
    const entry = this._getEntry(connectionId);
    const { log } = callbacks;
    clearInterval(entry.deafTimer);
    let fails = 0;
    let busy = false;
    const restarts = [];

    entry.deafTimer = setInterval(async () => {
      if (busy) return;
      const wa = entry.client;
      if (!wa || entry.state.phase !== 'ready' || !wa.pupPage) { fails = 0; return; }
      busy = true;
      try {
        const result = await probeClient(wa);
        if (entry.client !== wa) return;
        if (!isDeafProbe(result)) { fails = 0; return; }
        fails += 1;
        log?.warn({ connectionId, fails, probe: result }, 'WhatsApp client looks deaf');
        if (fails < DEAF_FAILS_TO_RESTART) return;
        fails = 0;
        // Pendengar yang hilang total dipasang ulang di halaman yang sama:
        // tanpa Chromium baru, tanpa risiko sesi rusak, dan nomor lain tak terganggu.
        const repaired = await repairListeners(wa, { log, connectionId });
        if (entry.client !== wa) return;
        if (!isDeafProbe(repaired)) return;
        const now = Date.now();
        while (restarts.length && now - restarts[0] > 3_600_000) restarts.shift();
        if (restarts.length >= DEAF_MAX_RESTARTS_PER_HOUR) {
          entry.state.phase = 'error';
          entry.state.lastError = 'WhatsApp tidak merespons berulang kali. Coba hubungkan ulang.';
          this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'error', error: entry.state.lastError, connectionId });
          callbacks.onStatusUpdate?.(entry.companyId, 'error', null, connectionId)?.catch?.(() => {});
          return;
        }
        restarts.push(now);
        log?.error({ connectionId }, 'Restarting deaf WhatsApp client');
        // Hanya koneksi ini: stopClient lalu startFor memasang watchdog baru.
        await this.stopClient(connectionId);
        clearInterval(entry.deafTimer);
        entry.state.phase = 'starting';
        entry.state.lastError = null;
        this.broadcast(entry.companyId, 'whatsapp_phase', { phase: 'starting', connectionId });
        await this.startFor(connectionId, { companyId: entry.companyId, clientId, sessionPath }, callbacks);
      } catch (error) {
        log?.warn({ err: error, connectionId }, 'Deaf watchdog check failed');
      } finally {
        busy = false;
      }
    }, DEAF_PROBE_INTERVAL_MS);
    entry.deafTimer.unref?.();
  }

  /**
   * Tear down the WA client for a company (but keep the entry).
   */
  async stopClient(connectionId) {
    const entry = this._entries.get(connectionId);
    if (!entry) return;
    this._clearQrMirror(connectionId);
    clearTimeout(entry.restoredSessionTimer);
    entry.restoredSessionTimer = null;
    clearInterval(entry.deafTimer);
    entry.deafTimer = null;
    const stale = entry.client;
    entry.client = null;
    if (stale) await stale.destroy().catch(() => {});
  }

  /**
   * Destroy everything for one company (including SSE connections).
   */
  async destroyCompany(companyId) {
    for (const connectionId of this.listConnectionIds(companyId)) {
      await this.stopClient(connectionId).catch(() => {});
      this._entries.delete(connectionId);
    }
    const listeners = this._sse.get(companyId);
    if (listeners) {
      for (const raw of listeners) {
        try { raw.end(); } catch { /* ignore */ }
      }
      listeners.clear();
      this._sse.delete(companyId);
    }
  }

  /**
   * Destroy every client of every company, all at once. Closing browsers one
   * by one can outlast the container's stop grace period; the leftover
   * Chromium is then SIGKILLed mid-write and WhatsApp Web's IndexedDB comes
   * back empty (QR login again). 12 Okt 2026: AL Gold FX and Beweix Digital.
   */
  async destroyAll() {
    const companyIds = new Set([...this._entries.values()].map((e) => e.companyId));
    await Promise.all([...companyIds].map((companyId) => this.destroyCompany(companyId).catch(() => {})));
    this._entries.clear();
    this._sse.clear();
  }
}

module.exports = { WhatsappManager, isDeafProbe, canReattach, repairListeners, deafProbeInPage, maskCompanyName, resolveBrowserExecutable, normalizePairingPhone };
