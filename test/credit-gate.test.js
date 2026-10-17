'use strict';

/**
 * Gerbang credit di getCompanyAi: saldo habis menghentikan semua rute AI dengan
 * alasan credit (bukan alasan paket atau API key); company tanpa mode credit
 * tidak terpengaruh. Broadcast juga mengikuti fitur paket.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const COMPANY = 'company-credit';
const OWNER = {
  id: 'owner-1', userId: 'owner-1', companyId: COMPANY,
  email: 'owner@pelanggan.test', displayName: 'Owner', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};

function fakeDatabase(cfg) {
  return {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) {
      return email === OWNER.email && password === 'password-123' ? OWNER : null;
    },
    async getActiveSessionUser() { return OWNER; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getCompanyConfig() {
      return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone', aiMessageLimit: 0, aiMessageCount: 0, ...cfg };
    },
    async getPlaybookDoc() { return null; },
    async getPlaybookContext() { return ''; },
  };
}

async function masuk(app) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: OWNER.email, password: 'password-123' },
  });
  return login.headers['set-cookie'].split(';')[0];
}

async function appDengan(t, cfg) {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: fakeDatabase(cfg),
    llmEnabled: true, openrouterApiKey: 'kunci-uji', sessionSecret: 'credit-1',
  });
  t.after(() => app.close());
  return app;
}

test('credit habis: rute AI balas 503 dengan alasan credit', async (t) => {
  const app = await appDengan(t, { plan: 'starter', creditMode: true, creditTotal: 0 });
  const cookie = await masuk(app);
  const res = await app.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
    payload: { mode: 'ai', customerMessage: 'Halo', grade: false },
  });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().error, /Credit AI .* habis/);
});

test('credit masih ada atau bukan mode credit: tidak ditahan gerbang credit', async (t) => {
  for (const cfg of [{ plan: 'growth', creditMode: true, creditTotal: 5 }, { plan: 'company', creditMode: false, creditTotal: 0 }]) {
    const app = await appDengan(t, cfg);
    const cookie = await masuk(app);
    const res = await app.inject({
      method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
      payload: { mode: 'ai', customerMessage: 'Halo', grade: false },
    });
    assert.doesNotMatch(String(res.json().error || ''), /Credit AI/);
  }
});

test('Starter tidak punya broadcast; Growth punya', async (t) => {
  const starter = await appDengan(t, { plan: 'starter', creditMode: true, creditTotal: 10 });
  const res = await starter.inject({ method: 'GET', url: '/v1/broadcasts', headers: { cookie: await masuk(starter) } });
  assert.equal(res.statusCode, 403);
  assert.match(res.json().error, /Broadcast tidak termasuk paket/);

  const growth = await appDengan(t, { plan: 'growth', creditMode: true, creditTotal: 10 });
  const ok = await growth.inject({ method: 'GET', url: '/v1/broadcasts', headers: { cookie: await masuk(growth) } });
  assert.notEqual(ok.statusCode, 403);
});

test('panggilan AI selesai: credit dipotong dari biaya penyedia, kabar dikirim saat melewati ambang', async (t) => {
  const debits = [];
  const notified = [];
  const database = {
    ...fakeDatabase({ plan: 'growth', creditMode: true, creditTotal: 100 }),
    async recordAiUsage() {},
    async getCreditState() { return { creditMode: true, plan: 'growth', discountPct: 50 }; },
    async debitCredit(companyId, args) { debits.push({ companyId, ...args }); return { total: 0, crossed: 'empty' }; },
    async notifyCredit(companyId, body) { notified.push({ companyId, body }); return []; },
  };
  const original = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 } }),
  });
  t.after(() => { global.fetch = original; });
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database,
    llmEnabled: true, openrouterApiKey: 'kunci-uji', sessionSecret: 'credit-2',
  });
  t.after(() => app.close());
  const cookie = await masuk(app);
  await app.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
    payload: { mode: 'ai', customerMessage: 'Halo', grade: false },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(debits.length >= 1, 'ada pemotongan');
  // 0,002 USD x 16.500 x 3 x (1 - 50%) = 49,5 credit
  assert.equal(debits[0].amount, 49.5);
  assert.equal(debits[0].companyId, COMPANY);
  assert.equal(notified.length, debits.length, 'kabar habis dikirim ke supervisor');
  assert.match(notified[0].body, /Credit AI habis/);
});
