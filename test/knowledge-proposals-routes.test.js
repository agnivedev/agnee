'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';
const CHAT = '6281200000001@c.us';

/**
 * Rute "AI belajar dari chat" dengan database Postgres asli untuk semua yang
 * menyangkut usulan, notifikasi, dan Fakta; auth, WhatsApp, dan model dipalsukan.
 */
async function setup(t, { summaryKnowledge = [], conflict = 'new' } = {}) {
  const real = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await real.connect();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const mkCompany = async (label) => (await real.pool.query(
    "INSERT INTO companies (slug, name) VALUES ($1, 'Toko Uji') RETURNING id", [`kpr-${label}-${stamp}`],
  )).rows[0].id;
  const companyA = await mkCompany('a');
  const companyB = await mkCompany('b');
  const mkUser = async (label, companyId, role) => {
    const email = `${label}-${stamp}@pelanggan.test`;
    const { rows: [u] } = await real.pool.query('INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id', [email, label]);
    await real.pool.query('INSERT INTO company_members (company_id, user_id, role, whatsapp_number) VALUES ($1, $2, $3, $4)',
      [companyId, u.id, role, role === 'agent' ? null : '08123456789']);
    return { id: u.id, userId: u.id, companyId, email, displayName: label, role, status: 'active', isPlatformAdmin: false };
  };
  const SUP_A = await mkUser('supa', companyA, 'owner');
  const AGENT_A = await mkUser('agena', companyA, 'agent');
  const SUP_B = await mkUser('supb', companyB, 'owner');
  const users = [SUP_A, AGENT_A, SUP_B];

  const state = { prompts: [], learning: new Set(), conflict, summaryKnowledge };
  const facts = [];
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
    async getPlaybookContext() { return '## PLAYBOOK\nPaket dasar Rp 100.000 per bulan.'; },
    async listPlaybookFacts() { return facts; },
    async saveConversationSummary(item) { return item; },
    async listOutboundReplyAuthors() {
      return [{ messageId: 'd2', author: 'human', body: 'Betul. Agnee bisa menjawab FAQ, kualifikasi lead, lalu handoff ke tim sales.' }];
    },
  };
  const db = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      const delegated = /Knowledge|listCreditRecipients|recordAuditLog/;
      if (typeof prop === 'string' && delegated.test(prop) && typeof real[prop] === 'function') return real[prop].bind(real);
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });

  const llm = {
    enabled: true,
    model: 'tiruan',
    async generateReply(message, options) {
      state.prompts.push({ purpose: options.purpose, systemPrompt: options.systemPrompt || '', message });
      if (options.purpose === 'summary') {
        return { text: JSON.stringify({
          summary: 'Customer bertanya soal paket.', stage: 'qualified', score: 60, title: 'Calon', detail: 'tanya paket',
          labels: [], pipelineStage: 'warm', pipelineReason: 'bertanya', knowledge: state.summaryKnowledge,
        }), model: 'tiruan', usage: {} };
      }
      if (options.purpose === 'knowledge_check') {
        if (/USULAN:/.test(message)) return { text: JSON.stringify({ status: state.conflict, note: 'Harga paket berbeda dari playbook.' }), model: 'tiruan' };
        return { text: '{"variants":["cod bisa nggak ya","bisa bayar di tempat?"]}', model: 'tiruan' };
      }
      if (options.purpose === 'judge') {
        return { text: JSON.stringify({ scores: { accuracy: 5, helpfulness: 5, funnel: 4, tone: 5 }, verdict: 'pass', strengths: [], issues: [], suggestedReply: '', missingInfo: [] }), model: 'tiruan' };
      }
      // simulate: hanya tahu ongkirnya kalau usulan ikut di prompt.
      const knows = /USULAN BARU/.test(options.systemPrompt || '');
      // Model sungguhan menyebut angka yang ada di prompt (penjaga harga membuang yang lain): baca dari blok usulan.
      const fee = /ongkir (Rp [\d.]+)/.exec(options.systemPrompt || '')?.[1] || 'Rp 15.000';
      return { text: knows ? `Bisa COD kak, ongkirnya ${fee}.` : 'Aku cek dulu ke tim ya kak.', model: 'tiruan', usage: {} };
    },
  };

  const app = await buildApp({
    logger: process.env.KP_DEBUG ? { level: 'warn' } : false, startupEnabled: false, demoMode: true, sessionSecret: 'kp-routes', database: db, llmService: llm,
  });
  t.after(async () => {
    await app.close();
    await real.pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[companyA, companyB]]);
    await real.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users.map((u) => u.id)]);
    await real.pool.end();
  });
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    assert.equal(res.statusCode, 200);
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  return {
    app, real, state, facts, call, companyA, companyB,
    sup: await login(SUP_A), agent: await login(AGENT_A), supB: await login(SUP_B),
    ids: { SUP_A, AGENT_A, SUP_B },
  };
}

