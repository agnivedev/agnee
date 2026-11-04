'use strict';

/**
 * Eskalasi model di jalur simulator (sejalur dengan balasan WhatsApp): model
 * murah menjawab dulu; bila penjaga menilai bermasalah, giliran itu diulang
 * dengan model yang lebih kuat. LLM ditiru; tidak ada jaringan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const SUP = {
  id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'sup@toko.test',
  displayName: 'Supervisor', role: 'supervisor', status: 'active', isPlatformAdmin: true,
};

function fakeDatabase(extraConfig = {}) {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === SUP.email && password === 'password-123' ? SUP : null; },
    async getActiveSessionUser(userId) { return userId === SUP.id ? SUP : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: ['murah/model'], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member', ...extraConfig }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

const BAD = 'Dana sudah masuk Kak, pesanan langsung kami proses ya.';
const GOOD = 'Terima kasih Kak. Boleh kirim foto bukti transfernya supaya tim kami cek?';

async function setup(t, replies, { toolCalls = [], config = {} } = {}) {
  const calls = [];
  const llm = {
    enabled: true, model: 'murah/model',
    async generateReply(message, options) {
      if (options.purpose !== 'simulate') return { text: 'ok', model: 'x', usage: {} };
      const model = (options.modelChain || [])[0] || 'murah/model';
      calls.push({ model, maxTokens: options.maxTokens });
      const text = replies[model];
      if (text === undefined) return null;
      return { text, model, usage: { cost: model === 'kuat/model' ? 0.01 : 0.001 }, toolCalls: model === 'murah/model' ? toolCalls : [] };
    },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'esc', database: fakeDatabase(config), llmService: llm });
  t.after(async () => { await app.close(); });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUP.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const simulate = (payload) => app.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
    payload: { mode: 'ai', grade: false, customerMessage: 'sudah saya transfer ya kak', ...payload },
  });
  return { calls, simulate };
}

test('jawaban bermasalah dari model murah dieskalasi ke model kuat dan hasil kuat dipakai', async (t) => {
  const { calls, simulate } = await setup(t, { 'murah/model': BAD, 'kuat/model': GOOD });
  const res = await simulate({ escalationChain: 'kuat/model' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.reply, GOOD);
  assert.equal(body.escalation.chosen, 'second');
  assert.notEqual(body.escalation.from, 'murah/model', 'id model asli tidak sampai ke supervisor');
  assert.ok(!JSON.stringify(body.escalation).includes('kuat/model'));
  assert.ok(body.escalation.why.length > 0);
  assert.deepEqual(calls.map((c) => c.model), ['murah/model', 'kuat/model']);
  assert.equal(calls[1].maxTokens, 2000, 'model kuat diberi jatah token lebih besar');
});

test('jawaban bersih: model kuat tidak dipanggil, tak ada biaya tambahan', async (t) => {
  const { calls, simulate } = await setup(t, { 'murah/model': GOOD, 'kuat/model': GOOD });
  const body = (await simulate({ escalationChain: 'kuat/model' })).json();
  assert.equal(body.reply, GOOD);
  assert.equal(body.escalation, null);
  assert.deepEqual(calls.map((c) => c.model), ['murah/model']);
});

test('tanpa rantai eskalasi: perilaku lama, model kuat tak pernah dipanggil', async (t) => {
  const { calls, simulate } = await setup(t, { 'murah/model': BAD, 'kuat/model': GOOD });
  const body = (await simulate({ escalationChain: '' })).json();
  assert.equal(body.escalation, null);
  assert.deepEqual(calls.map((c) => c.model), ['murah/model']);
  assert.notEqual(body.reply, BAD, 'penjaga tetap membuang klaim uang masuk');
});

test('model kuat gagal membalas: jatuh ke hasil model murah yang sudah dijaga', async (t) => {
  const { calls, simulate } = await setup(t, { 'murah/model': BAD });
  const res = await simulate({ escalationChain: 'kuat/model' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.escalation.chosen, 'first');
  assert.notEqual(body.reply, BAD);
  assert.deepEqual(calls.map((c) => c.model), ['murah/model', 'kuat/model']);
});

test('model murah yang sudah menjalankan alat pesanan tidak diulang oleh eskalasi', async (t) => {
  const { calls, simulate } = await setup(t, { 'murah/model': BAD, 'kuat/model': GOOD }, { toolCalls: [{ name: 'buat_proforma', args: {} }] });
  const body = (await simulate({ escalationChain: 'kuat/model' })).json();
  assert.equal(body.escalation, null);
  assert.deepEqual(calls.map((c) => c.model), ['murah/model']);
});

test('model murah tak membalas sama sekali: model kuat mengambil alih', async (t) => {
  const { simulate } = await setup(t, { 'kuat/model': GOOD });
  const body = (await simulate({ escalationChain: 'kuat/model' })).json();
  assert.equal(body.reply, GOOD);
  assert.equal(body.escalation.chosen, 'second');
  assert.deepEqual(body.escalation.why, ['no_reply']);
});

test('saklar company mati (aiEscalation=false): model kuat tak dipanggil walau jawaban bermasalah', async (t) => {
  const { calls, simulate } = await setup(t, { 'murah/model': BAD, 'kuat/model': GOOD }, { config: { aiEscalation: false } });
  const body = (await simulate({ escalationChain: 'kuat/model' })).json();
  assert.equal(body.escalation, null);
  assert.deepEqual(calls.map((c) => c.model), ['murah/model']);
});

test('saklar company hidup atau belum pernah diset: eskalasi jalan', async (t) => {
  for (const config of [{ aiEscalation: true }, {}]) {
    const { calls, simulate } = await setup(t, { 'murah/model': BAD, 'kuat/model': GOOD }, { config });
    const body = (await simulate({ escalationChain: 'kuat/model' })).json();
    assert.equal(body.escalation.chosen, 'second');
    assert.deepEqual(calls.map((c) => c.model), ['murah/model', 'kuat/model']);
  }
});
