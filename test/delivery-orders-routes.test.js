'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const CHAT = '6281234567890@c.us';
const BSD = { id: '7', name: 'Toko BSD', kind: 'store', address: 'Jl. Raya Serpong 1', lat: -6.3, lng: 106.65, isPickup: true, contactName: 'Pak Budi', contactPhone: '6281200000001' };
const TANPA_KONTAK = { id: '8', name: 'Toko Kemang', kind: 'store', address: 'Jl. Kemang 9', lat: -6.27, lng: 106.81, isPickup: false, contactName: null, contactPhone: null };
const CONN = {
  environment: 'sandbox', market: 'ID', apiKey: 'pk_test_x', apiSecret: 'sk_test_x', enabled: true, defaultService: 'VAN',
  cities: [{ locode: 'ID JKT', name: 'Jakarta', services: [{ key: 'MOTORCYCLE', description: 'Motor' }, { key: 'VAN', description: 'Van' }] }],
};

async function setup(t, { conn = CONN } = {}) {
  const state = { orders: [], audits: [], seq: 0, lalamove: [], orderStatus: 'ASSIGNING_DRIVER' };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(userId) { return userId === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async getLalamoveConnection() { return conn ? { ...conn } : null; },
    async listCompanyLocations() { return [BSD, TANPA_KONTAK]; },
    async createLalamoveOrder(companyId, order) {
      const row = { id: String(++state.seq), ...order, createdAt: new Date().toISOString() };
      state.orders.push(row);
      return row;
    },
    async listLalamoveOrders() { return state.orders.map((o) => ({ ...o })); },
    async getLalamoveOrderRow(companyId, chatId, id) { return state.orders.find((o) => o.id === id) || null; },
    async updateLalamoveOrderStatus(companyId, id, { status, shareLink }) {
      const row = state.orders.find((o) => o.id === id);
      Object.assign(row, { status, ...(shareLink ? { shareLink } : {}) });
      return row;
    },
    async recordAuditLog(entry) { state.audits.push(entry); },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('lalamove.com')) return realFetch(url, init);
    const method = init.method || 'GET';
    state.lalamove.push({ method, url: u, body: init.body ? JSON.parse(init.body) : null });
    const json = (data, status = 200) => new Response(JSON.stringify({ data }), { status });
    if (u.endsWith('/v3/quotations')) {
      return json({ quotationId: 'q-1', serviceType: 'VAN', priceBreakdown: { total: '85000', currency: 'IDR' }, distance: { value: '12000' }, stops: [{ stopId: 's-0', address: 'a' }, { stopId: 's-1', address: 'b' }] }, 201);
    }
    if (u.endsWith('/v3/orders') && method === 'POST') return json({ orderId: 'LM-1', status: 'ASSIGNING_DRIVER', shareLink: 'https://share.sandbox.lalamove.com/?LM-1' }, 201);
    if (u.includes('/v3/orders/LM-1') && method === 'GET') return json({ orderId: 'LM-1', status: state.orderStatus, shareLink: 'https://share.sandbox.lalamove.com/?LM-1' });
    if (u.includes('/v3/orders/LM-1') && method === 'DELETE') return new Response(null, { status: 204 });
    return json({}, 404);
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'dlv-orders', database });
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const call = (method, path, payload) => app.inject({ method, url: `/v1/chats/${encodeURIComponent(CHAT)}/delivery${path}`, headers: { cookie }, payload });
  return { state, call };
}

const PIN = '-6.2650,106.7830';
const ORDER = (quotationId = 'q-1') => ({ quotationId, recipientName: 'Bu Rina', recipientPhone: '0812-3456-7890', confirmed: true });

test('tanpa Lalamove tersambung: layar kurir tidak tersedia, bukan error', async (t) => {
  const { call } = await setup(t, { conn: null });
  const res = await call('GET', '');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().available, false);
  assert.equal((await call('POST', '/quote', { destination: PIN })).statusCode, 409);
});

