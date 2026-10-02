'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/**
 * Setelah "Selesai" di daftar periksa onboarding, /v1/auth/session harus
 * langsung bilang onboarded — cookie sesi masih membawa nilai saat login.
 */
test('onboarded dibaca segar dari database setelah ditandai', async (t) => {
  const user = { id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'baru@onb.test', displayName: 'Baru', role: 'owner', status: 'active', isPlatformAdmin: false, onboardedAt: null };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return email === user.email && password === 'password-123' ? { ...user } : null; },
    async getActiveSessionUser() { return { ...user }; },
    async setPresence() {},
    async markOnboarded() { user.onboardedAt = new Date().toISOString(); },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'onb-1' });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];

  const before = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  assert.equal(before.json().user.onboarded, false);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/onboarded', headers: { cookie } })).statusCode, 200);
  const after = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  assert.equal(after.json().user.onboarded, true);
});

test('hubInbox hanya untuk company penerima Agnive Hub', async (t) => {
  const make = (companyId) => ({ id: 'u-1', userId: 'u-1', companyId, email: 'u@hub.test', displayName: 'U', role: 'owner', status: 'active', isPlatformAdmin: false, onboardedAt: '2026-10-01' });
  for (const [companyId, expected] of [['company-agnive', true], ['company-lain', false]]) {
    const user = make(companyId);
    const database = {
      enabled: true, connected: true,
      async connect() {}, async close() {},
      status() { return { driver: 'postgresql', connected: true }; },
      async authenticateUser(email, password) { return password === 'password-123' ? { ...user } : null; },
      async getActiveSessionUser() { return { ...user }; },
      async setPresence() {},
      async resolveCompanyId(ref) { return ref === 'agnive' ? 'company-agnive' : null; },
    };
    process.env.INSIGHT_WEBHOOK_COMPANY = 'agnive';
    const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: `hub-${companyId}` });
    delete process.env.INSIGHT_WEBHOOK_COMPANY;
    t.after(() => app.close());
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    const cookie = login.headers['set-cookie'].split(';')[0];
    const session = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
    assert.equal(session.json().user.hubInbox, expected, companyId);
  }
});
