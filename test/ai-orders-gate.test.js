'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/*
 * Alat buat_proforma / buat_invoice menulis ke DealPOS dan memesan kurir.
 * Simulator Coach menerima chatId (dulu cukup untuk menyalakan alat itu), jadi
 * simulasi pada chat sungguhan tidak boleh pernah mendapatkannya. Rincian
 * (susun_rincian) tetap ada karena tidak menulis ke mana pun.
 */

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};

const POS = {
  enabled: true, aiOrdersEnabled: true, host: 'toko.dealpos.co.id',
  orderOutlet: 'Toko BSD', orderTag: 'WA', orderTaxType: 'Exclusive',
};

test('simulator dengan chatId tidak mendapat alat proforma/invoice, rincian tetap ada', async (t) => {
  const seen = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      seen.push((options.tools || []).map((x) => x.name));
      return { text: 'Baik kak.', model: 'tiruan', usage: {} };
    },
  };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(userId) { return userId === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
    async getDealposConnection() { return { ...POS }; },
    async listDealposProducts() { return { products: [{ code: 'MU480', name: 'MU 480 RENOFIX 25KG', unitPrice: 313000 }], syncedAt: null }; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'orders-gate', database, llmService: llm });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];

  const res = await app.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
    payload: { mode: 'ai', grade: false, chatId: '6281234@c.us', customerMessage: 'oke kak, buatkan pesanannya 10 sak MU 480' },
  });
  assert.equal(res.statusCode, 200);
  const tools = seen.at(-1);
  assert.ok(tools.includes('susun_rincian'));
  assert.ok(!tools.includes('buat_proforma'), 'simulasi tidak boleh menulis proforma ke DealPOS');
  assert.ok(!tools.includes('buat_invoice'), 'simulasi tidak boleh membuat invoice atau memesan kurir');
});
