'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};

test('daftar katalog meneruskan urut dan saringan, menolak kunci urut asing; kategori tersedia', async (t) => {
  const seen = [];
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(userId) { return userId === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async getCatalogSettings() { return { aiEnabled: true }; },
    async listCatalogItems(companyId, options) { seen.push({ companyId, ...options }); return { items: [], total: 0 }; },
    async listCatalogCategories() { return [{ category: 'SEMEN', count: 3 }]; },
    async countCatalogItemsNeedingDetail() { return 12; },
    async listCatalogTags() { return []; },
    async countCatalogItems() { return { total: 0, manual: 0, dealpos: 0 }; },
    async getDealposConnection() { return null; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'cat-list', database });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const headers = { cookie: login.headers['set-cookie'].split(';')[0] };
  const get = (url) => app.inject({ method: 'GET', url, headers });

  const ok = await get('/v1/catalog/items?sort=sold&dir=desc&kind=service&category=SEMEN&status=visible&priced=no&q=semen');
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(seen[0], { companyId: 'company-a', q: 'semen', tagId: null, source: null, kind: 'service', category: 'SEMEN', status: 'visible', priced: 'no', sort: 'sold', dir: 'desc', limit: 50, offset: 0 });
  assert.equal((await get('/v1/catalog/items?sort=password')).statusCode, 400);
  assert.equal((await get('/v1/catalog/items?kind=hantu')).statusCode, 400);
  assert.deepEqual((await get('/v1/catalog/categories')).json().categories, [{ category: 'SEMEN', count: 3 }]);
  assert.equal((await get('/v1/catalog')).json().detailPending, 12);
});
