'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp, normalizeChatId, inlineImageFromBody, messagePreviewForUi, normalizeMessageForUi, requestsHumanAgent } = require('../src/server');

test('normalizes Indonesian phone numbers', () => {
  assert.equal(normalizeChatId('0812-3456-7890', '62'), '6281234567890@c.us');
});

test('normalizes interactive image payloads without leaking base64 as text', () => {
  const jpeg = `/9j/${'A'.repeat(120)}`;
  assert.equal(inlineImageFromBody(jpeg).extension, 'jpg');
  assert.equal(messagePreviewForUi('interactive', jpeg), 'Pesan interaktif WhatsApp');
  assert.equal(messagePreviewForUi('video', jpeg), 'Video');
  const message = normalizeMessageForUi({ type: 'interactive', body: jpeg, quoted: null });
  assert.equal(message.body, '');
  assert.match(message.inlineImage, /^data:image\/jpeg;base64,/);
  assert.equal(normalizeMessageForUi({ type: 'image', body: jpeg, caption: 'Promo hari ini' }).body, 'Promo hari ini');
  assert.equal(inlineImageFromBody('normal customer message'), null);
});

test('detects explicit requests to hand a conversation from AI to a human', () => {
  assert.equal(requestsHumanAgent('Tolong hubungkan saya ke CS'), true);
  assert.equal(requestsHumanAgent('Can I speak to a human agent?'), true);
  assert.equal(requestsHumanAgent('Berapa harga paketnya?'), false);
});

test('login, list chats, read and send in demo mode', async (t) => {
  const app = await buildApp({
    logger: false,
    startupEnabled: false,
    demoMode: true,
    apiKey: 'test-key',
    sessionSecret: 'test-session-secret',
    adminEmail: 'owner@example.com',
    adminPassword: 'strong-pass',
  });
  t.after(() => app.close());

  const unauthorized = await app.inject({ method: 'GET', url: '/v1/chats' });
  assert.equal(unauthorized.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: 'owner@example.com', password: 'strong-pass' },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];

  const chats = await app.inject({ method: 'GET', url: '/v1/chats', headers: { cookie } });
  assert.equal(chats.statusCode, 200);
  assert.ok(chats.json().chats.length >= 3);
  assert.equal(chats.json().chats[0].id, 'demo-raka');
  assert.equal(chats.json().chats[0].pinned, true);

  const search = await app.inject({ method: 'GET', url: '/v1/chats?q=nadia', headers: { cookie } });
  assert.equal(search.json().chats.length, 1);
  const noMatch = await app.inject({ method: 'GET', url: '/v1/chats?q=tidak-ada', headers: { cookie } });
  assert.equal(noMatch.json().chats.length, 0);
  const unread = await app.inject({ method: 'GET', url: '/v1/chats?filter=unread', headers: { cookie } });
  assert.ok(unread.json().chats.every((chat) => chat.unreadCount > 0));
  const qualified = await app.inject({ method: 'GET', url: '/v1/chats?filter=qualified', headers: { cookie } });
  assert.equal(qualified.json().chats.length, 0);
  const pinned = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/pinned', headers: { cookie } });
  assert.equal(pinned.statusCode, 200);
  assert.deepEqual(pinned.json().messages.map((message) => message.id), ['d2']);

  const send = await app.inject({
    method: 'POST',
    url: '/v1/messages/send',
    headers: { cookie },
    payload: { chatId: 'demo-nadia', text: 'Boleh, saya bantu hitungkan.', clientRequestId: 'request-demo-123' },
  });
  assert.equal(send.statusCode, 200);

  const duplicateRetry = await app.inject({
    method: 'POST',
    url: '/v1/messages/send',
    headers: { cookie },
    payload: { chatId: 'demo-nadia', text: 'Boleh, saya bantu hitungkan.', clientRequestId: 'request-demo-123' },
  });
  assert.equal(duplicateRetry.json().messageId, send.json().messageId);

  const messages = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/messages', headers: { cookie } });
  assert.equal(messages.json().messages.at(-1).body, 'Boleh, saya bantu hitungkan.');
  assert.equal(messages.json().messages.filter((message) => message.body === 'Boleh, saya bantu hitungkan.').length, 1);

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/messages/send',
    headers: { cookie },
    payload: {
      chatId: 'demo-nadia',
      text: 'Ini balasan terkutip.',
      quotedMessageId: messages.json().messages[0].id,
      clientRequestId: 'request-demo-reply-123',
    },
  });
  assert.equal(reply.statusCode, 200);
  const afterReply = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/messages', headers: { cookie } });
  assert.equal(afterReply.json().messages.at(-1).quoted.body, 'Pesan dibalas');
  assert.equal(afterReply.json().messages.at(-1).quoted.id, messages.json().messages[0].id);

  const attachment = await app.inject({
    method: 'POST',
    url: '/v1/messages/send',
    headers: { cookie },
    payload: {
      chatId: 'demo-nadia',
      text: '',
      attachment: { data: 'aGVsbG8=', mimetype: 'image/png', filename: 'contoh.png', filesize: 5 },
      clientRequestId: 'request-demo-media-123',
    },
  });
  assert.equal(attachment.statusCode, 200);

  const assigned = await app.inject({
    method: 'POST',
    url: '/v1/chats/demo-nadia/assign',
    headers: { cookie },
    payload: { assignee: 'Sales team' },
  });
  assert.equal(assigned.statusCode, 200);
  assert.equal(assigned.json().stage, 'assigned');
  const qualifiedAfterAssign = await app.inject({ method: 'GET', url: '/v1/chats?filter=qualified', headers: { cookie } });
  assert.ok(qualifiedAfterAssign.json().chats.some((chat) => chat.id === 'demo-nadia'));

  const team = await app.inject({ method: 'GET', url: '/v1/team/members', headers: { cookie } });
  assert.equal(team.statusCode, 200);
  assert.equal(team.json().members[0].role, 'supervisor');

  const toHuman = await app.inject({
    method: 'POST', url: '/v1/chats/demo-nadia/routing', headers: { cookie },
    payload: { mode: 'human', assigneeUserId: 'local-supervisor', note: 'Perlu bantuan manusia' },
  });
  assert.equal(toHuman.statusCode, 200);
  assert.equal(toHuman.json().routing.mode, 'human');
  assert.equal(toHuman.json().routing.assigneeName, 'Supervisor');

  const note = await app.inject({
    method: 'POST', url: '/v1/chats/demo-nadia/notes', headers: { cookie },
    payload: { body: 'Pelanggan menunggu penawaran.' },
  });
  assert.equal(note.statusCode, 201);
  const notes = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/notes', headers: { cookie } });
  assert.equal(notes.json().notes[0].body, 'Pelanggan menunggu penawaran.');

  const toAi = await app.inject({
    method: 'POST', url: '/v1/chats/demo-nadia/routing', headers: { cookie },
    payload: { mode: 'ai', note: 'Lanjutkan otomatis' },
  });
  assert.equal(toAi.json().routing.mode, 'ai');
  const routingHistory = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/routing', headers: { cookie } });
  assert.equal(routingHistory.json().handoffs.length, 2);
});

