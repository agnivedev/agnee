'use strict';

/**
 * Bot tagihan dan putaran "Ada yang bisa saya bantu?" dari ujung ke ujung
 * (handleInboundMessage). Audit ESBEJE 9 Nov: 19% balasan AI terkirim ke yang
 * bukan customer.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const CHAT = '628111222333@c.us';
const OWNER = { id: '11111111-1111-4111-8111-111111111111', role: 'owner', status: 'active', displayName: 'Sup' };

async function harness(t, { reply = 'Ada yang bisa saya bantu terkait bahan bangunan, kak?', recent = [], templateRecently = false } = {}) {
  const state = { prompts: [], routing: [], sent: [] };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone', aiMessageLimit: 0, aiMessageCount: 0, timezone: 'Asia/Jakarta' }; },
    async getReplyDelaySettings() { return { enabled: false }; },
    async incrementAiMessageCount() { return { exceeded: false }; },
    async getHandoffNotifyNumbers() { return []; },
    async listTeamMembers() { return [OWNER]; },
    async saveConversationRouting(change) { state.routing.push(change); return { ...change }; },
    async listRecentChatTexts() { return recent; },
    async hasRecentInboundOfType() { return templateRecently; },
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
    async generateReply(text) { state.prompts.push(text); return { text: reply, model: 'tiruan', usage: {} }; },
    async generateJson() { return null; },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'non-customer' });
  t.after(() => server.close());
  const send = async (body, type = 'chat') => {
    await server.handleInboundMessage('co-1', {
      from: CHAT, body, type, timestamp: 1, id: { _serialized: `m-${body}-${type}` },
      async reply(text) { state.sent.push(text); },
    }, { connectionId: '33333333-3333-4333-8333-333333333333' });
  };
  return { state, send };
}

test('tagihan SPayLater tidak dijawab dan model tidak dipanggil', async (t) => {
  const { state, send } = await harness(t);
  await send('Yuk, segera selesaikan tagihan SPayLater-mu sebesar Rp 4.059.506 yang akan jatuh tempo!');
  assert.deepEqual(state.sent, []);
  assert.equal(state.prompts.length, 0);
});

test('chat yang baru menerima template resmi akun bisnis tidak dijawab', async (t) => {
  const { state, send } = await harness(t, { templateRecently: true });
  await send('Halo, ada info penting untuk akun Anda');
  assert.deepEqual(state.sent, []);
});

test('customer biasa tetap dijawab', async (t) => {
  const { state, send } = await harness(t, { reply: 'Semen Jakarta 40KG Rp 45.000 per zak, kak.' });
  await send('semen jakarta 40kg berapa?');
  assert.equal(state.sent.length, 1);
});

test('tawaran kosong ketiga ke teman pemilik ditahan dan chat diserahkan ke manusia', async (t) => {
  const recent = [
    { fromMe: false, body: 'Mihhh' },
    { fromMe: true, body: 'Oke kak. Ada yang bisa saya bantu terkait bahan bangunan?' },
    { fromMe: false, body: 'Km da smbu blm?' },
    { fromMe: true, body: 'Saya Agnes dari ESBEJE. Ada yang bisa saya bantu, kak?' },
    { fromMe: false, body: 'Oo ud ganti no yah?' },
  ];
  const { state, send } = await harness(t, { recent });
  await send('Oo ud ganti no yah?');
  assert.deepEqual(state.sent, [], 'balasan ketiga tidak dikirim');
  assert.equal(state.routing.length, 1);
  assert.equal(state.routing[0].mode, 'human');
  assert.equal(state.routing[0].assigneeUserId, OWNER.id);
});

test('tawaran kosong kedua masih dikirim', async (t) => {
  const recent = [
    { fromMe: false, body: 'Mihhh' },
    { fromMe: true, body: 'Oke kak. Ada yang bisa saya bantu terkait bahan bangunan?' },
    { fromMe: false, body: 'Km da smbu blm?' },
  ];
  const { state, send } = await harness(t, { recent });
  await send('Km da smbu blm?');
  assert.equal(state.sent.length, 1);
  assert.equal(state.routing.length, 0);
});
