'use strict';

/**
 * Titik sambung aturan otomasi di inti: pesan customer masuk lewat webhook
 * Cloud API bertanda tangan, aturan company itu berjalan SEBELUM AI menyiapkan
 * balasan, dan chat yang diserahkan ke seseorang tidak dijawab AI.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildApp } = require('../src/server');

const COMPANY = 'company-a';
const OTHER = 'company-b';
const SECRET = 'app-secret-uji';
const PHONE_ID = 'pn-1';
const AGENT = '11111111-1111-4111-8111-111111111111';

function fakeDatabase(rules) {
  const events = [];
  const inbound = [];
  const claims = new Map();
  const routing = new Map();
  const noop = async () => null;
  return {
    events, inbound, routing,
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async getCloudApiConnectionByPhoneNumberId(id) { return id === PHONE_ID ? { id: 'conn-1', companyId: COMPANY, appSecret: SECRET } : null; },
    async recordCloudMessage() {},
    async recordInboundMessage(companyId, m) { inbound.push({ companyId, chatId: m.chatId }); return true; },
    async countInboundMessages(companyId, chatId) { return inbound.filter((m) => m.companyId === companyId && m.chatId === chatId).length; },
    async markFollowUpReplied() {}, async stopFollowUpSequence() {},
    async getCompanyConfig() { return { planStatus: 'active', status: 'active' }; },
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getReplyDelaySettings() { return { replyDelayEnabled: false }; },
    async getConversationRouting(chatId, companyId) { return routing.get(`${companyId}:${chatId}`) || null; },
    async saveConversationRouting(change, companyId) {
      const saved = { chatId: change.chatId, mode: change.mode, assigneeUserId: change.assigneeUserId, status: change.status, priority: change.priority, note: change.note };
      routing.set(`${companyId}:${change.chatId}`, saved);
      events.push(['route', companyId, saved]);
      return saved;
    },
    async listAutomationRules(companyId) { return rules.filter((r) => r.companyId === companyId); },
    async claimAutomationRun(ruleId, companyId, chatId) {
      const key = `${ruleId}|${chatId}`;
      if (claims.has(key)) return null;
      claims.set(key, true);
      return { id: claims.size };
    },
    async finishAutomationRun() {},
    async setPipelineStage(chatId, stage, by, companyId) { events.push(['stage', companyId, chatId, stage]); },
    async notifySupervisorsAbout({ chatId, body }, companyId) { events.push(['notify', companyId, chatId, body]); },
    async incrementAiMessageCount() { return { exceeded: false }; },
    getPlaybookContext: noop,
  };
}

function signedWebhook(app, text, from = '628111@c.us'.replace('@c.us', ''), id = `wamid.${crypto.randomUUID()}`) {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: PHONE_ID },
      messages: [{ from, id, type: 'text', timestamp: String(Math.floor(Date.now() / 1000)), text: { body: text } }],
    } }] }],
  });
  const signature = `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;
  return app.inject({ method: 'POST', url: '/webhook/meta', payload: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature } });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

async function setup(t, rules, llm) {
  const database = fakeDatabase(rules);
  const app = await buildApp({
    logger: process.env.TEST_LOG ? { level: 'warn' } : false, startupEnabled: false, demoMode: true, sessionSecret: 'automation-inbound',
    llmEnabled: Boolean(llm), openrouterApiKey: 'kunci-uji',
    database, llmService: llm || { enabled: false, model: 'tiruan', async generateReply() { return { text: 'balasan AI' }; } },
  });
  t.after(() => app.close());
  return { app, database };
}

const rule = (patch) => ({ id: 'r1', companyId: COMPANY, name: 'Grosir', enabled: true, cooldownHours: 24, trigger: { type: 'keyword', words: ['grosir'] }, actions: [], ...patch });

test('pesan masuk memicu aturan company itu: pindah tahap, beri tahu tim, serahkan chat; sekali per chat', async (t) => {
  const { app, database } = await setup(t, [
    rule({ actions: [{ type: 'set_pipeline_stage', stage: 'hot' }, { type: 'notify_team', message: 'Ada calon grosir' }, { type: 'assign_to_user', userId: AGENT, priority: 'high' }] }),
    rule({ id: 'r-other', companyId: OTHER, actions: [{ type: 'notify_team', message: 'bukan punya A' }] }),
  ]);

  assert.equal((await signedWebhook(app, 'Kak harga grosir berapa?')).statusCode, 200);
  await settle();
  assert.deepEqual(database.events.map((e) => e[0]), ['stage', 'notify', 'route']);
  assert.deepEqual(database.events[0], ['stage', COMPANY, '628111', 'hot']);
  assert.equal(database.events[1][3], 'Grosir: Ada calon grosir');
  assert.deepEqual(
    { mode: database.events[2][2].mode, assignee: database.events[2][2].assigneeUserId, priority: database.events[2][2].priority },
    { mode: 'human', assignee: AGENT, priority: 'high' },
  );
  assert.equal(database.events.some((e) => e[1] === OTHER), false, 'aturan company lain tidak ikut');

  await signedWebhook(app, 'grosir lagi dong');
  await settle();
  assert.equal(database.events.length, 3, 'jeda ulang: tidak memicu dua kali');
});

test('pesan yang tak cocok dan aturan yang mati tidak memicu apa pun', async (t) => {
  const { app, database } = await setup(t, [
    rule({ actions: [{ type: 'notify_team', message: 'tetap' }] }),
    rule({ id: 'r-off', enabled: false, trigger: { type: 'keyword', words: ['promo'] }, actions: [{ type: 'notify_team', message: 'mati' }] }),
  ]);
  await signedWebhook(app, 'halo selamat siang');
  await signedWebhook(app, 'ada promo?');
  await settle();
  assert.deepEqual(database.events, []);
});

test('aturan new_chat hanya memicu pesan pertama sebuah chat', async (t) => {
  const { app, database } = await setup(t, [rule({ id: 'r-new', trigger: { type: 'new_chat' }, actions: [{ type: 'set_pipeline_stage', stage: 'warm' }] })]);
  await signedWebhook(app, 'halo', '62822');
  await settle();
  await signedWebhook(app, 'halo lagi', '62822');
  await settle();
  assert.deepEqual(database.events.map((e) => [e[0], e[2]]), [['stage', '62822']], 'hanya pesan pertama');
});

test('aturan yang rusak tidak menggagalkan pesan masuk', async (t) => {
  const { app, database } = await setup(t, [rule({ actions: [{ type: 'notify_team', message: 'x' }] })]);
  database.listAutomationRules = async () => { throw new Error('tabel hilang'); };
  const res = await signedWebhook(app, 'harga grosir');
  assert.equal(res.statusCode, 200);
  await settle();
  assert.equal(database.inbound.length, 1, 'pesan tetap dicatat');
});

test('chat yang diserahkan aturan tidak dijawab AI pada pesan yang sama; tanpa aturan AI menjawab', async (t) => {
  const llm = (calls) => ({
    enabled: true, model: 'tiruan',
    async generateReply(message) { calls.push(message); return { text: 'balasan AI', model: 'tiruan' }; },
  });

  const withoutRule = [];
  const plain = await setup(t, [], llm(withoutRule));
  await signedWebhook(plain.app, 'harga grosir berapa?', '62833');
  await settle();
  assert.ok(withoutRule.length > 0, 'pembanding: tanpa aturan AI menyiapkan balasan');

  const withRule = [];
  const handed = await setup(t, [rule({ actions: [{ type: 'assign_to_user', userId: AGENT }] })], llm(withRule));
  await signedWebhook(handed.app, 'harga grosir berapa?', '62833');
  await settle();
  assert.equal(handed.database.routing.get(`${COMPANY}:62833`).mode, 'human');
  assert.equal(withRule.length, 0, 'AI tidak menyiapkan balasan untuk chat yang sudah dipegang orang');
});