test('agent can only take chats for self and cannot open supervisor settings', async (t) => {
  const routes = new Map();
  const agent = { id: 'agent-2', userId: 'agent-2', companyId: 'company-1', email: 'agent2@example.com', displayName: 'Agent 2', role: 'agent' };
  const supervisor = { id: 'supervisor-1', email: 'owner@example.com', displayName: 'Supervisor', role: 'supervisor', status: 'active' };
  const database = {
    connected: true, companyId: 'company-1',
    async connect() {}, async close() {}, status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return email === agent.email && password === 'agent-pass-123' ? agent : null; },
    async setPresence() {}, async listTeamMembers() { return [supervisor, { ...agent, status: 'active' }]; },
    async getConversationRouting(chatId) { return routes.get(chatId) || null; },
    async saveConversationRouting(change) {
      const member = change.assigneeUserId === agent.id ? agent : supervisor;
      const value = { chatId: change.chatId, mode: change.mode, assigneeUserId: change.assigneeUserId || null, assigneeName: change.assigneeUserId ? member.displayName : null, status: 'open', priority: 'normal' };
      routes.set(change.chatId, value);
      return value;
    },
    async listConversationHandoffs() { return []; }, async listConversationNotes() { return []; },
    async getLeadState() { return null; }, async saveLeadState(lead) { return lead; },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'agent-session-secret' });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: agent.email, password: 'agent-pass-123' } });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];

  const forbiddenAdmin = await app.inject({ method: 'GET', url: '/v1/admin/config', headers: { cookie } });
  assert.equal(forbiddenAdmin.statusCode, 403);
  const forbiddenOther = await app.inject({ method: 'POST', url: '/v1/chats/demo-nadia/routing', headers: { cookie }, payload: { mode: 'human', assigneeUserId: supervisor.id } });
  assert.equal(forbiddenOther.statusCode, 403);
  const hiddenBeforeAssignment = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/messages', headers: { cookie } });
  assert.equal(hiddenBeforeAssignment.statusCode, 403);
  const takeSelf = await app.inject({ method: 'POST', url: '/v1/chats/demo-nadia/routing', headers: { cookie }, payload: { mode: 'human', assigneeUserId: agent.id } });
  assert.equal(takeSelf.statusCode, 200);
  const visibleAfterAssignment = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/messages', headers: { cookie } });
  assert.equal(visibleAfterAssignment.statusCode, 200);
  const backToAi = await app.inject({ method: 'POST', url: '/v1/chats/demo-nadia/routing', headers: { cookie }, payload: { mode: 'ai' } });
  assert.equal(backToAi.statusCode, 200);
  assert.equal(backToAi.json().routing.mode, 'ai');
});

