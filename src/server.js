'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

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

function createSession(email, secret) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
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
  const eventClients = new Set();
  const sendReceipts = new Map();
  const leadStates = new Map();
  const state = {
    phase: config.demoMode ? 'demo' : config.startupEnabled ? 'starting' : 'disabled',
    qrDataUrl: null,
    connectedAt: config.demoMode ? new Date().toISOString() : null,
    account: config.demoMode ? 'Agnee Demo Workspace' : null,
    lastError: null,
  };

  function publicState() {
    return {
      phase: state.phase,
      connectedAt: state.connectedAt,
      account: state.account,
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
        protocolTimeout: 120_000,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      },
    });
    whatsapp.on('qr', async (qr) => {
      state.phase = 'waiting_for_qr';
      state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      state.lastError = null;
      app.log.info('WhatsApp QR generated');
    });
    whatsapp.on('authenticated', () => {
      if (state.phase === 'ready') return; // whatsapp-web.js can re-fire 'authenticated' after 'ready'
      state.phase = 'authenticated';
      state.qrDataUrl = null;
      state.lastError = null;
      app.log.info('WhatsApp authenticated');
      broadcastEvent('whatsapp_phase', { phase: 'authenticated' });
    });
    whatsapp.on('ready', () => {
      clearTimeout(restoredSessionTimer);
      restoredSessionTimer = null;
      state.phase = 'ready';
      state.connectedAt = new Date().toISOString();
      state.account = whatsapp.info?.wid?._serialized || null;
      state.qrDataUrl = null;
      state.lastError = null;
      app.log.info({ account: state.account }, 'WhatsApp ready');
      broadcastEvent('whatsapp_phase', { phase: 'ready', account: state.account });
    });
    whatsapp.on('auth_failure', (message) => {
      state.phase = 'auth_failure';
      state.lastError = String(message);
      app.log.warn({ message }, 'WhatsApp auth_failure');
      broadcastEvent('whatsapp_phase', { phase: 'auth_failure' });
    });
    whatsapp.on('disconnected', (reason) => {
      state.phase = 'disconnected';
      state.connectedAt = null;
      state.account = null;
      state.lastError = String(reason);
      app.log.warn({ reason }, 'WhatsApp disconnected');
      broadcastEvent('whatsapp_phase', { phase: 'disconnected' });
      setTimeout(async () => {
        try {
          await whatsapp.destroy().catch(() => {});
        } catch { /* ignore */ }
        whatsapp = null;
        state.phase = 'starting';
        state.lastError = null;
        app.log.info('WhatsApp restarting after disconnect');
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
        if (config.ackEnabled && message.body) await message.reply(config.ackText);
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
  }

  async function getChatsForUi() {
    try {
      const chats = await whatsapp.getChats();
      return chats.map((chat) => ({
        id: chat.id?._serialized,
        name: chat.name || chat.id?.user || 'Unknown',
        preview: messagePreviewForUi(chat.lastMessage?.type, chat.lastMessage?.body, chat.lastMessage?.hasMedia, chat.lastMessage?._data?.caption || chat.lastMessage?.caption),
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
              previewType: meaningful?.type || last?.type || 'chat',
              previewCaption: meaningful?.caption || last?.caption || '',
              timestamp: Number(chat.t || chat.timestamp || last?.t || 0),
              unreadCount: Number(chat.unreadCount || 0),
              isGroup: Boolean(chat.groupMetadata) || id.endsWith('@g.us'),
              pinned: Boolean(chat.pin || chat.__x_pin),
              archived: Boolean(chat.archived || chat.__x_archived),
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
        if (message.hasQuotedMsg) {
          try { quotedMessage = await message.getQuotedMessage(); } catch { /* quoted message may have expired */ }
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
        senderName: message._data?.notifyName || null,
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

  function getLeadState(chatId) {
    return leadStates.get(chatId) || {
      chatId,
      stage: 'inbox',
      score: null,
      title: 'Belum dikualifikasi',
      detail: 'Belum dianalisis oleh AI.',
      assignee: null,
    };
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

  app.get('/health', async () => ({ ok: true, service: 'agnee-app', whatsapp: publicState() }));

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
    const valid = safeEqual(request.body.email.toLowerCase(), config.adminEmail.toLowerCase())
      && safeEqual(request.body.password, config.adminPassword);
    if (!valid) {
      entry.count += 1;
      loginAttempts.set(ip, entry);
      return reply.code(401).send({ error: 'Email atau password salah' });
    }
    loginAttempts.delete(ip);
    const token = createSession(config.adminEmail, config.sessionSecret);
    reply.header('set-cookie', `agnee_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${config.cookieSecure ? '; Secure' : ''}`);
    return { ok: true, user: { email: config.adminEmail } };
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/') || request.url.startsWith('/v1/auth/login')) return;
    const suppliedKey = request.headers['x-api-key'];
    const session = verifySession(getCookie(request.headers.cookie, 'agnee_session'), config.sessionSecret);
    if (suppliedKey === config.apiKey || session) {
      request.agneeSession = session;
      return;
    }
    return reply.code(401).send({ error: 'Unauthorized' });
  });

  app.get('/v1/auth/session', async (request) => ({ authenticated: true, user: { email: request.agneeSession?.email || 'api-client' } }));
  app.post('/v1/auth/logout', async (_request, reply) => {
    reply.header('set-cookie', 'agnee_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { ok: true };
  });

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
    if (!state.qrDataUrl) return reply.code(404).send({ error: 'QR is not available', phase: state.phase });
    return { qrDataUrl: state.qrDataUrl, demoMode: false };
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
    if (filter === 'inbox') chats = chats.filter((chat) => !chat.archived);
    if (filter === 'archived') chats = chats.filter((chat) => chat.archived);
    if (filter === 'unread') chats = chats.filter((chat) => chat.unreadCount > 0 && !chat.archived);
    if (filter === 'qualified') chats = chats.filter((chat) => !chat.archived && ['qualified', 'assigned'].includes(getLeadState(chat.id).stage));
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
    const lead = {
      ...getLeadState(request.params.chatId),
      stage: 'assigned',
      score: getLeadState(request.params.chatId).score ?? 70,
      title: 'Assigned lead',
      detail: `Ditugaskan ke ${request.body?.assignee || 'Sales team'}.`,
      assignee: request.body?.assignee || 'Sales team',
    };
    leadStates.set(request.params.chatId, lead);
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
      await whatsapp.pupPage.evaluate(async (requestedChatId) => {
        await window.WWebJS.sendSeen(requestedChatId);
      }, chatId);
      return { success: true };
    } catch (error) {
      app.log.warn({ err: error, chatId }, 'Failed to mark chat as read');
      return reply.code(500).send({ error: 'Failed to mark chat as read' });
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
        if (!message || !['image', 'sticker', 'video', 'audio', 'ptt', 'document'].includes(message.type) || !message.mediaData) return null;
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
          type: message.type,
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
    clearTimeout(restoredSessionTimer);
    for (const client of eventClients) client.end();
    eventClients.clear();
    sendReceipts.clear();
    leadStates.clear();
    if (whatsapp) await whatsapp.destroy();
  });
  app.decorate('startWhatsapp', async () => {
    if (!config.startupEnabled || config.demoMode || whatsapp) return;
    createWhatsappClient();
    whatsapp.initialize().catch((error) => {
      state.phase = 'error';
      state.lastError = error.message;
      app.log.error({ err: error }, 'WhatsApp initialization failed');
    });
    let restoredSessionAttempts = 0;
    const tryResumeRestoredSession = async () => {
      restoredSessionAttempts += 1;
      if (!['starting', 'authenticated'].includes(state.phase) || !whatsapp?.pupPage) {
        restoredSessionTimer = null;
        return;
      }
      try {
        const connectionState = await whatsapp.getState().catch(() => null);
        if (connectionState === 'CONNECTED') {
          state.phase = 'ready';
          state.connectedAt = new Date().toISOString();
          state.account = whatsapp.info?.wid?._serialized || null;
          state.lastError = null;
          app.log.info('Restored WhatsApp session confirmed connected');
          broadcastEvent('whatsapp_phase', { phase: 'ready', account: state.account });
          restoredSessionTimer = null;
          return;
        }
        const kicked = await whatsapp.pupPage.evaluate(() => {
          const socket = window.require?.('WAWebSocketModel')?.Socket;
          if (!socket?.hasSynced || typeof socket.trigger !== 'function') return false;
          socket.trigger('change:hasSynced');
          return true;
        });
        if (kicked) app.log.info('Restored WhatsApp session sync resumed');
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

module.exports = { buildApp, loadConfig, normalizeChatId, inlineImageFromBody, messagePreviewForUi, normalizeMessageForUi };
