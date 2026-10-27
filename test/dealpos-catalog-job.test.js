'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const CONN = { enabled: true, host: 'toko.dealpos.co.id', clientId: 'client-12345', clientSecret: 'secret-12345' };

// Respons bentuk asli ESBEJE (27 Okt): /Product memuat Variants[].UnitPrice, /Variant memuat UnitPrice + UnitCost.
const PRODUCTS = [
  { ID: 'p-promo', Name: 'RUCIKA BACKFLOW VALVE 3"', Code: 'RB3', Category: 'PIPA', Released: '2020-01-01T00:00:00', Variants: [{ ID: 'v-promo', Model: 'Default', Code: 'RB3', UnitPrice: 120000, Discount: 10 }] },
  { ID: 'p-biasa', Name: 'KAWAT AYAKAN', Code: 'KA1', Category: 'KAWAT', Released: '2020-01-01T00:00:00', Variants: [{ ID: 'v-biasa', Model: 'Default', Code: 'KA1', UnitPrice: 18400, Discount: 0 }] },
];

async function setup(t, { aiEnabled }) {
  const state = { posTagRibbon: false, productsPending: [], savedProductTags: [], applied: 0, pending: [], savedDetail: [], detailUrls: [], variantCalls: 0, detailCalls: [], replaced: 0, marked: 0, synced: null, details: null };
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
    async getDealposConnection() { return { ...CONN }; },
    async upsertDealposConnection() {},
    async upsertDealposCustomers() {},
    async recordDealposSync() {},
    async getCatalogSettings() { return { aiEnabled, bestSellerCount: 10, bestSellerDays: 30, newDays: 30 }; },
    async replaceDealposProducts() { state.replaced += 1; return 0; },
    async markDealposProductsSynced() { state.marked += 1; },
    async syncPosCatalog(companyId, source, items, extra) { state.synced = { items, extra }; return items.length; },
    async savePosCatalogDetails(companyId, source, details) { state.details = details; return details.size; },
    async recordCatalogPosError(companyId, message) { state.error = message; },
    async listDealposCompaniesPendingDetail() { return []; },
    async hasPosTagRibbons() { return state.posTagRibbon; },
    async listProductsNeedingPosTags() { return state.productsPending.splice(0, 20); },
    async savePosProductTags(companyId, productId, detail) { state.savedProductTags.push({ productId, ...detail }); },
    async applyPosTagRibbons() { state.applied += 1; return 0; },
    async createCatalogTag(companyId, data) { state.posTagRibbon = Boolean(data.posTag); return { id: 't1', ...data }; },
    async listCatalogItemsNeedingDetail() { return state.pending.splice(0, 20); },
    async saveCatalogItemDetail(companyId, itemId, detail) { state.savedDetail.push({ itemId, ...detail }); },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.includes('toko.dealpos.co.id')) return realFetch(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (u.includes('/Token/OAuth2')) return json({ access_token: 'tok' });
    if (u.includes('/Customer/WithTotalCount')) return json({ TotalCount: 0 });
    if (u.includes('/Customer')) return json([]);
    if (u.includes('/Variant/Detail')) {
      state.detailUrls.push(u);
      return json(u.includes('v-nouom') ? { UOMName: null, Brand: null } : { UOMName: ' mtr ', Brand: 'SBJ' });
    }
    if (u.includes('/Product/Detail') && u.includes('p-frap')) {
      state.productDetailUrls = [...(state.productDetailUrls || []), u];
      return json({ Tags: ['Consignment'], Brand: 'FRAP' });
    }
    if (u.includes('/Product/Detail')) { state.detailCalls.push(u); return json({ Brand: 'RUCIKA', Tags: ['Normal'] }); }
    if (u.includes('/Product?')) return json({ DataArray: PRODUCTS });
    if (u.includes('/Report/ProductSold')) return json([{ Code: 'KA1', Quantity: 50 }]);
    if (u.includes('/Variant')) { state.variantCalls += 1; return json({ Data: [], RecordsCount: 0 }); }
    return json([]);
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'dp-job', database });
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const call = (method, url, payload) => app.inject({ method, url, headers: { cookie }, payload });
  const until = async (check) => { for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 20)); };
  return { state, call, until };
}

