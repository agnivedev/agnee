'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const KnowledgeBase = require('./knowledge-loader.js');
const LlmService = require('./llm-service.js');
const { normalizeUsage, styleWarnings } = require('./reply-style.js');
const Database = require('./database.js');

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (WhatsApp adapter kept alive):', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception (WhatsApp adapter kept alive):', error);
});

function loadConfig(overrides = {}) {
  const startupEnabled = process.env.WA_STARTUP_ENABLED !== 'false';
  const config = {
    port: Number(process.env.PORT || 4100),
    host: process.env.HOST || '0.0.0.0',
    apiKey: process.env.API_KEY || 'dev-api-key',
    sessionSecret: process.env.SESSION_SECRET || process.env.API_KEY || 'agnee-local-session',
    adminEmail: process.env.ADMIN_EMAIL || 'admin@agnee.local',
    adminPassword: process.env.ADMIN_PASSWORD || 'agnee-demo',
    cookieSecure: process.env.NODE_ENV === 'production',
    sessionPath: process.env.WA_SESSION_PATH || './data/whatsapp',
    clientId: process.env.WA_CLIENT_ID || 'agnee-main',
    defaultCountryCode: process.env.WA_DEFAULT_COUNTRY_CODE || '62',
    startupEnabled,
    demoMode: process.env.WA_DEMO_MODE === 'true' || !startupEnabled,
    webhookUrl: process.env.INBOUND_WEBHOOK_URL || '',
    webhookSecret: process.env.INBOUND_WEBHOOK_SECRET || '',
    ackEnabled: process.env.WA_ACK_ENABLED === 'true',
    ackText: process.env.WA_ACK_TEXT || 'Terima kasih, pesan Anda sudah kami terima.',
    llmEnabled: process.env.LLM_ENABLED === 'true',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openrouterModel: process.env.OPENROUTER_MODEL || 'qwen-2.5-72b-instruct',
    llmMaxTokens: Number(process.env.LLM_MAX_TOKENS || 512),
    knowledgeClient: process.env.KNOWLEDGE_CLIENT || 'bzone',
    databaseUrl: process.env.DATABASE_URL || '',
    defaultCompanySlug: process.env.DEFAULT_COMPANY_SLUG || 'default',
    defaultCompanyName: process.env.DEFAULT_COMPANY_NAME || 'Default Company',
    ...overrides,
  };
  if (process.env.NODE_ENV === 'production') {
    const insecure = config.apiKey === 'dev-api-key'
      || config.sessionSecret === 'agnee-local-session'
      || config.adminPassword === 'agnee-demo';
    if (insecure) throw new Error('Production requires API_KEY, SESSION_SECRET, and ADMIN_PASSWORD');
  }
  return config;
}

