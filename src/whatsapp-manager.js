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
 *   { log, onMessage(companyId, message), onStatusUpdate(companyId, status, phoneNumber) }
 */
class WhatsappManager {
  constructor() {
    this._entries = new Map(); // companyId -> entry
  }

  _makeState(phase = 'disabled') {
    return {
      phase,
      qrDataUrl: null,
      qrPayload: null,
      qrGeneratedAt: null,
      connectedAt: null,
      account: null,
      syncPercent: null,
      lastError: null,
      // Kapan terakhir kali ada kemajuan nyata (fase berubah / persen naik).
      // Dipakai watchdog untuk membedakan "sedang sibuk" dari "macet".
      lastProgressAt: null,
    };
  }

  _getEntry(companyId) {
    if (!this._entries.has(companyId)) {
      this._entries.set(companyId, {
        client: null,
        state: this._makeState(),
        sseClients: new Set(),
        qrMirrorTimer: null,
        restoredSessionTimer: null,
      });
    }
    return this._entries.get(companyId);
  }

  /** Returns the live WA Client instance for a company, or null. */
  getClient(companyId) {
    return this._entries.get(companyId)?.client || null;
  }

  /** Returns the live state object (by reference) for a company. */
  getState(companyId) {
    return this._getEntry(companyId).state;
  }

  /** Returns the public-facing state snapshot for a company. */
  publicState(companyId, demoMode = false) {
    const s = this.getState(companyId);
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
  _markReady(companyId, account, log, onStatusUpdate) {
    const entry = this._getEntry(companyId);
    const state = entry.state;
    this._clearQrMirror(companyId);
    clearTimeout(entry.restoredSessionTimer);
    entry.restoredSessionTimer = null;
    state.phase = 'ready';
    state.connectedAt = new Date().toISOString();
    state.account = account || null;
    state.qrDataUrl = null;
    state.qrPayload = null;
    state.qrGeneratedAt = null;
    state.syncPercent = 100;
    state.lastError = null;
    state.lastProgressAt = Date.now();
    log?.info({ account: state.account }, 'WhatsApp ready');
    this.broadcast(companyId, 'whatsapp_phase', { phase: 'ready', account: state.account });
    onStatusUpdate?.(companyId, 'ready', state.account)?.catch?.(() => {});
  }

  /** Broadcast an SSE event to all connected clients for a company. */
  broadcast(companyId, event, payload) {
    const entry = this._entries.get(companyId);
    if (!entry) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const raw of entry.sseClients) {
      try {
        raw.write(frame);
      } catch {
        entry.sseClients.delete(raw);
      }
    }
  }

  addSseClient(companyId, raw) {
    this._getEntry(companyId).sseClients.add(raw);
  }

  removeSseClient(companyId, raw) {
    this._entries.get(companyId)?.sseClients.delete(raw);
  }

  totalSseClients() {
    let n = 0;
    for (const e of this._entries.values()) n += e.sseClients.size;
    return n;
  }

  /** Number of companies with a live WA client — used by tenant-agnostic health. */
  activeCompanyCount() {
    let n = 0;
    for (const e of this._entries.values()) if (e.client) n += 1;
    return n;
  }

  // ── QR mirror helpers ──────────────────────────────────────────────────────

  _clearQrMirror(companyId) {
    const entry = this._entries.get(companyId);
    if (!entry) return;
    clearInterval(entry.qrMirrorTimer);
    entry.qrMirrorTimer = null;
  }

  async _setCurrentQr(companyId, payload, source, log) {
    if (!payload) return false;
    const entry = this._getEntry(companyId);
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
    log?.info({ source }, 'WhatsApp QR generated');
    this.broadcast(companyId, 'whatsapp_phase', {
      phase: 'waiting_for_qr',
      qrDataUrl: entry.state.qrDataUrl,
      qrGeneratedAt: entry.state.qrGeneratedAt,
    });
    return true;
  }

  async mirrorCurrentQrFromBrowser(companyId, log) {
    const entry = this._entries.get(companyId);
    if (!entry) return false;
    const { client, state } = entry;
    if (state.phase !== 'waiting_for_qr' || !client?.pupPage || client.pupPage.isClosed()) return false;
    try {
      const currentQr = await client.pupPage.evaluate(() => (
        document.querySelector('[data-ref^="https://wa.me/settings/linked_devices#"]')?.getAttribute('data-ref') || null
      ));
      return await this._setCurrentQr(companyId, currentQr, 'browser', log);
    } catch (error) {
      log?.debug({ err: error }, 'Could not mirror current WhatsApp QR');
      return false;
    }
  }

