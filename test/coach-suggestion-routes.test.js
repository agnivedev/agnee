'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/**
 * Rute aksi atas saran balasan di Uji AI. Database, auth, dan model dipalsukan:
 * yang diuji adalah urutan wajib draf → simulasi → terapkan dan penjagaannya.
 */
async function setup(t, { distill } = {}) {
  const stamp = Date.now();
  const mk = (id, role, companyId) => ({
    id, userId: id, companyId, email: `${id}-${stamp}@pelanggan.test`, displayName: id, role, status: 'active', isPlatformAdmin: false,
  });
  const users = [mk('sup1', 'owner', 'co-a'), mk('agent1', 'agent', 'co-a')];
  const saved = [];
  const state = { prompts: [] };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return users.find((u) => u.email === email && password === 'password-123') || null; },
    async getActiveSessionUser(userId) { return users.find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async getPlaybookContext() { return '## PLAYBOOK\nToko bahan bangunan.'; },
    async listPlaybookFacts() { return []; },
    async upsertPlaybookFact(fact, userId, companyId) {
      const row = { id: `f${saved.length + 1}`, ...fact };
      saved.push({ ...row, userId, companyId });
      return row;
    },
  };
  const db = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const llm = {
    enabled: true,
    model: 'tiruan',
    async generateReply(message, options) {
      state.prompts.push({ purpose: options.purpose, systemPrompt: options.systemPrompt || '', message });
      if (options.purpose === 'knowledge_check') {
        if (/menyaring/.test(options.systemPrompt || '')) {
          const text = typeof distill === 'function' ? distill(message) : distill;
          return { text, model: 'tiruan' };
        }
        return { text: '{"variants":["cod bisa nggak ya","bisa bayar di tempat?"]}', model: 'tiruan' };
      }
      if (options.purpose === 'judge') {
        return { text: JSON.stringify({ scores: { accuracy: 5, helpfulness: 5, funnel: 4, tone: 5 }, verdict: 'pass', strengths: [], issues: [], suggestedReply: '', missingInfo: [] }), model: 'tiruan' };
      }
      const knows = /USULAN BARU/.test(options.systemPrompt || '');
      return { text: knows ? 'Bisa COD kak, ongkirnya Rp 15.000.' : 'Aku cek dulu ke tim ya kak.', model: 'tiruan', usage: {} };
    },
  };
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'cs-routes', database: db, llmService: llm,
  });
  t.after(() => app.close());
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    assert.equal(res.statusCode, 200);
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, url, payload) => app.inject({ method: 'POST', url, headers: { cookie: who.cookie }, payload });
  return { call, saved, state, sup: await login(users[0]), agent: await login(users[1]) };
}

const FACT = JSON.stringify({
  decision: 'fact', reason: 'Kebijakan COD.', question: 'Apakah bisa COD ke Bekasi?',
  answer: 'Bisa COD Jabodetabek, ongkir Rp 15.000.', category: 'faq',
});
const DRAFT_BODY = { customerMessage: 'kak bisa cod ke bekasi?', suggestedReply: 'Bisa COD kak, ongkir Rp 15.000.', issues: ['tidak langsung menjawab'] };
const FACT_BODY = { question: 'Apakah bisa COD ke Bekasi?', answer: 'Bisa COD Jabodetabek, ongkir Rp 15.000.', category: 'faq', customerMessage: 'kak bisa cod ke bekasi?' };

test('hanya supervisor: agent ditolak di ketiga rute', async (t) => {
  const { call, agent } = await setup(t, { distill: FACT });
  assert.equal((await call(agent, '/v1/coach/suggestion/draft', { mode: 'accept', ...DRAFT_BODY })).statusCode, 403);
  assert.equal((await call(agent, '/v1/coach/suggestion/simulate', FACT_BODY)).statusCode, 403);
  assert.equal((await call(agent, '/v1/coach/suggestion/apply', FACT_BODY)).statusCode, 403);
});

