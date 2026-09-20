'use strict';

/**
 * Isolasi /v1/admin/ai-settings antar company.
 *
 * Sebelum migrasi 033, setting ini adalah SATU objek proses (`aiSettings` di
 * server.js) yang dibagi semua tenant sekaligus — supervisor company mana pun
 * yang mematikan AI atau mengganti model chain mengubahnya untuk SETIAP
 * company lain di server yang sama, bukan cuma miliknya sendiri. Ini menguji
 * bahwa PATCH oleh satu company tidak pernah terlihat oleh company lain.
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

function fakeDatabase() {
  const users = [OWNER_A, OWNER_B];
  // Baris per company, persis seperti kolom ai_enabled/ai_model_chain di
  // migrasi 033 — defaultnya AI menyala tanpa chain kustom.
  const aiRows = new Map([
    [COMPANY_A, { enabled: true, modelChain: [] }],
    [COMPANY_B, { enabled: true, modelChain: [] }],
  ]);

  return {
    aiRows,
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
    async getAiSettings(companyId) {
      return aiRows.get(companyId) || { enabled: true, modelChain: [] };
    },
    async setAiSettings(companyId, patch) {
      const current = aiRows.get(companyId) || { enabled: true, modelChain: [] };
      const next = {
        enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
        modelChain: Array.isArray(patch.modelChain) ? patch.modelChain : current.modelChain,
      };
      aiRows.set(companyId, next);
      return next;
    },
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

test('supervisor company A mengganti AI setting tidak menyentuh company B', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'ai-settings-1',
  });
  t.after(() => app.close());

  const cookieA = await signIn(app, OWNER_A);
  const cookieB = await signIn(app, OWNER_B);

  // Owner A mematikan AI dan mengganti ke model yang mahal — persis skenario
  // yang dulu bocor ke semua tenant lain.
  const patched = await app.inject({
    method: 'PATCH', url: '/v1/admin/ai-settings', headers: { cookie: cookieA },
    payload: { enabled: false, modelChain: ['openai/gpt-4-turbo-mahal'] },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().enabled, false);
  assert.deepEqual(patched.json().modelChain, ['openai/gpt-4-turbo-mahal']);

  // Baris company A di "database" berubah…
  assert.deepEqual(database.aiRows.get(COMPANY_A), { enabled: false, modelChain: ['openai/gpt-4-turbo-mahal'] });
  // …tapi company B tidak pernah disentuh.
  assert.deepEqual(database.aiRows.get(COMPANY_B), { enabled: true, modelChain: [] });

  // Dan itu juga yang dilihat company B lewat API-nya sendiri.
  const readB = await app.inject({ method: 'GET', url: '/v1/admin/ai-settings', headers: { cookie: cookieB } });
  assert.equal(readB.statusCode, 200);
  assert.deepEqual(readB.json().modelChain, []);
});

test('GET /v1/admin/ai-settings mengembalikan baris company milik pemanggil, bukan company lain', async (t) => {
  const database = fakeDatabase();
  await database.setAiSettings(COMPANY_B, { enabled: false, modelChain: ['model-khusus-b'] });

  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'ai-settings-2',
  });
  t.after(() => app.close());

  const cookieA = await signIn(app, OWNER_A);
  const readA = await app.inject({ method: 'GET', url: '/v1/admin/ai-settings', headers: { cookie: cookieA } });
  assert.equal(readA.statusCode, 200);
  // Company A tidak pernah menyetel apa pun — chain company B tidak boleh bocor ke sini.
  assert.deepEqual(readA.json().modelChain, []);
});
