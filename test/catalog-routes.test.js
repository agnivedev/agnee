'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const AGENT = { ...OWNER, id: 'agent-a', userId: 'agent-a', email: 'agent@toko.test', role: 'agent' };

const POS_ITEM = {
  id: '11111111-1111-4111-8111-111111111111', source: 'dealpos', externalId: 'v1', kind: 'product',
  name: 'Semen Jakarta 40 kg', code: 'SJ40', price: 62000, discountPct: 0, description: '', tags: [],
};

function fakeDatabase(state) {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return [OWNER, AGENT].find((u) => u.email === email && password === 'password-123') || null; },
    async getActiveSessionUser(userId) { return [OWNER, AGENT].find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
    async getCatalogSettings() { return { aiEnabled: true, bestSellerCount: 10, bestSellerDays: 30, newDays: 30 }; },
    async listCatalogTags() { return []; },
    async countCatalogItems() { return { total: state.items.size, manual: 0, dealpos: 1 }; },
    async getDealposConnection() { return state.dealpos; },
    async getCatalogItem(id) { return state.items.get(id) || null; },
    async createCatalogItem(companyId, data) {
      const item = { id: '22222222-2222-4222-8222-222222222222', source: 'manual', tags: [], ...data };
      state.items.set(item.id, item);
      return item;
    },
    async updateCatalogItem(id, companyId, patch) {
      const item = { ...state.items.get(id), ...patch };
      state.items.set(id, item);
      return item;
    },
    async deleteCatalogItem(id) { return state.items.delete(id); },
    async listCatalogForAi() { return state.ai; },
    async listDealposProducts() {
      return { products: [{ variantId: 'v1', name: 'Semen Jakarta 40 kg', unitPrice: 62000 }], syncedAt: null };
    },
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

async function setup(t, { dealpos = null, ai = { enabled: false, items: [], tags: [] } } = {}) {
  const state = { items: new Map([[POS_ITEM.id, { ...POS_ITEM }]]), dealpos, ai };
  const prompts = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      prompts.push(options.systemPrompt || '');
      return { text: 'Baik kak.', model: 'tiruan', usage: {} };
    },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'catalog-routes', database: fakeDatabase(state), llmService: llm });
  t.after(() => app.close());
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  return { state, prompts, call, owner: await login(OWNER), agent: await login(AGENT) };
}

test('katalog: semua anggota boleh melihat, hanya supervisor yang mengubah', async (t) => {
  const { call, owner, agent } = await setup(t);
  const view = await call(agent, 'GET', '/v1/catalog');
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().canEdit, false);
  assert.equal((await call(owner, 'GET', '/v1/catalog')).json().canEdit, true);
  assert.equal((await call(agent, 'GET', '/v1/catalog/items')).statusCode, 200);
  assert.equal((await call(agent, 'POST', '/v1/catalog/items', { name: 'Cat' })).statusCode, 403);
  assert.equal((await call(agent, 'PATCH', `/v1/catalog/items/${POS_ITEM.id}`, { description: 'x' })).statusCode, 403);
  assert.equal((await call(agent, 'POST', '/v1/catalog/tags', { name: 'Hot' })).statusCode, 403);
  assert.equal((await call(agent, 'PUT', '/v1/catalog/settings', { aiEnabled: false })).statusCode, 403);
});

test('item manual: jasa tanpa harga boleh, link gambar non-http ditolak', async (t) => {
  const { call, owner } = await setup(t);
  const bad = await call(owner, 'POST', '/v1/catalog/items', { name: 'Cat', imageUrl: 'javascript:alert(1)' });
  assert.equal(bad.statusCode, 400);
  const ok = await call(owner, 'POST', '/v1/catalog/items', { name: 'Jasa Pasang', kind: 'service', price: null, priceNote: 'per m2' });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().item.price, null);
  assert.equal((await call(owner, 'POST', '/v1/catalog/items', { name: 'X', price: -5 })).statusCode, 400);
});

test('item dari DealPOS: harga/nama dikunci, deskripsi boleh, tidak bisa dihapus', async (t) => {
  const { call, owner, state } = await setup(t);
  const locked = await call(owner, 'PATCH', `/v1/catalog/items/${POS_ITEM.id}`, { price: 1 });
  assert.equal(locked.statusCode, 400);
  assert.match(locked.json().error, /DealPOS/);
  const desc = await call(owner, 'PATCH', `/v1/catalog/items/${POS_ITEM.id}`, { description: 'Untuk plester', active: false });
  assert.equal(desc.statusCode, 200);
  assert.equal(state.items.get(POS_ITEM.id).description, 'Untuk plester');
  assert.equal((await call(owner, 'DELETE', `/v1/catalog/items/${POS_ITEM.id}`)).statusCode, 400);
  assert.equal((await call(owner, 'POST', '/v1/catalog/sync')).statusCode, 409);
});

test('AI membaca katalog; daftar harga DealPOS lama tidak ikut bila katalog sudah memuat item POS', async (t) => {
  const tags = [{ id: 't-bs', name: 'Best Seller', autoRule: 'best_seller', highlight: true, aiNote: '', active: true }];
  const withPos = await setup(t, {
    dealpos: { enabled: true, host: 'toko.dealpos.co.id' },
    ai: { enabled: true, tags, items: [{ ...POS_ITEM, tags: [{ id: 't-bs', name: 'Best Seller' }] }] },
  });
  await withPos.call(withPos.owner, 'POST', '/v1/coach/simulate', { mode: 'ai', customerMessage: 'semen jakarta berapa?', grade: false });
  const prompt = withPos.prompts.find((p) => p.includes('KATALOG'));
  assert.ok(prompt, 'prompt memuat katalog');
  assert.match(prompt, /Semen Jakarta 40 kg \[SJ40\]: Rp 62\.000 · ribbon: Best Seller/);
  assert.doesNotMatch(prompt, /DAFTAR HARGA DEALPOS/);

  const off = await setup(t, { dealpos: { enabled: true, host: 'toko.dealpos.co.id' } });
  await off.call(off.owner, 'POST', '/v1/coach/simulate', { mode: 'ai', customerMessage: 'semen jakarta berapa?', grade: false });
  assert.ok(off.prompts.some((p) => p.includes('DAFTAR HARGA DEALPOS')), 'tanpa katalog, harga DealPOS lama tetap dipakai');
  assert.ok(!off.prompts.some((p) => p.includes('KATALOG PRODUK')));
});

test('kategorikan otomatis: hanya supervisor, mengembalikan jumlah per aturan', async (t) => {
  const { call, owner, agent } = await setup(t);
  assert.equal((await call(agent, 'POST', '/v1/catalog/auto-tags')).statusCode, 403);
  const res = await call(owner, 'POST', '/v1/catalog/auto-tags');
  assert.equal(res.statusCode, 200);
  assert.ok('counts' in res.json());
});