const MANUAL = { chatId: CHAT, question: 'Apakah bisa COD ke Bekasi?', answer: 'Bisa COD Jabodetabek, ongkir Rp 15.000', customerMessage: 'kak bisa cod ke bekasi?' };

test('saklar mati secara bawaan: chip kosong, usulan ditolak, hanya supervisor yang menyalakan', { skip }, async (t) => {
  const { call, sup, agent, supB } = await setup(t);
  assert.deepEqual((await call(agent, 'GET', '/v1/knowledge/settings')).json(), { enabled: false });
  assert.deepEqual((await call(agent, 'GET', `/v1/chats/${CHAT}/knowledge-suggestions`)).json(), { enabled: false, proposals: [] });
  assert.equal((await call(agent, 'POST', '/v1/knowledge-proposals', MANUAL)).statusCode, 409);
  assert.equal((await call(agent, 'PUT', '/v1/knowledge/settings', { enabled: true })).statusCode, 403);
  assert.deepEqual((await call(sup, 'PUT', '/v1/knowledge/settings', { enabled: true })).json(), { enabled: true });
  assert.equal((await call(agent, 'GET', '/v1/knowledge/settings')).json().enabled, true);
  assert.equal((await call(supB, 'GET', '/v1/knowledge/settings')).json().enabled, false, 'saklar per company');
});

test('alur lengkap: CS ajukan, supervisor dikabari, simulasi sebelum/sesudah, terapkan jadi Fakta', { skip }, async (t) => {
  const { call, real, sup, agent, supB, companyA, ids, state } = await setup(t, { conflict: 'conflict' });
  await call(sup, 'PUT', '/v1/knowledge/settings', { enabled: true });

  const created = await call(agent, 'POST', '/v1/knowledge-proposals', MANUAL);
  assert.equal(created.statusCode, 201);
  const id = created.json().proposal.id;
  assert.equal(created.json().proposal.status, 'suggested');
  assert.equal((await call(agent, 'POST', '/v1/knowledge-proposals', { ...MANUAL, question: 'Ongkir ke Bekasi berapa ya?' })).statusCode, 409, 'satu chip per chat');
  assert.equal((await call(agent, 'POST', '/v1/knowledge-proposals', { ...MANUAL, chatId: 'lain@c.us', answer: 'Hubungi 081234567890 ya' })).statusCode, 400, 'data pribadi ditolak');

  const submitted = await call(agent, 'POST', `/v1/knowledge-proposals/${id}/submit`);
  assert.equal(submitted.statusCode, 200);
  assert.equal(submitted.json().outcome, 'submitted');
  assert.equal(submitted.json().proposal.conflictStatus, 'conflict');
  assert.match(submitted.json().proposal.conflictNote, /berbeda/);

  // Supervisor dikabari di lonceng; pengusul sendiri tidak.
  const bells = async (userId) => (await real.pool.query("SELECT body FROM notifications WHERE user_id = $1 AND kind = 'knowledge'", [userId])).rows;
  assert.equal((await bells(ids.SUP_A.id)).length, 1);
  assert.equal((await bells(ids.AGENT_A.id)).length, 0);

  // Agent tidak boleh meninjau; supervisor company lain tidak melihat apa-apa.
  assert.equal((await call(agent, 'POST', `/v1/knowledge-proposals/${id}/simulate`)).statusCode, 403);
  assert.equal((await call(agent, 'POST', `/v1/knowledge-proposals/${id}/apply`)).statusCode, 403);
  assert.equal((await call(supB, 'GET', `/v1/knowledge-proposals/${id}`)).statusCode, 404);
  assert.equal((await call(supB, 'POST', `/v1/knowledge-proposals/${id}/apply`)).statusCode, 404);
  assert.equal((await call(supB, 'GET', '/v1/knowledge-proposals')).json().proposals.length, 0);

  const queue = (await call(sup, 'GET', '/v1/knowledge-proposals')).json();
  assert.equal(queue.pending, 1);
  assert.equal(queue.proposals[0].id, id);
  // Agent hanya melihat usulannya sendiri, dan bisa menyimak statusnya.
  assert.equal((await call(agent, 'GET', '/v1/knowledge-proposals')).json().proposals[0].id, id);

  // Terapkan tanpa simulasi ditolak.
  const early = await call(sup, 'POST', `/v1/knowledge-proposals/${id}/apply`);
  assert.equal(early.statusCode, 400);
  assert.equal(early.json().needsSimulation, true);

  const simulated = await call(sup, 'POST', `/v1/knowledge-proposals/${id}/simulate`);
  assert.equal(simulated.statusCode, 200);
  const rows = simulated.json().proposal.simulation.rows;
  assert.ok(rows.length >= 2 && rows.length <= 3);
  for (const row of rows) {
    assert.match(row.before, /cek dulu/, 'sebelum: AI belum tahu');
    assert.match(row.after, /Rp 15\.000/, 'sesudah: usulan terbaca');
    assert.equal(row.judge.verdict, 'pass');
  }
  // Usulan hanya ditempel sementara di "sesudah": tidak ada Fakta yang tertulis.
  assert.equal((await real.listPlaybookFacts(companyA)).length, 0);
  assert.ok(state.prompts.filter((p) => p.purpose === 'simulate' && /USULAN BARU/.test(p.systemPrompt)).length >= 2);
  assert.ok(state.prompts.filter((p) => p.purpose === 'simulate' && !/USULAN BARU/.test(p.systemPrompt)).length >= 2);

  // Menyunting membatalkan simulasi: yang diterapkan harus persis yang disimulasikan.
  const edited = await call(sup, 'PATCH', `/v1/knowledge-proposals/${id}`, { answer: 'Bisa COD Jabodetabek, ongkir Rp 20.000' });
  assert.equal(edited.json().proposal.simulation, null);
  assert.equal((await call(sup, 'POST', `/v1/knowledge-proposals/${id}/apply`)).statusCode, 400);
  assert.equal((await call(sup, 'POST', `/v1/knowledge-proposals/${id}/simulate`)).statusCode, 200);

  const applied = await call(sup, 'POST', `/v1/knowledge-proposals/${id}/apply`);
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.json().fact.source, 'chat');
  const factRows = await real.listPlaybookFacts(companyA, { onlyAnswered: true });
  assert.equal(factRows.length, 1);
  assert.match(factRows[0].answer, /20\.000/);
  assert.equal((await call(sup, 'POST', `/v1/knowledge-proposals/${id}/apply`)).statusCode, 409);

  // Pengusul dikabari, dan keputusan tercatat di jejak audit.
  assert.equal((await bells(ids.AGENT_A.id)).length, 1);
  const audit = (await real.pool.query("SELECT action FROM audit_logs WHERE company_id = $1 AND action LIKE 'knowledge.%'", [companyA])).rows;
  assert.ok(audit.some((r) => r.action === 'knowledge.applied'));
});

