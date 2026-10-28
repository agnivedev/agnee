'use strict';

/**
 * Ongkir Lalamove dengan kendaraan ditentukan Management.
 *
 * Alurnya diuji dari ujung ke ujung seperti produksi: customer minta ongkir
 * (handleInboundMessage) -> AI memanggil cek_ongkir -> pertanyaan kendaraan ke
 * Management dengan daftar kendaraan -> jawaban Management (rute web yang sama
 * dengan jawaban dari grup) -> kendaraan dibaca, ongkir dihitung ke Lalamove
 * -> hasilnya disusun untuk customer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const departmentAsk = require('../src/department-ask');

const sup = { id: '11111111-1111-4111-8111-111111111111', userId: '11111111-1111-4111-8111-111111111111', companyId: 'co-1', email: 'sup@t.test', displayName: 'Sup', role: 'owner', status: 'active' };
const CHAT = '628111222333@c.us';
const DEPT = '55555555-5555-4555-8555-555555555555';
const GROUP = '120363000000000001@g.us';

const svc = (key, load) => ({ key, description: `kendaraan ${key}`, load: { value: String(load), unit: 'kg' } });
const CITIES = [{ locode: 'ID JKT', name: 'Jakarta', services: [
  svc('MOTORCYCLE', 20), svc('MPV', 200), svc('VAN', 600), svc('PICK_UP_TRUCK', 800), svc('ENGKELBOX', 2000), svc('ENGKELBAK', 2500), svc('CDDBOX', 5000), svc('FUSO_BOX', 8000), svc('CDDBAK_INTERCITY', 5000),
] }];
// PICK_UP_TRUCK sengaja tanpa harga: Lalamove menjawab "di luar area layanan" (seperti sandbox ESBEJE).
const PRICE = { MOTORCYCLE: 26500, MPV: 49300, VAN: 65000, ENGKELBOX: 120000, ENGKELBAK: 125000, CDDBOX: 250000, FUSO_BOX: 400000 };
const STORE = { id: '1', name: 'Cisauk Store', kind: 'store', address: 'Cisauk', lat: -6.34, lng: 106.637, openToCustomers: true, isPickup: true, openingHours: null };

async function harness(t, { environment = 'production', vehicleMode = 'management', management = true, llmScript } = {}) {
  const state = {
    questions: [], notified: [], reopened: [], payloads: [], quotes: [], prompts: [], replies: [], audits: [],
    conn: {
      companyId: 'co-1', environment, market: 'ID', apiKey: 'pk_prod_x', apiSecret: 'sk_prod_x', enabled: true, cities: CITIES,
      pickupLocationId: '1', pickupName: 'Cisauk Store', pickupAddress: 'Cisauk', pickupLat: -6.34, pickupLng: 106.637,
      defaultService: 'MOTORCYCLE', aiQuotesEnabled: true, vehicleMode,
    },
  };
  const departments = management
    ? [{ id: DEPT, name: 'Management', description: 'x', whatsappGroupId: GROUP, members: [] }]
    : [{ id: 'd2', name: 'Finance', description: 'x', members: [{ userId: 'u1', displayName: 'Fin', whatsappNumber: '0812' }] }];
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, pw) { return pw === 'pass-12345' && email === sup.email ? sup : null; },
    async getActiveSessionUser(id) { return id === sup.id ? { ...sup, isPlatformAdmin: false } : null; },
    async setPresence() {}, async setLastCompany() {},
    async listCompaniesForUser() { return [{ id: 'co-1' }]; },
    async recordAuditLog(e) { state.audits.push(e); return { id: 1 }; },
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone', aiMessageLimit: 0, aiMessageCount: 0, timezone: 'Asia/Jakarta' }; },
    async getPlaybookContext() { return 'Paket kirim: semen sak 40 kg.'; },
    async getLalamoveConnection() { return { ...state.conn }; },
    async listCompanyLocations() { return [STORE]; },
    async listPromoRules() { return []; },
    async listDepartments() { return departments.map((d) => ({ ...d })); },
    async createDepartmentQuestion(q) {
      const row = { id: `a1b2c3d4-0000-4000-8000-00000000000${state.questions.length + 1}`, ...q, status: 'open' };
      state.questions.push(row);
      return { id: row.id, department: 'Management', whatsappGroupId: GROUP, members: [] };
    },
    async listDepartmentQuestions(_c, { status }) {
      return state.questions.filter((q) => q.status === status).map((q) => ({ id: q.id, chatId: q.chatId, customerText: q.customerText, question: q.question, departmentId: q.departmentId, department: 'Management' }));
    },
    async latestVehicleQuestion(_c, chatId) {
      const rows = state.questions.filter((q) => q.kind === 'lalamove_vehicle' && q.chatId === chatId);
      const q = rows[rows.length - 1];
      return q ? { id: q.id, status: q.status, answer: q.answer, payload: q.payload } : null;
    },
    async answerDepartmentQuestion(id, { answer }) {
      const q = state.questions.find((x) => x.id === id && x.status === 'open');
      if (!q) return null;
      q.status = 'answered'; q.answer = answer;
      return { id: q.id, chatId: q.chatId, customerText: q.customerText, question: q.question, answer, kind: q.kind, payload: q.payload };
    },
    async reopenDepartmentQuestion(id) { const q = state.questions.find((x) => x.id === id); if (q) { q.status = 'open'; q.answer = null; } state.reopened.push(id); return true; },
    async setDepartmentQuestionPayload(id, payload) { const q = state.questions.find((x) => x.id === id); if (q) q.payload = payload; state.payloads.push(payload); return true; },
    async addDepartmentQuestionGroupMessage() {},
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
      const out = llmScript ? await llmScript(text, opts, state) : 'Siap kak.';
      return { text: out, model: 'tiruan', usage: {} };
    },
    async generateJson() { return null; },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('lalamove.com/v3/quotations')) {
      const body = JSON.parse(init.body).data;
      state.quotes.push({ serviceType: body.serviceType, stops: body.stops });
      const total = PRICE[body.serviceType];
      if (!total) return new Response(JSON.stringify({ errors: [{ id: 'ERR_OUT_OF_SERVICE_AREA', message: 'out of service area' }] }), { status: 400 });
      return new Response(JSON.stringify({ data: { quotationId: 'q1', priceBreakdown: { total: String(total), currency: 'IDR' }, distance: { value: '14400' } } }), { status: 201 });
    }
    if (String(url).includes('nominatim.openstreetmap.org/search')) {
      return new Response(JSON.stringify([{ lat: '-6.2595', lon: '106.6358', display_name: 'Jalan Topaz Timur 5, Summarecon Serpong, Kelapa Dua' }]), { status: 200 });
    }
    return realFetch(url, init);
  };
  const server = await buildApp({ logger: process.env.TEST_LOG ? { level: 'error' } : false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'veh-session' });
  t.after(async () => { globalThis.fetch = realFetch; await server.close(); });
  const login = (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: sup.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  const customer = (body) => {
    const sent = [];
    return { sent, message: { from: CHAT, body, type: 'chat', timestamp: 1, id: { _serialized: `m-${body}` }, async reply(text) { sent.push(text); } } };
  };
  const answer = (id, text) => server.inject({ method: 'POST', url: `/v1/department-questions/${id}/answer`, headers: { cookie: login }, payload: { answer: text } });
  return { server, state, customer, answer, cookie: login };
}

const ASK_TOOL_ARGS = { tujuan: 'Gading Serpong Topaz Timur II', barang: '10 sak MU 301 Plasterplus 40KG' };

/** Model tiruan: memanggil cek_ongkir seperti yang diminta panduan, lalu menulis balasan dari hasilnya. */
const callTool = async (text, opts, state) => {
  const tool = (opts.tools || []).find((x) => x.name === 'cek_ongkir');
  if (!tool || !/ongkir/i.test(text)) return 'Siap kak.';
  const out = await tool.run(ASK_TOOL_ARGS);
  state.toolResult = out;
  return out.status === 'menunggu_management' ? 'Ongkirnya saya pastikan dulu ya kak, nanti saya kabari.' : `Estimasi ongkir ${out.ongkir}.`;
};

