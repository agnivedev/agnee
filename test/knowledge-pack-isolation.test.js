'use strict';

/**
 * Pack knowledge (FAQ, harga, funnel milik satu pelanggan) tidak boleh
 * menyeberang ke company lain.
 *
 * Dulu playground di Admin menerima pack mana pun lewat `clientId`, dan daftar
 * pack di /v1/admin/config memuat semuanya. Playground sudah dihapus — Coach
 * simulasi yang meniru jalur WhatsApp sungguhan menggantikannya — jadi yang
 * diuji sekarang adalah satu-satunya jalan pack masuk ke prompt:
 * buildReplyContext, lewat Coach simulasi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const COMPANY_A = 'company-a';
const OWNER_A = {
  id: 'owner-a', userId: 'owner-a', companyId: COMPANY_A,
  email: 'owner-a@pelanggan.test', displayName: 'Owner A', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};

function fakeDatabase(getCompanyConfig) {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return email === OWNER_A.email && password === 'password-123' ? OWNER_A : null; },
    async getActiveSessionUser() { return OWNER_A; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    getCompanyConfig,
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

async function promptFor(t, getCompanyConfig, extra = {}) {
  const prompts = [];
  const llmService = {
    enabled: true, model: 'test/m',
    async generateReply(message, context) { prompts.push(context.systemPrompt || ''); return { text: 'Halo kak', model: 'test/m', usage: {} }; },
  };
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'pack-iso',
    database: fakeDatabase(getCompanyConfig), llmService, ...extra,
  });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER_A.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const res = await app.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
    payload: { mode: 'ai', customerMessage: 'Berapa harga paketnya?', grade: false },
  });
  assert.equal(res.statusCode, 200, res.body);
  return prompts[0];
}

test('prompt memakai pack milik company itu sendiri, bukan pack lain', async (t) => {
  const prompt = await promptFor(t, async () => ({ knowledgeClient: 'tradersmastermind', planStatus: 'active', status: 'active' }));
  assert.match(prompt, /Trader's Mastermind/);
  assert.doesNotMatch(prompt, /bZone Alpha/);
});

test('pembacaan company gagal: pack jatuh ke Agnee netral, bukan KNOWLEDGE_CLIENT', async (t) => {
  // Dulu .catch(() => null) lalu config.knowledgeClient (bawaan 'bzone'): satu
  // error DB cukup untuk menyajikan FAQ dan harga customer lain.
  let calls = 0;
  const prompt = await promptFor(t, async () => {
    calls += 1;
    // Gerbang AI membaca config lebih dulu; yang gagal adalah pembacaan pack.
    if (calls > 1) throw new Error('koneksi putus');
    return { planStatus: 'active', status: 'active' };
  }, { knowledgeClient: 'bzone' });
  assert.doesNotMatch(prompt, /bZone Alpha/);
});
