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

/** Tiruan tabel company_locations secukupnya: satu titik jemput per company. */
function fakeDatabase(store) {
  const own = (companyId) => store.rows.filter((r) => r.companyId === companyId);
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return [OWNER, AGENT, OTHER].find((u) => u.email === email && password === 'password-123') || null; },
    async getActiveSessionUser(userId) { return [OWNER, AGENT, OTHER].find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getLalamoveConnection(companyId) { return store.lalamove[companyId] || null; },
    async listCompanyLocations(companyId) { return own(companyId).map(({ companyId: _c, ...row }) => row); },
    async getCompanyLocation(companyId, id) { return own(companyId).find((r) => r.id === id) || null; },
    async countCompanyLocations(companyId) { return own(companyId).length; },
    async saveCompanyLocation(companyId, id, location) {
      if (location.isPickup) for (const row of own(companyId)) if (row.id !== id) row.isPickup = false;
      if (id) {
        const row = own(companyId).find((r) => r.id === id);
        Object.assign(row, location);
        return row;
      }
      const row = { id: String(++store.seq), companyId, ...location };
      store.rows.push(row);
      return row;
    },
    async deleteCompanyLocation(companyId, id) {
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
  const store = { rows: [], seq: 0, lalamove: {} };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'loc-routes', database: fakeDatabase(store) });
  t.after(() => app.close());
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  return { store, call, owner: await login(OWNER), agent: await login(AGENT), other: await login(OTHER) };
}

const TOKO = { name: 'Toko BSD', kind: 'store', place: '-6.301234,106.652345', contactName: 'Rina', contactPhone: '0812-3456-7890', openingHours: 'Sen–Sab 08.00–17.00' };

test('tambah lokasi: supervisor saja, titik peta wajib terbaca, lokasi pertama jadi titik jemput', async (t) => {
  const { call, owner, agent, store } = await setup(t);
  assert.equal((await call(agent, 'POST', '/v1/locations', TOKO)).statusCode, 403);
  assert.match((await call(owner, 'POST', '/v1/locations', { ...TOKO, place: 'jalan entah' })).json().error, /Titik peta/);
  assert.match((await call(owner, 'POST', '/v1/locations', { ...TOKO, contactPhone: '123' })).json().error, /Nomor HP/);

  const res = await call(owner, 'POST', '/v1/locations', TOKO);
  assert.equal(res.statusCode, 201);
  const { location } = res.json();
  assert.equal(location.lat, -6.301234);
  assert.equal(location.contactPhone, '6281234567890');
  assert.equal(location.mapsUrl, 'https://www.google.com/maps?q=-6.301234,106.652345');
  assert.equal(location.address, '-6.301234,106.652345');
  assert.equal(location.isPickup, true);
  assert.equal(location.openToCustomers, true);

  // Gudang kedua: bukan titik jemput, dan bawaannya tidak menerima customer.
  const gudang = (await call(owner, 'POST', '/v1/locations', { name: 'Gudang Serpong', kind: 'warehouse', place: '-6.32,106.66', address: 'Jl. Raya Serpong 1' })).json().location;
  assert.equal(gudang.isPickup, false);
  assert.equal(gudang.openToCustomers, false);
  assert.equal(gudang.address, 'Jl. Raya Serpong 1');
  assert.equal(store.rows.length, 2);
});

test('daftar lokasi: agen boleh membaca, company lain tidak melihat', async (t) => {
  const { call, owner, agent, other } = await setup(t);
  await call(owner, 'POST', '/v1/locations', TOKO);
  assert.equal((await call(agent, 'GET', '/v1/locations')).json().locations.length, 1);
  assert.equal((await call(other, 'GET', '/v1/locations')).json().locations.length, 0);
  const id = (await call(owner, 'GET', '/v1/locations')).json().locations[0].id;
  assert.equal((await call(other, 'PUT', `/v1/locations/${id}`, { name: 'Curian', kind: 'store' })).statusCode, 404);
  assert.equal((await call(other, 'DELETE', `/v1/locations/${id}`)).statusCode, 404);
});

