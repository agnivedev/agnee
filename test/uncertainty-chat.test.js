'use strict';

/**
 * "Kalau tidak yakin, jangan menebak" dari ujung ke ujung: customer menulis
 * (handleInboundMessage) -> model tiruan menjawab dengan tebakan -> kontrak +
 * penjaga mengubahnya -> departemen ditanya / customer ditanya balik / staf
 * diberi tahu. Simulator (/v1/coach/simulate) memakai penilaian yang sama
 * tetapi tidak menjalankan tindakannya.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const sup = { id: '11111111-1111-4111-8111-111111111111', userId: '11111111-1111-4111-8111-111111111111', companyId: 'co-1', email: 'sup@t.test', displayName: 'Sup', role: 'owner', status: 'active' };
const CHAT = '628111222333@c.us';
const PLAYBOOK = 'Toko bahan bangunan ESBEJE. MU 480 Rp 313.000 per sak.';

const DEPTS = {
  both: [
    { id: 'd1', name: 'Management', description: 'x', whatsappGroupId: '120363000000000001@g.us', members: [] },
    { id: 'd2', name: 'Finance', description: 'x', whatsappGroupId: '120363000000000002@g.us', members: [] },
  ],
  none: [],
};

async function harness(t, { departments = DEPTS.both, mode = 'on', script, addressFound = false } = {}) {
  const state = { questions: [], events: [], cards: [], routing: [], prompts: [] };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, pw) { return pw === 'pass-12345' && email === sup.email ? sup : null; },
    async getActiveSessionUser(id) { return id === sup.id ? { ...sup, isPlatformAdmin: false } : null; },
    async setPresence() {}, async setLastCompany() {},
    async listCompaniesForUser() { return [{ id: 'co-1' }]; },
    async recordAuditLog() { return { id: 1 }; },
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone', aiMessageLimit: 0, aiMessageCount: 0, timezone: 'Asia/Jakarta' }; },
    async getPlaybookContext() { return PLAYBOOK; },
    async listDepartments() { return departments.map((d) => ({ ...d })); },
    async listTeamMembers() { return [{ id: sup.id, role: 'owner', status: 'active', displayName: 'Sup' }]; },
    async saveConversationRouting(change) { state.routing.push(change); return { ...change }; },
    async createDepartmentQuestion(q) {
      const dept = departments.find((d) => d.id === q.departmentId);
      const row = { id: `a1b2c3d4-0000-4000-8000-00000000000${state.questions.length + 1}`, ...q, department: dept?.name, status: 'open' };
      state.questions.push(row);
      return { id: row.id, department: dept?.name, whatsappGroupId: dept?.whatsappGroupId, members: [] };
    },
    async listDepartmentQuestions() { return state.questions.filter((q) => q.status === 'open').map((q) => ({ ...q, chatId: q.chatId })); },
    async addDepartmentQuestionGroupMessage() {},
    async getUncertaintyGuard() { return mode; },
    async recordUncertaintyEvent(e) { state.events.push(e); return { id: state.events.length }; },
    async listUncertaintyEvents() { return state.events; },
    async addConversationNote(note) { state.cards.push(note); return note; },
    async incrementAiMessageCount() { return { exceeded: false, count: 1, limit: 0 }; },
    async recordOutboundReply() { return true; },
    async getFollowUpSettings() { return { enabled: false }; },
    async recordSimulationRun() { return { id: 'r1' }; },
    async recordInboundMessage() { return true; },
    async markFollowUpReplied() {}, async stopFollowUpSequence() {}, async upsertContactName() {},
    async listCatalogForAi() { return { enabled: false, items: [], tags: [], syncedAt: null }; },
    async getHandoffNotifyNumbers() { return []; },
    async getReplyDelaySettings() { return { replyDelayEnabled: false }; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const llmService = {
    enabled: true,
    async generateReply(text, opts) {
      state.prompts.push({ text, ...opts });
      const out = script ? await script(text, opts, state) : 'Siap kak.';
      return { text: out, model: 'tiruan', usage: {} };
    },
    async generateJson() { return null; },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('nominatim.openstreetmap.org') || String(url).includes('serper')) {
      return new Response(JSON.stringify(addressFound ? [{ lat: '-6.2', lon: '106.6', display_name: 'Jalan Merdeka, Kota X' }] : []), { status: 200 });
    }
    return realFetch(url, init);
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'unsure-session' });
  t.after(async () => { globalThis.fetch = realFetch; await server.close(); });
  const login = (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: sup.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  const customer = (body) => {
    const sent = [];
    return { sent, message: { from: CHAT, body, type: 'chat', timestamp: 1, id: { _serialized: `m-${body}` }, async reply(text) { sent.push(text); } } };
  };
  const chat = async (body) => {
    const c = customer(body);
    await server.handleInboundMessage('co-1', c.message, { connectionId: '33333333-3333-4333-8333-333333333333' });
    return c.sent.join('\n');
  };
  const simulate = (customerMessage) => server.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie: login }, payload: { mode: 'ai', grade: false, customerMessage },
  });
  return { server, state, chat, simulate, login };
}

const INTERNAL = /Management|Finance|ask_department|cek_harga|cek_ongkir|cek_alamat|belum diisi|tidak ada di (?:prompt|katalog)|playbook/i;

test('ESBEJE: barang tak ada di katalog, model mengarang harga -> tidak menebak, tanya Management', async (t) => {
  const { state, chat } = await harness(t, { script: async () => 'Untuk dinding retak pakai MU 100 Base Plester seharga Rp 75.000 per sak ya Kak.' });
  const reply = await chat('dinding saya retak perlu diperbaiki, pakai apa dan berapa?');
  assert.doesNotMatch(reply, /75\.000/);
  assert.match(reply, /belum bisa memastikan/);
  assert.match(reply, /tim kami/);
  assert.doesNotMatch(reply, INTERNAL);
  assert.equal(state.questions.length, 1);
  assert.equal(state.questions[0].departmentId, 'd1', 'harga/produk -> Management');
  assert.match(state.questions[0].question, /AI tidak punya datanya/);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].topic, 'harga');
  assert.equal(state.events[0].action, 'ask_department');
  assert.equal(state.events[0].department, 'Management');
  assert.ok(state.events[0].reasons.some((r) => r.code === 'invented_price'));
});

test('customer klaim sudah transfer, model mengiyakan -> Finance ditanya, tidak ada "sudah diterima"', async (t) => {
  const { state, chat } = await harness(t, { script: async () => 'Terima kasih Kak, pembayaran sudah kami terima. Pesanan segera diproses.' });
  const reply = await chat('sudah saya transfer ya kak 1,5jt');
  assert.doesNotMatch(reply, /sudah kami terima/);
  assert.match(reply, /transferannya saya belum bisa memastikan/);
  assert.equal(state.questions.length, 1);
  assert.equal(state.questions[0].departmentId, 'd2', 'transferan -> Finance');
  assert.match(state.questions[0].question, /sudah membayar/);
  assert.equal(state.events[0].topic, 'transfer');
  assert.doesNotMatch(reply, INTERNAL);
});

test('tanya stok tanpa data stok, model bilang ready -> tidak menebak, tanya departemen', async (t) => {
  const { state, chat } = await harness(t, { script: async () => 'Halo Kak! Stok MU 480 ready ya, silakan order.' });
  const reply = await chat('MU 480 masih ready gak kak?');
  assert.match(reply, /^Halo Kak!/, 'sapaan yang sah dipertahankan');
  assert.doesNotMatch(reply, /ready ya/);
  assert.match(reply, /stoknya saya belum bisa memastikan/);
  assert.equal(state.questions.length, 1);
  assert.equal(state.events[0].topic, 'stok');
});

test('ongkir dengan alamat yang tak terbaca: AI bertanya balik ke customer, tidak menanyakan departemen', async (t) => {
  const { state, chat } = await harness(t, {
    script: async (text, opts) => {
      const tool = (opts.tools || []).find((x) => x.name === 'cek_alamat');
      if (tool) await tool.run({ alamat: 'Jl Merdeka' });
      return 'Siap Kak, ongkirnya segera saya hitung.';
    },
  });
  const reply = await chat('ongkir ke Jl Merdeka berapa?');
  assert.match(reply, /belum bisa memastikan angkanya/);
  assert.match(reply, /lokasi atau alamat lengkap/);
  assert.equal(state.questions.length, 0);
  assert.equal(state.events[0].action, 'ask_customer');
  assert.equal(state.events[0].topic, 'ongkir');
});

test('tanpa departemen: staf diberi kartu serah-terima dan AI tetap membalas', async (t) => {
  const { state, chat } = await harness(t, { departments: DEPTS.none, script: async () => 'Stok MU 480 ready Kak.' });
  const reply = await chat('MU 480 ready gak?');
  assert.match(reply, /Saya teruskan ke tim kami untuk memastikannya/);
  assert.equal(state.events[0].action, 'notify_staff');
  assert.equal(state.routing.length, 0, 'chat tidak diserahkan di mode "on"');
});

test('mode handoff tanpa departemen: chat diserahkan ke manusia', async (t) => {
  const { state, chat } = await harness(t, { departments: DEPTS.none, mode: 'handoff', script: async () => 'Stok MU 480 ready Kak.' });
  const reply = await chat('MU 480 ready gak?');
  assert.match(reply, /Saya teruskan percakapan ini ke tim kami/);
  assert.equal(state.routing.length, 1);
  assert.equal(state.routing[0].mode, 'human');
  assert.equal(state.events[0].action, 'handoff');
});

test('mode off: balasan model lewat apa adanya', async (t) => {
  const { state, chat } = await harness(t, { mode: 'off', script: async () => 'Stok MU 480 ready Kak.' });
  assert.equal(await chat('MU 480 ready gak?'), 'Stok MU 480 ready Kak.');
  assert.equal(state.questions.length, 0);
  assert.equal(state.events.length, 0);
});

test('topik santai dan harga yang punya sumber tidak ikut diblokir', async (t) => {
  const { state, chat } = await harness(t, {
    script: async (text) => (/halo/i.test(text) ? 'Halo Kak! Ada yang bisa saya bantu?' : 'MU 480 Rp 313.000 per sak, Kak. Butuh berapa sak?'),
  });
  assert.equal(await chat('halo kak'), 'Halo Kak! Ada yang bisa saya bantu?');
  assert.equal(await chat('harga MU 480 berapa?'), 'MU 480 Rp 313.000 per sak, Kak. Butuh berapa sak?');
  assert.equal(state.questions.length, 0);
  assert.equal(state.events.length, 0);
});

test('simulator sejalur: balasan yang sama + alasan, tanpa membangunkan departemen atau mencatat jejak', async (t) => {
  const { state, simulate } = await harness(t, { script: async () => 'Stok MU 480 ready Kak.' });
  const res = await simulate('MU 480 ready gak?');
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.match(body.reply, /stoknya saya belum bisa memastikan/);
  assert.equal(body.uncertainty.topic, 'stok');
  assert.equal(body.uncertainty.action, 'ask_department');
  assert.equal(body.uncertainty.department, 'Management');
  assert.equal(body.uncertainty.dryRun, true);
  assert.ok(body.uncertainty.reasons.some((r) => r.code === 'stock_claim' && r.label));
  assert.equal(state.questions.length, 0, 'simulator tidak bertanya ke departemen sungguhan');
  assert.equal(state.events.length, 0);

  const casual = await simulate('halo kak');
  assert.equal(casual.json().uncertainty, null);
});

test('pengaturan: supervisor mengubah mode dan membaca jejak', async (t) => {
  const { server, login } = await harness(t);
  const get = await server.inject({ method: 'GET', url: '/v1/ai-uncertainty/settings', headers: { cookie: login } });
  assert.equal(get.json().mode, 'on');
  const bad = await server.inject({ method: 'PUT', url: '/v1/ai-uncertainty/settings', headers: { cookie: login }, payload: { mode: 'sembarang' } });
  assert.equal(bad.statusCode, 400);
  const events = await server.inject({ method: 'GET', url: '/v1/ai-uncertainty/events', headers: { cookie: login } });
  assert.equal(events.statusCode, 200);
});
