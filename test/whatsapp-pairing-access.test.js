'use strict';

/**
 * Pairing WhatsApp adalah urusan supervisor.
 *
 * Tiga rute ini dulu terbuka untuk agent mana pun di company:
 *
 * - `GET /v1/whatsapp/qr` — siapa pun yang memegang QR-nya bisa memindainya
 *   dengan WhatsApp PRIBADInya; sejak itu nomor pribadi itulah yang terpasang
 *   di Agnee, chat pribadinya masuk ke inbox perusahaan, dan percakapan
 *   perusahaan berhenti.
 * - `POST /v1/whatsapp/qr-refresh` — memaksa QR baru.
 * - `POST /v1/whatsapp/logout` — memutus nomor perusahaan, menghentikan semua
 *   percakapan masuk dan keluar untuk SEMUA orang. Ini yang paling berat, dan
 *   baru terlihat saat memasang pagar untuk QR-nya.
 *
 * `GET /v1/whatsapp/status` sengaja TETAP terbuka: header inbox menampilkan
 * status koneksi, dan itu memang perlu dilihat agent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const COMPANY = 'company-1';
const SUPERVISOR = {
  id: 'sup-1', userId: 'sup-1', companyId: COMPANY,
  email: 'sup@pelanggan.test', displayName: 'Supervisor', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};
const AGENT = {
  id: 'agent-1', userId: 'agent-1', companyId: COMPANY,
  email: 'agent@pelanggan.test', displayName: 'Agent', role: 'agent', status: 'active',
  isPlatformAdmin: false,
};

function fakeDatabase() {
  const users = [SUPERVISOR, AGENT];
  return {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) {
      const user = users.find((item) => item.email === email);
      return user && password === 'password-123' ? user : null;
    },
    async getActiveSessionUser(userId) { return users.find((item) => item.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getCompanyConfig() { return { planStatus: 'active', knowledgeClient: 'bzone' }; },
  };
}

async function masuk(app, user) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: user.email, password: 'password-123' },
  });
  assert.equal(login.statusCode, 200);
  return login.headers['set-cookie'].split(';')[0];
}

const RUTE_PAIRING = [
  ['GET', '/v1/whatsapp/qr'],
  ['POST', '/v1/whatsapp/qr-refresh'],
  ['POST', '/v1/whatsapp/logout'],
];

test('agent ditolak di semua rute pairing WhatsApp', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: fakeDatabase(), sessionSecret: 'pairing-1',
  });
  t.after(() => app.close());

  const cookie = await masuk(app, AGENT);
  for (const [method, url] of RUTE_PAIRING) {
    const res = await app.inject({ method, url, headers: { cookie } });
    assert.equal(res.statusCode, 403, `${method} ${url} seharusnya 403 untuk agent`);
  }
});

test('supervisor tidak ditolak di rute yang sama', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: fakeDatabase(), sessionSecret: 'pairing-2',
  });
  t.after(() => app.close());

  const cookie = await masuk(app, SUPERVISOR);
  for (const [method, url] of RUTE_PAIRING) {
    const res = await app.inject({ method, url, headers: { cookie } });
    // Boleh gagal karena mode demo atau client belum siap — yang tidak boleh
    // adalah ditolak karena perannya.
    assert.notEqual(res.statusCode, 403, `${method} ${url} tidak boleh 403 untuk supervisor`);
  }
});

test('status koneksi tetap bisa dilihat agent', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: fakeDatabase(), sessionSecret: 'pairing-3',
  });
  t.after(() => app.close());

  const cookie = await masuk(app, AGENT);
  const res = await app.inject({ method: 'GET', url: '/v1/whatsapp/status', headers: { cookie } });
  assert.equal(res.statusCode, 200);
});