test('tolak membawa alasan ke pengusul, dan "Bukan" menutup usulan', { skip }, async (t) => {
  const { call, real, sup, agent, ids } = await setup(t);
  await call(sup, 'PUT', '/v1/knowledge/settings', { enabled: true });

  const first = (await call(agent, 'POST', '/v1/knowledge-proposals', MANUAL)).json().proposal;
  await call(agent, 'POST', `/v1/knowledge-proposals/${first.id}/submit`);
  const rejected = await call(sup, 'POST', `/v1/knowledge-proposals/${first.id}/reject`, { reason: 'Ongkir sudah naik' });
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.json().proposal.rejectReason, 'Ongkir sudah naik');
  const bell = (await real.pool.query("SELECT body FROM notifications WHERE user_id = $1 AND kind = 'knowledge'", [ids.AGENT_A.id])).rows;
  assert.match(bell[0].body, /ditolak: Ongkir sudah naik/);
  assert.equal((await call(sup, 'POST', `/v1/knowledge-proposals/${first.id}/reject`, {})).statusCode, 409);

  const second = (await call(agent, 'POST', '/v1/knowledge-proposals', { ...MANUAL, question: 'Jam buka toko hari Minggu?', answer: 'Buka jam 09.00 sampai 17.00' })).json().proposal;
  const dismissed = await call(agent, 'POST', `/v1/knowledge-proposals/${second.id}/dismiss`);
  assert.equal(dismissed.json().proposal.status, 'dismissed');
  assert.equal((await call(agent, 'GET', `/v1/chats/${CHAT}/knowledge-suggestions`)).json().proposals.length, 0);
});

