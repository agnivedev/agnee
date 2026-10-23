'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const Database = require('../src/database.js');

const CHAT = '6281200000001@c.us';

/**
 * Bar "AI diam" di composer menampilkan kapan chat kembali ke AI. Angka itu
 * hanya jujur kalau `autoAssigned` benar-benar tersimpan — sebelumnya tidak
 * pernah, jadi penyapu 30 menit tidak pernah menemukan apa pun.
 */
async function appWith({ lastHumanReplyAt = null } = {}) {
  const routes = new Map();
  const saved = [];
  const supervisor = { id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'sup@example.com', displayName: 'Supervisor', role: 'supervisor', status: 'active' };
  const agent = { id: 'agent-1', userId: 'agent-1', companyId: 'company-1', email: 'agent@example.com', displayName: 'Agent', role: 'agent', status: 'active' };
  const users = [supervisor, agent];
  const database = {
    enabled: true, connected: true, companyId: 'company-1',
    async connect() {}, async close() {}, status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return users.find((u) => u.email === email && password === 'pass-12345') || null; },
    async getActiveSessionUser(userId) { return users.find((u) => u.id === userId) || null; },
    async setPresence() {}, async listTeamMembers() { return users; },
    async getConversationRouting(chatId) { return routes.get(chatId) || null; },
    async saveConversationRouting(change) {
      saved.push(change);
      const value = {
        chatId: change.chatId, mode: change.mode, assigneeUserId: change.assigneeUserId || null,
        status: 'open', priority: 'normal', updatedAt: new Date().toISOString(),
        autoAssigned: change.mode === 'human' && Boolean(change.autoAssigned),
      };
      routes.set(change.chatId, value);
      return value;
    },
    async getLastHumanReplyAt() { return lastHumanReplyAt; },
    async listConversationHandoffs() { return []; },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'ai-paused-secret' });
  const login = async (email) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } });
    assert.equal(res.statusCode, 200);
    return res.headers['set-cookie'].split(';')[0];
  };
  return { app, saved, login, supervisor, agent };
}

test('ambil alih dari composer kembali ke AI 30 menit sesudahnya', async (t) => {
  const { app, saved, login } = await appWith();
  t.after(() => app.close());
  const cookie = await login('agent@example.com');

  const res = await app.inject({ method: 'POST', url: `/v1/chats/${CHAT}/routing`, headers: { cookie }, payload: { mode: 'human', autoReturn: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(saved.at(-1).autoAssigned, true);
  const { routing } = res.json();
  const delta = new Date(routing.autoReturnAt).getTime() - new Date(routing.updatedAt).getTime();
  assert.equal(delta, 30 * 60_000);

  const read = await app.inject({ method: 'GET', url: `/v1/chats/${CHAT}/routing`, headers: { cookie } });
  assert.equal(read.json().routing.autoReturnAt, routing.autoReturnAt);
});

test('balasan manusia yang lebih baru memundurkan waktu kembali ke AI', async (t) => {
  const later = new Date(Date.now() + 10 * 60_000).toISOString();
  const { app, login } = await appWith({ lastHumanReplyAt: later });
  t.after(() => app.close());
  const cookie = await login('agent@example.com');
  const res = await app.inject({ method: 'POST', url: `/v1/chats/${CHAT}/routing`, headers: { cookie }, payload: { mode: 'human', autoReturn: true } });
  assert.equal(new Date(res.json().routing.autoReturnAt).getTime(), new Date(later).getTime() + 30 * 60_000);
});

test('penugasan lewat panel tidak kedaluwarsa', async (t) => {
  const { app, saved, login, agent } = await appWith();
  t.after(() => app.close());
  const cookie = await login('sup@example.com');

  const manual = await app.inject({ method: 'POST', url: `/v1/chats/${CHAT}/routing`, headers: { cookie }, payload: { mode: 'human' } });
  assert.equal(saved.at(-1).autoAssigned, false);
  assert.equal(manual.json().routing.autoReturnAt, null);

  // autoReturn hanya berlaku untuk diri sendiri: menugaskan orang lain adalah
  // keputusan supervisor, bukan efek samping membalas.
  const other = await app.inject({ method: 'POST', url: `/v1/chats/${CHAT}/routing`, headers: { cookie }, payload: { mode: 'human', assigneeUserId: agent.id, autoReturn: true } });
  assert.equal(saved.at(-1).autoAssigned, false);
  assert.equal(other.json().routing.autoReturnAt, null);

  const back = await app.inject({ method: 'POST', url: `/v1/chats/${CHAT}/routing`, headers: { cookie }, payload: { mode: 'ai' } });
  assert.equal(back.json().routing.mode, 'ai');
  assert.equal(back.json().routing.autoReturnAt, null);
});

const DB_URL = process.env.DATABASE_URL;

test('auto_assigned tersimpan dan disapu; pesan yang belum dijawab terbaca', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const slug = `ai-paused-${Date.now()}`;
  const companyId = (await db.pool.query(`INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id`, [slug])).rows[0].id;
  const email = `${slug}@ai-paused.test`;
  t.after(async () => {
    for (const table of ['conversation_handoffs', 'conversation_routing', 'inbound_messages', 'outbound_replies', 'audit_logs', 'company_members']) {
      await db.pool.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]).catch(() => {});
    }
    await db.pool.query('DELETE FROM users WHERE email = $1', [email]);
    await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    await db.close();
  });
  const agent = await db.createTeamMember({ email, displayName: 'Agent', password: 'password-agent', role: 'agent' }, companyId);
  const human = (extra = {}) => ({ chatId: CHAT, mode: 'human', assigneeUserId: agent.id, ...extra });

  await db.saveConversationRouting(human({ autoAssigned: true }), companyId);
  assert.equal((await db.getConversationRouting(CHAT, companyId)).autoAssigned, true);

  await db.pool.query(`UPDATE conversation_routing SET updated_at = NOW() - INTERVAL '31 minutes' WHERE company_id = $1`, [companyId]);
  const swept = await db.returnIdleAutoAssignedToAi(30);
  assert.ok(swept.some((row) => row.companyId === companyId && row.chatId === CHAT));
  assert.equal((await db.getConversationRouting(CHAT, companyId)).mode, 'ai');

  // Menyimpan ulang tanpa autoAssigned (penugasan lewat panel) mematikannya.
  await db.saveConversationRouting(human({ autoAssigned: true }), companyId);
  await db.saveConversationRouting(human(), companyId);
  assert.equal((await db.getConversationRouting(CHAT, companyId)).autoAssigned, false);

  await db.recordInboundMessage(companyId, { chatId: CHAT, provider: 'cloud_api', waMessageId: `wamid.${slug}`, body: 'Masih ada stok?', timestamp: Math.floor(Date.now() / 1000) });
  const waiting = await db.getUnansweredInbound(companyId, CHAT);
  assert.equal(waiting?.body, 'Masih ada stok?');
  assert.equal(waiting?.waMessageId, `wamid.${slug}`);

  await db.recordOutboundReply({ chatId: CHAT, author: 'human', body: 'Ada kak' }, companyId);
  assert.equal(await db.getUnansweredInbound(companyId, CHAT), null);
});
