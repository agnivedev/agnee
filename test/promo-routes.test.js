'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const AGENT = { ...OWNER, id: 'agent-a', userId: 'agent-a', email: 'agent@toko.test', role: 'agent' };
const OTHER = { ...OWNER, id: 'owner-b', userId: 'owner-b', companyId: 'company-b', email: 'b@toko.test' };

/** Tiruan tabel promo_rules secukupnya. */
function fakeDatabase(store) {
  const own = (companyId) => store.rows.filter((r) => r.companyId === companyId);
  const strip = ({ companyId: _c, ...row }) => row;
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return [OWNER, AGENT, OTHER].find((u) => u.email === email && password === 'password-123') || null; },
    async getActiveSessionUser(userId) { return [OWNER, AGENT, OTHER].find((u) => u.id === userId) || null; },
    async setPresence() {},
    async listPromoRules(companyId) { return own(companyId).map(strip); },
    async getPromoRule(companyId, id) { const r = own(companyId).find((x) => x.id === id); return r ? strip(r) : null; },
    async countPromoRules(companyId) { return own(companyId).length; },
    async savePromoRule(companyId, id, rule) {
      if (id) {
        const row = own(companyId).find((r) => r.id === id);
        Object.assign(row, rule);
        return strip(row);
      }
      const row = { id: String(++store.seq), companyId, ...rule };
      store.rows.push(row);
      return strip(row);
    },
    async setPromoRuleEnabled(companyId, id, enabled) {
      const row = own(companyId).find((r) => r.id === id);
      if (!row) return null;
      row.enabled = enabled;
      return strip(row);
    },
    async deletePromoRule(companyId, id) {
      const before = store.rows.length;
      store.rows = store.rows.filter((r) => !(r.companyId === companyId && r.id === id));
      return store.rows.length < before;
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

async function setup(t) {
  const store = { rows: [], seq: 0 };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'promo-routes', database: fakeDatabase(store) });
  t.after(() => app.close());
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  return { store, call, owner: await login(OWNER), agent: await login(AGENT), other: await login(OTHER) };
}

const PROMO = {
  name: 'Free ongkir Tangerang',
  areas: [{ province: 'Banten', city: 'Tangerang Selatan', district: 'Ciputat' }, { province: 'Banten', city: 'Tangerang', district: 'Alam Sutera' }],
  conditions: { minQty: 10 },
};

test('tambah promo: supervisor saja, isian divalidasi, tersimpan dalam bentuk bersih', async (t) => {
  const { call, owner, agent, store } = await setup(t);
  assert.equal((await call(agent, 'POST', '/v1/promo-rules', PROMO)).statusCode, 403);
  assert.match((await call(owner, 'POST', '/v1/promo-rules', { ...PROMO, maxSubsidy: 'abc' })).json().error, /subsidi/i);
  assert.match((await call(owner, 'POST', '/v1/promo-rules', { ...PROMO, name: '   ' })).json().error, /nama/i);

  const res = await call(owner, 'POST', '/v1/promo-rules', PROMO);
  assert.equal(res.statusCode, 201);
  const { rule } = res.json();
  assert.equal(rule.kind, 'free_shipping');
  assert.equal(rule.enabled, true);
  assert.equal(rule.areas.length, 2);
  assert.deepEqual(rule.conditions, { minQty: 10 });
  assert.equal(store.rows.length, 1);
});

test('promo: agen boleh membaca, company lain tidak melihat atau mengubah', async (t) => {
  const { call, owner, agent, other } = await setup(t);
  const id = (await call(owner, 'POST', '/v1/promo-rules', PROMO)).json().rule.id;
  assert.equal((await call(agent, 'GET', '/v1/promo-rules')).json().rules.length, 1);
  assert.equal((await call(other, 'GET', '/v1/promo-rules')).json().rules.length, 0);
  assert.equal((await call(other, 'PUT', `/v1/promo-rules/${id}`, PROMO)).statusCode, 404);
  assert.equal((await call(other, 'PATCH', `/v1/promo-rules/${id}`, { enabled: false })).statusCode, 404);
  assert.equal((await call(other, 'DELETE', `/v1/promo-rules/${id}`)).statusCode, 404);
  assert.equal((await call(agent, 'DELETE', `/v1/promo-rules/${id}`)).statusCode, 403);
});

test('ubah, matikan, dan hapus promo', async (t) => {
  const { call, owner, store } = await setup(t);
  const id = (await call(owner, 'POST', '/v1/promo-rules', PROMO)).json().rule.id;
  const renamed = (await call(owner, 'PUT', `/v1/promo-rules/${id}`, { ...PROMO, name: 'Baru', maxSubsidy: 50000 })).json().rule;
  assert.equal(renamed.name, 'Baru');
  assert.equal(renamed.maxSubsidy, 50000);
  assert.equal((await call(owner, 'PATCH', `/v1/promo-rules/${id}`, { enabled: false })).json().rule.enabled, false);
  assert.equal((await call(owner, 'DELETE', `/v1/promo-rules/${id}`)).statusCode, 200);
  assert.equal(store.rows.length, 0);
});

test('uji alamat: memakai penilaian yang sama dengan alat AI', async (t) => {
  const { call, owner, agent } = await setup(t);
  assert.match((await call(owner, 'POST', '/v1/promo-rules/check', { destination: '-6.30,106.69' })).json().error, /promo aktif/);
  await call(owner, 'POST', '/v1/promo-rules', PROMO);

  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() { return { display_name: 'Ciputat, Kota Tangerang Selatan, Banten, Indonesia', address: { city_district: 'Ciputat' } }; },
  });
  t.after(() => { globalThis.fetch = original; });

  assert.equal((await call(agent, 'POST', '/v1/promo-rules/check', { destination: '-6.30,106.69' })).statusCode, 403);
  const needQty = (await call(owner, 'POST', '/v1/promo-rules/check', { destination: '-6.30,106.69' })).json();
  assert.equal(needQty.summary.status, 'syarat_belum_diketahui');
  const ok = (await call(owner, 'POST', '/v1/promo-rules/check', { destination: '-6.30,106.69', qty: 12 })).json();
  assert.equal(ok.summary.status, 'berlaku');
  assert.ok(ok.destination.segments.includes('ciputat'));
});