  _startQrMirror(companyId, log) {
    const entry = this._getEntry(companyId);
    if (entry.qrMirrorTimer) return;
    entry.qrMirrorTimer = setInterval(() => {
      this.mirrorCurrentQrFromBrowser(companyId, log).catch(() => {});
    }, 2_000);
    entry.qrMirrorTimer.unref?.();
  }

  // ── Session quarantine ─────────────────────────────────────────────────────

  quarantineProfile(companyId, sessionPath, clientId, log) {
    const profilePath = path.join(sessionPath, `session-${clientId}`);
    if (!fs.existsSync(profilePath)) return null;
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `session-${clientId}-stale-${suffix}`;
    fs.renameSync(profilePath, path.join(sessionPath, backupName));
    log?.warn({ backupName }, 'Corrupt WhatsApp session moved aside for fresh pairing');
    return backupName;
  }

  // ── Client creation ────────────────────────────────────────────────────────

  _createClient(companyId, clientId, sessionPath, callbacks) {
    const entry = this._getEntry(companyId);
    const { log, onMessage, onStatusUpdate } = callbacks;
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

    wa.on('qr', async (qr) => {
      await this._setCurrentQr(companyId, qr, 'event', log);
      this._startQrMirror(companyId, log);
      onStatusUpdate?.(companyId, 'waiting_for_qr', null).catch(() => {});
    });

    wa.on('authenticated', () => {
      if (state.phase === 'ready') return;
      this._clearQrMirror(companyId);
      state.phase = 'authenticated';
      state.qrDataUrl = null;
      state.qrPayload = null;
      state.qrGeneratedAt = null;
      state.lastError = null;
      state.lastProgressAt = Date.now();
      log?.info('WhatsApp authenticated');
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'authenticated' });
    });

    wa.on('loading_screen', (percent) => {
      if (state.phase === 'ready') return;
      this._clearQrMirror(companyId);
      state.phase = 'syncing';
      state.qrDataUrl = null;
      state.qrPayload = null;
      state.qrGeneratedAt = null;
      const next = Number(percent);
      // Hanya persen yang benar-benar berubah yang dihitung sebagai kemajuan.
      // WhatsApp Web menembakkan 100% berkali-kali; kalau itu ikut dihitung,
      // watchdog tidak akan pernah melihat client yang macet di 100%.
      if (next !== state.syncPercent) state.lastProgressAt = Date.now();
      state.syncPercent = next;
      state.lastError = null;
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'syncing', percent: state.syncPercent });
    });

    wa.on('ready', () => {
      this._markReady(companyId, wa.info?.wid?._serialized, log, onStatusUpdate);
    });

    wa.on('auth_failure', (msg) => {
      state.phase = 'auth_failure';
      state.syncPercent = null;
      state.lastError = String(msg);
      log?.warn({ msg }, 'WhatsApp auth_failure');
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'auth_failure' });
    });

    wa.on('disconnected', (reason) => {
      this._clearQrMirror(companyId);
      state.phase = 'disconnected';
      state.connectedAt = null;
      state.account = null;
      state.syncPercent = null;
      state.lastError = String(reason);
      log?.warn({ reason }, 'WhatsApp disconnected');
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'disconnected' });
      onStatusUpdate?.(companyId, 'disconnected', null).catch(() => {});
      setTimeout(async () => {
        try { await entry.client?.destroy().catch(() => {}); } catch { /* ignore */ }
        entry.client = null;
        state.phase = 'starting';
        state.syncPercent = null;
        state.lastError = null;
        log?.info('WhatsApp restarting after disconnect');
        this.broadcast(companyId, 'whatsapp_phase', { phase: 'starting' });
        this._createClient(companyId, clientId, sessionPath, callbacks);
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
        await onMessage?.(companyId, message);
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
   * @param {{ log, onMessage, onStatusUpdate }} callbacks
   */
  async startFor(companyId, { clientId, sessionPath }, callbacks = {}) {
    const entry = this._getEntry(companyId);
    if (entry.client) return; // already running

    const { log } = callbacks;
    entry.state.phase = 'starting';

    let initRetries = 0;
    const initWithRetry = () => {
      this._createClient(companyId, clientId, sessionPath, callbacks);
      entry.client.initialize().catch((error) => {
        entry.state.phase = 'error';
        entry.state.lastError = error.message;
        log?.error({ err: error }, 'WhatsApp initialization failed');
        this.broadcast(companyId, 'whatsapp_phase', { phase: 'error', error: error.message });
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
            this.broadcast(companyId, 'whatsapp_phase', { phase: 'starting' });
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
    const startedAt = Date.now();
    let restartAttempted = false;
    let crashHandlersAttached = false;

    const restartOnce = async (reason) => {
      restartAttempted = true;
      log?.warn({ reason }, 'Restarting WhatsApp client');
      entry.restoredSessionTimer = null;
      const stale = entry.client;
      entry.client = null;
      await stale?.destroy().catch(() => {});
      entry.state.phase = 'starting';
      entry.state.lastError = null;
      entry.state.lastProgressAt = Date.now();
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'starting' });
      this._createClient(companyId, clientId, sessionPath, callbacks);
      entry.client.initialize().catch((error) => {
        entry.state.phase = 'error';
        entry.state.lastError = error.message;
        log?.error({ err: error }, 'WhatsApp re-initialization failed');
        this.broadcast(companyId, 'whatsapp_phase', { phase: 'error', error: error.message });
      });
    };

    const giveUp = (reason) => {
      entry.restoredSessionTimer = null;
      entry.state.phase = 'error';
      entry.state.syncPercent = null;
      entry.state.lastError = reason;
      log?.error({ reason }, 'WhatsApp never reached ready; marking connection as failed');
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'error', error: reason });
      callbacks.onStatusUpdate?.(companyId, 'error', null)?.catch?.(() => {});
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
        if (restartAttempted) return giveUp(`Browser WhatsApp berhenti: ${why}`);
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
        return giveUp('WhatsApp tidak selesai tersambung dalam 5 menit. Coba hubungkan ulang.');
      }
      if (!entry.client?.pupPage) return schedule(); // client sedang dibuat ulang

      attachCrashHandlers();

      try {
        const connectionState = await entry.client.getState().catch(() => null);
        if (connectionState === 'CONNECTED') {
          const injected = await entry.client.pupPage
            .evaluate(() => Boolean(window.WWebJS)).catch(() => false);

          if (!injected) {
            if (!restartAttempted) return restartOnce('socket tersambung tapi helper halaman tidak pernah dimuat');
            log?.warn('WhatsApp page helpers still missing after restart; will keep waiting');
            return schedule();
          }

          // Selama persennya masih bergerak, biarkan whatsapp-web.js
          // menyelesaikan sinkronisasinya sendiri — memaksa 'ready' di tengah
          // sync yang sehat hanya menukar satu bug dengan bug lain.
          const stalled = Date.now() - (state.lastProgressAt || startedAt) > SYNC_STALL_MS;
          if (state.phase === 'syncing' && !stalled) return schedule();

          return this._markReady(
            companyId,
            entry.client.info?.wid?._serialized,
            log,
            callbacks.onStatusUpdate,
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
  }

  /**
   * Tear down the WA client for a company (but keep the entry).
   */
  async stopClient(companyId) {
    const entry = this._entries.get(companyId);
    if (!entry) return;
    this._clearQrMirror(companyId);
    clearTimeout(entry.restoredSessionTimer);
    entry.restoredSessionTimer = null;
    const stale = entry.client;
    entry.client = null;
    if (stale) await stale.destroy().catch(() => {});
  }

  /**
   * Destroy everything for one company (including SSE connections).
   */
  async destroyCompany(companyId) {
    const entry = this._entries.get(companyId);
    if (!entry) return;
    await this.stopClient(companyId);
    for (const raw of entry.sseClients) {
      try { raw.end(); } catch { /* ignore */ }
    }
    entry.sseClients.clear();
    this._entries.delete(companyId);
  }

  /** Destroy all company clients. */
  async destroyAll() {
    for (const companyId of [...this._entries.keys()]) {
      await this.destroyCompany(companyId).catch(() => {});
    }
  }
}

module.exports = { WhatsappManager, resolveBrowserExecutable };
