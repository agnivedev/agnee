'use strict';

/**
 * Pack knowledge (FAQ, harga, funnel, reply policy) bersifat per pelanggan —
 * `ENTITLEMENT_FIELDS` di server.js menyebutnya proprietary dan hanya staf
 * platform yang boleh mengubahnya.
 *
 * Tapi `/v1/admin/config` dulu menyodorkan SELURUH daftar pack ke dropdown
 * Admin setiap supervisor, dan `/v1/admin/playground/auto-reply` menerima pack
 * mana pun dari daftar itu. Supervisor pelanggan A tinggal memilih pack
 * pelanggan B dan membaca isinya lewat jawaban AI. Ini menguji bahwa pelanggan
 * hanya melihat dan hanya boleh memakai pack miliknya sendiri, sementara staf
 * platform tetap bisa memilih semuanya.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

const OWNER_A = {
  id: 'owner-a', userId: 'owner-a', companyId: COMPANY_A,
  email: 'owner-a@pelanggan.test', displayName: 'Owner A', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};
const OWNER_B = {
  id: 'owner-b', userId: 'owner-b', companyId: COMPANY_B,
  email: 'owner-b@pelanggan.test', displayName: 'Owner B', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};
const STAF_PLATFORM = {
  id: 'staf', userId: 'staf', companyId: COMPANY_A,
  email: 'staf@agnive.co', displayName: 'Staf Agnive', role: 'owner', status: 'active',
  isPlatformAdmin: true,
};

function fakeDatabase() {
  const users = [OWNER_A, OWNER_B, STAF_PLATFORM];
  const packs = new Map([
    [COMPANY_A, 'tradersmastermind'],
    [COMPANY_B, 'bzone'],
  ]);

  return {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) {
      const user = users.find((item) => item.email === email);
      return user && password === 'password-123' ? user : null;
    },
    async getActiveSessionUser(userId) {
      return users.find((item) => item.id === userId) || null;
    },
    async setPresence() {},
    async getCompanyConfig(companyId) {
      return { knowledgeClient: packs.get(companyId) || 'bzone', planStatus: 'active' };
    },
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
  };
}

async function signIn(app, user) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: user.email, password: 'password-123' },
  });
  assert.equal(login.statusCode, 200);
  return login.headers['set-cookie'].split(';')[0];
}

test('supervisor hanya melihat pack knowledge miliknya sendiri di /v1/admin/config', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'pack-1',
  });
  t.after(() => app.close());

  const cookieA = await signIn(app, OWNER_A);
  const config = await app.inject({ method: 'GET', url: '/v1/admin/config', headers: { cookie: cookieA } });
  assert.equal(config.statusCode, 200);
  const ids = config.json().knowledgeClients.map((c) => c.id);
  assert.deepEqual(ids, ['tradersmastermind']);
  // Pack pelanggan lain tidak boleh bocor lewat daftar ini — dulu ikut terkirim
  // ke dropdown, lengkap dengan nama kliennya.
  assert.equal(ids.includes('bzone'), false);
});

test('playground menolak pack knowledge milik company lain', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'pack-2',
  });
  t.after(() => app.close());

  const cookieA = await signIn(app, OWNER_A);
  const curi = await app.inject({
    method: 'POST', url: '/v1/admin/playground/auto-reply', headers: { cookie: cookieA },
    payload: { message: 'Berapa harga paketnya?', clientId: 'bzone' },
  });
  assert.equal(curi.statusCode, 403);
});

test('staf platform tetap boleh menguji pack mana pun', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'pack-3',
  });
  t.after(() => app.close());

  const cookie = await signIn(app, STAF_PLATFORM);
  const config = await app.inject({ method: 'GET', url: '/v1/admin/config', headers: { cookie } });
  assert.equal(config.statusCode, 200);
  assert.equal(config.json().knowledgeClients.length > 1, true);

  // Pack milik company lain tidak ditolak di gerbang isolasi. Balasannya sendiri
  // bergantung OpenRouter yang memang mati di test, jadi yang diuji di sini
  // hanya: bukan 403.
  const dibolehkan = await app.inject({
    method: 'POST', url: '/v1/admin/playground/auto-reply', headers: { cookie },
    payload: { message: 'Berapa harga paketnya?', clientId: 'bzone' },
  });
  assert.notEqual(dibolehkan.statusCode, 403);
});