test('terima perbaikan: draf, simulasi sebelum/sesudah, lalu terapkan jadi Fakta', async (t) => {
  const { call, sup, saved } = await setup(t, { distill: FACT });
  const draft = await call(sup, '/v1/coach/suggestion/draft', { mode: 'accept', ...DRAFT_BODY });
  assert.equal(draft.statusCode, 200);
  assert.equal(draft.json().decision, 'fact');
  assert.deepEqual(draft.json().problems, []);

  // Terapkan tanpa simulasi ditolak.
  const early = await call(sup, '/v1/coach/suggestion/apply', FACT_BODY);
  assert.equal(early.statusCode, 400);
  assert.equal(early.json().needsSimulation, true);
  assert.equal(saved.length, 0);

  const sim = await call(sup, '/v1/coach/suggestion/simulate', FACT_BODY);
  assert.equal(sim.statusCode, 200);
  const body = sim.json();
  assert.equal(body.blocked, false);
  assert.ok(body.rows.length >= 2);
  assert.match(body.rows[0].before, /cek dulu/);
  assert.match(body.rows[0].after, /Bisa COD/);

  const applied = await call(sup, '/v1/coach/suggestion/apply', FACT_BODY);
  assert.equal(applied.statusCode, 200);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source, 'simulation');
  assert.equal(saved[0].question, 'Apakah bisa COD ke Bekasi?');
  assert.equal(saved[0].companyId, 'co-a');

  // Simulasi sekali pakai: terapkan kedua kali butuh simulasi ulang.
  assert.equal((await call(sup, '/v1/coach/suggestion/apply', FACT_BODY)).statusCode, 400);
});

test('menyunting isi setelah simulasi membatalkan izin terapkan', async (t) => {
  const { call, sup, saved } = await setup(t, { distill: FACT });
  assert.equal((await call(sup, '/v1/coach/suggestion/simulate', FACT_BODY)).statusCode, 200);
  const edited = { ...FACT_BODY, answer: 'Bisa COD seluruh Indonesia, gratis ongkir.' };
  const res = await call(sup, '/v1/coach/suggestion/apply', edited);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().needsSimulation, true);
  assert.equal(saved.length, 0);
});

test('biar AI putuskan: discard dihormati, accept tetap memberi draf yang perlu disunting', async (t) => {
  const discard = JSON.stringify({ decision: 'discard', reason: 'Hanya soal gaya bicara.' });
  const { call, sup } = await setup(t, { distill: discard });
  const auto = await call(sup, '/v1/coach/suggestion/draft', { mode: 'auto', ...DRAFT_BODY });
  assert.equal(auto.json().decision, 'discard');
  assert.equal(auto.json().draft, null);
  const accept = await call(sup, '/v1/coach/suggestion/draft', { mode: 'accept', ...DRAFT_BODY });
  assert.equal(accept.json().decision, 'fact');
  assert.equal(accept.json().needsEdit, true);
});

test('saran dengan "Rp ..." kosong: draf memberi masalah, simulasi dan terapkan menolak', async (t) => {
  const bad = JSON.stringify({
    decision: 'fact', reason: 'x', question: 'Berapa harga semen Jakarta?', answer: 'Semen Jakarta mulai dari Rp ... per sak.', category: 'pricing',
  });
  const { call, sup, saved } = await setup(t, { distill: bad });
  const draft = await call(sup, '/v1/coach/suggestion/draft', { mode: 'accept', ...DRAFT_BODY });
  assert.equal(draft.json().problems.length, 1);
  const body = { question: 'Berapa harga semen Jakarta?', answer: 'Semen Jakarta mulai dari Rp ... per sak.' };
  const sim = await call(sup, '/v1/coach/suggestion/simulate', body);
  assert.equal(sim.statusCode, 400);
  assert.match(sim.json().error, /kosong|titik/);
  assert.equal((await call(sup, '/v1/coach/suggestion/apply', body)).statusCode, 400);
  assert.equal(saved.length, 0);
});

test('model tidak menjawab: draf 502 dan tidak ada yang tersimpan', async (t) => {
  const { call, sup, saved } = await setup(t, { distill: '' });
  const res = await call(sup, '/v1/coach/suggestion/draft', { mode: 'auto', ...DRAFT_BODY });
  assert.equal(res.statusCode, 502);
  assert.equal(saved.length, 0);
});