test('harga: butuh titik pasti (nama daerah ditolak), pakai titik jemput dan kendaraan bawaan', async (t) => {
  const { call, state } = await setup(t);
  const info = (await call('GET', '')).json();
  assert.equal(info.available, true);
  assert.equal(info.environment, 'sandbox');
  assert.deepEqual(info.pickups.map((p) => [p.name, p.hasContact]), [['Toko BSD', true], ['Toko Kemang', false]]);

  const ok = await call('POST', '/quote', { destination: PIN });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().total, 85000);
  assert.equal(ok.json().serviceType, 'VAN');
  assert.equal(ok.json().pickupName, 'Toko BSD');
  const sent = state.lalamove.find((c) => c.url.endsWith('/v3/quotations'));
  assert.deepEqual(sent.body.data.stops[0].coordinates, { lat: '-6.3', lng: '106.65' });
  assert.equal((await call('POST', '/quote', { destination: PIN, vehicle: 'TRUK99' })).statusCode, 422);
});

test('pesan kurir: wajib konfirmasi, harga harus masih berlaku, satu harga satu order', async (t) => {
  const { call, state } = await setup(t);
  assert.equal((await call('POST', '/orders', { ...ORDER(), confirmed: false })).statusCode, 400);
  assert.equal((await call('POST', '/orders', ORDER('tak-dikenal'))).statusCode, 410);

  await call('POST', '/quote', { destination: PIN });
  const res = await call('POST', '/orders', ORDER());
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().order.orderId, 'LM-1');
  assert.equal(res.json().order.environment, 'sandbox');
  const sent = state.lalamove.find((c) => c.method === 'POST' && c.url.endsWith('/v3/orders'));
  assert.equal(sent.body.data.quotationId, 'q-1');
  assert.deepEqual(sent.body.data.sender, { stopId: 's-0', name: 'Pak Budi', phone: '+6281200000001' });
  assert.deepEqual(sent.body.data.recipients, [{ stopId: 's-1', name: 'Bu Rina', phone: '+6281234567890', remarks: '' }]);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].action, 'delivery.order_placed');
  assert.ok(!JSON.stringify(state.audits[0]).includes('6281234567890'), 'nomor customer tidak masuk audit');

  assert.equal((await call('POST', '/orders', ORDER())).statusCode, 410, 'harga yang sama tidak bisa dipakai dua kali');
  assert.equal(state.lalamove.filter((c) => c.method === 'POST' && c.url.endsWith('/v3/orders')).length, 1);
});

test('lokasi jemput tanpa penanggung jawab: order ditolak sebelum menyentuh Lalamove', async (t) => {
  const { call, state } = await setup(t);
  await call('POST', '/quote', { destination: PIN, locationId: '8' });
  const res = await call('POST', '/orders', ORDER());
  assert.equal(res.statusCode, 422);
  assert.match(res.json().error, /Toko Kemang.*Pengaturan > Lokasi/);
  assert.ok(!state.lalamove.some((c) => c.url.endsWith('/v3/orders')));
});

test('nomor penerima tidak valid ditolak', async (t) => {
  const { call } = await setup(t);
  await call('POST', '/quote', { destination: PIN });
  const res = await call('POST', '/orders', { ...ORDER(), recipientPhone: '12345' });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().error, /Nomor HP penerima/);
});

test('daftar menyegarkan status dari Lalamove; batalkan sebelum selesai, tidak bisa dua kali', async (t) => {
  const { call, state } = await setup(t);
  await call('POST', '/quote', { destination: PIN });
  await call('POST', '/orders', ORDER());

  state.orderStatus = 'ON_GOING';
  const list = (await call('GET', '')).json();
  assert.equal(list.orders[0].status, 'ON_GOING');
  assert.match(list.orders[0].shareLink, /share\.sandbox\.lalamove\.com/);

  const cancel = await call('POST', '/orders/1/cancel');
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.json().order.status, 'CANCELED');
  assert.ok(state.lalamove.some((c) => c.method === 'DELETE'));
  assert.equal(state.audits.at(-1).action, 'delivery.order_canceled');
  assert.equal((await call('POST', '/orders/1/cancel')).statusCode, 409);
  assert.equal((await call('POST', '/orders/99/cancel')).statusCode, 404);
});
