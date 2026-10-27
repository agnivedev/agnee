'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};

const PROMO = {
  id: '1', kind: 'free_shipping', name: 'Free ongkir Tangerang Raya', enabled: true, startsAt: null, endsAt: null,
  areas: [{ province: 'Banten', city: 'Tangerang Selatan', district: 'Ciputat' }],
  conditions: { minQty: 10 }, maxSubsidy: null, notes: '',
};

function fakeDatabase(state) {
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
    async getLalamoveConnection() { return null; },
    async listPromoRules() { return state.rules; },
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

async function setup(t, rules) {
  const seen = [];
  const results = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      const tool = (options.tools || []).find((x) => x.name === 'cek_ongkir');
      seen.push({ purpose: options.purpose, prompt: options.systemPrompt || '', tools: (options.tools || []).map((x) => x.name) });
      if (tool && options.purpose === 'simulate') {
        results.push(await tool.run({ tujuan: 'Ciputat, Tangerang Selatan', jumlah_barang: 12 }));
        results.push(await tool.run({ tujuan: 'Ciputat, Tangerang Selatan' }));
        results.push(await tool.run({ tujuan: 'Kebayoran Baru, Jakarta Selatan', jumlah_barang: 12 }));
      }
      return { text: 'Baik kak.', model: 'tiruan', usage: {} };
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('nominatim.openstreetmap.org/search')) {
      const q = decodeURIComponent(String(url).split('q=')[1] || '');
      const display = /ciputat/i.test(q)
        ? 'Ciputat, Kota Tangerang Selatan, Banten, Indonesia'
        : 'Kebayoran Baru, Jakarta Selatan, DKI Jakarta, Indonesia';
      return new Response(JSON.stringify([{ lat: '-6.3', lon: '106.7', display_name: display, address: {} }]), { status: 200 });
    }
    return realFetch(url, init);
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'promo-sim', database: fakeDatabase({ rules }), llmService: llm });
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); });
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = res.headers['set-cookie'].split(';')[0];
  const simulate = () => app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage: 'kirim ke Ciputat gratis ongkir ga?', grade: false } });
  return { seen, results, simulate };
}

test('simulator: promo aktif tanpa Lalamove menghidupkan cek_ongkir dan bagian PROMO di prompt', async (t) => {
  const { seen, results, simulate } = await setup(t, [PROMO]);
  assert.equal((await simulate()).statusCode, 200);
  const sim = seen.find((s) => s.purpose === 'simulate');
  assert.ok(sim.tools.includes('cek_ongkir'));
  assert.match(sim.prompt, /PROMO GRATIS ONGKIR/);
  assert.match(sim.prompt, /Free ongkir Tangerang Raya/);
  assert.ok(!/ONGKIR LALAMOVE/.test(sim.prompt), 'panduan Lalamove tak boleh muncul tanpa Lalamove');

  assert.equal(results[0].promo_gratis_ongkir.status, 'berlaku');
  assert.equal(results[1].promo_gratis_ongkir.status, 'syarat_belum_diketahui');
  assert.equal(results[2].promo_gratis_ongkir.status, 'di_luar_wilayah');
});

test('simulator: promo mati atau kedaluwarsa tidak menghidupkan alat', async (t) => {
  const { seen, simulate } = await setup(t, [{ ...PROMO, enabled: false }, { ...PROMO, id: '2', endsAt: '2020-01-01T00:00:00Z' }]);
  await simulate();
  const sim = seen.find((s) => s.purpose === 'simulate');
  assert.ok(!sim.tools.includes('cek_ongkir'));
  assert.ok(!/PROMO GRATIS ONGKIR/.test(sim.prompt));
});
