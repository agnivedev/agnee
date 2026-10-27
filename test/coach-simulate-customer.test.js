'use strict';

/**
 * Simulasi chat sebagai customer (/v1/coach/simulate, mode "ai").
 *
 * Simulator harus memberi model pesan yang SAMA dengan yang diterima chat
 * sungguhan. Tes di sini memainkan customer yang mengirim lokasi lewat link
 * Google Maps dan memeriksa apa yang benar-benar sampai ke model, lalu
 * balasan yang keluar. LLM dan Google/OpenStreetMap ditiru; tidak ada jaringan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const mapsLink = require('../src/maps-link');

const SUP = {
  id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'sup@toko.test',
  displayName: 'Supervisor', role: 'supervisor', status: 'active', isPlatformAdmin: false,
};
const AGENT = { ...SUP, id: 'agent-1', userId: 'agent-1', email: 'agent@toko.test', role: 'agent' };

const LONG_URL = 'https://www.google.com/maps/place/Toko+Sinar+Jaya/@-6.3,106.65,17z/data=!3d-6.301234!4d106.652345';

function fakeDatabase() {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return [SUP, AGENT].find((u) => u.email === email && password === 'password-123') || null; },
    async getActiveSessionUser(userId) { return [SUP, AGENT].find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

async function setup(t, { reply = 'Baik kak, saya catat lokasinya.' } = {}) {
  mapsLink.clearCache();
  const seen = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      if (options.purpose === 'simulate') seen.push({ message, history: options.history });
      return { text: reply, model: 'tiruan', usage: {} };
    },
  };
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://maps.app.goo.gl/')) {
      fetched.push(u);
      if (u.endsWith('/Mati')) return new Response('', { status: 404 });
      return new Response('', { status: 302, headers: { location: LONG_URL } });
    }
    if (u.startsWith('https://nominatim.openstreetmap.org/')) {
      fetched.push(u);
      return new Response(JSON.stringify({ display_name: 'Jl. Raya Serpong, Tangerang Selatan' }), { status: 200 });
    }
    return realFetch(url, init);
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'sim-cust', database: fakeDatabase(), llmService: llm });
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); });
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    return res.headers['set-cookie'].split(';')[0];
  };
  const simulate = (cookie, payload) => app.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
    payload: { mode: 'ai', grade: false, ...payload },
  });
  return { seen, fetched, simulate, supCookie: await login(SUP), agentCookie: await login(AGENT) };
}

test('customer kirim link Google Maps pendek: model menerima nama tempat dan koordinatnya', async (t) => {
  const { seen, simulate, supCookie } = await setup(t);
  const res = await simulate(supCookie, { customerMessage: 'Kirim ke sini ya kak https://maps.app.goo.gl/Ab12Cd' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().reply, 'Baik kak, saya catat lokasinya.');
  assert.equal(seen.length, 1);
  assert.match(seen[0].message, /^Kirim ke sini ya kak https:\/\/maps\.app\.goo\.gl\/Ab12Cd/);
  assert.match(seen[0].message, /\[Isi link Google Maps dari customer: tempat "Toko Sinar Jaya", koordinat -6\.301234,106\.652345\]/);
});

test('link yang tidak bisa dibuka: model diberi tahu tidak terbaca, bukan error', async (t) => {
  const { seen, simulate, supCookie } = await setup(t);
  const res = await simulate(supCookie, { customerMessage: 'ini lokasi saya https://maps.app.goo.gl/Mati' });
  assert.equal(res.statusCode, 200);
  assert.match(seen[0].message, /\[Customer mengirim link Google Maps yang isinya tidak bisa dibaca\]/);
});

test('pesan tanpa link sampai ke model apa adanya dan tanpa jaringan', async (t) => {
  const { seen, fetched, simulate, supCookie } = await setup(t);
  await simulate(supCookie, { customerMessage: 'Halo, ada stok sepatu ukuran 42?' });
  assert.equal(seen[0].message, 'Halo, ada stok sepatu ukuran 42?');
  assert.deepEqual(fetched, []);
});

test('giliran customer sebelumnya di transkrip ikut terbaca dari cache', async (t) => {
  const { seen, simulate, supCookie } = await setup(t);
  await simulate(supCookie, { customerMessage: 'lokasi https://maps.app.goo.gl/Ab12Cd' });
  await simulate(supCookie, {
    customerMessage: 'ongkirnya berapa?',
    transcript: [
      { role: 'customer', text: 'lokasi https://maps.app.goo.gl/Ab12Cd' },
      { role: 'agent', text: 'Baik kak, saya catat lokasinya.' },
    ],
  });
  const history = seen[1].history;
  assert.equal(history[0].role, 'user');
  assert.match(history[0].content, /Toko Sinar Jaya/);
  assert.equal(history[1].content, 'Baik kak, saya catat lokasinya.');
});

test('simulator hanya untuk supervisor', async (t) => {
  const { simulate, agentCookie } = await setup(t);
  const res = await simulate(agentCookie, { customerMessage: 'halo' });
  assert.equal(res.statusCode, 403);
});
