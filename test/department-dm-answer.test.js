'use strict';

/**
 * Anggota departemen membalas DM pertanyaan AI di WhatsApp. Balasan itu adalah
 * jawaban (diteruskan ke customer), bukan chat customer yang dijawab AI.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const departmentAsk = require('../src/department-ask');

const MEMBER = '22222222-2222-4222-8222-222222222222';
const Q1 = 'aaaaaa00-0000-4000-8000-000000000001';
const Q2 = 'bbbbbb00-0000-4000-8000-000000000002';

async function harness(t, { open = [{ id: Q1, chatId: '62811@c.us', question: 'Stok MU 301 ada?', department: 'Product' }], isMember = true } = {}) {
  const state = { answered: [], closed: [], recorded: [], prompts: [] };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async findMemberByWhatsapp(_c, digits) { return isMember && digits === '628123456789' ? { userId: MEMBER } : null; },
    async listOpenQuestionsForMember() { return open; },
    async answerDepartmentQuestion(id, { answer, userId }) { state.answered.push({ id, answer, userId }); return { id, chatId: '62811@c.us', customerText: 'x', question: 'q', answer, kind: 'general' }; },
    async closeDepartmentQuestion(id) { state.closed.push(id); return { id }; },
    async recordInboundMessage(...args) { state.recorded.push(args); return true; },
    async getHandoffNotifyNumbers() { return []; },
    async getAiSettings() { return { enabled: false, modelChain: [], identity: 'team_member' }; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const llmService = { enabled: true, async generateReply(text) { state.prompts.push(text); return { text: 'Siap.', model: 'tiruan', usage: {} }; }, async generateJson() { return null; } };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'dm-session' });
  t.after(() => server.close());
  const dm = (body, from = '628123456789@c.us') => ({ from, body, type: 'chat', timestamp: 1, id: { _serialized: `m-${body}` }, async reply() {} });
  return { server, state, dm };
}

test('DM anggota dengan satu pertanyaan terbuka dicatat sebagai jawaban, bukan chat customer', async (t) => {
  const { server, state, dm } = await harness(t);
  await server.handleInboundMessage('co-1', dm('Stok ada 40 sak, siap kirim besok'));
  assert.equal(state.answered.length, 1);
  assert.equal(state.answered[0].id, Q1);
  assert.equal(state.answered[0].userId, MEMBER);
  assert.equal(state.recorded.length, 0, 'tidak tercatat sebagai chat customer');
});

test('DM "batal" menutup pertanyaan tanpa meneruskan', async (t) => {
  const { server, state, dm } = await harness(t);
  await server.handleInboundMessage('co-1', dm('batal'));
  assert.deepEqual(state.closed, [Q1]);
  assert.equal(state.answered.length, 0);
});

test('beberapa pertanyaan terbuka: tanpa #kode tidak dijawab, dengan #kode tepat sasaran', async (t) => {
  const open = [
    { id: Q1, chatId: '62811@c.us', question: 'Stok A?', department: 'Product' },
    { id: Q2, chatId: '62822@c.us', question: 'Harga B?', department: 'Product' },
  ];
  const { server, state, dm } = await harness(t, { open });
  await server.handleInboundMessage('co-1', dm('ada 40 sak'));
  assert.equal(state.answered.length, 0);
  assert.equal(state.recorded.length, 0);
  await server.handleInboundMessage('co-1', dm(`#${departmentAsk.questionCode(Q2)} harga 75 ribu per sak`));
  assert.equal(state.answered.length, 1);
  assert.equal(state.answered[0].id, Q2);
  assert.equal(state.answered[0].answer, 'harga 75 ribu per sak');
});

test('pengirim yang bukan anggota tetap diperlakukan sebagai customer', async (t) => {
  const { server, state, dm } = await harness(t, { isMember: false });
  await server.handleInboundMessage('co-1', dm('Stok ada 40 sak'));
  assert.equal(state.answered.length, 0);
  assert.equal(state.recorded.length, 1);
});

test('notifikasi ke anggota memuat kode dan cara membalas langsung; kabar 12 jam ke customer tidak membocorkan proses internal', () => {
  const notice = departmentAsk.buildQuestionNotice({ department: 'Product', question: 'q', customerLabel: 'C', code: 'abc123', dm: true });
  assert.match(notice, /#abc123/);
  assert.match(notice, /Balas pesan ini langsung/);
  assert.equal(departmentAsk.leaksInternal(departmentAsk.unresolvedCustomerNotice()), false);
  assert.match(departmentAsk.ambiguousDmNotice([{ id: Q1, question: 'Stok A?' }, { id: Q2, question: 'Harga B?' }]), /#aaaaaa/);
});
