'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/**
 * Sinkron, jeda, dan putus untuk OneDrive, Google Sheets, dan Mayar sekarang
 * didaftarkan satu helper. Tes ini memastikan ketiganya tetap berperilaku sama:
 * supervisor saja, putus tercatat di audit, dan "belum terhubung" dijawab jelas.
 */
const COMPANY = 'company-1';
const SUP = { id: 'sup-1', userId: 'sup-1', companyId: COMPANY, email: 'sup@int.test', displayName: 'Sup', role: 'owner', status: 'active', isPlatformAdmin: false };
const AGENT = { ...SUP, id: 'agent-1', userId: 'agent-1', email: 'agent@int.test', role: 'agent' };

function fakeDatabase(calls) {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'password-123' ? [SUP, AGENT].find((u) => u.email === email) || null : null; },
    async getActiveSessionUser(id) { return [SUP, AGENT].find((u) => u.id === id) || null; },
    async setPresence() {},
    async recordAuditLog(entry) { calls.push(['audit', entry.action, entry.metadata?.integration]); },
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      const name = String(prop);
      if (name.startsWith('delete')) return async () => { calls.push(['delete', name]); };
      return async () => null;
    },
  });
}

async function masuk(app, user) {
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
  return login.headers['set-cookie'].split(';')[0];
}

const BASES = [['/v1/export/onedrive', 'onedrive'], ['/v1/export/gsheets', 'gsheets'], ['/v1/integrations/mayar', 'mayar']];

test('agent ditolak di semua rute siklus integrasi', async (t) => {
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase([]), sessionSecret: 'int-1' });
  t.after(() => app.close());
  const cookie = await masuk(app, AGENT);
  for (const [base] of BASES) {
    for (const [method, url, payload] of [['POST', `${base}/sync`], ['PATCH', base, { enabled: false }], ['DELETE', base]]) {
      const res = await app.inject({ method, url, headers: { cookie }, payload });
      assert.equal(res.statusCode, 403, `${method} ${url}`);
    }
  }
});

test('supervisor: belum terhubung = 409/404, putus tercatat di audit', async (t) => {
  const calls = [];
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(calls), sessionSecret: 'int-2' });
  t.after(() => app.close());
  const cookie = await masuk(app, SUP);
  for (const [base, integration] of BASES) {
    assert.equal((await app.inject({ method: 'POST', url: `${base}/sync`, headers: { cookie } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'PATCH', url: base, headers: { cookie }, payload: { enabled: true } })).statusCode, 404);
    const removed = await app.inject({ method: 'DELETE', url: base, headers: { cookie } });
    assert.equal(removed.statusCode, 200);
    assert.ok(calls.some(([kind, action, name]) => kind === 'audit' && action === 'integration.disconnected' && name === integration), integration);
  }
});
