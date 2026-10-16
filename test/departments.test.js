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
  assert.match(departmentAsk.ensureHolding('', 'Product'), /tim Product/);
  assert.match(departmentAsk.ensureHolding('Stoknya ada 5 pcs', 'Product'), /ditunggu sebentar/);
  const ok = 'Baik kak, saya konfirmasikan dulu ya, mohon ditunggu.';
  assert.equal(departmentAsk.ensureHolding(ok, 'Product'), ok);
});

test('jadwal pengingat 5 mnt, 15 mnt, 2 jam, 12 jam dan pengingat terakhir menyebut 12 jam', () => {
  assert.deepEqual(departmentAsk.REMINDER_MINUTES, [5, 15, 120, 720]);
  const last = departmentAsk.buildReminderNotice({ department: 'Product', question: 'q', customerLabel: '+62', reminderCount: 4, final: true });
  assert.match(last, /12 jam/);
  assert.match(departmentAsk.buildReminderNotice({ department: 'Product', question: 'q', customerLabel: '+62', reminderCount: 2, final: false }), /2\/4/);
});
