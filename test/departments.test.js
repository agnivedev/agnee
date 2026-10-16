'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const departmentAsk = require('../src/department-ask');

const sup = { id: '11111111-1111-4111-8111-111111111111', companyId: 'co-1', email: 'sup@t.test', displayName: 'Sup', role: 'owner' };
const agent = { id: '22222222-2222-4222-8222-222222222222', companyId: 'co-1', email: 'ag@t.test', displayName: 'Agen', role: 'agent' };
const DEPT = '33333333-3333-4333-8333-333333333333';

async function app(t) {
  const calls = { created: [], answered: [], audits: [], memberSets: [] };
  const users = { [sup.email]: sup, [agent.email]: agent };
  let open = true;
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'pass-12345' ? users[email] || null : null; },
    async getActiveSessionUser(userId) { return { ...Object.values(users).find((u) => u.id === userId), isPlatformAdmin: false }; },
    async setPresence() {}, async setLastCompany() {},
    async listCompaniesForUser() { return [{ id: 'co-1' }]; },
    async recordAuditLog(entry) { calls.audits.push(entry); return { id: 1 }; },
    async listDepartments() { return [{ id: DEPT, name: 'Product', description: 'x', members: [{ userId: agent.id, displayName: 'Agen', email: agent.email, whatsappNumber: '0812' }] }]; },
    async createDepartment(b) { calls.created.push(b); return { id: DEPT, ...b, members: [] }; },
    async updateDepartment(id, b) { return { id, name: b.name || 'Product', description: '' }; },
    async deleteDepartment() { return true; },
    async setDepartmentMembers(id, ids) { calls.memberSets.push([id, ids]); return true; },
    async listDepartmentQuestions(_c, { userId }) {
      if (!open) return [];
      return [{ id: DEPT, chatId: '62811@c.us', customerText: 'x', question: 'q', departmentId: DEPT, department: 'Product', visibleTo: userId }];
    },
    async answerDepartmentQuestion(id, input) {
      if (!open) return null;
      open = false; calls.answered.push(input);
      return { id, chatId: '62811@c.us', customerText: 'x', question: 'q', answer: input.answer };
    },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'mem-session' });
  t.after(() => server.close());
  const login = async (email) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { server, calls, supCookie: await login(sup.email), agentCookie: await login(agent.email) };
}

test('supervisor membuat departemen dan tercatat di audit; agent ditolak', async (t) => {
  const { server, calls, supCookie, agentCookie } = await app(t);
  const denied = await server.inject({ method: 'POST', url: '/v1/departments', headers: { cookie: agentCookie }, payload: { name: 'Legal' } });
  assert.equal(denied.statusCode, 403);
  const ok = await server.inject({ method: 'POST', url: '/v1/departments', headers: { cookie: supCookie }, payload: { name: 'Legal' } });
  assert.equal(ok.statusCode, 201);
  assert.equal(calls.created[0].name, 'Legal');
  assert.ok(calls.audits.some((a) => a.action === 'department.created'));
});

test('daftar departemen menyembunyikan email dan nomor dari agent', async (t) => {
  const { server, agentCookie, supCookie } = await app(t);
  const a = (await server.inject({ method: 'GET', url: '/v1/departments', headers: { cookie: agentCookie } })).json();
  assert.equal(a.departments[0].members[0].email, undefined);
  assert.equal(a.departments[0].members[0].whatsappNumber, undefined);
  const s = (await server.inject({ method: 'GET', url: '/v1/departments', headers: { cookie: supCookie } })).json();
  assert.equal(s.departments[0].members[0].whatsappNumber, '0812');
});

test('jawaban pertama menang; jawaban kedua 404/409', async (t) => {
  const { server, calls, agentCookie } = await app(t);
  const url = `/v1/department-questions/${DEPT}/answer`;
  const first = await server.inject({ method: 'POST', url, headers: { cookie: agentCookie }, payload: { answer: 'Ada stok 10' } });
  assert.equal(first.statusCode, 200);
  assert.equal(calls.answered[0].answer, 'Ada stok 10');
  const second = await server.inject({ method: 'POST', url, headers: { cookie: agentCookie }, payload: { answer: 'lain' } });
  assert.ok([404, 409].includes(second.statusCode));
});

test('panduan prompt melarang menebak dan alat membatasi pilihan ke departemen yang ada', () => {
  const deps = [{ name: 'Product', description: 'fitur' }, { name: 'Procurement', description: '' }];
  assert.match(departmentAsk.guide(deps), /JANGAN menebak/);
  const spec = departmentAsk.toolSpec({ departments: deps, run: () => ({}) });
  assert.deepEqual(spec.parameters.properties.department.enum, ['Product', 'Procurement']);
  assert.match(departmentAsk.buildQuestionNotice({ department: 'Product', question: 'q', customerLabel: '+62' }), /Pertanyaan AI/);
});

