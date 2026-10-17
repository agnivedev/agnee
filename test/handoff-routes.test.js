'use strict';

/**
 * Rute serah-terima terstruktur: alasan + batasan AI, mention departemen,
 * catatan jadi tugas, dan batasan yang sampai ke prompt AI.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server.js');

const COMPANY = 'co-1';
const CHAT = '6281200000001@c.us';
const sup = { id: '11111111-1111-4111-8111-111111111111', userId: '11111111-1111-4111-8111-111111111111', companyId: COMPANY, email: 'sup@t.test', displayName: 'Sup', role: 'owner', status: 'active' };
const agent = { id: '22222222-2222-4222-8222-222222222222', userId: '22222222-2222-4222-8222-222222222222', companyId: COMPANY, email: 'ag@t.test', displayName: 'Agen', role: 'agent', status: 'active' };
const budi = { id: '33333333-3333-4333-8333-333333333333', userId: '33333333-3333-4333-8333-333333333333', companyId: COMPANY, email: 'budi@t.test', displayName: 'Budi', role: 'agent', status: 'active' };
const sari = { id: '44444444-4444-4444-8444-444444444444', userId: '44444444-4444-4444-8444-444444444444', companyId: COMPANY, email: 'sari@t.test', displayName: 'Sari', role: 'agent', status: 'active' };
const DEPT = '55555555-5555-4555-8555-555555555555';
const users = [sup, agent, budi, sari];

function makeDb(state) {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'pass-12345' ? users.find((u) => u.email === email) || null : null; },
    async getActiveSessionUser(id) { return users.find((u) => u.id === id) || null; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', whatsappProvider: 'cloud_api' }; },
    async listTeamMembers() { return users.map((u) => ({ ...u, presence: 'online' })); },
    async listMentionableUsers() { return users.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email, role: u.role })); },
    async listDepartments() {
      return [
        { id: DEPT, name: 'Product', description: 'x', members: [
          { userId: agent.id, displayName: 'Agen', email: agent.email, whatsappNumber: '081200000010' },
          { userId: budi.id, displayName: 'Budi', email: budi.email, whatsappNumber: null },
          { userId: sari.id, displayName: 'Sari', email: sari.email, whatsappNumber: '081200000011' },
        ] },
        { id: 'kosong', name: 'Kosong', description: '', members: [] },
      ];
    },
    async getConversationRouting(chat) { return state.routings[chat] || state.routing; },
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async incrementAiMessageCount() { return { exceeded: false }; },
    async saveConversationRouting(change) { state.saved.push(change); state.routing = { ...state.routing, mode: change.mode, assigneeUserId: change.assigneeUserId || null, dueAt: change.dueAt || null }; return state.routing; },
    async getConversationNote(id, chat) { return id === 7 && chat !== 'lain@c.us' ? { id: 7, body: 'Telepon Budi soal pengiriman\nbesok' } : null; },
    async addConversationNote(chat, uid, body) { const note = { id: 100 + state.notes.length, body, chatId: chat }; state.notes.push(note); return note; },
    async createMentionNotifications(input) { state.notifs.push(input); return input.mentions.filter((m) => m.kind === 'user').map((m) => m.id); },
    async createTaskNotification(input) { state.taskNotifs.push(input); return [input.userId]; },
    async getAiConstraints() { return state.constraints; },
    async recordCloudMessage() {},
    async getCloudChatNumber() { return { id: 'n1', phoneNumberId: 'pn-1', accessToken: 'tok', isActive: true, status: 'connected' }; },
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

async function boot(t, { llmService } = {}) {
  const state = { routing: { mode: 'ai', assigneeUserId: null, status: 'open', priority: 'normal' }, saved: [], routings: {}, notes: [], notifs: [], taskNotifs: [], constraints: null, sent: [] };
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      state.sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${state.sent.length}` }] }), { status: 200 });
    }
    return realFetch(url, init);
  };
  t.after(() => { global.fetch = realFetch; });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: false, database: makeDb(state), sessionSecret: 'handoff-routes', llmService });
  t.after(() => app.close());
  const login = async (u) => (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: u.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { app, state, supCookie: await login(sup), agentCookie: await login(agent) };
}

const post = (app, cookie, url, payload) => app.inject({ method: 'POST', url, headers: { cookie }, payload });

test('alasan dan batasan AI diteruskan; alasan di luar daftar ditolak; tiap arah hanya membawa miliknya', async (t) => {
  const { app, state, supCookie } = await boot(t);
  const url = `/v1/chats/${CHAT}/routing`;
  assert.equal((await post(app, supCookie, url, { mode: 'human', reason: 'ngawur' })).statusCode, 400);

  let res = await post(app, supCookie, url, { mode: 'human', assigneeUserId: agent.id, reason: 'price_decision', note: 'minta diskon', aiConstraints: 'abaikan' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(state.saved[0].reason, 'price_decision');
  assert.equal(state.saved[0].aiConstraints, undefined, 'batasan AI tidak ikut saat ke manusia');
  assert.equal(state.saved[0].note, 'minta diskon');

  res = await post(app, supCookie, url, { mode: 'ai', reason: 'price_decision', aiConstraints: 'Jangan beri diskon.' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(state.saved[1].aiConstraints, 'Jangan beri diskon.');
  assert.equal(state.saved[1].reason, undefined, 'alasan tidak ikut saat kembali ke AI');
  assert.equal((await post(app, supCookie, url, { mode: 'ai', aiConstraints: 'x'.repeat(801) })).statusCode, 400);
});

test('batasan manusia sampai ke prompt AI dan dilarang disebut ke customer', async (t) => {
  const prompts = [];
  const llmService = { enabled: true, model: 'uji', async generateReply(_t, o) { prompts.push(o.systemPrompt); return { text: 'Siap.' }; } };
  const { app, state, supCookie } = await boot(t, { llmService });
  state.constraints = 'Jangan beri diskon, jangan janjikan tanggal kirim.';
  const res = await post(app, supCookie, `/v1/chats/${CHAT}/notes`, { body: '@AI apa status chat ini?', mentions: [{ kind: 'ai' }] });
  assert.equal(res.statusCode, 201, res.body);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(prompts.length >= 1, 'AI tidak dipanggil');
  assert.match(prompts[0], /Jangan beri diskon, jangan janjikan tanggal kirim\./);
  assert.match(prompts[0], /JANGAN menyebut, mengutip, atau mengisyaratkan batasan ini ke customer/);
  prompts.length = 0;
  state.constraints = null;
  await post(app, supCookie, `/v1/chats/${CHAT}/notes`, { body: '@AI halo', mentions: [{ kind: 'ai' }] });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!/BATASAN DARI TIM/.test(prompts[0] || ''), 'tanpa batasan tidak ada blok');
});

test('daftar mention memuat departemen berisi (nama saja, tanpa anggota)', async (t) => {
  const { app, agentCookie } = await boot(t);
  const res = (await app.inject({ method: 'GET', url: '/v1/mentionables', headers: { cookie: agentCookie } })).json();
  assert.deepEqual(res.departments, [{ id: DEPT, name: 'Product' }]);
  assert.ok(res.users.length >= 3);
});

test('@Departemen memberi tahu semua anggota (lonceng + WhatsApp bila ada nomor), kecuali penulis; tanpa dobel', async (t) => {
  const { app, state, supCookie, agentCookie } = await boot(t);
  state.routing = { mode: 'human', assigneeUserId: agent.id, status: 'open', priority: 'normal' };
  // agent (anggota Product) menulis dan juga menyebut Budi secara pribadi
  const res = await post(app, agentCookie, `/v1/chats/${CHAT}/notes`, {
    body: '@Product mohon cek stok, @Budi tolong lihat juga',
    mentions: [{ kind: 'department', id: DEPT }, { kind: 'user', id: budi.id }, { kind: 'department', id: 'bukan-milik-company' }],
  });
  assert.equal(res.statusCode, 201, res.body);
  await new Promise((r) => setTimeout(r, 100));
  const stored = state.notes[0];
  assert.ok(stored);
  const deptCalls = state.notifs.filter((n) => /^@Product:/.test(n.body));
  assert.equal(deptCalls.length, 1);
  const recipients = deptCalls[0].mentions.map((m) => m.id);
  assert.deepEqual(recipients, [sari.id], 'penulis dan Budi (sudah di-mention pribadi) tidak dobel');
  assert.equal(deptCalls[0].actorUserId, agent.id);
  // WhatsApp: hanya yang punya nomor dan bukan penulis -> Sari saja
  assert.equal(state.sent.length, 1);
  assert.match(state.sent[0].to, /^6281200000011/);
  assert.match(state.sent[0].text.body, /menyebut tim Product/);
  assert.match(state.sent[0].text.body, /tidak dikirim ke customer/);
  // customer tidak pernah menerima apa pun
  assert.ok(state.sent.every((m) => !String(m.to).includes('6281200000001')));

  // supervisor menulis: semua anggota (3) dapat lonceng, dua bernomor dapat WhatsApp
  state.notifs.length = 0; state.sent.length = 0;
  await post(app, supCookie, `/v1/chats/${CHAT}/notes`, { body: '@Product halo', mentions: [{ kind: 'department', id: DEPT }] });
  await new Promise((r) => setTimeout(r, 100));
  const all = state.notifs.find((n) => /^@Product:/.test(n.body));
  assert.deepEqual(all.mentions.map((m) => m.id).sort(), [agent.id, budi.id, sari.id].sort());
  assert.equal(state.sent.length, 2);
});

test('mention departemen tak dikenal dibuang dan tidak mengirim apa pun', async (t) => {
  const { app, state, supCookie } = await boot(t);
  const res = await post(app, supCookie, `/v1/chats/${CHAT}/notes`, { body: '@Hantu halo', mentions: [{ kind: 'department', id: 'bukan-milik-company' }] });
  assert.equal(res.statusCode, 201);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(state.sent.length, 0);
  assert.equal(state.notifs.length, 0);
});

test('catatan jadi tugas: pemilik, tenggat, prioritas; notifikasi penugasan jalan', async (t) => {
  const { app, state, supCookie } = await boot(t);
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const res = await post(app, supCookie, `/v1/chats/${CHAT}/notes/7/task`, { assigneeUserId: budi.id, dueAt: due, priority: 'high' });
  assert.equal(res.statusCode, 201, res.body);
  const saved = state.saved[0];
  assert.equal(saved.mode, 'human');
  assert.equal(saved.assigneeUserId, budi.id);
  assert.equal(saved.priority, 'high');
  assert.equal(saved.dueAt, due);
  assert.equal(saved.taskNoteId, 7);
  assert.match(saved.note, /^Tugas dari catatan: Telepon Budi soal pengiriman besok/);
  assert.equal(state.taskNotifs[0].userId, budi.id);
  assert.equal(res.json().routing.assigneeUserId, budi.id);
});

test('catatan jadi tugas: tanpa isian = untuk diri sendiri; validasi dan izin', async (t) => {
  const { app, state, supCookie, agentCookie } = await boot(t);
  const url = `/v1/chats/${CHAT}/notes/7/task`;
  state.routing = { mode: 'human', assigneeUserId: agent.id, status: 'open', priority: 'normal' };
  assert.equal((await post(app, agentCookie, url, {})).statusCode, 201);
  assert.equal(state.saved[0].assigneeUserId, agent.id);
  assert.equal(state.saved[0].dueAt, null);
  assert.equal((await post(app, agentCookie, url, { assigneeUserId: budi.id })).statusCode, 403, 'agent tak boleh menugaskan orang lain');
  assert.equal((await post(app, supCookie, url, { dueAt: 'kapan-kapan' })).statusCode, 400);
  assert.equal((await post(app, supCookie, url, { dueAt: new Date(Date.now() - 86_400_000).toISOString() })).statusCode, 400);
  assert.equal((await post(app, supCookie, url, { assigneeUserId: '99999999-9999-4999-8999-999999999999' })).statusCode, 400);
  assert.equal((await post(app, supCookie, `/v1/chats/${CHAT}/notes/8/task`, {})).statusCode, 404);
  assert.equal((await post(app, supCookie, `/v1/chats/lain@c.us/notes/7/task`, {})).statusCode, 404, 'catatan milik chat lain');
  // chat dipegang agent lain: agent biasa ditolak
  state.routings['6281299999999@c.us'] = { mode: 'human', assigneeUserId: budi.id, status: 'open', priority: 'normal' };
  assert.equal((await post(app, agentCookie, '/v1/chats/6281299999999@c.us/notes/7/task', {})).statusCode, 403);
});
