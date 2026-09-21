'use strict';

/**
 * Menandai-sudah-dibaca mengikuti aturan MEMBACA, bukan aturan MENULIS.
 *
 * Agent boleh membuka percakapan yang belum dipegang siapa pun — itu memang
 * aturannya, karena dia harus membacanya dulu sebelum memutuskan mau mengambil
 * alih atau tidak. Tapi `mark-read` kebetulan sebuah POST, jadi dulu ia ikut
 * tertolak gerbang "ambil alih dulu": tiga baris 403 di console peramban setiap
 * kali agent membuka chat, dan — yang lebih merugikan — badge unread yang
 * bohong. Server tetap menghitung chat itu belum dibaca padahal agent sudah
 * membacanya, jadi badge-nya muncul lagi begitu halaman di-reload.
 *
 * Pengecualiannya sempit: hanya rute mark-read, dan hanya untuk percakapan yang
 * belum dipegang siapa pun. Mengirim pesan tetap harus mengambil alih dulu, dan
 * percakapan milik agent lain tetap tertutup rapat.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const UNCLAIMED = '6281200000001@c.us'; // demoDataset: unreadCount 2
const HELD_BY_OTHER = '6281200000003@c.us';

function buildDatabase(routes, agent, otherAgent) {
  const byId = new Map([[agent.id, agent], [otherAgent.id, otherAgent]]);
  return {
    connected: true, companyId: 'company-1',
    async connect() {}, async close() {}, status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) {
      const found = [agent, otherAgent].find((user) => user.email === email);
      return found && password === 'agent-pass-123' ? found : null;
    },
    async getActiveSessionUser(userId) { return byId.get(userId) || null; },
    async setPresence() {},
    async listTeamMembers() { return [{ ...agent, status: 'active' }, { ...otherAgent, status: 'active' }]; },
    async getConversationRouting(chatId) { return routes.get(chatId) || null; },
    async saveConversationRouting(change) {
      const member = byId.get(change.assigneeUserId);
      const value = {
        chatId: change.chatId,
        mode: change.mode,
        assigneeUserId: change.assigneeUserId || null,
        assigneeName: member ? member.displayName : null,
        status: 'open',
        priority: 'normal',
      };
      routes.set(change.chatId, value);
      return value;
    },
    async listConversationHandoffs() { return []; },
    async listConversationNotes() { return []; },
    async getLeadState() { return null; },
    async saveLeadState(lead) { return lead; },
  };
}

async function setup(t) {
  const agent = { id: 'agent-1', userId: 'agent-1', companyId: 'company-1', email: 'agent1@example.com', displayName: 'Agent 1', role: 'agent' };
  const otherAgent = { id: 'agent-2', userId: 'agent-2', companyId: 'company-1', email: 'agent2@example.com', displayName: 'Agent 2', role: 'agent' };
  const routes = new Map();
  const app = await buildApp({
    logger: false,
    startupEnabled: false,
    demoMode: true,
    database: buildDatabase(routes, agent, otherAgent),
    sessionSecret: 'mark-read-secret',
  });
  t.after(() => app.close());
  const signIn = async (user) => {
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'agent-pass-123' } });
    assert.equal(login.statusCode, 200);
    return login.headers['set-cookie'].split(';')[0];
  };
  return { app, routes, agent, otherAgent, cookie: await signIn(agent), otherCookie: await signIn(otherAgent) };
}

const unreadOf = async (app, cookie, chatId) => {
  const list = await app.inject({ method: 'GET', url: '/v1/chats?limit=20', headers: { cookie } });
  assert.equal(list.statusCode, 200);
  const chat = list.json().chats.find((item) => item.id === chatId);
  assert.ok(chat, `chat ${chatId} tidak ada di daftar`);
  return chat.unreadCount;
};

test('agent boleh menandai-dibaca percakapan yang belum dipegang siapa pun', async (t) => {
  const { app, cookie } = await setup(t);

  // Prasyarat: chat ini memang belum diklaim, terlihat di inbox, dan unread.
  assert.equal(await unreadOf(app, cookie, UNCLAIMED), 2);
  const read = await app.inject({ method: 'GET', url: `/v1/chats/${UNCLAIMED}/messages`, headers: { cookie } });
  assert.equal(read.statusCode, 200);

  const markRead = await app.inject({ method: 'POST', url: `/v1/chats/${UNCLAIMED}/mark-read`, headers: { cookie } });
  assert.equal(markRead.statusCode, 200);

  // Inti perbaikannya: badge ikut turun. Dengan 403 yang lama badge tetap 2,
  // jadi ia muncul lagi setiap reload padahal agent sudah membacanya.
  assert.equal(await unreadOf(app, cookie, UNCLAIMED), 0);
});

test('mark-read tidak melonggarkan aturan ambil-alih untuk aksi lain', async (t) => {
  const { app, cookie } = await setup(t);

  // Menulis ke percakapan yang belum dipegang tetap harus mengambil alih dulu.
  const note = await app.inject({ method: 'POST', url: `/v1/chats/${UNCLAIMED}/notes`, headers: { cookie }, payload: { body: 'catatan' } });
  assert.equal(note.statusCode, 403);
  const send = await app.inject({ method: 'POST', url: '/v1/messages/send', headers: { cookie }, payload: { chatId: UNCLAIMED, text: 'halo' } });
  assert.equal(send.statusCode, 403);
  assert.match(send.json().error, /Ambil alih/);

  // Menandai-dibaca lebih dulu tidak diam-diam memberi hak membalas.
  assert.equal((await app.inject({ method: 'POST', url: `/v1/chats/${UNCLAIMED}/mark-read`, headers: { cookie } })).statusCode, 200);
  const sendAfter = await app.inject({ method: 'POST', url: '/v1/messages/send', headers: { cookie }, payload: { chatId: UNCLAIMED, text: 'halo' } });
  assert.equal(sendAfter.statusCode, 403);
});

test('percakapan yang dipegang agent lain tetap tertutup, termasuk untuk mark-read', async (t) => {
  const { app, routes, otherAgent, cookie, otherCookie } = await setup(t);

  const claim = await app.inject({
    method: 'POST', url: `/v1/chats/${HELD_BY_OTHER}/routing`, headers: { cookie: otherCookie },
    payload: { mode: 'human', assigneeUserId: otherAgent.id },
  });
  assert.equal(claim.statusCode, 200);
  assert.equal(routes.get(HELD_BY_OTHER).assigneeUserId, otherAgent.id);

  const markRead = await app.inject({ method: 'POST', url: `/v1/chats/${HELD_BY_OTHER}/mark-read`, headers: { cookie } });
  assert.equal(markRead.statusCode, 403);
  assert.match(markRead.json().error, /agent lain/);

  // Dan yang memegangnya tentu saja boleh.
  const ownMarkRead = await app.inject({ method: 'POST', url: `/v1/chats/${HELD_BY_OTHER}/mark-read`, headers: { cookie: otherCookie } });
  assert.equal(ownMarkRead.statusCode, 200);
});