test('kelima tindakan departemen tercatat di audit, tanpa isi jawaban', async (t) => {
  const { server, calls, supCookie } = await app(t);
  const h = { cookie: supCookie };
  await server.inject({ method: 'POST', url: '/v1/departments', headers: h, payload: { name: 'Legal' } });
  await server.inject({ method: 'PATCH', url: `/v1/departments/${DEPT}`, headers: h, payload: { name: 'Produk' } });
  await server.inject({ method: 'PUT', url: `/v1/departments/${DEPT}/members`, headers: h, payload: { userIds: [agent.id] } });
  await server.inject({ method: 'POST', url: `/v1/department-questions/${DEPT}/answer`, headers: h, payload: { answer: 'RAHASIA-JAWABAN' } });
  await server.inject({ method: 'DELETE', url: `/v1/departments/${DEPT}`, headers: h });
  const actions = calls.audits.map((a) => a.action);
  for (const a of ['department.created', 'department.updated', 'department.members_set', 'department.question_answered', 'department.deleted']) {
    assert.ok(actions.includes(a), `audit ${a} tidak tercatat`);
  }
  assert.ok(!JSON.stringify(calls.audits).includes('RAHASIA-JAWABAN'), 'isi jawaban tidak boleh masuk audit');
  assert.ok(calls.audits.every((a) => a.entityType.startsWith('department')));
});

test('kabar tunggu dipaksa: balasan tanpa kata tunggu ditambah teks cadangan', () => {
  assert.match(departmentAsk.ensureHolding(''), /saya pastikan dulu/);
  assert.doesNotMatch(departmentAsk.ensureHolding(''), /tim|internal|departemen|supplier/i, 'kabar tunggu tidak membuka proses internal');
  assert.match(departmentAsk.ensureHolding('Stoknya ada 5 pcs'), /ditunggu sebentar/);
  const ok = 'Baik kak, saya konfirmasikan dulu ya, mohon ditunggu.';
  assert.equal(departmentAsk.ensureHolding(ok), ok);
});

test('jadwal pengingat 5 mnt, 15 mnt, 2 jam, 12 jam dan pengingat terakhir menyebut 12 jam', () => {
  assert.deepEqual(departmentAsk.REMINDER_MINUTES, [5, 15, 120, 720]);
  const last = departmentAsk.buildReminderNotice({ department: 'Product', question: 'q', customerLabel: '+62', reminderCount: 4, final: true });
  assert.match(last, /12 jam/);
  assert.match(departmentAsk.buildReminderNotice({ department: 'Product', question: 'q', customerLabel: '+62', reminderCount: 2, final: false }), /2\/4/);
});

// ---- pihak ketiga -------------------------------------------------------

async function tpApp(t, { sender = null } = {}) {
  const calls = { recorded: [], captured: [], notified: [], created: [], audits: [], replies: [] };
  const sup2 = { id: '44444444-4444-4444-8444-444444444444', companyId: 'co-1', email: 's2@t.test', displayName: 'S2', role: 'owner' };
  const ag = { id: '55555555-5555-4555-8555-555555555555', companyId: 'co-1', email: 'a2@t.test', displayName: 'A2', role: 'agent' };
  const users = { [sup2.email]: sup2, [ag.email]: ag };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'pass-12345' ? users[email] || null : null; },
    async getActiveSessionUser(userId) { return { ...Object.values(users).find((u) => u.id === userId), isPlatformAdmin: false }; },
    async setPresence() {}, async setLastCompany() {},
    async listCompaniesForUser() { return [{ id: 'co-1' }]; },
    async recordAuditLog(e) { calls.audits.push(e); return { id: 1 }; },
    async listThirdParties() { return []; },
    async createThirdParty(b) { calls.created.push(b); return { id: 'tp-1', ...b, active: true }; },
    async findThirdPartySender(_c, chatId) { return sender && chatId === sender.chatId ? sender.hit : null; },
    async captureThirdPartyReply(id, text) { calls.captured.push([id, text]); return { id, chatId: '62811@c.us', thirdParty: 'Toko Semen', first: true }; },
    async notifySupervisors(n) { calls.notified.push(n); },
    async recordInboundMessage(_c, m) { calls.recorded.push(m); return true; },
    async markFollowUpReplied() {}, async stopFollowUpSequence() {}, async upsertContactName() {},
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'mem-session' });
  t.after(() => server.close());
  const login = async (email) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { server, calls, supCookie: await login(sup2.email), agentCookie: await login(ag.email) };
}

