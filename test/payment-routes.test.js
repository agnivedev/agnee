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

function fakeDatabase(store) {
  const own = (companyId) => store.accounts.filter((r) => r.companyId === companyId);
  const strip = ({ companyId: _c, ...row }) => row;
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return [OWNER, AGENT, OTHER].find((u) => u.email === email && password === 'password-123') || null; },
    async getActiveSessionUser(userId) { return [OWNER, AGENT, OTHER].find((u) => u.id === userId) || null; },
    async setPresence() {},
    async listPaymentAccounts(companyId) { return own(companyId).map(strip); },
    async getPaymentAccount(companyId, id) { const r = own(companyId).find((x) => x.id === id); return r ? strip(r) : null; },
    async countPaymentAccounts(companyId) { return own(companyId).length; },
    async savePaymentAccount(companyId, id, account) {
      if (id) { const row = own(companyId).find((r) => r.id === id); Object.assign(row, account); return strip(row); }
      const row = { id: String(++store.seq), companyId, ...account };
      store.accounts.push(row);
      return strip(row);
    },
    async deletePaymentAccount(companyId, id) {
      const before = store.accounts.length;
      store.accounts = store.accounts.filter((r) => !(r.companyId === companyId && r.id === id));
      return store.accounts.length < before;
    },
    async listPaymentProofs(companyId) { return store.proofs.filter((p) => p.companyId === companyId); },
    async reviewPaymentProof(companyId, id, status) {
      const p = store.proofs.find((x) => x.companyId === companyId && x.id === id);
      if (!p) return null;
      p.reviewStatus = status;
      return p;
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
  const store = { accounts: [], proofs: [{ id: '7', companyId: 'company-a', chatId: 'x@c.us', verdict: 'perlu_dicek', flags: ['total_tak_diketahui'], extracted: { amount: 100000 }, reviewStatus: 'pending' }], seq: 0 };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'payment-routes', database: fakeDatabase(store) });
  t.after(() => app.close());
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  return { store, call, owner: await login(OWNER), agent: await login(AGENT), other: await login(OTHER) };
}

const BCA = { bankName: 'BCA', accountNumber: '172 172 6989', accountHolder: 'PT Karya Warna Kemenangan' };

test('rekening: supervisor menambah, agen hanya membaca, company lain terpisah', async (t) => {
  const { call, owner, agent, other } = await setup(t);
  assert.equal((await call(agent, 'POST', '/v1/payment-accounts', BCA)).statusCode, 403);
  assert.match((await call(owner, 'POST', '/v1/payment-accounts', { ...BCA, accountNumber: 'abc' })).json().error, /angka/i);
  const res = await call(owner, 'POST', '/v1/payment-accounts', BCA);
  assert.equal(res.statusCode, 201);
  const id = res.json().account.id;
  assert.equal((await call(agent, 'GET', '/v1/payment-accounts')).json().accounts.length, 1);
  assert.equal((await call(other, 'GET', '/v1/payment-accounts')).json().accounts.length, 0);
  assert.equal((await call(other, 'PUT', `/v1/payment-accounts/${id}`, BCA)).statusCode, 404);
  assert.equal((await call(other, 'DELETE', `/v1/payment-accounts/${id}`)).statusCode, 404);
  const retired = await call(owner, 'PUT', `/v1/payment-accounts/${id}`, { ...BCA, status: 'retired' });
  assert.equal(retired.json().account.status, 'retired');
  assert.equal((await call(owner, 'DELETE', `/v1/payment-accounts/${id}`)).statusCode, 200);
});

test('bukti transfer: daftar memuat ringkasan; staf menerima atau menolak, company lain tidak bisa', async (t) => {
  const { call, owner, agent, other } = await setup(t);
  const list = (await call(agent, 'GET', '/v1/payment-proofs')).json().proofs;
  assert.equal(list.length, 1);
  assert.match(list[0].summary, /perlu dicek/);
  assert.equal((await call(agent, 'PATCH', '/v1/payment-proofs/7', { status: 'accepted' })).json().proof.reviewStatus, 'accepted');
  assert.equal((await call(other, 'PATCH', '/v1/payment-proofs/7', { status: 'rejected' })).statusCode, 404);
  assert.equal((await call(owner, 'PATCH', '/v1/payment-proofs/7', { status: 'bogus' })).statusCode, 400);
});
