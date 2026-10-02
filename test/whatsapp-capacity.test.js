'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/**
 * Plafon nomor WhatsApp berlaku untuk Cloud API juga. Dulu hanya QR dan
 * "tambah nomor" yang memeriksanya, jadi company paket 1 nomor bisa menambah
 * nomor Cloud API sebanyak apa pun.
 */
const SUPERVISOR = {
  id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'sup@kapasitas.test',
  displayName: 'Supervisor', role: 'owner', status: 'active', isPlatformAdmin: false,
};

function fakeDatabase({ existing = [] } = {}) {
  return {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return email === SUPERVISOR.email && password === 'password-123' ? SUPERVISOR : null; },
    async getActiveSessionUser() { return SUPERVISOR; },
    async setPresence() {},
    async getCompanyConfig() { return { planStatus: 'active', status: 'active' }; },
    async getCompanyUsage() { return { maxWhatsapp: 1, currentWhatsapp: 1 }; },
    async listCloudApiConnections() { return existing; },
  };
}

async function masuk(app) {
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUPERVISOR.email, password: 'password-123' } });
  return login.headers['set-cookie'].split(';')[0];
}

const BODY = { phoneNumberId: 'pn-baru', wabaId: 'waba-1', accessToken: 'token-panjang-1', appSecret: 'rahasia-panjang' };

test('Cloud API: nomor baru ditolak saat plafon nomor penuh', async (t) => {
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'kap-1' });
  t.after(() => app.close());
  const cookie = await masuk(app);
  const res = await app.inject({ method: 'POST', url: '/v1/whatsapp/cloud-api/connect', headers: { cookie }, payload: BODY });
  assert.equal(res.statusCode, 403);
  assert.match(res.json().error, /Batas koneksi WhatsApp/);
});

test('Cloud API: memperbarui token nomor yang sudah ada tidak dihitung ke plafon', async (t) => {
  // Jangan sampai test menyentuh Meta sungguhan.
  const realFetch = global.fetch;
  global.fetch = async (url, init) => (String(url).includes('graph.facebook.com')
    ? new Response(JSON.stringify({ error: { message: 'token uji' } }), { status: 400 })
    : realFetch(url, init));
  t.after(() => { global.fetch = realFetch; });
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'kap-2',
    database: fakeDatabase({ existing: [{ id: 'c1', phoneNumberId: 'pn-baru' }] }),
  });
  t.after(() => app.close());
  const cookie = await masuk(app);
  const res = await app.inject({ method: 'POST', url: '/v1/whatsapp/cloud-api/connect', headers: { cookie }, payload: BODY });
  // Gagal setelahnya (verifikasi ke Meta / penyimpanan palsu) boleh — yang
  // tidak boleh adalah ditolak karena plafon.
  assert.notEqual(res.statusCode === 403 && /Batas koneksi/.test(res.body), true);
});