test('alat: mode Management menghapus kendaraan dari skema, meminta barang, dan panduan menyuruh AI tidak memilih', async (t) => {
  const { server, state, customer } = await harness(t, { llmScript: callTool });
  const c = customer('ongkir ke gading serpong berapa?');
  await server.handleInboundMessage('co-1', c.message, { connectionId: '33333333-3333-4333-8333-333333333333' });
  const call = state.prompts.find((p) => (p.tools || []).some((x) => x.name === 'cek_ongkir'));
  assert.ok(call, 'alat cek_ongkir tersedia di chat nyata');
  const spec = call.tools.find((x) => x.name === 'cek_ongkir');
  assert.equal(spec.parameters.properties.kendaraan, undefined, 'AI tidak memilih kendaraan');
  assert.ok(spec.parameters.properties.barang);
  assert.deepEqual(spec.parameters.required, ['tujuan', 'barang']);
  assert.match(call.systemPrompt, /kendaraan ditentukan Management/);
  assert.match(call.systemPrompt, /Kamu TIDAK memilih kendaraan/);
});

test('alur lengkap: tanya Management, jawaban "engkel box", ongkir dihitung dan disusun untuk customer', async (t) => {
  const { server, state, customer, answer } = await harness(t, { llmScript: callTool });
  const c = customer('ongkir ke gading serpong topaz timur ii berapa?');
  await server.handleInboundMessage('co-1', c.message, { connectionId: '33333333-3333-4333-8333-333333333333' });

  // 1. Pertanyaan ke Management, dengan daftar kendaraan dari Lalamove.
  assert.equal(state.questions.length, 1);
  const q = state.questions[0];
  assert.equal(q.kind, 'lalamove_vehicle');
  assert.equal(q.chatId, CHAT);
  assert.match(q.question, /Ongkir Lalamove\. Kirim ke: Jalan Topaz Timur 5.*perkiraan area/);
  assert.match(q.question, /Barang: 10 sak MU 301 Plasterplus 40KG/);
  assert.match(q.question, /Motor \(20 kg\).*Engkel box \(2 ton\).*Fuso box \(8 ton\)/);
  assert.doesNotMatch(q.question, /INTERCITY|CDD bak/i, 'kendaraan antar-kota dan yang tak ditawarkan tidak ikut');
  assert.equal(q.payload.args.tujuan, ASK_TOOL_ARGS.tujuan);
  assert.equal(state.quotes.length, 0, 'belum ada hitungan ongkir sebelum Management menjawab');

  // 2. Customer diberi tahu menunggu, tanpa angka.
  assert.equal(state.toolResult.status, 'menunggu_management');
  const reply = c.sent.join(' ');
  assert.match(reply, /pastikan|kabari/i);
  assert.doesNotMatch(reply, /Rp\s?\d/);

  // 3. Chat yang sama bertanya lagi sambil menunggu: tidak menanyakan dua kali.
  const again = customer('jadi ongkirnya berapa?');
  await server.handleInboundMessage('co-1', again.message, { connectionId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(state.questions.length, 1, 'satu pertanyaan terbuka per chat');
  assert.equal(state.toolResult.status, 'menunggu_management');

  // 4. Management menjawab: kendaraan dibaca, ongkir dihitung ke Lalamove dari toko ke tujuan.
  state.prompts.length = 0;
  const res = await answer(q.id, `#${departmentAsk.questionCode(q.id)} engkel box ya`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(state.quotes.length, 1);
  assert.equal(state.quotes[0].serviceType, 'ENGKELBOX');
  assert.equal(state.quotes[0].stops[0].coordinates.lat, '-6.34', 'dari titik jemput toko');
  assert.equal(state.quotes[0].stops[1].coordinates.lat, '-6.2595', 'ke alamat customer');
  assert.deepEqual(state.payloads.at(-1).chosen, { key: 'ENGKELBOX', count: 1, label: 'Engkel box' });
  assert.equal(state.payloads.at(-1).quote.ongkir_angka, 120000);

  // 5. Yang disusun untuk customer memuat kendaraan dan ongkir hasil hitungan, bukan teks mentah Management.
  const relay = state.prompts.find((p) => /Hasil yang sudah dipastikan/.test(p.text));
  assert.ok(relay, 'jawaban disusun menjadi balasan customer');
  assert.match(relay.text, /Pengiriman memakai Engkel box\. Estimasi ongkir Rp 120\.000, jarak sekitar 14\.4 km, ke Jalan Topaz Timur 5/);
  assert.match(relay.text, /perkiraan ke area tersebut/);
  assert.doesNotMatch(relay.text, /engkel box ya/);

  // 6. Hitungan berikutnya di chat ini memakai kendaraan yang sama, tanpa bertanya lagi.
  state.quotes.length = 0;
  const follow = customer('ongkirnya berapa tadi?');
  await server.handleInboundMessage('co-1', follow.message, { connectionId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(state.questions.length, 1);
  assert.equal(state.quotes[0].serviceType, 'ENGKELBOX');
  assert.equal(state.toolResult.status, 'ok');
  assert.equal(state.toolResult.ongkir, 'Rp 120.000');
});

test('jawaban "2 motor" mengalikan ongkir, dan jawaban yang tak dikenali dibuka lagi dengan petunjuk', async (t) => {
  const { server, state, customer, answer } = await harness(t, { llmScript: callTool });
  await server.handleInboundMessage('co-1', customer('ongkir berapa?').message, { connectionId: '33333333-3333-4333-8333-333333333333' });
  const q = state.questions[0];

  // Container tidak ada di Lalamove: dibuka lagi, staf diberi pilihan, tidak ada ongkir.
  const bad = await answer(q.id, 'pakai container aja');
  assert.equal(bad.statusCode, 200);
  assert.equal(bad.json().reason, 'vehicle_tidak_tersedia');
  assert.deepEqual(state.reopened, [q.id]);
  assert.equal(state.quotes.length, 0);
  assert.equal(state.questions[0].status, 'open');

  state.prompts.length = 0;
  const ok = await answer(q.id, '2 motor');
  assert.equal(ok.statusCode, 200);
  assert.equal(state.quotes[0].serviceType, 'MOTORCYCLE');
  assert.deepEqual(state.payloads.at(-1).chosen, { key: 'MOTORCYCLE', count: 2, label: 'Motor' });
  const relay = state.prompts.find((p) => /Hasil yang sudah dipastikan/.test(p.text));
  assert.match(relay.text, /Pengiriman memakai Motor \(2 unit\)\. Estimasi ongkir Rp 53\.000/);
});

test('kendaraan tidak tersedia di area: dicatat, tidak ada balasan ongkir, CS yang menindaklanjuti', async (t) => {
  const { server, state, customer, answer } = await harness(t, { llmScript: callTool });
  await server.handleInboundMessage('co-1', customer('ongkir berapa?').message, { connectionId: '33333333-3333-4333-8333-333333333333' });
  state.prompts.length = 0;
  const res = await answer(state.questions[0].id, 'pick up');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().reason, 'quote_failed');
  assert.equal(state.prompts.filter((p) => /Hasil yang sudah dipastikan/.test(p.text)).length, 0, 'tidak menyusun balasan tanpa angka');
});

test('tanpa departemen Management yang bisa dihubungi: tidak menggantung, memakai kendaraan bawaan', async (t) => {
  const { server, state, customer } = await harness(t, { management: false, llmScript: callTool });
  await server.handleInboundMessage('co-1', customer('ongkir berapa?').message, { connectionId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(state.questions.length, 0);
  assert.equal(state.quotes[0].serviceType, 'MOTORCYCLE');
  assert.equal(state.toolResult.status, 'ok');
});

test('mode ai (bawaan) tidak berubah: AI memilih kendaraan sendiri, tidak ada pertanyaan ke Management', async (t) => {
  const { server, state, customer } = await harness(t, {
    vehicleMode: 'ai',
    llmScript: async (text, opts, st) => {
      const tool = (opts.tools || []).find((x) => x.name === 'cek_ongkir');
      if (!tool) return 'Siap kak.';
      assert.ok(tool.parameters.properties.kendaraan, 'mode ai tetap menawarkan pilihan kendaraan');
      st.toolResult = await tool.run({ tujuan: ASK_TOOL_ARGS.tujuan, kendaraan: 'VAN' });
      return `Estimasi ongkir ${st.toolResult.ongkir}.`;
    },
  });
  await server.handleInboundMessage('co-1', customer('ongkir berapa?').message, { connectionId: '33333333-3333-4333-8333-333333333333' });
  assert.equal(state.questions.length, 0);
  assert.equal(state.toolResult.ongkir, 'Rp 65.000');
});

test('simulator: menunjukkan pertanyaan yang akan dikirim, tanpa membangunkan staf', async (t) => {
  const { server, state, cookie } = await harness(t, { environment: 'sandbox', llmScript: callTool });
  const res = await server.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage: 'ongkir ke gading serpong berapa?', grade: false } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(state.toolResult.status, 'menunggu_management');
  assert.equal(state.toolResult.simulasi, true);
  assert.match(state.toolResult.pertanyaan_ke_management, /Pilihan: Motor/);
  assert.equal(state.questions.length, 0, 'simulator tidak membuat pertanyaan sungguhan');
});
