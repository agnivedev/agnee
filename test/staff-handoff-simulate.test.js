'use strict';

/**
 * Simulasi chat-sebagai-customer (/v1/coach/simulate, jalur yang sama dengan
 * generateAutoReply) untuk kasus ESBEJE 6–9 Nov: giliran customer persis seperti
 * di chat asli, dengan pesan STAF (role "staff") di tengahnya. LLM ditiru.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const SUP = {
  id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'sup@toko.test',
  displayName: 'Supervisor', role: 'supervisor', status: 'active', isPlatformAdmin: false,
};

function fakeDatabase() {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === SUP.email && password === 'password-123' ? SUP : null; },
    async getActiveSessionUser(userId) { return userId === SUP.id ? SUP : null; },
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

async function setup(t, reply) {
  const seen = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      if (options.purpose === 'simulate') seen.push({ message, history: options.history, systemPrompt: options.systemPrompt });
      return { text: typeof reply === 'function' ? reply(message, options) : reply, model: 'tiruan', usage: {} };
    },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'sim-staff', database: fakeDatabase(), llmService: llm });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUP.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const simulate = (payload) => app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', grade: false, ...payload } });
  return { seen, simulate };
}

const DAFTAR = 'Untuk triplek 3mm, kami ada:\n*TRIPLEK 3MM 3X7 UK.PINTU* Rp75.600 per lbr\n*TRIPLEK 3MM 4X8 MC/UT* Rp62.000 per lbr\n\nKakak butuh berapa lembar?';

test('giliran "Utk apa kak?" setelah pesan staf: model melihat pesan staf berlabel, bukan sebagai tulisannya sendiri', async (t) => {
  const { seen, simulate } = await setup(t, 'Rekan kami yang menulisnya akan menjelaskan langsung di chat ini ya kak.');
  const res = await simulate({
    customerMessage: 'Utk apa kak?',
    transcript: [
      { role: 'customer', text: 'Yg 3mm' },
      { role: 'agent', text: DAFTAR },
      { role: 'customer', text: '1 lembar' },
      { role: 'agent', text: 'Siap kak, 1 lembar. Mau ukuran yang mana?' },
      { role: 'staff', text: 'Pagi kak Rusnandar, utk pesanan 1 lembar triplek 3mm kami bantu buatkan proforma invoice yah' },
    ],
  });
  assert.equal(res.statusCode, 200, res.body);
  const staf = seen[0].history.find((h) => h.content.includes('proforma invoice yah'));
  assert.match(staf.content, /^\[Staf tim, bukan kamu\]/);
  assert.equal(seen[0].history.find((h) => h.content.startsWith('Siap kak')).content.startsWith('['), false);
  assert.match(seen[0].systemPrompt, /Staf manusia sudah turun tangan/);
  assert.match(res.json().reply, /Rekan kami/);
});

test('"Ini 62rb yg mana kak" setelah AI menyebut Rp62.000: penyangkalan harga sendiri diperbaiki', async (t) => {
  const { simulate } = await setup(t, 'Kak, harga triplek Teakwood 3mm 4x8 adalah Rp 113.300 per lembar. Tidak ada yang Rp 62.000.\nMungkin Kakak melihat harga untuk produk yang lain?');
  const res = await simulate({
    customerMessage: 'Ini 62rb yg mana kak',
    transcript: [
      { role: 'customer', text: 'Yg 3mm' },
      { role: 'agent', text: DAFTAR },
      { role: 'customer', text: 'Yg ini kak' },
      { role: 'agent', text: 'Baik, Kak. Teakwood 3mm ukuran 4x8 (122x244 cm) harganya Rp 113.300 per lembar.' },
    ],
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.json().reply, /^Rp62\.000 per lbr itu harga TRIPLEK 3MM 4X8 MC\/UT/);
  assert.doesNotMatch(res.json().reply, /Tidak ada yang Rp 62\.000/i);
});

test('simulasi tanpa pesan staf tidak berubah: tanpa label dan tanpa aturan staf', async (t) => {
  const { seen, simulate } = await setup(t, 'Ada kak.');
  await simulate({ customerMessage: 'Ada semen?', transcript: [{ role: 'customer', text: 'Halo' }, { role: 'agent', text: 'Halo kak' }] });
  assert.doesNotMatch(seen[0].systemPrompt, /Staf manusia sudah turun tangan/);
  assert.equal(seen[0].history[1].content, 'Halo kak');
});
