'use strict';

const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

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
      state.syncPercent = Number(percent);
      state.lastError = null;
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'syncing', percent: state.syncPercent });
    });

    wa.on('ready', () => {
      this._clearQrMirror(companyId);
      clearTimeout(entry.restoredSessionTimer);
      entry.restoredSessionTimer = null;
      state.phase = 'ready';
      state.connectedAt = new Date().toISOString();
      state.account = wa.info?.wid?._serialized || null;
      state.qrDataUrl = null;
      state.qrPayload = null;
      state.qrGeneratedAt = null;
      state.syncPercent = 100;
      state.lastError = null;
      log?.info({ account: state.account }, 'WhatsApp ready');
      this.broadcast(companyId, 'whatsapp_phase', { phase: 'ready', account: state.account });
      onStatusUpdate?.(companyId, 'ready', state.account).catch(() => {});
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

    let restoredSessionAttempts = 0;
    let restartAttempted = false;
    const tryResumeRestoredSession = async () => {
      restoredSessionAttempts += 1;
      if (!['starting', 'authenticated'].includes(entry.state.phase) || !entry.client?.pupPage) {
        entry.restoredSessionTimer = null;
        return;
      }
      try {
        const connectionState = await entry.client.getState().catch(() => null);
        if (connectionState === 'CONNECTED') {
          const injected = await entry.client.pupPage.evaluate(() => Boolean(window.WWebJS)).catch(() => false);
          if (!injected && !restartAttempted) {
            restartAttempted = true;
            log?.warn('WhatsApp socket connected but page helpers never loaded; restarting client');
            entry.restoredSessionTimer = null;
            const stale = entry.client;
            entry.client = null;
            await stale.destroy().catch(() => {});
            entry.state.phase = 'starting';
            entry.state.lastError = null;
            this._createClient(companyId, clientId, sessionPath, callbacks);
            entry.client.initialize().catch((error) => {
              entry.state.phase = 'error';
              entry.state.lastError = error.message;
              log?.error({ err: error }, 'WhatsApp re-initialization failed');
            });
            return;
          }
          if (injected) {
            entry.state.phase = 'ready';
            entry.state.connectedAt = new Date().toISOString();
            entry.state.account = entry.client.info?.wid?._serialized || null;
            entry.state.lastError = null;
            log?.info('Restored WhatsApp session confirmed connected');
            this.broadcast(companyId, 'whatsapp_phase', { phase: 'ready', account: entry.state.account });
            callbacks.onStatusUpdate?.(companyId, 'ready', entry.state.account).catch?.(() => {});
            entry.restoredSessionTimer = null;
            return;
          }
          log?.warn('WhatsApp socket connected but page helpers are still missing; will retry');
        }
      } catch (error) {
        log?.warn({ err: error }, 'Could not resume restored WhatsApp session sync');
      }
      if (restoredSessionAttempts < 12) {
        entry.restoredSessionTimer = setTimeout(tryResumeRestoredSession, 5000);
      }
    };
    entry.restoredSessionTimer = setTimeout(tryResumeRestoredSession, 5000);
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