test('ubah lokasi: titik peta kosong = tetap; pindah titik jemput melepas yang lama', async (t) => {
  const { call, owner, store } = await setup(t);
  const toko = (await call(owner, 'POST', '/v1/locations', TOKO)).json().location;
  const gudang = (await call(owner, 'POST', '/v1/locations', { name: 'Gudang', kind: 'warehouse', place: '-6.32,106.66' })).json().location;

  const renamed = (await call(owner, 'PUT', `/v1/locations/${toko.id}`, { name: 'Toko BSD City', kind: 'store' })).json().location;
  assert.equal(renamed.name, 'Toko BSD City');
  assert.equal(renamed.lat, -6.301234);
  assert.equal(renamed.isPickup, true);
  // Field yang tidak dikirim tetap; string kosong mengosongkan.
  assert.equal(renamed.contactPhone, '6281234567890');
  assert.equal(renamed.openingHours, 'Sen–Sab 08.00–17.00');
  const cleared = (await call(owner, 'PUT', `/v1/locations/${toko.id}`, { name: 'Toko BSD City', kind: 'store', openingHours: '' })).json().location;
  assert.equal(cleared.openingHours, null);
  assert.equal(cleared.contactName, 'Rina');

  await call(owner, 'PUT', `/v1/locations/${gudang.id}`, { name: 'Gudang', kind: 'warehouse', isPickup: true });
  assert.deepEqual(store.rows.map((r) => r.isPickup), [false, true]);
});

test('titik jemput yang dipakai ongkir otomatis tidak bisa dilepas atau dihapus', async (t) => {
  const { call, owner, store } = await setup(t);
  const toko = (await call(owner, 'POST', '/v1/locations', TOKO)).json().location;
  store.lalamove['company-a'] = { enabled: true, aiQuotesEnabled: true, pickupLocationId: toko.id };

  assert.equal((await call(owner, 'DELETE', `/v1/locations/${toko.id}`)).statusCode, 409);
  assert.equal((await call(owner, 'PUT', `/v1/locations/${toko.id}`, { name: 'Toko', kind: 'store', isPickup: false })).statusCode, 409);

  store.lalamove['company-a'].aiQuotesEnabled = false;
  assert.equal((await call(owner, 'DELETE', `/v1/locations/${toko.id}`)).statusCode, 200);
  assert.equal(store.rows.length, 0);
});

test('outlet DealPOS: daftar hanya supervisor, lokasi bisa dihubungkan, id asing ditolak, kosong melepas', async (t) => {
  const store = { rows: [], seq: 0, lalamove: {} };
  const database = fakeDatabase(store);
  database.getDealposConnection = async () => ({ enabled: true, host: 'toko.dealpos.co.id', clientId: 'x', clientSecret: 'y' });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/Token/OAuth2')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    if (String(url).includes('/Outlet?Suspended=false')) {
      return new Response(JSON.stringify([
        { ID: 'o-1', Name: 'BSD STORE', Code: 'SBJ02', Suspended: false },
        { ID: 'o-2', Name: 'TUTUP', Code: 'X', Suspended: true },
      ]), { status: 200 });
    }
    return realFetch(url);
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'loc-outlet', database });
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); });
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const owner = await login(OWNER);
  const agent = await login(AGENT);
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });

  assert.equal((await call(agent, 'GET', '/v1/integrations/dealpos/outlets')).statusCode, 403);
  const list = (await call(owner, 'GET', '/v1/integrations/dealpos/outlets')).json();
  assert.deepEqual(list.outlets, [{ id: 'o-1', name: 'BSD STORE', code: 'SBJ02' }]);

  assert.match((await call(owner, 'POST', '/v1/locations', { ...TOKO, dealposOutletId: 'o-404' })).json().error, /Outlet DealPOS tidak ditemukan/);
  const created = await call(owner, 'POST', '/v1/locations', { ...TOKO, dealposOutletId: 'o-1' });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().location.dealposOutletName, 'BSD STORE');
  const id = created.json().location.id;
  // Mengubah tanpa menyebut outlet tidak melepasnya; id kosong melepas.
  assert.equal((await call(owner, 'PUT', `/v1/locations/${id}`, { name: 'Toko BSD', kind: 'store', notes: 'x' })).json().location.dealposOutletId, 'o-1');
  assert.equal((await call(owner, 'PUT', `/v1/locations/${id}`, { name: 'Toko BSD', kind: 'store', dealposOutletId: '' })).json().location.dealposOutletId, null);
  assert.equal(calls.filter((u) => u.includes('/Token/OAuth2')).length, 1, 'daftar outlet dipakai ulang dari cache');
});