test('admin auto-reply playground previews usage without sending WhatsApp', async (t) => {
  const persistedLeads = new Map();
  const persistedRuns = [];
  const database = {
    enabled: true,
    connected: true,
    async connect() {},
    async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async getLeadState(chatId) { return persistedLeads.get(chatId) || null; },
    async saveLeadState(lead) { persistedLeads.set(lead.chatId, lead); return lead; },
    async recordPlaygroundRun(run) {
      const saved = { id: String(persistedRuns.length + 1), createdAt: new Date().toISOString(), ...run };
      persistedRuns.unshift(saved);
      return saved;
    },
    async listPlaygroundRuns(limit) {
      return persistedRuns.slice(0, limit).map((run) => ({
        ...run,
        inputTokens: run.usage.inputTokens,
        outputTokens: run.usage.outputTokens,
        totalTokens: run.usage.totalTokens,
        costUsd: run.usage.costUsd,
        stylePassed: run.style.passed,
        styleWarnings: run.style.warnings,
      }));
    },
  };
  const llmService = {
    enabled: true,
    model: 'test/model',
    async generateReply(message) {
      return {
        text: `Preview: ${message}`,
        model: this.model,
        usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132, cost: 0.00042 },
      };
    },
  };
  const app = await buildApp({
    logger: false,
    startupEnabled: false,
    demoMode: true,
    apiKey: 'test-key',
    sessionSecret: 'test-session-secret',
    llmService,
    database,
  });
  t.after(() => app.close());

  const headers = { 'x-api-key': 'test-key' };
  const config = await app.inject({ method: 'GET', url: '/v1/admin/config', headers });
  assert.equal(config.statusCode, 200);
  assert.equal(config.json().model, 'test/model');
  assert.equal(config.json().llmEnabled, true);

  const preview = await app.inject({
    method: 'POST',
    url: '/v1/admin/playground/auto-reply',
    headers,
    payload: { clientId: 'bzone', message: 'Bisa lihat demo dulu ga?' },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().reply, 'Preview: Bisa lihat demo dulu ga?');
  assert.deepEqual(preview.json().usage, { inputTokens: 120, outputTokens: 12, totalTokens: 132, costUsd: 0.00042 });
  assert.equal(preview.json().sentToWhatsapp, false);
  assert.ok(preview.json().matchedFaqs.length > 0);
  assert.deepEqual(preview.json().persistence, { driver: 'postgresql', saved: true, id: '1' });

  const history = await app.inject({ method: 'GET', url: '/v1/admin/playground/runs', headers });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().runs.length, 1);
  assert.equal(history.json().runs[0].message, 'Bisa lihat demo dulu ga?');

  const assigned = await app.inject({
    method: 'POST',
    url: '/v1/chats/demo-nadia/assign',
    headers,
    payload: { assignee: 'Sales database' },
  });
  assert.equal(assigned.statusCode, 200);
  assert.equal(persistedLeads.get('demo-nadia').assignee, 'Sales database');

  const invalidTenant = await app.inject({
    method: 'POST',
    url: '/v1/admin/playground/auto-reply',
    headers,
    payload: { clientId: 'unknown', message: 'Test' },
  });
  assert.equal(invalidTenant.statusCode, 400);
});
