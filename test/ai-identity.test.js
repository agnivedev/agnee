'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const { AGNEE_CONVERSATION_RULES, conversationRules } = require('../src/reply-style');

const OWNER_A = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a',
  email: 'a@pelanggan.test', displayName: 'A', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const OWNER_B = { ...OWNER_A, id: 'owner-b', userId: 'owner-b', companyId: 'company-b', email: 'b@pelanggan.test', displayName: 'B' };

function fakeDatabase() {
  const users = [OWNER_A, OWNER_B];
  const rows = new Map([
    ['company-a', { enabled: true, modelChain: [], identity: 'team_member' }],
    ['company-b', { enabled: true, modelChain: [], identity: 'team_member' }],
  ]);
  return {
    rows,
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) {
      return users.find((u) => u.email === email && password === 'password-123') || null;
    },
    async getActiveSessionUser(userId) { return users.find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getAiSettings(companyId) { return { ...rows.get(companyId) }; },
    async setAiSettings(companyId, patch) {
      const next = { ...rows.get(companyId) };
      if (patch.identity) next.identity = patch.identity;
      rows.set(companyId, next);
      return { ...next };
    },
    async getCompanyConfig(companyId) {
      return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: rows.get(companyId).identity };
    },
    async listPlaybookProducts() { return []; },
    async getPlaybookContext() { return ''; },
    async recordSimulationRun() { return { id: 'run-1' }; },
  };
}

async function masuk(app, user) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' },
  });
  assert.equal(login.statusCode, 200);
  return login.headers['set-cookie'].split(';')[0];
}

test('aturan bawaan tanpa pilihan identik dengan perilaku sebelum setelan ini ada', () => {
  assert.equal(AGNEE_CONVERSATION_RULES, conversationRules('team_member'));
  assert.equal(conversationRules('nilai-asing'), AGNEE_CONVERSATION_RULES);
  assert.match(AGNEE_CONVERSATION_RULES, /7\. JANGAN PERNAH menyebut dirimu AI/);
});

test('mode chatbot mengganti butir 7 saja', () => {
  const chatbot = conversationRules('chatbot');
  assert.doesNotMatch(chatbot, /JANGAN PERNAH menyebut dirimu AI/);
  assert.match(chatbot, /7\. Jangan mengaku manusia/);
  assert.match(chatbot, /jawab jujur bahwa kamu\s+chatbot/);
  assert.match(chatbot, /8\. Satu pesan, satu ajakan/);
});

test('setelan identitas hanya mengubah company pemanggil, dan nilai asing ditolak', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'identity-1',
  });
  t.after(() => app.close());
  const cookieA = await masuk(app, OWNER_A);
  const cookieB = await masuk(app, OWNER_B);

  const patched = await app.inject({
    method: 'PATCH', url: '/v1/admin/ai-settings', headers: { cookie: cookieA }, payload: { identity: 'chatbot' },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().identity, 'chatbot');
  assert.equal(database.rows.get('company-a').identity, 'chatbot');
  assert.equal(database.rows.get('company-b').identity, 'team_member');

  const readB = await app.inject({ method: 'GET', url: '/v1/admin/ai-settings', headers: { cookie: cookieB } });
  assert.equal(readB.json().identity, 'team_member');

  const invalid = await app.inject({
    method: 'PATCH', url: '/v1/admin/ai-settings', headers: { cookie: cookieA }, payload: { identity: 'manusia' },
  });
  assert.equal(invalid.statusCode, 400);
});

test('prompt balasan tiap company memuat aturan identitasnya sendiri', async (t) => {
  const database = fakeDatabase();
  database.rows.get('company-a').identity = 'chatbot';
  const prompts = new Map();
  let current = null;
  const llmService = {
    enabled: true,
    model: 'uji',
    async generateReply(_text, options) {
      prompts.set(current, options.systemPrompt);
      return { text: 'baik' };
    },
  };
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, llmService, sessionSecret: 'identity-2',
  });
  t.after(() => app.close());

  for (const [label, owner] of [['a', OWNER_A], ['b', OWNER_B]]) {
    current = label;
    const cookie = await masuk(app, owner);
    const res = await app.inject({
      method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
      payload: { mode: 'ai', customerMessage: 'Halo', grade: false },
    });
    assert.equal(res.statusCode, 200, `simulate ${label}: ${res.body}`);
  }

  assert.match(prompts.get('a'), /7\. Jangan mengaku manusia/);
  assert.doesNotMatch(prompts.get('a'), /JANGAN PERNAH menyebut dirimu AI/);
  assert.match(prompts.get('b'), /7\. JANGAN PERNAH menyebut dirimu AI/);
});
