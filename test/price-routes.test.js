'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};

// Katalog ESBEJE yang besar: lebih dari 40 item, jadi hanya yang cocok dengan pesan customer masuk prompt.
const filler = Array.from({ length: 60 }, (_, i) => ({
  id: `f${i}`, name: `PAKU BETON ${i + 1} CM`, code: `PK${i}`, price: 20000 + i, unit: 'kg', source: 'dealpos', tags: [],
}));
const ITEMS = [
  { id: 'a', name: 'MU 100 BASE PLESTER PREMIUM 40KG', code: '1000003303', price: 116400, unit: 'sak', source: 'dealpos', tags: [] },
  { id: 'b', name: 'MU 301 PLASTERPLUS 40KG', code: '1000011476', price: 104000, unit: 'sak', source: 'dealpos', tags: [] },
  ...filler,
];
const PLAYBOOK = '## PLAYBOOK\nPlester: MU 100 Base Plester, MU 301 Plasterplus. Pasang bata ringan: MU 380 Thinbed.';
const CUSTOMER = 'Untuk dinding yang retak dan perlu diperbaiki, ada apa?';

async function setup(t, script) {
  const seen = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      seen.push({ message, prompt: options.systemPrompt || '', tools: (options.tools || []).map((x) => x.name) });
      return { text: await script(message, options), model: 'tiruan', usage: {} };
    },
  };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(userId) { return userId === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
    async getPlaybookContext() { return PLAYBOOK; },
    async listCatalogForAi() { return { enabled: true, items: ITEMS, tags: [], syncedAt: null }; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'price-routes', database, llmService: llm });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const simulate = (customerMessage) => app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage, grade: false } });
  return { seen, simulate };
}

test('simulate (kasus ESBEJE 28 Okt): barang tidak ada di prompt, alat cek_harga tersedia, harga karangan tidak lolos', async (t) => {
  // Model membandel: mengarang harga dari ingatan, tanpa memanggil alat.
  const karangan = 'Untuk dinding retak ada MU 100 Base Plester seharga Rp 75.000 per sak, atau MU 301 Plasterplus Rp 90.000 per sak. Butuh berapa sak, kak?';
  const { seen, simulate } = await setup(t, async () => karangan);
  const res = await simulate(CUSTOMER);
  const first = seen[0];
  assert.ok(first.tools.includes('cek_harga'), 'alat cek harga tersedia');
  assert.match(first.prompt, /CEK HARGA \(alat cek_harga\)/);
  assert.ok(!/MU 100 BASE PLESTER PREMIUM 40KG: Rp|MU 100 BASE PLESTER PREMIUM 40KG \[/.test(first.prompt), 'barang ini memang tidak ikut ke prompt');
  // Harga karangan tidak sampai ke customer, apa pun hasil akhirnya (dibuang seluruhnya = jatuh ke manusia).
  const body = res.json();
  assert.ok(!/75\.000|90\.000/.test(String(body.reply || '')), `bocor: ${body.reply}`);
});

test('simulate: model memanggil cek_harga dengan nama dari playbook dan menyebut harga asli', async (t) => {
  const { seen, simulate } = await setup(t, async (message, options) => {
    const tool = options.tools.find((x) => x.name === 'cek_harga');
    const base = await tool.run({ barang: 'MU 100 Base Plester' });
    const plus = await tool.run({ barang: 'MU 301 Plasterplus' });
    return `Untuk dinding retak ada ${base.hasil[0].nama} ${base.hasil[0].harga}, atau ${plus.hasil[0].nama} ${plus.hasil[0].harga}. Butuh berapa sak, kak?`;
  });
  const res = await simulate(CUSTOMER);
  assert.equal(res.statusCode, 200);
  const reply = res.json().reply;
  assert.match(reply, /Rp 116\.400 per sak/);
  assert.match(reply, /Rp 104\.000 per sak/);
  assert.ok(seen.length >= 1);
});

test('simulate: harga yang disebut customer sendiri dan kelipatan harga asli tidak dianggap karangan', async (t) => {
  const { simulate } = await setup(t, async (message, options) => {
    const tool = options.tools.find((x) => x.name === 'cek_harga');
    await tool.run({ barang: 'MU 100 Base Plester' });
    return 'MU 100 Base Plester Rp 116.400 per sak, jadi 10 sak Rp 1.164.000. Masih di bawah budget Rp 2 juta kakak ya.';
  });
  const res = await simulate('budget saya Rp 2 juta, butuh 10 sak MU 100');
  assert.equal(res.statusCode, 200);
  assert.match(res.json().reply, /Rp 1\.164\.000/);
});
