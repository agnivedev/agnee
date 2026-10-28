'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const AGENT = { ...OWNER, id: 'agent-a', userId: 'agent-a', email: 'agent@toko.test', role: 'agent' };

function fakeDatabase(conn) {
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
    async getLalamoveConnection(companyId) { return companyId === 'company-a' && conn.value ? { ...conn.value } : null; },
    async saveLalamoveAiSettings(companyId, settings) {
      // Seperti COALESCE di SQL: nilai yang tidak dikirim tidak mengubah apa pun.
      for (const [key, value] of Object.entries(settings)) if (value !== undefined) conn.value[key] = value;
      return true;
    },
    async setPickupLocation(companyId, id) {
      const location = (conn.locations || []).find((l) => l.id === id);
      if (companyId !== 'company-a' || !location) return false;
      Object.assign(conn.value, { pickupLocationId: id, pickupLat: location.lat, pickupLng: location.lng, pickupAddress: location.address });
      return true;
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

async function setup(t, connValue, locations = []) {
  const conn = { value: connValue, locations };
  const seen = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      const tool = (options.tools || []).find((x) => x.name === 'cek_ongkir');
      seen.push({ purpose: options.purpose, prompt: options.systemPrompt || '', tools: (options.tools || []).map((x) => x.name) });
      if (tool && options.purpose === 'simulate') {
        const out = await tool.run({ tujuan: '-6.301234,106.652345', kendaraan: 'VAN' });
        return { text: `Estimasi ongkir via Lalamove ${out.ongkir} kak.`, model: 'tiruan', usage: {} };
      }
      return { text: 'Baik kak.', model: 'tiruan', usage: {} };
    },
  };
  const realFetch = globalThis.fetch;
  const lalamoveCalls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('lalamove.com/v3/quotations')) {
      lalamoveCalls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ data: { quotationId: 'q1', priceBreakdown: { total: '85000', currency: 'IDR' }, distance: { value: '12000' } } }), { status: 201 });
    }
    return realFetch(url, init);
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'dq-routes', database: fakeDatabase(conn), llmService: llm });
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); });
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  return { conn, seen, lalamoveCalls, call, owner: await login(OWNER), agent: await login(AGENT) };
}

const BASE = {
  environment: 'production', market: 'ID', apiKey: 'pk_prod_x', apiSecret: 'sk_prod_x', enabled: true,
  cities: [{ locode: 'ID JKT', name: 'Jakarta', services: [{ key: 'MOTORCYCLE', description: 'Motor' }, { key: 'VAN', description: 'Van' }] }],
  pickupLat: null, pickupLng: null, pickupAddress: null, defaultService: null, aiQuotesEnabled: false,
};

test('pengaturan ongkir otomatis: supervisor saja, wajib titik jemput dari Lokasi, kendaraan harus tersedia', async (t) => {
  const { call, owner, agent, conn } = await setup(t, { ...BASE }, [{ id: '7', lat: -6.2, lng: 106.7, address: 'Toko BSD' }]);
  assert.equal((await call(agent, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true })).statusCode, 403);
  assert.match((await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true })).json().error, /titik jemput.*Lokasi/);
  // Teks bebas tidak lagi diterima: titik jemput dipilih dari daftar lokasi.
  assert.match((await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true, pickup: '-6.2,106.7' })).json().error, /titik jemput/);
  assert.equal((await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true, pickupLocationId: '99' })).statusCode, 404);
  assert.match((await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true, pickupLocationId: '7', defaultService: 'TRUCK999' })).json().error, /Kendaraan/);

  const ok = await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true, pickupLocationId: '7', defaultService: 'VAN' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().aiQuotesEnabled, true);
  assert.equal(ok.json().pickupSet, true);
  assert.equal(ok.json().pickupLocationId, '7');
  assert.equal(conn.value.pickupLat, -6.2);
  assert.equal(conn.value.defaultService, 'VAN');
  // Mematikan tanpa mengirim lokasi lagi tidak melepas titik jemput.
  await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: false });
  assert.equal(conn.value.pickupLat, -6.2);

  // Kendaraan ditentukan Management: hanya nilai yang dikenal; tidak dikirim = tidak berubah.
  assert.equal((await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true, vehicleMode: 'robot' })).statusCode, 400);
  assert.equal((await call(agent, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true, vehicleMode: 'management' })).statusCode, 403);
  const managed = await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true, vehicleMode: 'management' });
  assert.equal(managed.statusCode, 200);
  assert.equal(conn.value.vehicleMode, 'management');
  await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true });
  assert.equal(conn.value.vehicleMode, 'management', 'tidak dikirim = tidak berubah');
  await call(owner, 'PUT', '/v1/integrations/lalamove/ai', { aiQuotesEnabled: true, vehicleMode: 'ai' });
  assert.equal(conn.value.vehicleMode, 'ai');
});

test('simulator: alat cek_ongkir hidup dan memanggil Lalamove dari toko ke pin customer', async (t) => {
  const { call, owner, seen, lalamoveCalls } = await setup(t, { ...BASE, pickupLat: -6.2, pickupLng: 106.7, pickupAddress: 'Toko', defaultService: 'VAN', aiQuotesEnabled: true });
  const res = await call(owner, 'POST', '/v1/coach/simulate', { mode: 'ai', customerMessage: 'ongkir ke rumah saya berapa?', grade: false });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().reply, /Rp 85\.000/);
  const sim = seen.find((s) => s.purpose === 'simulate');
  assert.ok(sim.tools.includes('cek_ongkir'));
  assert.match(sim.prompt, /ONGKIR LALAMOVE/);
  assert.equal(lalamoveCalls.length, 1);
  assert.equal(lalamoveCalls[0].body.data.serviceType, 'VAN');
  assert.deepEqual(lalamoveCalls[0].body.data.stops[0].coordinates, { lat: '-6.2', lng: '106.7' });
});

test('saklar mati: alat dan panduannya tidak ada di prompt', async (t) => {
  const { call, owner, seen } = await setup(t, { ...BASE, pickupLat: -6.2, pickupLng: 106.7, aiQuotesEnabled: false });
  await call(owner, 'POST', '/v1/coach/simulate', { mode: 'ai', customerMessage: 'ongkir berapa?', grade: false });
  const sim = seen.find((s) => s.purpose === 'simulate');
  assert.ok(!sim.tools.includes('cek_ongkir'));
  assert.ok(!/ONGKIR LALAMOVE/.test(sim.prompt));
});