test('pihak ketiga: hanya supervisor, nomor dinormalkan ke 62..., tag dibersihkan, tercatat audit', async (t) => {
  const { server, calls, supCookie, agentCookie } = await tpApp(t);
  const body = { name: 'Toko Semen', whatsappNumber: '0812-3456-789', tags: [' Semen ', 'semen', 'SUPPLIER'] };
  assert.equal((await server.inject({ method: 'POST', url: '/v1/third-parties', headers: { cookie: agentCookie }, payload: body })).statusCode, 403);
  assert.equal((await server.inject({ method: 'GET', url: '/v1/third-parties', headers: { cookie: agentCookie } })).statusCode, 403);
  const res = await server.inject({ method: 'POST', url: '/v1/third-parties', headers: { cookie: supCookie }, payload: body });
  assert.equal(res.statusCode, 201);
  assert.equal(calls.created[0].whatsappNumber, '628123456789');
  assert.deepEqual(calls.created[0].tags, ['semen', 'supplier']);
  assert.ok(calls.audits.some((a) => a.action === 'third_party.created'));
});

test('balasan dari nomor pihak ketiga dicegat: tersimpan untuk ditinjau, bukan chat customer', async (t) => {
  const hit = { thirdParty: { id: 'tp-1', name: 'Toko Semen' }, question: { id: 'q-1', status: 'open' } };
  const { server, calls } = await tpApp(t, { sender: { chatId: '628123456789@c.us', hit } });
  let replied = false;
  await server.handleInboundMessage('co-1', {
    from: '628123456789@c.us', body: 'Stok ada 200 sak, Rp 62rb/sak', type: 'chat', timestamp: 1,
    id: { _serialized: 'm1' }, async reply() { replied = true; },
  });
  assert.deepEqual(calls.captured, [['q-1', 'Stok ada 200 sak, Rp 62rb/sak']]);
  assert.equal(calls.notified.length, 1, 'supervisor dipanggil untuk meninjau');
  assert.equal(calls.recorded.length, 0, 'supplier tidak tercatat sebagai pesan customer');
  assert.equal(replied, false, 'AI tidak membalas supplier');
});

test('pesan pihak ketiga tanpa pertanyaan terbuka diabaikan; customer biasa tetap lewat jalur normal', async (t) => {
  const hit = { thirdParty: { id: 'tp-1', name: 'Toko Semen' }, question: null };
  const { server, calls } = await tpApp(t, { sender: { chatId: '628123456789@c.us', hit } });
  const msg = (from) => ({ from, body: 'halo', type: 'chat', timestamp: 1, id: { _serialized: `m-${from}` }, async reply() {} });
  await server.handleInboundMessage('co-1', msg('628123456789@c.us'));
  assert.equal(calls.captured.length, 0);
  assert.equal(calls.recorded.length, 0);
  await server.handleInboundMessage('co-1', msg('62899999@c.us'));
  assert.equal(calls.recorded.length, 1, 'customer biasa tetap dicatat');
});

test('pesan ke pihak ketiga tidak memuat data customer dan prompt relay tidak menyebut nama supplier', () => {
  const m = departmentAsk.buildThirdPartyMessage({ companyName: 'Toko Bangunan X', partyName: 'Toko Semen', question: 'Stok semen 50kg ada?' });
  assert.match(m, /Toko Bangunan X/);
  assert.doesNotMatch(m, /\+62|customer/i);
  assert.match(departmentAsk.relayPrompt({ customerText: 'c', question: 'q', answer: 'a' }), /supplier/);
  const spec = departmentAsk.toolSpecThirdParty({ parties: [{ name: 'A', tags: ['x'] }], run: () => ({}) });
  assert.deepEqual(spec.parameters.properties.party.enum, ['A']);
});

test('relay: jawaban pasti lolos, belum pasti ditahan, bocoran proses internal ditolak', () => {
  assert.equal(departmentAsk.judgeRelay('Stok semen 50kg tersedia kak, siap dikirim besok.').kind, 'ok');
  assert.equal(departmentAsk.judgeRelay(departmentAsk.UNSURE_TOKEN).kind, 'unsure');
  assert.equal(departmentAsk.judgeRelay('').kind, 'empty');
  for (const bocor of [
    'Kata tim Product, stoknya ada kak.',
    'Sudah kami tanyakan ke supplier, ada kak.',
    'Setelah dibahas internal, harganya 62rb.',
    'Menurut departemen terkait, bisa kak.',
  ]) {
    assert.equal(departmentAsk.judgeRelay(bocor).kind, 'leak', bocor);
  }
  // Kata "pabrik"/"semen" milik topik customer tidak dianggap bocoran.
  assert.equal(departmentAsk.judgeRelay('Untuk pabrik kakak, semen 50kg tersedia.').kind, 'ok');
});

test('prompt relay: santun, hanya isi jawaban, tanpa proses internal, token belum pasti', () => {
  const p = departmentAsk.relayPrompt({ customerText: 'c', question: 'q', answer: 'a' });
  assert.match(p, /BELUM_PASTI/);
  assert.match(p, /Tidak menggurui, tidak sombong/);
  assert.match(p, /HANYA isi jawaban/);
  assert.match(departmentAsk.relayPrompt({ customerText: 'c', question: 'q', answer: 'a', strict: true }), /menyebut proses internal/);
  assert.match(departmentAsk.guide([{ name: 'Product', description: '' }]), /JANGAN menyebut proses internal ke customer/);
});