function normalizeChatId(value, defaultCountryCode) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Recipient is required');
  const input = value.trim();
  if (input.endsWith('@c.us') || input.endsWith('@g.us')) return input;
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `${defaultCountryCode}${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) throw new Error('Recipient must contain 8-15 digits');
  return `${digits}@c.us`;
}

function inlineImageFromBody(value) {
  const body = typeof value === 'string' ? value.trim() : '';
  if (body.length < 100 || body.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(body)) return null;
  const signatures = [
    ['/9j/', 'image/jpeg', 'jpg'],
    ['iVBORw0KGgo', 'image/png', 'png'],
    ['R0lGOD', 'image/gif', 'gif'],
    ['UklGR', 'image/webp', 'webp'],
  ];
  const match = signatures.find(([prefix]) => body.startsWith(prefix));
  if (!match) return null;
  return { dataUrl: `data:${match[1]};base64,${body}`, extension: match[2] };
}

function messagePreviewForUi(type, body, hasMedia = false, caption = '') {
  const labels = {
    call_log: 'Panggilan WhatsApp', image: 'Foto', sticker: 'Stiker', video: 'Video',
    audio: 'Audio', ptt: 'Pesan suara', document: 'Dokumen', interactive: 'Pesan interaktif WhatsApp',
  };
  if (inlineImageFromBody(body)) {
    const captionText = typeof caption === 'string' && !inlineImageFromBody(caption) ? caption.trim() : '';
    return captionText || labels[type] || 'Media WhatsApp';
  }
  const text = typeof body === 'string' ? body.trim() : '';
  if (text) return text;
  const captionText = typeof caption === 'string' ? caption.trim() : '';
  return captionText || labels[type] || (hasMedia ? 'Media WhatsApp' : '');
}

function normalizeMessageForUi(message) {
  const inlineImage = inlineImageFromBody(message.body);
  const caption = typeof message.caption === 'string' && !inlineImageFromBody(message.caption) ? message.caption.trim() : '';
  return {
    ...message,
    body: inlineImage ? caption : (typeof message.body === 'string' ? message.body : ''),
    inlineImage: inlineImage?.dataUrl || null,
    inlineImageExtension: inlineImage?.extension || null,
    quoted: message.quoted ? {
      ...message.quoted,
      body: messagePreviewForUi(message.quoted.type, message.quoted.body),
    } : null,
  };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestsHumanAgent(text) {
  return /\b(?:mau|ingin|boleh|bisa|tolong|hubungkan|sambungkan|bicara|ngobrol|talk|speak|connect)\b[\s\S]{0,45}\b(?:cs|agent|manusia|admin|sales|supervisor|human|person)\b/i.test(String(text || ''))
    || /\b(?:cs|agent|manusia|admin|sales|supervisor|human|person)\b[\s\S]{0,45}\b(?:hubungkan|sambungkan|bicara|ngobrol|talk|speak|connect)\b/i.test(String(text || ''));
}

function createSession(user, secret) {
  const identity = typeof user === 'string' ? { email: user } : user;
  const payload = Buffer.from(JSON.stringify({ ...identity, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token, secret) {
  try {
    const [payload, signature] = String(token || '').split('.');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (!payload || !safeEqual(signature, expected)) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function getCookie(header, name) {
  const cookies = String(header || '').split(';');
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return null;
}

function demoDataset() {
  const now = Math.floor(Date.now() / 1000);
  return {
    chats: [
      { id: 'demo-nadia', name: 'Nadia — Kopi Pagi', preview: 'Bisa bantu paket untuk 3 cabang?', timestamp: now - 120, unreadCount: 2, isGroup: false, pinned: false, archived: false },
      { id: 'demo-raka', name: 'Raka Studio', preview: 'Oke, saya cek proposalnya dulu.', timestamp: now - 1860, unreadCount: 0, isGroup: false, pinned: true, archived: false },
      { id: 'demo-maya', name: 'Maya Retail', preview: 'Ada integrasi ke CRM kami?', timestamp: now - 7200, unreadCount: 1, isGroup: false, archived: false },
      { id: 'demo-old', name: 'Old Client', preview: 'Terima kasih sudah menggunakan Agnee', timestamp: now - 86400, unreadCount: 0, isGroup: false, pinned: false, archived: true },
    ],
    messages: {
      'demo-nadia': [
        { id: 'd1', body: 'Halo, saya lihat Agnee bisa bantu balas WhatsApp otomatis?', fromMe: false, timestamp: now - 480 },
        { id: 'd2', body: 'Betul. Agnee bisa menjawab FAQ, kualifikasi lead, lalu handoff ke tim sales.', fromMe: true, timestamp: now - 390 },
        { id: 'd3', body: 'Bisa bantu paket untuk 3 cabang?', fromMe: false, timestamp: now - 120 },
      ],
      'demo-raka': [
        { id: 'd4', body: 'Proposal dan estimasi implementasi sudah saya kirim ya.', fromMe: true, timestamp: now - 2100 },
        { id: 'd5', body: 'Oke, saya cek proposalnya dulu.', fromMe: false, timestamp: now - 1860 },
      ],
      'demo-maya': [{ id: 'd6', body: 'Ada integrasi ke CRM kami?', fromMe: false, timestamp: now - 7200 }],
    },
    pinned: { 'demo-nadia': ['d2'] },
  };
}

async function buildApp(overrides = {}) {
  const config = loadConfig(overrides);
  const app = Fastify({ logger: overrides.logger ?? true, bodyLimit: 10 * 1024 * 1024 });
  const demo = demoDataset();
  let whatsapp = null;
  let demoQr = null;
  let restoredSessionTimer = null;
  let qrMirrorTimer = null;
  const eventClients = new Set();
  const sendReceipts = new Map();
  const leadStates = new Map();
  const conversationRouting = new Map();
  const conversationNotes = new Map();
  const conversationHandoffs = new Map();
  const fallbackTeam = [{ id: 'local-supervisor', email: config.adminEmail, displayName: 'Supervisor', role: 'supervisor', status: 'active', presence: 'online' }];
  const knowledgeBase = new KnowledgeBase({ clientId: config.knowledgeClient });
  const llmService = overrides.llmService || new LlmService({
    apiKey: config.openrouterApiKey,
    model: config.openrouterModel,
    maxTokens: config.llmMaxTokens,
    enabled: config.llmEnabled,
  });
  // Runtime AI settings — survive without restart, reset on next deploy
  const aiSettings = {
    enabled: llmService.enabled,
    modelChain: [],
  };
  const database = overrides.database || new Database({
    connectionString: config.databaseUrl,
    companySlug: config.defaultCompanySlug,
    companyName: config.defaultCompanyName,
    adminEmail: config.adminEmail,
    adminPassword: config.adminPassword,
    logger: app.log,
  });
  await database.connect();
  if (config.llmEnabled) await knowledgeBase.load();
  const state = {
    phase: config.demoMode ? 'demo' : config.startupEnabled ? 'starting' : 'disabled',
    qrDataUrl: null,
    qrPayload: null,
    qrGeneratedAt: null,
    connectedAt: config.demoMode ? new Date().toISOString() : null,
    account: config.demoMode ? 'Agnee Demo Workspace' : null,
    syncPercent: null,
    lastError: null,
  };

  function publicState() {
    return {
      phase: state.phase,
      connectedAt: state.connectedAt,
      account: state.account,
      syncPercent: state.syncPercent,
      hasQr: Boolean(state.qrDataUrl) || config.demoMode,
      demoMode: config.demoMode,
      lastError: state.lastError,
    };
  }

  function broadcastEvent(event, payload) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of eventClients) {
      try {
        client.write(frame);
      } catch {
        eventClients.delete(client);
      }
    }
  }

  function clearQrMirror() {
    clearInterval(qrMirrorTimer);
    qrMirrorTimer = null;
  }

  async function setCurrentQr(payload, source = 'event') {
    if (!payload) return false;
    const officialPairingQr = String(payload).startsWith('https://wa.me/settings/linked_devices#')
      ? String(payload)
      : `https://wa.me/settings/linked_devices#${payload}`;
    if (officialPairingQr === state.qrPayload) return false;

    state.phase = 'waiting_for_qr';
    state.qrPayload = officialPairingQr;
    state.qrDataUrl = await QRCode.toDataURL(officialPairingQr, { margin: 1, width: 320 });
    state.qrGeneratedAt = new Date().toISOString();
    state.syncPercent = null;
    state.lastError = null;
    app.log.info({ source }, 'WhatsApp QR generated');
    broadcastEvent('whatsapp_phase', {
      phase: 'waiting_for_qr',
      qrDataUrl: state.qrDataUrl,
      qrGeneratedAt: state.qrGeneratedAt,
    });
    return true;
  }

  async function mirrorCurrentQrFromBrowser() {
    if (state.phase !== 'waiting_for_qr' || !whatsapp?.pupPage || whatsapp.pupPage.isClosed()) return false;
    try {
      const currentQr = await whatsapp.pupPage.evaluate(() => (
        document.querySelector('[data-ref^="https://wa.me/settings/linked_devices#"]')?.getAttribute('data-ref') || null
      ));
      return await setCurrentQr(currentQr, 'browser');
    } catch (error) {
      app.log.debug({ err: error }, 'Could not mirror current WhatsApp QR');
      return false;
    }
  }

  function startQrMirror() {
    if (qrMirrorTimer) return;
    qrMirrorTimer = setInterval(() => {
      mirrorCurrentQrFromBrowser().catch(() => {});
    }, 2_000);
    qrMirrorTimer.unref?.();
  }

  async function deliverInboundWebhook(message) {
    if (!config.webhookUrl) return;
    const headers = { 'content-type': 'application/json' };
    if (config.webhookSecret) headers.authorization = `Bearer ${config.webhookSecret}`;
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event: 'whatsapp.message.received',
        message: {
          id: message.id?._serialized || null,
          from: message.from,
          body: messagePreviewForUi(message.type, message.body, message.hasMedia),
          type: message.type,
          timestamp: message.timestamp,
          hasMedia: message.hasMedia,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Inbound webhook returned HTTP ${response.status}`);
  }

  async function generateAutoReply(message) {
    if (!config.llmEnabled) return null;
    if (message.from.endsWith('@g.us')) return null;
    if (!message.body || !message.body.trim()) return null;
    const routing = await getRouting(message.from);
    if (routing.mode === 'human') return null;

    const asksForHuman = requestsHumanAgent(message.body);
    if (asksForHuman) {
      const members = await getTeamMembers();
      const supervisor = members.find((member) => ['owner', 'supervisor', 'admin'].includes(member.role) && member.status === 'active');
      if (supervisor) {
        await saveRouting({
          chatId: message.from,
          mode: 'human',
          assigneeUserId: supervisor.id,
          actorUserId: null,
          note: 'Pelanggan meminta bantuan manusia.',
          priority: 'high',
        });
        const looksEnglish = /\b(?:human|person|talk|speak|connect|agent)\b/i.test(message.body)
          && !/\b(?:mau|ingin|boleh|bisa|tolong|hubungkan|bicara|manusia)\b/i.test(message.body);
        return looksEnglish
          ? 'Sure, I’ll hand this conversation to our team. Someone will continue here shortly.'
          : 'Baik, saya teruskan percakapan ini ke tim kami. Sebentar lagi akan dilanjutkan di sini.';
      }
    }

    const relevantFaqs = knowledgeBase.findRelevantFaq(message.body);
    const leadState = await getLeadState(message.from);

    const result = await llmService.generateReply(message.body, {
      systemPrompt: knowledgeBase.getSystemPrompt(),
      relevantFaqs,
      leadState,
    });

    return result?.text || null;
  }

  function quarantineWhatsappProfile() {
    const profilePath = path.join(config.sessionPath, `session-${config.clientId}`);
    if (!fs.existsSync(profilePath)) return null;
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `session-${config.clientId}-stale-${suffix}`;
    fs.renameSync(profilePath, path.join(config.sessionPath, backupName));
    app.log.warn({ backupName }, 'Corrupt WhatsApp session moved aside for fresh pairing');
    return backupName;
  }

  function createWhatsappClient() {
    // Chromium leaves host-specific singleton symlinks behind when a container
    // is recreated. The old process is already gone, so keeping these files
    // blocks the persisted WhatsApp profile from starting on the new hostname.
    const profilePath = path.join(config.sessionPath, `session-${config.clientId}`);
    for (const filename of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      try { fs.rmSync(path.join(profilePath, filename), { force: true }); } catch { /* profile may not exist yet */ }
    }
    whatsapp = new Client({
      authStrategy: new LocalAuth({ clientId: config.clientId, dataPath: config.sessionPath }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        protocolTimeout: 240_000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      },
    });
    whatsapp.on('qr', async (qr) => {
      // Recent WhatsApp clients require the wa.me deep-link form for the first
      // Camera scan. The library's event may stop after several rotations while
      // the page keeps producing fresh codes, so mirror the live DOM as backup.
      await setCurrentQr(qr, 'event');
      startQrMirror();
    });
    whatsapp.on('authenticated', () => {
      if (state.phase === 'ready') return; // whatsapp-web.js can re-fire 'authenticated' after 'ready'
      clearQrMirror();
      state.phase = 'authenticated';
      state.qrDataUrl = null;
      state.qrPayload = null;
      state.qrGeneratedAt = null;
      state.lastError = null;
      app.log.info('WhatsApp authenticated');
      broadcastEvent('whatsapp_phase', { phase: 'authenticated' });
    });
    whatsapp.on('loading_screen', (percent) => {
      if (state.phase === 'ready') return;
      clearQrMirror();
      state.phase = 'syncing';
      state.qrDataUrl = null;
      state.qrPayload = null;
      state.qrGeneratedAt = null;
      state.syncPercent = Number(percent);
      state.lastError = null;
      broadcastEvent('whatsapp_phase', { phase: 'syncing', percent: state.syncPercent });
    });
    whatsapp.on('ready', () => {
      clearQrMirror();
      clearTimeout(restoredSessionTimer);
      restoredSessionTimer = null;
      state.phase = 'ready';
      state.connectedAt = new Date().toISOString();
      state.account = whatsapp.info?.wid?._serialized || null;
      state.qrDataUrl = null;
      state.qrPayload = null;
      state.qrGeneratedAt = null;
      state.syncPercent = 100;
      state.lastError = null;
      app.log.info({ account: state.account }, 'WhatsApp ready');
      broadcastEvent('whatsapp_phase', { phase: 'ready', account: state.account });
    });
    // auth_failure never fires when using LocalAuth: BaseAuthStrategy.onAuthenticationNeeded()
    // always returns { failed: false }, so a stale/expired session silently falls through to
    // the QR flow instead. Handler kept as a defensive catch-all for other auth strategies.
    whatsapp.on('auth_failure', (message) => {
      state.phase = 'auth_failure';
      state.syncPercent = null;
      state.lastError = String(message);
      app.log.warn({ message }, 'WhatsApp auth_failure');
      broadcastEvent('whatsapp_phase', { phase: 'auth_failure' });
    });
    whatsapp.on('disconnected', (reason) => {
      clearQrMirror();
      state.phase = 'disconnected';
      state.connectedAt = null;
      state.account = null;
      state.syncPercent = null;
      state.lastError = String(reason);
      app.log.warn({ reason }, 'WhatsApp disconnected');
      broadcastEvent('whatsapp_phase', { phase: 'disconnected' });
      setTimeout(async () => {
        try {
          await whatsapp.destroy().catch(() => {});
        } catch { /* ignore */ }
        whatsapp = null;
        state.phase = 'starting';
        state.syncPercent = null;
        state.lastError = null;
        app.log.info('WhatsApp restarting after disconnect');
        broadcastEvent('whatsapp_phase', { phase: 'starting' });
        createWhatsappClient();
        whatsapp.initialize().catch((error) => {
          state.phase = 'error';
          state.lastError = error.message;
          app.log.error({ err: error }, 'WhatsApp re-initialization failed');
        });
      }, 3000);
    });
    whatsapp.on('message', async (message) => {
      if (message.fromMe || message.from === 'status@broadcast') return;
      try {
        await deliverInboundWebhook(message);
        const autoReply = await generateAutoReply(message);
        if (autoReply) {
          await message.reply(autoReply);
        } else if (config.ackEnabled && message.body) {
          await message.reply(config.ackText);
        }
      } catch (error) {
        app.log.error({ err: error }, 'Inbound message handling failed');
      }
    });
    whatsapp.on('message_create', (message) => {
      if (message.from === 'status@broadcast') return;
      broadcastEvent('message', {
        id: message.id?._serialized || null,
        chatId: message.fromMe ? message.to : message.from,
        fromMe: Boolean(message.fromMe),
        timestamp: message.timestamp || Math.floor(Date.now() / 1000),
        type: message.type || 'chat',
      });
    });
    whatsapp.on('message_ack', (message, ack) => {
      broadcastEvent('ack', { id: message.id?._serialized || null, ack: Number(ack) });
    });
    whatsapp.on('chat_archived', (chat, archived) => {
      broadcastEvent('chat', {
        chatId: chat.id?._serialized || null,
        archived: Boolean(archived),
      });
    });
  }

  async function getChatsForUi() {
    try {
      const chats = await whatsapp.getChats();
      return chats.map((chat) => ({
        id: chat.id?._serialized,
        name: chat.name || chat.id?.user || 'Unknown',
        preview: messagePreviewForUi(chat.lastMessage?.type, chat.lastMessage?.body, chat.lastMessage?.hasMedia, chat.lastMessage?._data?.caption || chat.lastMessage?.caption),
        lastSenderName: chat.isGroup && !chat.lastMessage?.fromMe
          ? chat.lastMessage?._data?.notifyName || null
          : null,
        timestamp: chat.timestamp || chat.lastMessage?.timestamp || 0,
        unreadCount: chat.unreadCount || 0,
        isGroup: Boolean(chat.isGroup),
        pinned: Boolean(chat.pinned),
        archived: Boolean(chat.archived),
      })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.timestamp) - Number(a.timestamp));
    } catch (error) {
      app.log.warn({ err: error }, 'Standard WhatsApp chat serialization failed; using safe snapshot');
      const snapshot = await whatsapp.pupPage.evaluate(() => {
        const collection = window.require('WAWebCollections').Chat;
        const messageCollection = window.require('WAWebCollections').Msg;
        const chats = collection.getModelsArray?.() || collection.models || [];
        return chats.map((chat) => {
          try {
            const id = chat.id?._serialized || chat.id?.toString?.();
            if (!id || id === 'status@broadcast') return null;
            const cachedMessages = chat.msgs?.getModelsArray?.() || [];
            const last = cachedMessages[cachedMessages.length - 1]
              || (chat.lastReceivedKey ? messageCollection.get(chat.lastReceivedKey._serialized) : null);
            const meaningful = [...cachedMessages].reverse().find((message) =>
              typeof message?.body === 'string'
              && message.body.trim()
              && !['call_log', 'e2e_notification', 'protocol', 'notification_template', 'gp2'].includes(message.type),
            );
            return {
              id,
              name: chat.formattedTitle || chat.name || chat.contact?.formattedName || id.split('@')[0],
              preview: meaningful?.body || (last?.type === 'call_log' ? 'Panggilan WhatsApp' : ''),
              lastSenderName: (() => {
                if (!chat.groupMetadata || meaningful?.id?.fromMe) return null;
                const authorId = meaningful?.author?._serialized || meaningful?.author?.toString?.();
                const author = authorId ? window.require('WAWebCollections').Contact.get?.(authorId) : null;
                return author?.formattedName || author?.pushname || meaningful?.notifyName || null;
              })(),
              previewType: meaningful?.type || last?.type || 'chat',
              previewCaption: meaningful?.caption || last?.caption || '',
              timestamp: Number(chat.t || chat.timestamp || last?.t || 0),
              unreadCount: Number(chat.unreadCount || 0),
              isGroup: Boolean(chat.groupMetadata) || id.endsWith('@g.us'),
              pinned: Boolean(chat.pin || chat.__x_pin),
              archived: Boolean(chat.archive || chat.__x_archive),
            };
          } catch {
            return null;
          }
        }).filter(Boolean).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp - a.timestamp);
      });
      return snapshot.map(({ previewType, previewCaption, ...chat }) => ({
        ...chat,
        preview: messagePreviewForUi(previewType, chat.preview, false, previewCaption),
      }));
    }
  }

  async function getMessagesForUi(chatId, limit) {
    const hiddenTypes = ['e2e_notification', 'protocol', 'notification_template', 'gp2'];
    try {
      const chat = await whatsapp.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit: Math.min(limit * 2 + 1, 241) });
      const visible = messages.filter((message) => !hiddenTypes.includes(message.type)
        && (message.type === 'call_log' || message.body || message.hasMedia));
      const serialized = await Promise.all(visible.slice(-limit).map(async (message) => {
        let quotedMessage = null;
        let senderName = message._data?.notifyName || null;
        if (message.hasQuotedMsg) {
          try { quotedMessage = await message.getQuotedMessage(); } catch { /* quoted message may have expired */ }
        }
        if (chat.isGroup && !message.fromMe && !senderName) {
          try {
            const sender = await message.getContact();
            senderName = sender?.pushname || sender?.name || sender?.shortName || sender?.number || null;
          } catch { /* sender may no longer be in the group */ }
        }
        return normalizeMessageForUi({
        id: message.id?._serialized,
        body: message.body,
        caption: message._data?.caption || message.caption || '',
        mimetype: message._data?.mimetype || message.mimetype || null,
        fromMe: message.fromMe,
        timestamp: message.timestamp,
        type: message.type,
        ack: Number(message.ack ?? 0),
        senderName,
        quoted: quotedMessage ? {
          id: quotedMessage.id?._serialized || null,
          body: quotedMessage.body || quotedMessage._data?.caption || '',
          type: quotedMessage.type || 'chat',
          fromMe: Boolean(quotedMessage.fromMe),
        } : null,
        call: message.type === 'call_log' ? {
          isVideo: Boolean(message._data?.isVideo || message._data?.videoCall || message._data?.callType === 'video'),
          result: message._data?.callResult || message._data?.subtype || null,
          duration: Number(message.duration || message._data?.callDuration || 0) || null,
        } : null,
      });
      }));
      return { messages: serialized, hasMore: visible.length > limit };
    } catch (error) {
      app.log.warn({ err: error, chatId }, 'Standard WhatsApp message serialization failed; loading safe history snapshot');
      const snapshot = await whatsapp.pupPage.evaluate(async (requestedChatId, requestedLimit, ignoredTypes) => {
        const collection = window.require('WAWebCollections').Chat;
        const chats = collection.getModelsArray?.() || collection.models || [];
        const chat = collection.get?.(requestedChatId)
          || chats.find((item) => (item.id?._serialized || item.id?.toString?.()) === requestedChatId);
        if (!chat) return { messages: [], hasMore: false };

        const keyFor = (message) => message.id?._serialized || message.id?.toString?.() || `${message.t}:${message.body}`;
        const contacts = window.require('WAWebCollections').Contact;
        const isVisible = (message) => !message.isNotification
          && !ignoredTypes.includes(message.type)
          && (message.type === 'call_log' || Boolean(message.body) || Boolean(message.mediaData) || Boolean(message.__x_mediaData));
        let messages = chat.msgs?.getModelsArray?.() || [];
        let visible = messages.filter(isVisible);
        const target = requestedLimit + 1;

        // WhatsApp Web only keeps the newest window in memory. Explicitly ask it
        // for older pages until the UI batch is full or history is exhausted.
        for (let page = 0; visible.length < target && page < 12; page += 1) {
          const loaded = await window.require('WAWebChatLoadMessages').loadEarlierMsgs({ chat });
          if (!loaded?.length) break;
          const merged = [...loaded, ...messages];
          messages = [...new Map(merged.map((message) => [keyFor(message), message])).values()];
          visible = messages.filter(isVisible);
        }

        visible.sort((a, b) => Number(a.t || a.timestamp || 0) - Number(b.t || b.timestamp || 0));
        return {
          hasMore: visible.length > requestedLimit,
          messages: visible.slice(-requestedLimit)
          .map((message) => {
            const authorId = message.author?._serialized || message.author?.toString?.() || null;
            const author = authorId ? contacts.get?.(authorId) : null;
            let quoted = null;
            try { quoted = window.require('WAWebQuotedMsgModelUtils').getQuotedMsgObj(message); } catch {
              quoted = message.quotedMsg || message.__x_quotedMsg || null;
            }
            return {
            id: message.id?._serialized || message.id?.toString?.() || null,
            body: typeof message.body === 'string' ? message.body : '',
            caption: typeof message.caption === 'string' ? message.caption : '',
            mimetype: message.mimetype || message.mediaData?.mimetype || null,
            fromMe: Boolean(message.id?.fromMe),
            timestamp: Number(message.t || message.timestamp || 0),
            type: message.type || 'chat',
            ack: Number(message.ack ?? message.__x_ack ?? 0),
            senderName: author?.formattedName || author?.pushname || message.notifyName || null,
            quoted: quoted ? {
              id: quoted.id?._serialized || quoted.id?.toString?.() || null,
              body: quoted.body || quoted.caption || '',
              type: quoted.type || 'chat',
              fromMe: Boolean(quoted.id?.fromMe),
            } : null,
            call: message.type === 'call_log' ? {
              isVideo: Boolean(message.isVideo || message.videoCall || message.callType === 'video'),
              result: message.callResult || message.subtype || message.__x_callResult || message.__x_subtype || null,
              duration: Number(message.duration || message.callDuration || message.__x_duration || 0) || null,
            } : null,
          };
          }),
        };
      }, chatId, limit, hiddenTypes);
      return { ...snapshot, messages: snapshot.messages.map(normalizeMessageForUi) };
    }
  }

  async function getProfilePicUrlForUi(chatId) {
    try {
      return await whatsapp.getProfilePicUrl(chatId);
    } catch {
      return whatsapp.pupPage.evaluate(async (requestedChatId) => {
        const collection = window.require('WAWebCollections').Chat;
        const chats = collection.getModelsArray?.() || collection.models || [];
        const chat = collection.get?.(requestedChatId)
          || chats.find((item) => (item.id?._serialized || item.id?.toString?.()) === requestedChatId);
        if (!chat) return null;

        const cached = chat.contact?.profilePicThumb
          || chat.contact?.__x_profilePicThumb
          || chat.profilePicThumb
          || chat.__x_profilePicThumb;
        if (cached?.eurl) return cached.eurl;

        try {
          const profile = await window
            .require('WAWebContactProfilePicThumbBridge')
            .requestProfilePicFromServer(chat);
          return profile?.eurl || profile?.imgFull || profile?.img || null;
        } catch {
          return null;
        }
      }, chatId);
    }
  }

  async function getGroupInfoForUi(chatId) {
    return whatsapp.pupPage.evaluate((requestedChatId) => {
      const collection = window.require('WAWebCollections').Chat;
      const chats = collection.getModelsArray?.() || collection.models || [];
      const chat = collection.get?.(requestedChatId)
        || chats.find((item) => (item.id?._serialized || item.id?.toString?.()) === requestedChatId);
      if (!chat?.groupMetadata) return { isGroup: false, participantCount: 0, participantNames: [] };

      const participantsCollection = chat.groupMetadata.participants;
      const participants = participantsCollection?.getModelsArray?.()
        || participantsCollection?.models
        || participantsCollection?._models
        || [];
      const me = window.require('WAWebUserPrefsMeUser');
      const ownIds = new Set([
        me.getMaybeMePnUser?.()?._serialized,
        me.getMaybeMeLidUser?.()?._serialized,
      ].filter(Boolean));
      const contacts = window.require('WAWebCollections').Contact;
      const ids = participants
        .map((participant) => participant.id?._serialized || participant.id?.toString?.())
        .filter(Boolean);
      const selected = ids.filter((id) => !ownIds.has(id)).slice(0, 4);
      const ownId = ids.find((id) => ownIds.has(id));
      if (ownId) selected.push(ownId);
      const participantNames = selected.map((id) => {
        if (ownIds.has(id)) return 'Anda';
        const contact = contacts.get?.(id);
        return contact?.formattedName || contact?.pushname || contact?.name || contact?.shortName || id.split('@')[0];
      });
      return { isGroup: true, participantCount: ids.length, participantNames };
    }, chatId);
  }

  async function sendTextForUi(chatId, text, options = {}) {
    return whatsapp.pupPage.evaluate(async (requestedChatId, content, sendOptions) => {
      const chat = await window.WWebJS.getChat(requestedChatId, { getAsModel: false });
      if (!chat) throw new Error('Conversation is unavailable');
      await window.WWebJS.sendSeen(requestedChatId);
      const message = await window.WWebJS.sendMessage(chat, content, {
        linkPreview: true,
        parseVCards: true,
        mentionedJidList: [],
        groupMentions: [],
        ignoreQuoteErrors: true,
        waitUntilMsgSent: false,
        quotedMessageId: sendOptions.quotedMessageId || undefined,
        media: sendOptions.attachment || undefined,
        caption: sendOptions.attachment && content ? content : undefined,
        isCaptionByUser: Boolean(sendOptions.attachment && content),
      });
      if (!message) throw new Error('WhatsApp did not accept the message');
      return {
        messageId: message.id?._serialized || message.id?.toString?.() || null,
        timestamp: Number(message.t || Math.floor(Date.now() / 1000)),
      };
    }, chatId, text, options);
  }

  async function getLeadState(chatId) {
    if (leadStates.has(chatId)) return leadStates.get(chatId);
    const persisted = await database.getLeadState(chatId);
    if (persisted) {
      leadStates.set(chatId, persisted);
      return persisted;
    }
    return {
      chatId,
      stage: 'inbox',
      score: null,
      title: 'Belum dikualifikasi',
      detail: 'Belum dianalisis oleh AI.',
      assignee: null,
    };
  }

  function isSupervisor(session) {
    return ['owner', 'supervisor', 'admin'].includes(session?.role) || session?.apiClient;
  }

  async function getTeamMembers() {
    if (typeof database.listTeamMembers === 'function') {
      const members = await database.listTeamMembers();
      if (members.length) return members;
    }
    return fallbackTeam;
  }

  async function getRouting(chatId) {
    if (conversationRouting.has(chatId)) return conversationRouting.get(chatId);
    const persisted = typeof database.getConversationRouting === 'function' && database.status().connected
      ? await database.getConversationRouting(chatId)
      : null;
    const routing = persisted || {
      chatId,
      mode: 'ai',
      assigneeUserId: null,
      assigneeName: null,
      status: 'open',
      priority: 'normal',
    };
    conversationRouting.set(chatId, routing);
    return routing;
  }

  async function saveRouting(change) {
    const previous = await getRouting(change.chatId);
    let routing;
    if (typeof database.saveConversationRouting === 'function' && database.status().connected) {
      routing = await database.saveConversationRouting(change);
    } else {
      const member = fallbackTeam.find((item) => item.id === change.assigneeUserId);
      routing = {
        ...previous,
        chatId: change.chatId,
        mode: change.mode,
        assigneeUserId: change.assigneeUserId || null,
        assigneeName: member?.displayName || null,
        status: change.status || 'open',
        priority: change.priority || previous.priority || 'normal',
        updatedAt: new Date().toISOString(),
      };
      const history = conversationHandoffs.get(change.chatId) || [];
      history.unshift({
        id: crypto.randomUUID(),
        fromMode: previous.mode,
        toMode: routing.mode,
        fromName: previous.assigneeName,
        toName: routing.assigneeName,
        note: change.note || null,
        createdAt: new Date().toISOString(),
      });
      conversationHandoffs.set(change.chatId, history);
    }
    conversationRouting.set(change.chatId, routing);
    broadcastEvent('routing', routing);
    return routing;
  }

  // Rate limiter for login endpoint: max 10 attempts per IP per 15 minutes
  const loginAttempts = new Map();
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_MAX_ATTEMPTS = 10;
  setInterval(() => {
    const cutoff = Date.now() - LOGIN_WINDOW_MS;
    for (const [key, entry] of loginAttempts) {
      if (entry.resetAt < cutoff) loginAttempts.delete(key);
    }
  }, 60_000).unref?.();

  // Security headers on every response
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'geolocation=(), camera=(), microphone=()');
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    reply.header('content-security-policy', csp);
  });

  await app.register(fastifyStatic, { root: path.join(__dirname, '..', 'public'), prefix: '/' });
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'assets', 'brand'),
    prefix: '/brand/',
    decorateReply: false,
  });

  app.get('/health', async () => ({ ok: true, service: 'agnee-app', database: database.status(), whatsapp: publicState() }));

  app.post('/v1/auth/login', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', minLength: 3, maxLength: 200 },
          password: { type: 'string', minLength: 6, maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    const ip = request.headers['x-forwarded-for']?.split(',')[0].trim() || request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + LOGIN_WINDOW_MS; }
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      reply.header('retry-after', String(retryAfter));
      return reply.code(429).send({ error: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
    }
    let user = null;
    if (typeof database.authenticateUser === 'function' && database.status().connected) {
      user = await database.authenticateUser(request.body.email, request.body.password);
    } else if (safeEqual(request.body.email.toLowerCase(), config.adminEmail.toLowerCase())
      && safeEqual(request.body.password, config.adminPassword)) {
      user = fallbackTeam[0];
    }
    if (!user) {
      entry.count += 1;
      loginAttempts.set(ip, entry);
      return reply.code(401).send({ error: 'Email atau password salah' });
    }
    loginAttempts.delete(ip);
    const sessionUser = {
      userId: user.id,
      companyId: user.companyId || database.companyId || 'local-company',
      email: user.email,
      displayName: user.displayName || user.email,
      role: user.role === 'owner' || user.role === 'admin' ? 'supervisor' : user.role,
    };
    const token = createSession(sessionUser, config.sessionSecret);
    reply.header('set-cookie', `agnee_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${config.cookieSecure ? '; Secure' : ''}`);
    if (typeof database.setPresence === 'function') await database.setPresence(user.id, 'online');
    return { ok: true, user: sessionUser };
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/') || request.url.startsWith('/v1/auth/login')) return;
    const suppliedKey = request.headers['x-api-key'];
    const session = verifySession(getCookie(request.headers.cookie, 'agnee_session'), config.sessionSecret);
    if (suppliedKey === config.apiKey || session) {
      request.agneeSession = session || { apiClient: true, role: 'supervisor', displayName: 'Sistem' };
      if (request.url.startsWith('/v1/admin/') && !isSupervisor(request.agneeSession)) {
        return reply.code(403).send({ error: 'Halaman ini hanya tersedia untuk supervisor.' });
      }
      return;
    }
    return reply.code(401).send({ error: 'Unauthorized' });
  });

  app.addHook('preHandler', async (request, reply) => {
    if (isSupervisor(request.agneeSession)) return;
    const chatId = request.params?.chatId;
    if (!chatId) return;
    if (request.method === 'POST' && request.routeOptions?.url === '/v1/chats/:chatId/routing') return;
    const routing = await getRouting(chatId);
    if (routing.mode !== 'human' || routing.assigneeUserId !== request.agneeSession?.userId) {
      return reply.code(403).send({ error: 'Chat ini ditangani oleh agent lain.' });
    }
  });

  app.get('/v1/auth/session', async (request) => ({ authenticated: true, user: request.agneeSession }));
  app.post('/v1/auth/logout', async (request, reply) => {
    if (typeof database.setPresence === 'function') await database.setPresence(request.agneeSession?.userId, 'offline');
    reply.header('set-cookie', 'agnee_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { ok: true };
  });

  app.get('/v1/team/members', async () => ({ members: await getTeamMembers() }));

  app.post('/v1/team/members', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['email', 'displayName', 'password', 'role'], properties: {
      email: { type: 'string', minLength: 5, maxLength: 200 },
      displayName: { type: 'string', minLength: 2, maxLength: 100 },
      password: { type: 'string', minLength: 8, maxLength: 200 },
      role: { type: 'string', enum: ['supervisor', 'agent'] },
    } } },
  }, async (request, reply) => {
    if (!isSupervisor(request.agneeSession)) return reply.code(403).send({ error: 'Hanya supervisor yang dapat menambah anggota.' });
    if (typeof database.createTeamMember !== 'function' || !database.status().connected) {
      return reply.code(503).send({ error: 'Penyimpanan anggota belum tersedia.' });
    }
    const member = await database.createTeamMember(request.body);
    broadcastEvent('team', { action: 'created', member });
    return reply.code(201).send({ member });
  });

  app.get('/v1/chats/:chatId/routing', async (request) => ({
    routing: await getRouting(request.params.chatId),
    handoffs: typeof database.listConversationHandoffs === 'function' && database.status().connected
      ? await database.listConversationHandoffs(request.params.chatId)
      : conversationHandoffs.get(request.params.chatId) || [],
  }));

  app.post('/v1/chats/:chatId/routing', {
    schema: {
      params: { type: 'object', required: ['chatId'], properties: { chatId: { type: 'string', minLength: 1, maxLength: 128 } } },
      body: { type: 'object', additionalProperties: false, required: ['mode'], properties: {
        mode: { type: 'string', enum: ['ai', 'human'] },
        assigneeUserId: { type: ['string', 'null'], maxLength: 100 },
        note: { type: 'string', maxLength: 500 },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      } },
    },
  }, async (request, reply) => {
    const session = request.agneeSession;
    const members = await getTeamMembers();
    let assigneeUserId = request.body.mode === 'ai' ? null : request.body.assigneeUserId;
    if (request.body.mode === 'human' && !assigneeUserId) assigneeUserId = session.userId;
    const assignee = assigneeUserId ? members.find((member) => member.id === assigneeUserId && member.status === 'active') : null;
    if (request.body.mode === 'human' && !assignee) return reply.code(400).send({ error: 'Pilih agent yang aktif.' });
    if (!isSupervisor(session) && request.body.mode === 'human' && assigneeUserId !== session.userId) {
      return reply.code(403).send({ error: 'Agent hanya dapat mengambil chat untuk dirinya sendiri.' });
    }
    const routing = await saveRouting({
      chatId: request.params.chatId,
      mode: request.body.mode,
      assigneeUserId,
      actorUserId: session.userId,
      note: request.body.note,
      priority: request.body.priority || 'normal',
    });
    return { routing };
  });

  app.get('/v1/chats/:chatId/notes', async (request) => ({
    notes: typeof database.listConversationNotes === 'function' && database.status().connected
      ? await database.listConversationNotes(request.params.chatId)
      : conversationNotes.get(request.params.chatId) || [],
  }));

  app.post('/v1/chats/:chatId/notes', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['body'], properties: {
      body: { type: 'string', minLength: 1, maxLength: 2000 },
    } } },
  }, async (request, reply) => {
    let note;
    if (typeof database.addConversationNote === 'function' && database.status().connected) {
      note = await database.addConversationNote(request.params.chatId, request.agneeSession?.userId, request.body.body.trim());
      note.authorName = request.agneeSession?.displayName;
    } else {
      note = { id: crypto.randomUUID(), body: request.body.body.trim(), authorName: request.agneeSession?.displayName, createdAt: new Date().toISOString() };
      const notes = conversationNotes.get(request.params.chatId) || [];
      notes.unshift(note);
      conversationNotes.set(request.params.chatId, notes);
    }
    broadcastEvent('note', { chatId: request.params.chatId, note });
    return reply.code(201).send({ note });
  });

  app.get('/v1/admin/config', async () => ({
    llmEnabled: Boolean(llmService.enabled),
    model: llmService.model || config.openrouterModel,
    defaultKnowledgeClient: config.knowledgeClient,
    database: database.status(),
    knowledgeClients: [
      { id: 'bzone', name: 'bZone Alpha / Bengkel EA Gold' },
      { id: 'agnee', name: 'Agnee by Agnive' },
    ],
  }));

  app.get('/v1/admin/ai-settings', async () => ({
    enabled: aiSettings.enabled,
    modelChain: aiSettings.modelChain,
    defaultModel: config.openrouterModel,
  }));

  app.patch('/v1/admin/ai-settings', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          modelChain: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
  }, async (request) => {
    if (typeof request.body.enabled === 'boolean') {
      aiSettings.enabled = request.body.enabled;
      llmService.enabled = request.body.enabled && !!llmService.apiKey;
    }
    if (Array.isArray(request.body.modelChain)) {
      aiSettings.modelChain = request.body.modelChain.filter(Boolean);
      llmService.modelChain = aiSettings.modelChain;
    }
    return { ok: true, enabled: aiSettings.enabled, modelChain: aiSettings.modelChain };
  });

  app.post('/v1/admin/playground/auto-reply', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['message', 'clientId'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 2000 },
          clientId: { type: 'string', enum: ['bzone', 'agnee'] },
        },
      },
    },
  }, async (request, reply) => {
    if (!llmService.enabled) {
      return reply.code(503).send({ error: 'OpenRouter belum aktif. Periksa LLM_ENABLED dan OPENROUTER_API_KEY.' });
    }

    const message = request.body.message.trim();
    if (!message) return reply.code(400).send({ error: 'Pesan tidak boleh kosong.' });

    const playgroundKnowledge = new KnowledgeBase({ clientId: request.body.clientId });
    await playgroundKnowledge.load();
    if (!playgroundKnowledge.loaded) return reply.code(404).send({ error: 'Knowledge client tidak ditemukan.' });

    const relevantFaqs = playgroundKnowledge.findRelevantFaq(message);
    const startedAt = Date.now();
    const result = await llmService.generateReply(message, {
      systemPrompt: playgroundKnowledge.getSystemPrompt(),
      relevantFaqs,
    });
    if (!result) return reply.code(502).send({ error: 'OpenRouter tidak menghasilkan balasan.' });

    const expectsDirectHandoff = /\b(?:bicara|hubungkan|teruskan|handoff)\b.*\b(?:sales|tim|manusia|admin|agent)\b/i.test(message)
      || /\b(?:sales|tim|manusia|admin|agent)\b.*\b(?:bicara|hubungkan|teruskan|handoff)\b/i.test(message);
    const warnings = styleWarnings(result.text, { expectDirectHandoff: expectsDirectHandoff });

    const response = {
      reply: result.text,
      model: result.model || llmService.model || config.openrouterModel,
      clientId: request.body.clientId,
      matchedFaqs: relevantFaqs.map((faq) => ({ id: faq.id, source: faq.source, score: faq.score })),
      usage: normalizeUsage(result),
      style: { passed: warnings.length === 0, warnings },
      elapsedMs: Date.now() - startedAt,
      sentToWhatsapp: false,
    };
    try {
      const saved = await database.recordPlaygroundRun({
        clientId: response.clientId,
        message,
        reply: response.reply,
        model: response.model,
        matchedFaqs: response.matchedFaqs,
        usage: response.usage,
        style: response.style,
        elapsedMs: response.elapsedMs,
      });
      response.persistence = { driver: database.status().driver, saved: Boolean(saved), id: saved?.id || null };
    } catch (error) {
      app.log.error({ err: error }, 'Could not persist playground run');
      response.persistence = { driver: database.status().driver, saved: false, id: null };
    }
    return response;
  });

  app.get('/v1/admin/playground/runs', {
    schema: { querystring: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    } } },
  }, async (request) => ({
    database: database.status(),
    runs: await database.listPlaygroundRuns(request.query.limit || 20),
  }));

  app.get('/v1/whatsapp/status', async () => publicState());
  const SSE_MAX_CLIENTS = 50;
  app.get('/v1/events', async (request, reply) => {
    if (eventClients.size >= SSE_MAX_CLIENTS) {
      return reply.code(503).send({ error: 'Too many event stream connections' });
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ phase: state.phase })}\n\n`);
    eventClients.add(reply.raw);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(': keepalive\n\n');
    }, 25_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      eventClients.delete(reply.raw);
    });
  });
  app.get('/v1/whatsapp/qr', async (_request, reply) => {
    if (config.demoMode) {
      demoQr ||= await QRCode.toDataURL('AGNEE-DEMO-PAIRING', { margin: 1, width: 320, color: { dark: '#173A30', light: '#FFFFFF' } });
      return { qrDataUrl: demoQr, demoMode: true };
    }
    await mirrorCurrentQrFromBrowser();
    if (!state.qrDataUrl) return reply.code(404).send({ error: 'QR is not available', phase: state.phase });
    return { qrDataUrl: state.qrDataUrl, qrGeneratedAt: state.qrGeneratedAt, demoMode: false };
  });

  app.post('/v1/whatsapp/qr-refresh', async (_request, reply) => {
    if (config.demoMode) {
      demoQr ||= await QRCode.toDataURL('AGNEE-DEMO-PAIRING', { margin: 1, width: 320, color: { dark: '#173A30', light: '#FFFFFF' } });
      return { qrDataUrl: demoQr, demoMode: true };
    }
    // When client is stuck in error state, restart it so a fresh QR is generated
    if (state.phase === 'error') {
      const stale = whatsapp;
      whatsapp = null;
      await stale?.destroy().catch(() => {});
      const backupName = quarantineWhatsappProfile();
      state.phase = 'starting';
      state.qrDataUrl = null;
      state.lastError = null;
      broadcastEvent('whatsapp_phase', { phase: 'starting' });
      createWhatsappClient();
      whatsapp.initialize().catch((error) => {
        state.phase = 'error';
        state.lastError = error.message;
        app.log.error({ err: error }, 'WhatsApp re-initialization after manual refresh failed');
        broadcastEvent('whatsapp_phase', { phase: 'error', error: error.message });
      });
      return { restarting: true, phase: 'starting', previousSessionBackedUp: Boolean(backupName) };
    }
    await mirrorCurrentQrFromBrowser();
    if (!state.qrDataUrl) return reply.code(404).send({ error: 'QR is not available', phase: state.phase });
    return { qrDataUrl: state.qrDataUrl, qrGeneratedAt: state.qrGeneratedAt, demoMode: false };
  });

  app.post('/v1/whatsapp/logout', async (_request, reply) => {
    if (config.demoMode) return reply.code(409).send({ error: 'Cannot logout in demo mode' });
    if (!whatsapp) return reply.code(409).send({ error: 'WhatsApp client not initialized' });
    try {
      await whatsapp.logout();
    } catch {
      // logout() may throw if already disconnected — force restart anyway
      const stale = whatsapp;
      whatsapp = null;
      await stale.destroy().catch(() => {});
      state.phase = 'starting';
      state.qrDataUrl = null;
      state.account = null;
      state.syncPercent = null;
      state.lastError = null;
      broadcastEvent('whatsapp_phase', { phase: 'starting' });
      createWhatsappClient();
      whatsapp.initialize().catch((error) => {
        state.phase = 'error';
        state.lastError = error.message;
        app.log.error({ err: error }, 'WhatsApp re-initialization after logout failed');
      });
    }
    return { ok: true };
  });

  app.get('/v1/chats', {
    schema: { querystring: { type: 'object', properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
      offset: { type: 'integer', minimum: 0, maximum: 5000, default: 0 },
      q: { type: 'string', maxLength: 100, default: '' },
      filter: { type: 'string', enum: ['all', 'unread', 'qualified', 'archived', 'inbox'], default: 'inbox' },
    } } },
  }, async (request) => {
    const limit = request.query.limit || 12;
    const offset = request.query.offset || 0;
    if (!config.demoMode && state.phase !== 'ready') return { chats: [], phase: state.phase };
    const query = String(request.query.q || '').trim().toLocaleLowerCase('id-ID');
    const filter = request.query.filter || 'inbox';
    let chats = config.demoMode ? [...demo.chats] : await getChatsForUi();
    if (!isSupervisor(request.agneeSession)) {
      const routing = await Promise.all(chats.map((chat) => getRouting(chat.id)));
      chats = chats.filter((_chat, index) => routing[index].mode === 'human'
        && routing[index].assigneeUserId === request.agneeSession?.userId);
    }
    if (filter === 'inbox') chats = chats.filter((chat) => !chat.archived);
    if (filter === 'archived') chats = chats.filter((chat) => chat.archived);
    if (filter === 'unread') chats = chats.filter((chat) => chat.unreadCount > 0 && !chat.archived);
    if (filter === 'qualified') {
      const states = await Promise.all(chats.map((chat) => getLeadState(chat.id)));
      chats = chats.filter((chat, index) => !chat.archived && ['qualified', 'assigned'].includes(states[index].stage));
    }
    if (filter === 'all') chats = chats;
    if (query) chats = chats.filter((chat) => `${chat.name} ${chat.preview}`.toLocaleLowerCase('id-ID').includes(query));
    chats.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Number(b.timestamp || 0) - Number(a.timestamp || 0));
    return {
      chats: chats.slice(offset, offset + limit),
      hasMore: offset + limit < chats.length,
    };
  });

  app.get('/v1/chats/:chatId/messages', {
    schema: {
      params: { type: 'object', required: ['chatId'], properties: { chatId: { type: 'string', minLength: 1, maxLength: 128 } } },
      querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 600, default: 30 } } },
    },
  }, async (request, reply) => {
    const { chatId } = request.params;
    const limit = request.query.limit || 30;
    if (config.demoMode) {
      const all = demo.messages[chatId] || [];
      return { messages: all.slice(-limit), hasMore: all.length > limit };
    }
    if (state.phase !== 'ready') return reply.code(503).send({ error: 'WhatsApp is not ready', phase: state.phase });
    return getMessagesForUi(chatId, limit);
  });

  app.get('/v1/chats/:chatId/info', {
    schema: { params: { type: 'object', required: ['chatId'], properties: {
      chatId: { type: 'string', minLength: 1, maxLength: 128 },
    } } },
  }, async (request, reply) => {
    if (config.demoMode) {
      const chat = demo.chats.find((item) => item.id === request.params.chatId);
      return { isGroup: Boolean(chat?.isGroup), participantCount: 0, participantNames: [] };
    }
    if (state.phase !== 'ready') return reply.code(503).send({ error: 'WhatsApp is not ready', phase: state.phase });
    try {
      return await getGroupInfoForUi(request.params.chatId);
    } catch (error) {
      app.log.debug({ err: error, chatId: request.params.chatId }, 'Group information is unavailable');
      return { isGroup: true, participantCount: 0, participantNames: [] };
    }
  });

  app.get('/v1/chats/:chatId/pinned', {
    schema: { params: { type: 'object', required: ['chatId'], properties: {
      chatId: { type: 'string', minLength: 1, maxLength: 128 },
    } } },
  }, async (request, reply) => {
    const { chatId } = request.params;
    if (config.demoMode) {
      const pinnedIds = new Set(demo.pinned[chatId] || []);
      return { messages: (demo.messages[chatId] || []).filter((message) => pinnedIds.has(message.id)) };
    }
    if (state.phase !== 'ready') return reply.code(503).send({ error: 'WhatsApp is not ready', phase: state.phase });
    try {
      const chat = await whatsapp.getChatById(chatId);
      const messages = await chat.getPinnedMessages();
      return { messages: messages.map((message) => normalizeMessageForUi({
        id: message.id?._serialized || null,
        body: typeof message.body === 'string' ? message.body : '',
        fromMe: Boolean(message.fromMe),
        timestamp: Number(message.timestamp || 0),
        type: message.type || 'chat',
        senderName: message._data?.notifyName || null,
      })) };
    } catch (error) {
      app.log.warn({ err: error, chatId }, 'Standard pinned-message serialization failed; using safe pin snapshot');
      try {
        const messages = await whatsapp.pupPage.evaluate(async (requestedChatId) => {
          const chatWid = window.require('WAWebWidFactory').createWid(requestedChatId);
          const rows = await window.require('WAWebPinInChatSchema').getTable().equals(['chatId'], chatWid.toString());
          const collection = window.require('WAWebCollections').Msg;
          const contacts = window.require('WAWebCollections').Contact;
          const result = [];
          for (const row of rows.filter((item) => item.pinType == 1)) {
            const message = (await collection.getMessagesById([row.parentMsgKey]))?.messages?.[0];
            if (!message) continue;
            const authorId = message.author?._serialized || message.author?.toString?.() || null;
            const author = authorId ? contacts.get?.(authorId) : null;
            result.push({
              id: message.id?._serialized || message.id?.toString?.() || null,
              body: typeof message.body === 'string' ? message.body : '',
              fromMe: Boolean(message.id?.fromMe),
              timestamp: Number(message.t || message.timestamp || 0),
              type: message.type || 'chat',
              senderName: author?.formattedName || author?.pushname || message.notifyName || null,
            });
          }
          return result;
        }, chatId);
        return { messages: messages.map(normalizeMessageForUi) };
      } catch (fallbackError) {
        app.log.warn({ err: fallbackError, chatId }, 'Pinned messages are unavailable');
        return { messages: [] };
      }
    }
  });

  app.get('/v1/chats/:chatId/lead', {
    schema: { params: { type: 'object', required: ['chatId'], properties: {
      chatId: { type: 'string', minLength: 1, maxLength: 128 },
    } } },
  }, async (request) => getLeadState(request.params.chatId));

  app.post('/v1/chats/:chatId/assign', {
    schema: {
      params: { type: 'object', required: ['chatId'], properties: {
        chatId: { type: 'string', minLength: 1, maxLength: 128 },
      } },
      body: { type: 'object', additionalProperties: false, properties: {
        assignee: { type: 'string', minLength: 1, maxLength: 100, default: 'Sales team' },
      } },
    },
  }, async (request) => {
    const currentLead = await getLeadState(request.params.chatId);
    const lead = {
      ...currentLead,
      stage: 'assigned',
      score: currentLead.score ?? 70,
      title: 'Assigned lead',
      detail: `Ditugaskan ke ${request.body?.assignee || 'Sales team'}.`,
      assignee: request.body?.assignee || 'Sales team',
    };
    leadStates.set(request.params.chatId, lead);
    await database.saveLeadState(lead);
    broadcastEvent('lead', lead);
    return lead;
  });

  app.post('/v1/chats/:chatId/mark-read', {
    schema: {
      params: { type: 'object', required: ['chatId'], properties: {
        chatId: { type: 'string', minLength: 1, maxLength: 128 },
      } },
    },
  }, async (request, reply) => {
    const { chatId } = request.params;
    if (config.demoMode) {
      const chat = demo.chats.find((c) => c.id === chatId);
      if (chat) chat.unreadCount = 0;
      return { success: true };
    }
    if (state.phase !== 'ready') return reply.code(503).send({ error: 'WhatsApp is not ready', phase: state.phase });
    try {
      await whatsapp.sendSeen(chatId);
      return { success: true };
    } catch (error) {
      app.log.warn({ err: error, chatId }, 'Failed to mark chat as read');
      return reply.code(500).send({ error: 'Failed to mark chat as read' });
    }
  });

  app.post('/v1/chats/:chatId/archive', {
    schema: {
      params: { type: 'object', required: ['chatId'], properties: {
        chatId: { type: 'string', minLength: 1, maxLength: 128 },
      } },
      body: { type: 'object', additionalProperties: false, required: ['archived'], properties: {
        archived: { type: 'boolean' },
      } },
    },
  }, async (request, reply) => {
    const { chatId } = request.params;
    const { archived } = request.body;
    if (config.demoMode) {
      const chat = demo.chats.find((item) => item.id === chatId);
      if (!chat) return reply.code(404).send({ error: 'Chat not found' });
      chat.archived = archived;
      return { success: true, archived };
    }
    if (state.phase !== 'ready') return reply.code(503).send({ error: 'WhatsApp is not ready', phase: state.phase });
    try {
      const success = archived
        ? await whatsapp.archiveChat(chatId)
        : await whatsapp.unarchiveChat(chatId);
      if (!success) return reply.code(409).send({ error: 'WhatsApp did not change the archive state' });
      return { success: true, archived };
    } catch (error) {
      app.log.warn({ err: error, chatId, archived }, 'Failed to change chat archive state');
      return reply.code(500).send({ error: archived ? 'Failed to archive chat' : 'Failed to restore chat' });
    }
  });

  app.get('/v1/chats/:chatId/avatar', {
    schema: { params: { type: 'object', required: ['chatId'], properties: {
      chatId: { type: 'string', minLength: 1, maxLength: 128 },
    } } },
  }, async (request, reply) => {
    if (config.demoMode || state.phase !== 'ready') return reply.code(404).send();
    try {
      const avatarUrl = await getProfilePicUrlForUi(request.params.chatId);
      if (!avatarUrl) return reply.code(404).send();
      const parsed = new URL(avatarUrl);
      if (parsed.protocol !== 'https:') return reply.code(404).send();
      const response = await fetch(parsed, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return reply.code(404).send();
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) return reply.code(404).send();
      reply.header('content-type', contentType);
      reply.header('cache-control', 'private, max-age=3600');
      return reply.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      app.log.debug({ err: error, chatId: request.params.chatId }, 'Profile picture is unavailable');
      return reply.code(404).send();
    }
  });

  app.get('/v1/messages/:messageId/media', {
    schema: { params: { type: 'object', required: ['messageId'], properties: {
      messageId: { type: 'string', minLength: 1, maxLength: 256 },
    } } },
  }, async (request, reply) => {
    if (config.demoMode || state.phase !== 'ready') return reply.code(404).send();
    try {
      const media = await whatsapp.pupPage.evaluate(async (messageId) => {
        const messages = window.require('WAWebCollections').Msg;
        const message = messages.get(messageId)
          || (await messages.getMessagesById([messageId]))?.messages?.[0];
        if (!message || !['image', 'sticker', 'video', 'audio', 'ptt', 'document', 'interactive'].includes(message.type) || !message.mediaData) return null;
        if (message.mediaData.mediaStage === 'REUPLOADING') return null;
        if (message.mediaData.mediaStage !== 'RESOLVED') {
          await message.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
        }
        if (message.mediaData.mediaStage?.includes('ERROR') || message.mediaData.mediaStage === 'FETCHING') return null;
        const mockQpl = { addAnnotations() { return this; }, addPoint() { return this; } };
        const bytes = await window.require('WAWebDownloadManager').downloadManager.downloadAndMaybeDecrypt({
          directPath: message.directPath,
          encFilehash: message.encFilehash,
          filehash: message.filehash,
          mediaKey: message.mediaKey,
          mediaKeyTimestamp: message.mediaKeyTimestamp,
          type: message.mediaData.type || (message.type === 'interactive' ? 'image' : message.type),
          signal: new AbortController().signal,
          downloadQpl: mockQpl,
        });
        return {
          data: await window.WWebJS.arrayBufferToBase64Async(bytes),
          mimetype: message.mimetype || message.mediaData?.mimetype || (message.type === 'sticker' ? 'image/webp' : 'application/octet-stream'),
          filename: message.filename || null,
        };
      }, request.params.messageId);
      const supported = /^(image|video|audio)\//.test(String(media?.mimetype)) || media?.mimetype === 'application/pdf';
      if (!media?.data || !supported) return reply.code(404).send();
      const buffer = Buffer.from(media.data, 'base64');
      if (buffer.length > 40 * 1024 * 1024) return reply.code(413).send();
      reply.header('content-type', media.mimetype);
      reply.header('cache-control', 'private, max-age=3600');
      reply.header('content-disposition', 'inline');
      return reply.send(buffer);
    } catch (error) {
      app.log.debug({ err: error }, 'Message media is unavailable');
      return reply.code(404).send();
    }
  });

  app.post('/v1/messages/send', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        anyOf: [{ required: ['to'] }, { required: ['chatId'] }],
        properties: {
          to: { type: 'string', minLength: 1, maxLength: 128 },
          chatId: { type: 'string', minLength: 1, maxLength: 128 },
          text: { type: 'string', minLength: 0, maxLength: 4096 },
          clientRequestId: { type: 'string', minLength: 8, maxLength: 100 },
          quotedMessageId: { type: 'string', minLength: 1, maxLength: 256 },
          attachment: {
            type: 'object',
            additionalProperties: false,
            required: ['data', 'mimetype', 'filename'],
            properties: {
              data: { type: 'string', minLength: 1, maxLength: 8500000 },
              mimetype: { type: 'string', minLength: 3, maxLength: 100 },
              filename: { type: 'string', minLength: 1, maxLength: 255 },
              filesize: { type: 'integer', minimum: 0, maximum: 6291456 },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const text = String(request.body.text || '').trim();
    const attachment = request.body.attachment || null;
    if (!text && !attachment) return reply.code(400).send({ error: 'Text or attachment is required' });
    if (attachment) {
      const allowed = /^(image|video|audio)\//.test(attachment.mimetype) || attachment.mimetype === 'application/pdf';
      if (!allowed) return reply.code(415).send({ error: 'Attachment type is not supported' });
      const estimatedBytes = Math.floor(attachment.data.length * 0.75);
      if (estimatedBytes > 6 * 1024 * 1024) return reply.code(413).send({ error: 'Attachment exceeds 6 MB' });
    }
    const requestId = request.body.clientRequestId || null;
    if (requestId && sendReceipts.has(requestId)) return sendReceipts.get(requestId);
    if (config.demoMode) {
      const chatId = request.body.chatId || request.body.to;
      demo.messages[chatId] ||= [];
      const message = {
        id: crypto.randomUUID(),
        body: text,
        fromMe: true,
        timestamp: Math.floor(Date.now() / 1000),
        type: attachment ? (attachment.mimetype === 'application/pdf' ? 'document' : attachment.mimetype.split('/')[0]) : 'chat',
        quoted: request.body.quotedMessageId ? { id: request.body.quotedMessageId, body: 'Pesan dibalas', type: 'chat', fromMe: false } : null,
      };
      demo.messages[chatId].push(message);
      const chat = demo.chats.find((item) => item.id === chatId);
      if (chat) {
        chat.preview = message.body;
        chat.timestamp = message.timestamp;
      }
      const result = { ok: true, demoMode: true, messageId: message.id, to: chatId };
      if (requestId) sendReceipts.set(requestId, result);
      return result;
    }
    if (state.phase !== 'ready') return reply.code(503).send({ error: 'WhatsApp is not ready', phase: state.phase });
    let chatId;
    try {
      chatId = request.body.chatId || normalizeChatId(request.body.to, config.defaultCountryCode);
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
    const routing = await getRouting(chatId);
    if (!isSupervisor(request.agneeSession)
      && (routing.mode !== 'human' || routing.assigneeUserId !== request.agneeSession?.userId)) {
      return reply.code(403).send({ error: 'Ambil alih chat ini sebelum membalas.' });
    }
    if (!request.body.chatId && !(await whatsapp.isRegisteredUser(chatId))) return reply.code(422).send({ error: 'Recipient is not on WhatsApp' });
    const sent = await sendTextForUi(chatId, text, {
      quotedMessageId: request.body.quotedMessageId || null,
      attachment,
    });
    const result = { ok: true, messageId: sent.messageId, timestamp: sent.timestamp, to: chatId };
    if (requestId) {
      sendReceipts.set(requestId, result);
      setTimeout(() => sendReceipts.delete(requestId), 5 * 60 * 1000).unref?.();
    }
    return result;
  });

  app.addHook('onClose', async () => {
    clearQrMirror();
    clearTimeout(restoredSessionTimer);
    for (const client of eventClients) client.end();
    eventClients.clear();
    sendReceipts.clear();
    leadStates.clear();
    conversationRouting.clear();
    conversationNotes.clear();
    conversationHandoffs.clear();
    if (whatsapp) await whatsapp.destroy();
    await database.close();
  });
  app.decorate('startWhatsapp', async () => {
    if (!config.startupEnabled || config.demoMode || whatsapp) return;
    let initRetries = 0;
    const initWithRetry = () => {
      createWhatsappClient();
      whatsapp.initialize().catch((error) => {
        state.phase = 'error';
        state.lastError = error.message;
        app.log.error({ err: error }, 'WhatsApp initialization failed');
        broadcastEvent('whatsapp_phase', { phase: 'error', error: error.message });
        if (initRetries < 2) {
          initRetries += 1;
          const delay = initRetries * 10_000;
          app.log.info(`WhatsApp will auto-retry initialization in ${delay / 1000}s (attempt ${initRetries}/2)`);
          setTimeout(() => {
            if (state.phase !== 'error') return;
            const stale = whatsapp;
            whatsapp = null;
            stale?.destroy().catch(() => {});
            state.phase = 'starting';
            state.lastError = null;
            broadcastEvent('whatsapp_phase', { phase: 'starting' });
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
      if (!['starting', 'authenticated'].includes(state.phase) || !whatsapp?.pupPage) {
        restoredSessionTimer = null;
        return;
      }
      try {
        const connectionState = await whatsapp.getState().catch(() => null);
        if (connectionState === 'CONNECTED') {
          // getState() reads the raw WA socket and can be CONNECTED even when
          // whatsapp-web.js's own page-side helpers never finished loading
          // (e.g. a prior Client.inject() crashed mid-way). Calling inject()
          // again in place is not safe to retry — it re-registers page-side
          // listeners on every call, so a full client restart (same recovery
          // path as the 'disconnected' handler) is used instead once.
          const injected = await whatsapp.pupPage.evaluate(() => Boolean(window.WWebJS)).catch(() => false);
          if (!injected && !restartAttempted) {
            restartAttempted = true;
            app.log.warn('WhatsApp socket connected but page helpers never loaded; restarting client');
            restoredSessionTimer = null;
            const stale = whatsapp;
            whatsapp = null;
            await stale.destroy().catch(() => {});
            state.phase = 'starting';
            state.lastError = null;
            createWhatsappClient();
            whatsapp.initialize().catch((error) => {
              state.phase = 'error';
              state.lastError = error.message;
              app.log.error({ err: error }, 'WhatsApp re-initialization failed');
            });
            return;
          }
          if (injected) {
            state.phase = 'ready';
            state.connectedAt = new Date().toISOString();
            state.account = whatsapp.info?.wid?._serialized || null;
            state.lastError = null;
            app.log.info('Restored WhatsApp session confirmed connected');
            broadcastEvent('whatsapp_phase', { phase: 'ready', account: state.account });
            restoredSessionTimer = null;
            return;
          }
          app.log.warn('WhatsApp socket connected but page helpers are still missing; will retry');
        }
        // inject() already handles the case where hasSynced fired before our listener was
        // registered — it checks the flag and calls the handler immediately. Manual triggering
        // here risks double-initialization, so we just wait and retry.
      } catch (error) {
        app.log.warn({ err: error }, 'Could not resume restored WhatsApp session sync');
      }
      if (restoredSessionAttempts < 12) restoredSessionTimer = setTimeout(tryResumeRestoredSession, 5000);
    };
    restoredSessionTimer = setTimeout(tryResumeRestoredSession, 5000);
  });
  return app;
}

async function main() {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ port: config.port, host: config.host });
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await app.startWhatsapp();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildApp, loadConfig, normalizeChatId, inlineImageFromBody, messagePreviewForUi, normalizeMessageForUi, requestsHumanAgent };
