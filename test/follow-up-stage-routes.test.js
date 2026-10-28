'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const { buildSummary } = require('../src/order-summary');

/*
 * Tindak lanjut per tahap lewat app sungguhan: setelan per tahap di
 * /v1/follow-up/settings, generate lewat buildReplyContext yang sama dengan
 * balasan biasa (aturan percakapan bawaan + playbook company ikut), dan
 * kirim manual yang memeriksa ulang tahap funnel sebelum mengirim.
 */

const OWNER = {
  id: 'owner-e', userId: 'owner-e', companyId: 'esbeje', email: 'owner@esbeje.test',
  displayName: 'Owner', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const NOW = new Date();
const HOUR_WIB = (NOW.getUTCHours() + 7) % 24;
const ago = (hours) => new Date(NOW.getTime() - hours * 3600_000).toISOString();
const RINCIAN = buildSummary({
  items: [{ name: 'MU 420 CERAFIX 25KG', qty: 10, unitPrice: 95000, unit: 'sak' }], shipping: 0,
}).text;

async function setup(t, { facts, settings = {} }) {
  const seen = [];
  const saved = [];
  const stopped = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      seen.push({ message, prompt: options.systemPrompt || '', purpose: options.purpose });
      return { text: 'Kak, rincian CERAFIX 10 sak dengan grand total Rp 950.000 sudah sesuai? Kalau oke saya proses ya.', model: 'tiruan', usage: {} };
    },
  };
  const state = {
    companyId: 'esbeje', chatId: '628123@c.us', sequenceStartedAt: ago(4), lastSentAt: null,
    sentTotal: 0, sentPerDay: [], stoppedAt: null, stopReason: null, restartCount: 0,
    // Jendela kirim di sekitar jam sekarang (WIB), supaya tes tidak bergantung jam jalan.
    enabled: true, dayCaps: [1, 1, 1], minGapMinutes: 120, sendFromHour: (HOUR_WIB + 23) % 24, sendToHour: (HOUR_WIB + 2) % 24,
    restartAfterDays: 2, stages: {}, timezone: 'Asia/Jakarta',
  };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(userId) { return userId === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'chatbot' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'chatbot' }; },
    async getPlaybookContext() { return '## Persona\nKamu Agnes dari ESBEJE, toko bahan bangunan.'; },
    async incrementAiMessageCount() { return { exceeded: false }; },
    async getFollowUpSettings() { return { enabled: true, dayCaps: [1, 1, 1], minGapMinutes: 120, sendFromHour: 8, sendToHour: 21, restartAfterDays: 2, stages: { inquiry: true, summary: true, proforma: true, payment: true }, ...settings }; },
    async saveFollowUpSettings(patch) { saved.push(patch); return { ...patch }; },
    async getFollowUpStats() { return { sent: 0, replied: 0, active: 0 }; },
    async getFollowUpState() { return { ...state }; },
    async getFollowUpFunnelFacts() { return facts; },
    async stopFollowUpSequence(chatId, companyId, reason) { stopped.push(reason); return true; },
    async listOutboundRepliesForChat() { return facts.outbound; },
    async listFollowUpSends() { return []; },
    async countFollowUpSends() { return 0; },
    async getPlaybookDocForChat(kind) { return kind === 'followup' ? { contentMd: 'Follow-up: satu pertanyaan, sebut barangnya.' } : null; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'fu-stage', database, llmService: llm });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  return { app, cookie, seen, saved, stopped, state };
}

const summaryFacts = () => ({
  inbound: [{ body: 'cerafix 10 sak berapa kak', messageType: 'chat', at: ago(5) }],
  outbound: [{ body: RINCIAN, at: ago(4) }],
  proforma: null, invoice: null, proof: null, pendingQuestion: null,
  paymentMarkers: { accountNumbers: [], paymentLink: '' },
});

test('setelan: saklar per tahap ikut tersimpan, kunci tahap asing dibuang', async (t) => {
  const { app, cookie, saved } = await setup(t, { facts: summaryFacts() });
  const got = await app.inject({ method: 'GET', url: '/v1/follow-up/settings', headers: { cookie } });
  assert.equal(got.statusCode, 200);
  assert.deepEqual(got.json().stages, { inquiry: true, summary: true, proforma: true, payment: true });

  const ok = await app.inject({ method: 'PATCH', url: '/v1/follow-up/settings', headers: { cookie }, payload: { stages: { inquiry: false } } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(saved[0].stages, { inquiry: false });

  // Tahap "menunggu jawaban tim" selalu ditahan dan tidak bisa dimatikan.
  await app.inject({ method: 'PATCH', url: '/v1/follow-up/settings', headers: { cookie }, payload: { stages: { waiting_internal: false } } });
  assert.deepEqual(saved[1].stages, {});

  const bad = await app.inject({ method: 'PATCH', url: '/v1/follow-up/settings', headers: { cookie }, payload: { stages: { summary: 'mati' } } });
  assert.equal(bad.statusCode, 400);
});

test('generate: follow-up lewat konteks balasan yang sama (aturan bawaan + playbook) dan data tahap', async (t) => {
  const { app, cookie, seen } = await setup(t, { facts: summaryFacts() });
  const res = await app.inject({ method: 'POST', url: '/v1/follow-up/draft', headers: { cookie }, payload: { chatId: '628123@c.us' } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().stage, 'summary');
  assert.match(res.json().text, /Rp 950\.000/);
  const call = seen.at(-1);
  assert.equal(call.purpose, 'follow_up');
  assert.match(call.prompt, /ATURAN PERCAKAPAN \(bawaan Agnee/);
  assert.match(call.prompt, /Agnes dari ESBEJE/);
  assert.match(call.message, /Grand total: Rp 950\.000/);
  assert.match(call.message, /MU 420 CERAFIX 25KG \(10 sak\)/);
  assert.match(call.message, /satu pertanyaan, sebut barangnya/);
});

test('kirim manual: tahap dicek ulang, bukti transfer yang masuk selama draf terbuka menghentikan rangkaian', async (t) => {
  const facts = summaryFacts();
  const { app, cookie, stopped } = await setup(t, { facts });
  facts.proof = { verdict: 'cocok', at: ago(0.1) };
  const res = await app.inject({ method: 'POST', url: '/v1/follow-up/send', headers: { cookie }, payload: { chatId: '628123@c.us', text: 'Kak, jadi diproses?' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().reasonKey, 'fu.paymentSent');
  assert.deepEqual(stopped, ['payment_sent']);
});
