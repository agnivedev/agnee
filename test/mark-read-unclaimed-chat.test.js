'use strict';

/**
 * Dua aturan yang bertemu di `POST /v1/chats/:chatId/mark-read`.
 *
 * 1. Rutenya mengikuti aturan MEMBACA, bukan MENULIS. Agent boleh membuka
 *    percakapan yang belum dipegang siapa pun — dia harus membacanya dulu
 *    sebelum memutuskan mau mengambil alih. Tapi `mark-read` kebetulan sebuah
 *    POST, jadi dulu ia ikut tertolak gerbang "ambil alih dulu": tiga baris
 *    403 di console peramban setiap kali agent membuka chat.
 *
 * 2. Tapi AGENT yang mengintip percakapan yang belum dipegang siapa pun tidak
 *    mengirim centang biru. Dia belum memutuskan mau menanganinya atau tidak,
 *    dan customer yang melihat "sudah dibaca" akan menunggu jawaban yang belum
 *    tentu datang. Rutenya menjawab 200 `seen: false` tanpa memanggil
 *    `sendSeen`, dan badge unread-nya sengaja TETAP menyala: percakapannya
 *    memang masih menunggu seseorang.
 *
 *    Supervisor dikecualikan — inbox itu memang miliknya, jadi "supervisor
 *    sudah membacanya" sama saja dengan "perusahaan sudah membacanya". Kalau
 *    dia pun tidak menandai, badge inbox tidak pernah bisa dibersihkan oleh
 *    siapa pun yang berhak membersihkannya.
 *
 * Mengirim pesan tetap harus mengambil alih dulu, dan percakapan milik agent
 * lain tetap tertutup rapat.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const UNCLAIMED = '6281200000001@c.us'; // demoDataset: unreadCount 2
const HELD_BY_OTHER = '6281200000003@c.us';

function buildDatabase(routes, members) {
  const byId = new Map(members.map((user) => [user.id, user]));
  return {
    connected: true, companyId: 'company-1',
    async connect() {}, async close() {}, status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) {
      const found = members.find((user) => user.email === email);
      return found && password === 'agent-pass-123' ? found : null;
    },
    async getActiveSessionUser(userId) { return byId.get(userId) || null; },
    async setPresence() {},
    async listTeamMembers() { return members.map((user) => ({ ...user, status: 'active' })); },
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
  const supervisor = { id: 'supervisor-1', userId: 'supervisor-1', companyId: 'company-1', email: 'owner@example.com', displayName: 'Supervisor', role: 'supervisor' };
  const routes = new Map();
  const app = await buildApp({
    logger: false,
    startupEnabled: false,
    demoMode: true,
    database: buildDatabase(routes, [agent, otherAgent, supervisor]),
    sessionSecret: 'mark-read-secret',
  });
  t.after(() => app.close());
  const signIn = async (user) => {
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'agent-pass-123' } });
    assert.equal(login.statusCode, 200);
    return login.headers['set-cookie'].split(';')[0];
  };
  return {
    app, routes, agent, otherAgent, supervisor,
    cookie: await signIn(agent),
    otherCookie: await signIn(otherAgent),
    supervisorCookie: await signIn(supervisor),
  };
}

const unreadOf = async (app, cookie, chatId) => {
  const list = await app.inject({ method: 'GET', url: '/v1/chats?limit=20', headers: { cookie } });
  assert.equal(list.statusCode, 200);
  const chat = list.json().chats.find((item) => item.id === chatId);
  assert.ok(chat, `chat ${chatId} tidak ada di daftar`);
  return chat.unreadCount;
};

test('agent membuka chat yang belum diambil: tidak ditolak, tapi juga tidak dikirimi centang biru', async (t) => {
  const { app, cookie } = await setup(t);

  // Prasyarat: chat ini memang belum diklaim, terlihat di inbox, dan unread.
  assert.equal(await unreadOf(app, cookie, UNCLAIMED), 2);
  const read = await app.inject({ method: 'GET', url: `/v1/chats/${UNCLAIMED}/messages`, headers: { cookie } });
  assert.equal(read.statusCode, 200);

  // Tidak lagi 403 — tidak ada baris merah di console, dan UI tidak perlu
  // menebak-nebak kapan boleh memanggil rutenya.
  const markRead = await app.inject({ method: 'POST', url: `/v1/chats/${UNCLAIMED}/mark-read`, headers: { cookie } });
  assert.equal(markRead.statusCode, 200);

  // Tapi jawabannya jujur: tidak ada yang ditandai, jadi tidak ada centang
  // biru yang terkirim ke customer.
  assert.equal(markRead.json().seen, false);
  assert.equal(markRead.json().reason, 'unclaimed');

  // Dan karena itu badge-nya sengaja tetap menyala — percakapannya masih
  // menunggu seseorang, dan itulah yang harus dilihat seluruh tim.
  assert.equal(await unreadOf(app, cookie, UNCLAIMED), 2);
});

test('centang biru terkirim begitu chatnya diambil', async (t) => {
  const { app, agent, cookie } = await setup(t);

  const claim = await app.inject({
    method: 'POST', url: `/v1/chats/${UNCLAIMED}/routing`, headers: { cookie },
    payload: { mode: 'human', assigneeUserId: agent.id },
  });
  assert.equal(claim.statusCode, 200);

  const markRead = await app.inject({ method: 'POST', url: `/v1/chats/${UNCLAIMED}/mark-read`, headers: { cookie } });
  assert.equal(markRead.statusCode, 200);
  assert.equal(markRead.json().seen, true);
  assert.equal(await unreadOf(app, cookie, UNCLAIMED), 0);
});

test('supervisor tetap menandai sudah dibaca, walau chatnya belum diambil siapa pun', async (t) => {
  // Inbox itu memang miliknya. Kalau dia pun tidak menandai, badge inbox tidak
  // pernah bisa dibersihkan oleh siapa pun yang berhak membersihkannya.
  const { app, supervisorCookie } = await setup(t);

  assert.equal(await unreadOf(app, supervisorCookie, UNCLAIMED), 2);
  const markRead = await app.inject({ method: 'POST', url: `/v1/chats/${UNCLAIMED}/mark-read`, headers: { cookie: supervisorCookie } });
  assert.equal(markRead.statusCode, 200);
  assert.equal(markRead.json().seen, true);
  assert.equal(await unreadOf(app, supervisorCookie, UNCLAIMED), 0);
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

  // Dan yang memegangnya tentu saja boleh — di situ centang birunya jujur.
  const ownMarkRead = await app.inject({ method: 'POST', url: `/v1/chats/${HELD_BY_OTHER}/mark-read`, headers: { cookie: otherCookie } });
  assert.equal(ownMarkRead.statusCode, 200);
  assert.equal(ownMarkRead.json().seen, true);
});
