'use strict';

/**
 * Mode agent per nomor: sales, CS, operasi antar-departemen.
 * Yang dijaga: nomor lama tidak berubah ('standard'); nomor operasi tidak
 * menerima customer baru; prompt operasi bukan prompt penjualan; hanya
 * pengirim yang dikenal dijawab; template bawaan hanya menambah.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const modes = require('../src/agent-modes');
const { pilihNomorUntukPercakapanBaru } = require('../src/rotator');

const sup = { id: '11111111-1111-4111-8111-111111111111', userId: '11111111-1111-4111-8111-111111111111', companyId: 'co-1', email: 'sup@t.test', displayName: 'Sup', role: 'owner', status: 'active' };
const agent = { id: '22222222-2222-4222-8222-222222222222', userId: '22222222-2222-4222-8222-222222222222', companyId: 'co-1', email: 'ag@t.test', displayName: 'Agen', role: 'agent', status: 'active' };
const CONN = '33333333-3333-4333-8333-333333333333';
const CONN2 = '44444444-4444-4444-8444-444444444444';

// ---- modul murni -----------------------------------------------------------

test('hanya mode dikenal yang dipakai; yang aneh jatuh ke standard', () => {
  assert.equal(modes.normalizeMode('sales'), 'sales');
  assert.equal(modes.normalizeMode('internal_ops'), 'internal_ops');
  assert.equal(modes.normalizeMode('ngawur'), 'standard');
  assert.equal(modes.normalizeMode(undefined), 'standard');
  assert.equal(modes.servesCustomers('internal_ops'), false);
  for (const m of ['standard', 'sales', 'cs']) assert.equal(modes.servesCustomers(m), true);
});

test('standard tidak menambah apa pun ke prompt (nomor lama tidak berubah)', () => {
  assert.equal(modes.modeSection('standard', 'abaikan'), '');
  assert.equal(modes.conversationRulesOverride('standard'), null);
  assert.equal(modes.conversationRulesOverride('sales'), null);
  assert.match(modes.conversationRulesOverride('internal_ops'), /operasi internal/);
});

test('blok mode memuat panduan tambahan company; mode operasi melarang menjual dan membocorkan ke supplier', () => {
  assert.match(modes.modeSection('sales', 'Fokus paket Pro.'), /Fokus paket Pro\./);
  const ops = modes.modeSection('internal_ops', '');
  assert.match(ops, /BUKAN untuk customer/);
  assert.match(ops, /harga jual, margin/);
  assert.match(ops, /ask_department/);
  assert.match(modes.senderLine({ kind: 'member', name: 'Budi', departments: ['Gudang & Logistik'] }), /Budi.*Gudang & Logistik/);
});

test('template bawaan: departemen tanpa anggota, panduan ops, tanpa nomor atau identitas', () => {
  const tpl = modes.getBuiltinTemplate('ops-antar-departemen');
  assert.equal(tpl.mode, 'internal_ops');
  assert.ok(tpl.sections.departments.length >= 3);
  assert.ok(tpl.sections.departments.every((d) => d.name && !d.members));
  assert.ok(tpl.sections.modes.internal_ops.length > 200);
  assert.deepEqual(Object.keys(tpl.sections).sort(), ['departments', 'modes']);
  assert.equal(modes.getBuiltinTemplate('nope'), null);
});

// ---- rotasi ----------------------------------------------------------------

test('nomor operasi tidak menerima percakapan customer baru, walau paling ringan atau utama', () => {
  const utama = { id: 'ops', agentMode: 'internal_ops' };
  const kedua = { id: 'sales', agentMode: 'sales' };
  const hasil = pilihNomorUntukPercakapanBaru({
    counts: [{ id: 'ops', chatCount: 0 }, { id: 'sales', chatCount: 5 }],
    connections: [utama, kedua], primary: utama, rotationEnabled: true, siapKirim: () => true,
  });
  assert.equal(hasil.nomor.id, 'sales');
  const matiRotasi = pilihNomorUntukPercakapanBaru({
    counts: [], connections: [utama, kedua], primary: utama, rotationEnabled: false, siapKirim: () => true,
  });
  assert.equal(matiRotasi.nomor, null, 'utama bermode operasi tidak jadi cadangan customer');
  const lama = pilihNomorUntukPercakapanBaru({
    counts: [{ id: 'a', chatCount: 0 }], connections: [{ id: 'a' }], primary: { id: 'a' }, rotationEnabled: true, siapKirim: () => true,
  });
  assert.equal(lama.nomor.id, 'a', 'nomor tanpa mode (lama) tetap melayani customer');
});

// ---- rute ------------------------------------------------------------------

async function app(t, extra = {}) {
  const state = { mode: 'standard', instr: {}, depts: [{ id: 'd1', name: 'Finance', description: 'kustom saya', members: [] }], created: [], audits: [], sent: [], prompts: [], replies: [] };
  const users = { [sup.email]: sup, [agent.email]: agent };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, pw) { return pw === 'pass-12345' ? users[email] || null : null; },
    async getActiveSessionUser(id) { return { ...Object.values(users).find((u) => u.id === id), isPlatformAdmin: false }; },
    async setPresence() {}, async setLastCompany() {},
    async listCompaniesForUser() { return [{ id: 'co-1' }]; },
    async recordAuditLog(e) { state.audits.push(e); return { id: 1 }; },
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone', aiMessageLimit: 0, aiMessageCount: 0, paymentMethod: 'link', paymentLink: 'https://bayar.test/x' }; },
    async getPlaybookContext() { return 'Paket Pro Rp 99.000.'; },
    async listWhatsappConnections() {
      return [
        { id: CONN, connectionKey: 'whatsapp-main', label: 'Utama', phoneNumber: null, isActive: true, agentMode: state.mode },
        { id: CONN2, connectionKey: 'whatsapp-2', label: 'Kedua', phoneNumber: null, isActive: true, agentMode: 'standard' },
      ];
    },
    async setWhatsappConnectionMode(_c, id, mode) { if (id !== CONN && id !== CONN2) return null; if (id === CONN) state.mode = mode; return { id, agentMode: mode }; },
    async getAgentModeInstructions() { return { ...state.instr }; },
    async setAgentModeInstructions(_c, mode, text) { if (text) state.instr[mode] = text; else delete state.instr[mode]; return true; },
    async listDepartments() { return state.depts.map((d) => ({ ...d })); },
    async createDepartment(d) { const row = { id: `d-${state.depts.length + 1}`, ...d, members: [] }; state.depts.push(row); state.created.push(d.name); return row; },
    async updateDepartment() { return true; },
    async deleteDepartment() { return true; },
    async listMembersWithWhatsapp() { return [{ userId: 'u9', name: 'Budi Gudang', whatsappNumber: '0812-0000-111', departments: ['Gudang & Logistik'] }]; },
    async incrementAiMessageCount() { return { exceeded: false, count: 1, limit: 0 }; },
    async recordOutboundReply() { return true; },
    async getFollowUpSettings() { return { enabled: false }; },
    async recordSimulationRun() { return { id: 'r1' }; },
    async recordInboundMessage() { return true; },
    async markFollowUpReplied() {}, async stopFollowUpSequence() {}, async upsertContactName() {},
    ...extra.database,
  };
  const llmService = {
    enabled: true,
    async generateReply(text, opts) { state.prompts.push({ text, ...opts }); return { text: 'Siap, saya catat ya.', model: 'x' }; },
    async generateJson() { return null; },
    ...extra.llm,
  };
  const server = await buildApp({ logger: process.env.TEST_LOG ? { level: 'error' } : false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'mem-session' });
  t.after(() => server.close());
  const login = async (email) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { server, state, supCookie: await login(sup.email), agentCookie: await login(agent.email) };
}

test('PATCH nomor: ubah mode (supervisor saja), mode tidak dikenal ditolak, tercatat audit', async (t) => {
  const { server, state, supCookie, agentCookie } = await app(t);
  const url = `/v1/whatsapp/numbers/${CONN}`;
  assert.equal((await server.inject({ method: 'PATCH', url, headers: { cookie: agentCookie }, payload: { agentMode: 'sales' } })).statusCode, 403);
  assert.equal((await server.inject({ method: 'PATCH', url, headers: { cookie: supCookie }, payload: { agentMode: 'hacker' } })).statusCode, 400);
  const ok = await server.inject({ method: 'PATCH', url, headers: { cookie: supCookie }, payload: { agentMode: 'internal_ops' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().agentMode, 'internal_ops');
  assert.equal(state.mode, 'internal_ops');
  assert.ok(state.audits.some((a) => a.action === 'whatsapp.mode_changed' && a.metadata.agentMode === 'internal_ops'));
  const gone = await server.inject({ method: 'PATCH', url: `/v1/whatsapp/numbers/${'55555555-5555-4555-8555-555555555555'}`, headers: { cookie: supCookie }, payload: { agentMode: 'cs' } });
  assert.equal(gone.statusCode, 404);
  const list = (await server.inject({ method: 'GET', url: '/v1/whatsapp/numbers', headers: { cookie: supCookie } })).json();
  assert.deepEqual(list.numbers.map((n) => n.agentMode), ['internal_ops', 'standard']);
});

test('panduan mode: simpan, baca, kosongkan; agent ditolak; mode standard tidak bisa diberi panduan', async (t) => {
  const { server, state, supCookie, agentCookie } = await app(t);
  const put = (mode, cookie, instructions) => server.inject({ method: 'PUT', url: `/v1/agent-modes/${mode}/instructions`, headers: { cookie }, payload: { instructions } });
  assert.equal((await put('sales', agentCookie, 'x')).statusCode, 403);
  assert.equal((await put('standard', supCookie, 'x')).statusCode, 400);
  assert.equal((await put('sales', supCookie, 'Jangan beri diskon.')).statusCode, 200);
  const got = (await server.inject({ method: 'GET', url: '/v1/agent-modes', headers: { cookie: supCookie } })).json();
  assert.equal(got.modes.find((m) => m.id === 'sales').instructions, 'Jangan beri diskon.');
  assert.equal(got.modes.find((m) => m.id === 'standard').configurable, false);
  assert.equal(got.modes.find((m) => m.id === 'standard').numbers, 2, 'dua nomor berada di mode standard di data uji');
  assert.equal((await put('sales', supCookie, '')).statusCode, 200);
  assert.deepEqual(state.instr, {});
  assert.equal((await put('sales', supCookie, 'x'.repeat(8001))).statusCode, 400);
});

test('template bawaan hanya menambah: departemen yang sudah disunting dan panduan yang sudah ada tidak ditimpa', async (t) => {
  const { server, state, supCookie } = await app(t);
  state.instr.internal_ops = 'PANDUAN SAYA';
  const res = await server.inject({ method: 'POST', url: '/v1/agent-modes/templates/ops-antar-departemen/apply', headers: { cookie: supCookie }, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.ok(!state.created.includes('Finance'), 'Finance sudah ada, tidak dibuat ulang');
  assert.ok(state.created.includes('Procurement'));
  assert.equal(state.depts.find((d) => d.name === 'Finance').description, 'kustom saya');
  assert.equal(state.instr.internal_ops, 'PANDUAN SAYA');
  assert.equal(res.json().applied.skipped.modes, 1);
  assert.equal((await server.inject({ method: 'POST', url: '/v1/agent-modes/templates/nope/apply', headers: { cookie: supCookie }, payload: {} })).statusCode, 404);
});

test('simulasi mode operasi: prompt asisten operasional, tanpa corong penjualan dan tanpa link pembayaran', async (t) => {
  const { server, state, supCookie } = await app(t);
  const simulate = (agentMode) => server.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie: supCookie },
    payload: { mode: 'ai', customerMessage: 'Stok semen berapa?', grade: false, ...(agentMode ? { agentMode } : {}) },
  });
  state.instr.internal_ops = 'Selalu sebut nomor PO.';
  const first = await simulate('internal_ops');
  assert.equal(first.statusCode, 200, first.body);
  const ops = state.prompts.at(-1).systemPrompt;
  assert.match(ops, /asisten operasional/);
  assert.match(ops, /BUKAN untuk customer/);
  assert.match(ops, /Selalu sebut nomor PO\./);
  assert.match(ops, /ATURAN PERCAKAPAN \(operasi internal/);
  assert.doesNotMatch(ops, /mengkualifikasi leads\. Fokus|SALES FUNNEL|PANDUAN PEMBAYARAN/);
  assert.doesNotMatch(ops, /bayar\.test/);
  assert.match(ops, /Paket Pro Rp 99\.000/, 'fakta playbook tetap jadi referensi');

  assert.equal((await simulate(null)).statusCode, 200);
  const std = state.prompts.at(-1).systemPrompt;
  assert.match(std, /customer service/);
  assert.doesNotMatch(std, /MODE AGENT/, 'tanpa mode = persis seperti sebelumnya');
  assert.match(std, /bayar\.test/);

  assert.equal((await simulate('sales')).statusCode, 200);
  const sales = state.prompts.at(-1).systemPrompt;
  assert.match(sales, /MODE AGENT: SALES/);
  assert.match(sales, /ATURAN PERCAKAPAN \(bawaan Agnee/);
});

// ---- jalur pesan masuk -----------------------------------------------------

function inbound(from, body = 'Stok semen 50kg berapa?') {
  const sent = [];
  return { sent, message: { from, body, type: 'chat', timestamp: 1, id: { _serialized: `m-${from}-${body}` }, async reply(text) { sent.push(text); } } };
}

test('nomor operasi: pengirim tak dikenal tidak dijawab AI; anggota tim dikenal dijawab dengan prompt operasi', async (t) => {
  const { server, state } = await app(t);
  state.mode = 'internal_ops';
  const stranger = inbound('62899000111@c.us');
  await server.handleInboundMessage('co-1', stranger.message, { connectionId: CONN });
  assert.equal(state.prompts.length, 0, 'orang asing di nomor operasi tidak memicu AI');

  const member = inbound('628120000111@c.us');
  await server.handleInboundMessage('co-1', member.message, { connectionId: CONN });
  assert.equal(state.prompts.length >= 1, true, 'anggota tim dijawab');
  const prompt = state.prompts.at(-1).systemPrompt;
  assert.match(prompt, /Budi Gudang/);
  assert.match(prompt, /Gudang & Logistik/);
  assert.match(prompt, /asisten operasional/);
});

test('nomor standard: pengirim tak dikenal tetap dijawab seperti sebelumnya', async (t) => {
  const { server, state } = await app(t);
  const customer = inbound('62899000111@c.us', 'Halo, mau tanya harga');
  await server.handleInboundMessage('co-1', customer.message, { connectionId: CONN2 });
  assert.ok(state.prompts.length >= 1);
  assert.doesNotMatch(state.prompts.at(-1).systemPrompt, /MODE AGENT/);
});