test('usulan yang sudah ada di Fakta ditutup sendiri, tanpa mengganggu supervisor', { skip }, async (t) => {
  const { call, real, sup, agent, facts, ids } = await setup(t);
  await call(sup, 'PUT', '/v1/knowledge/settings', { enabled: true });
  facts.push({ category: 'faq', question: 'Apakah bisa COD ke Bekasi', answer: 'Bisa COD Jabodetabek, ongkir Rp 15.000' });
  const { proposal } = (await call(agent, 'POST', '/v1/knowledge-proposals', MANUAL)).json();
  const result = (await call(agent, 'POST', `/v1/knowledge-proposals/${proposal.id}/submit`)).json();
  assert.equal(result.outcome, 'duplicate');
  assert.equal(result.proposal.status, 'dismissed');
  assert.equal((await real.pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND kind = 'knowledge'", [ids.SUP_A.id])).rowCount, 0);
});

test('ringkasan chat menangkap usulan: label AI/CS, saringan di kode, satu chip per chat', { skip }, async (t) => {
  const { call, sup, agent, state } = await setup(t, {
    summaryKnowledge: [
      { q: 'Hubungi admin lewat nomor berapa?', a: 'Hubungi 081234567890 saja kak', c: 'nomor admin?' },
      { q: 'Terima kasih ya kak', a: 'Sama-sama kak, senang membantu' },
      { q: 'Apakah bisa COD ke Bekasi?', a: 'Bisa COD Jabodetabek, ongkir Rp 15.000', c: 'kak bisa cod ke bekasi?' },
      { q: 'Berapa minimal order grosir?', a: 'Minimal order grosir 10 pcs' },
    ],
  });

  // Saklar mati: ringkasan tidak memakai label baru dan tidak menangkap apa pun.
  assert.equal((await call(agent, 'GET', `/v1/chats/${encodeURIComponent(CHAT)}/summary`)).statusCode, 200);
  const offPrompt = state.prompts.find((p) => p.purpose === 'summary');
  assert.ok(!/Tim \(CS\)/.test(offPrompt.message) && !/knowledge/.test(offPrompt.systemPrompt));
  await call(sup, 'PUT', '/v1/knowledge/settings', { enabled: true });
  assert.equal((await call(agent, 'GET', `/v1/chats/${encodeURIComponent(CHAT)}/knowledge-suggestions`)).json().proposals.length, 0);

  // Saklar hidup: pesan baru membuat ringkasan dibuat ulang.
  await call(sup, 'POST', `/v1/chats/${encodeURIComponent(CHAT)}/messages`, { body: 'Ongkirnya Rp 15.000 kak, bisa COD Jabodetabek' }).catch(() => null);
  state.prompts.length = 0;
  const res = await call(agent, 'GET', `/v1/chats/${encodeURIComponent(CHAT)}/summary?locale=en`);
  assert.equal(res.statusCode, 200);
  assert.ok(!('knowledge' in res.json()), 'kolom knowledge tidak bocor ke layar');
  const summaryCall = state.prompts.find((p) => p.purpose === 'summary');
  assert.match(summaryCall.systemPrompt, /"knowledge"/);
  assert.match(summaryCall.message, /Team \(CS\)/, 'balasan CS berlabel sendiri');
  for (let i = 0; i < 40 && !(await call(agent, 'GET', `/v1/chats/${encodeURIComponent(CHAT)}/knowledge-suggestions`)).json().proposals.length; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const chips = (await call(agent, 'GET', `/v1/chats/${encodeURIComponent(CHAT)}/knowledge-suggestions`)).json().proposals;
  assert.equal(chips.length, 1, 'tepat satu chip');
  assert.equal(chips[0].question, 'Apakah bisa COD ke Bekasi?', 'nomor telepon dan basa-basi tersaring');
  assert.equal(chips[0].customerMessage, 'kak bisa cod ke bekasi?');
  assert.equal(chips[0].status, 'suggested');
});

test('kabar WhatsApp ke supervisor digabung: banyak usulan berdekatan, satu rangkuman', { skip }, async (t) => {
  const kp = require('../src/knowledge-proposals.js');
  const original = kp.DIGEST_DEBOUNCE_MS;
  kp.DIGEST_DEBOUNCE_MS = 150;
  t.after(() => { kp.DIGEST_DEBOUNCE_MS = original; });
  const { call, real, sup, agent, companyA } = await setup(t);
  await call(sup, 'PUT', '/v1/knowledge/settings', { enabled: true });
  for (const [chatId, question] of [['a@c.us', 'Berapa minimal order grosir?'], ['b@c.us', 'Apakah ada garansi barang?']]) {
    const { proposal } = (await call(agent, 'POST', '/v1/knowledge-proposals', { ...MANUAL, chatId, question, answer: 'Minimal 10 pcs, garansi 7 hari' })).json();
    assert.equal((await call(agent, 'POST', `/v1/knowledge-proposals/${proposal.id}/submit`)).statusCode, 200);
  }
  const pending = async () => (await real.pool.query(
    "SELECT COUNT(*)::int AS n FROM knowledge_proposals WHERE company_id = $1 AND status = 'submitted' AND wa_notified_at IS NULL", [companyA],
  )).rows[0].n;
  assert.equal(await pending(), 2);
  for (let i = 0; i < 200 && await pending() > 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(await pending(), 0, 'keduanya masuk satu rangkuman');
});
