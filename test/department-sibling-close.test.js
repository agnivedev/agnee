'use strict';

/**
 * Satu jawaban menutup pertanyaan kembar yang masih terbuka untuk barang yang
 * sama (pengingatnya berhenti); pertanyaan tentang barang lain tetap terbuka.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const MEMBER = '22222222-2222-4222-8222-222222222222';
const DEPT = 'dddddd00-0000-4000-8000-0000000000dd';
const CHAT = '62811@c.us';
const q = (id, question, extra = {}) => ({ id, chatId: CHAT, departmentId: DEPT, department: 'Management', customerText: '', question, ...extra });
const ANSWERED = q('aaaaaa00-0000-4000-8000-000000000001', 'Customer minta harga paralon Rucika 4 inch dan 3/4 inch, masing-masing 7 batang');
const TWIN = q('bbbbbb00-0000-4000-8000-000000000002', 'Customer minta harga paralon 4 inci dan paralon 3/4 inci, tidak ada di DealPOS');
const OTHER = q('cccccc00-0000-4000-8000-000000000003', 'Apakah gypsum board 9mm ready?');

async function harness(t, replyText) {
  const state = { answered: [], closed: [], sent: [] };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async findMemberByWhatsapp(_c, digits) { return digits === '628123456789' ? { userId: MEMBER } : null; },
    async listOpenQuestionsForMember() { return [ANSWERED]; },
    async listDepartmentQuestions(_c, { status }) { return status === 'open' ? [TWIN, OTHER] : []; },
    async answerDepartmentQuestion(id, { answer, userId }) { state.answered.push({ id, answer, userId }); return { id, chatId: CHAT, customerText: '', question: ANSWERED.question, answer, kind: 'general' }; },
    async closeDepartmentQuestion(id) { state.closed.push(id); return { id }; },
    async recordInboundMessage() { return true; },
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
  const llmService = { enabled: true, async generateReply() { return { text: 'Siap.', model: 'tiruan', usage: {} }; }, async generateJson() { return null; } };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'sib-session' });
  t.after(() => server.close());
  const dm = (body) => ({ from: '628123456789@c.us', body, type: 'chat', timestamp: 1, id: { _serialized: `m-${body}` }, async reply() {} });
  return { server, state, dm };
}

test('jawaban menutup saudara sebarang yang sama, bukan pertanyaan barang lain', async (t) => {
  const { server, state, dm } = await harness(t);
  await server.handleInboundMessage('co-1', dm('Harga Pipa Rucika 4in D 193.500 per batang, 3/4in AW 37.000 per batang'));
  assert.equal(state.answered.length, 1);
  assert.deepEqual(state.closed, [TWIN.id]);
});

test('keluhan staf "udah dijawab nanya lagi" bukan jawaban', async (t) => {
  const { server, state, dm } = await harness(t);
  await server.handleInboundMessage('co-1', dm('Udh dijawab nanya lagi'));
  assert.equal(state.answered.length, 0, 'tidak diteruskan ke customer');
});