test('sinkron katalog: merek dan tag ditarik hanya untuk item Promo dan Best Seller', async (t) => {
  const { state, call, until } = await setup(t, { aiEnabled: true });
  assert.equal((await call('POST', '/v1/catalog/sync')).statusCode, 202);
  await until(() => state.details);
  assert.ok(state.synced, 'katalog tersimpan');
  assert.equal(state.synced.items.find((i) => i.externalId === 'v-promo').price, 120000, 'UnitPrice dibaca sebagai harga jual');
  assert.deepEqual(state.detailCalls.map((u) => u.split('ID=')[1]).sort(), ['p-biasa', 'p-promo'], 'promo (diskon) dan best seller (terjual)');
  assert.deepEqual(state.details.get('v-promo'), { brand: 'RUCIKA', tags: ['Normal'] });
});

test('katalog dipakai AI: tarikan /Variant dilewati dan penjadwal ditandai selesai', async (t) => {
  const { state, call, until } = await setup(t, { aiEnabled: true });
  const res = await call('POST', '/v1/integrations/dealpos', { host: 'toko.dealpos.co.id', clientId: 'client-12345', clientSecret: 'secret-12345' });
  assert.equal(res.statusCode, 201);
  await until(() => state.marked > 0);
  assert.equal(state.marked, 1);
  assert.equal(state.variantCalls, 0, '/Variant tidak ditarik dua kali');
  assert.equal(state.replaced, 0);
  assert.ok(state.synced, 'katalog tetap ditarik');
});

test('katalog tidak dipakai AI: daftar harga /Variant tetap ditarik sebagai cadangan', async (t) => {
  const { state, call, until } = await setup(t, { aiEnabled: false });
  const res = await call('POST', '/v1/integrations/dealpos', { host: 'toko.dealpos.co.id', clientId: 'client-12345', clientSecret: 'secret-12345' });
  assert.equal(res.statusCode, 201);
  await until(() => state.replaced > 0 || state.error);
  assert.ok(state.variantCalls >= 1);
});

test('satuan dari UOM DealPOS ditarik per varian di latar; varian tanpa UOM tetap ditandai selesai', async (t) => {
  const { state, call, until } = await setup(t, { aiEnabled: true });
  state.pending = [{ id: 'row-1', externalId: 'v-biasa' }, { id: 'row-2', externalId: 'v-nouom' }];
  assert.equal((await call('POST', '/v1/catalog/sync')).statusCode, 202);
  await until(() => state.savedDetail.length >= 2);
  assert.deepEqual(state.savedDetail, [
    { itemId: 'row-1', unit: 'mtr', brand: 'SBJ' },
    { itemId: 'row-2', unit: null, brand: null },
  ]);
  assert.deepEqual(state.detailUrls.map((u) => u.split('ID=')[1]), ['v-biasa', 'v-nouom']);
});

test('ribbon tag DealPOS: dibuat dengan tag POS, tag produk ditarik di latar lalu ribbon dipasang', async (t) => {
  const { state, call, until } = await setup(t, { aiEnabled: true });
  state.productsPending = ['p-frap'];
  const res = await call('POST', '/v1/catalog/tags', { name: 'Konsinyasi', color: 'violet', posTag: 'Consignment' });
  assert.equal(res.statusCode, 201);
  await until(() => state.applied >= 3);
  assert.deepEqual(state.savedProductTags, [{ productId: 'p-frap', tags: ['Consignment'], brand: 'FRAP' }]);
  assert.ok(state.applied >= 3, 'ribbon dipasang saat dibuat, setelah batch, dan di akhir');
});

test('tanpa ribbon yang mengikuti tag POS, tidak ada permintaan /Product/Detail untuk tag', async (t) => {
  const { state, call, until } = await setup(t, { aiEnabled: true });
  state.productsPending = ['p-frap'];
  const res = await call('POST', '/v1/catalog/tags', { name: 'Biasa', color: 'slate' });
  assert.equal(res.statusCode, 201);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(state.savedProductTags, []);
  assert.equal(state.productDetailUrls, undefined);
  void until;
});
