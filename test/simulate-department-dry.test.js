'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/*
 * Uji AI (simulator) kini membawa alat ask_department seperti chat asli, tetapi
 * pertanyaannya hanya DICATAT dan dikembalikan (departmentQuestions): tidak ada
 * baris department_questions, tidak ada pesan ke grup atau anggota.
 */

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const MGMT = { id: 'dept-m', name: 'Management', description: 'stok, harga di luar daftar', members: [{ userId: 'u1' }], whatsappGroupId: '120363@g.us' };

test('simulator: ask_department tercatat di departmentQuestions tanpa menulis atau mengirim', async (t) => {
  const writes = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      const ask = (options.tools || []).find((x) => x.name === 'ask_department');
      if (options.purpose === 'simulate' && ask) {
        const out = await ask.run({ department: 'Management', question: 'Apakah kloset Volk C509 white ready stok?' });
        assert.equal(out.status, 'sent');
      }
      return { text: 'Saya cek dulu ketersediaannya ke tim ya kak.', model: 'tiruan', usage: {} };
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
    async listDepartments() { return [MGMT]; },
    async createDepartmentQuestion(...args) { writes.push(args); return null; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'sim-dept', database, llmService: llm });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];

  const res = await app.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
    payload: { mode: 'ai', grade: false, customerMessage: 'Volk C509 white ready ga kak?' },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.deepEqual(body.departmentQuestions, [{ department: 'Management', question: 'Apakah kloset Volk C509 white ready stok?', kind: 'general' }]);
  assert.equal(writes.length, 0, 'simulasi tidak boleh membuat pertanyaan departemen sungguhan');
});
