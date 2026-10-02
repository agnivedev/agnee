'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildApp } = require('../src/server');
const Database = require('../src/database.js');

/*
 * Agnive Insight → Agnee: copies of Agnive Hub conversations (funder ↔
 * research team). Signed, time-boxed, and always the whole thread, so a late
 * or repeated delivery can only ever leave the newest state behind.
 */

const SECRET = 'insight-webhook-test-secret';
const owner = { id: 'owner-1', companyId: 'company-agnive', email: 'own@agnive.test', displayName: 'Owner', role: 'owner' };
const agent = { id: 'agent-1', companyId: 'company-agnive', email: 'ag@agnive.test', displayName: 'Agent', role: 'agent' };

function payload(overrides = {}) {
  return {
    version: 1,
    source: 'hub',
    thread: {
      externalId: 'inq-1',
      status: 'open',
      contact: { name: 'Rina', email: 'rina@modal.co', organization: 'Modal Ventura' },
      context: { listingSlug: 'pinara', productName: 'Pinara', kind: 'funding', amount: 250000000 },
      anonymizedAt: null,
      startedAt: '2026-10-02T08:20:00.000Z',
      lastMessageAt: '2026-10-02T08:21:00.000Z',
      messages: [
        { externalId: 'inq-1:opening', author: 'contact', authorName: 'Rina', body: 'Kami tertarik.', occurredAt: '2026-10-02T08:20:00.000Z' },
        { externalId: 'msg-1', author: 'team', authorName: 'Andi', body: 'Terima kasih.', occurredAt: '2026-10-02T08:21:00.000Z' },
      ],
      ...overrides,
    },
  };
}

function signed(body, { secret = SECRET, timestamp = Date.now() } = {}) {
  const raw = JSON.stringify(body);
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-agnive-timestamp': String(timestamp), 'x-agnive-signature': signature } };
}

async function app(t, { secret = SECRET, company = 'agnive', sourceEnabled = true, outcome = { created: true, newContactMessages: 1 } } = {}) {
  const synced = [];
  const bells = [];
  const switches = [];
  const database = {
    connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(ref) { return ref === 'agnive' ? 'company-agnive' : null; },
    async authenticateUser(email, password) { return password !== 'pass-12345' ? null : [owner, agent].find((u) => u.email === email) || null; },
    async getActiveSessionUser(userId) { return [owner, agent].find((u) => u.id === userId) || null; },
    async setPresence() {},
    async syncExternalThread(companyId, source, thread) { synced.push({ companyId, source, thread }); return { id: 'thread-uuid-1', ...outcome }; },
    async isExternalSourceEnabled() { return sourceEnabled; },
    async createHubNotifications(input, companyId) { bells.push({ ...input, companyId }); return ['owner-1']; },
    async listExternalSources() { return [{ source: 'hub', enabled: sourceEnabled, lastReceivedAt: '2026-10-03T00:00:00Z', threadCount: 2 }]; },
    async setExternalSourceEnabled(companyId, source, enabled) { switches.push({ companyId, source, enabled }); return enabled; },
    async recordAuditLog() { return { id: 1 }; },
    async listConversationNotes() { return []; },
    async listExternalThreads() { return [{ id: 'thread-uuid-1', source: 'hub' }]; },
    async getExternalThread(_c, id) { return id === 'thread-uuid-1' ? { id, messages: [] } : null; },
  };
  process.env.INSIGHT_WEBHOOK_SECRET = secret;
  process.env.INSIGHT_WEBHOOK_COMPANY = company;
  const instance = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'iw-session' });
  delete process.env.INSIGHT_WEBHOOK_SECRET;
  delete process.env.INSIGHT_WEBHOOK_COMPANY;
  t.after(() => instance.close());
  return { server: instance, synced, bells, switches };
}

test('kiriman bertanda tangan benar tersimpan sebagai satu thread', async (t) => {
  const { server, synced } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload()) });
  assert.equal(res.statusCode, 200);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].companyId, 'company-agnive');
  assert.equal(synced[0].source, 'hub');
  assert.equal(synced[0].thread.messages.length, 2);
  assert.equal(synced[0].thread.contact.email, 'rina@modal.co');
});

test('tanpa tanda tangan, salah rahasia, atau isi diubah: ditolak', async (t) => {
  const { server, synced } = await app(t);
  const none = await server.inject({ method: 'POST', url: '/webhook/insight', payload: payload() });
  assert.equal(none.statusCode, 401);
  const wrong = await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload(), { secret: 'lain' }) });
  assert.equal(wrong.statusCode, 401);
  const good = signed(payload());
  const tampered = await server.inject({ method: 'POST', url: '/webhook/insight', headers: good.headers, payload: good.payload.replace('Kami tertarik', 'Kami MUNDUR') });
  assert.equal(tampered.statusCode, 401);
  assert.equal(synced.length, 0);
});

test('kiriman lama (lebih dari 5 menit) tidak bisa diputar ulang', async (t) => {
  const { server, synced } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload(), { timestamp: Date.now() - 6 * 60_000 }) });
  assert.equal(res.statusCode, 401);
  assert.equal(synced.length, 0);
});

test('isi yang tidak sesuai bentuk ditolak', async (t) => {
  const { server } = await app(t);
  const bad = payload({ messages: [{ externalId: 'x', author: 'robot', body: 'hi', occurredAt: '2026-10-02T08:20:00Z' }] });
  const res = await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(bad) });
  assert.equal(res.statusCode, 400);
});

test('pintu tertutup bila rahasia belum diatur', async (t) => {
  const { server } = await app(t, { secret: '' });
  const res = await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload()) });
  assert.equal(res.statusCode, 404);
});

test('pintu tertutup bila company penerima tidak disebut — tidak ada company bawaan', async (t) => {
  const { server, synced } = await app(t, { company: '' });
  const res = await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload()) });
  assert.equal(res.statusCode, 404);
  assert.equal(synced.length, 0);
});

test('salinan hanya bisa dibaca supervisor', async (t) => {
  const { server } = await app(t);
  const login = async (user) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  const asAgent = await server.inject({ method: 'GET', url: '/v1/external/threads?source=hub', headers: { cookie: await login(agent) } });
  assert.equal(asAgent.statusCode, 403);
  const cookie = await login(owner);
  const list = await server.inject({ method: 'GET', url: '/v1/external/threads?source=hub', headers: { cookie } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().threads.length, 1);
  const one = await server.inject({ method: 'GET', url: '/v1/external/threads/thread-uuid-1', headers: { cookie } });
  assert.equal(one.statusCode, 200);
});

/* The SQL itself, against real Postgres — skipped without DATABASE_URL (CI has one). */
test('syncExternalThread: menimpa, tidak menggandakan, dan anonimisasi ikut', { skip: !process.env.DATABASE_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const companyId = await db.resolveCompanyId('tradersmastermind');
  const externalId = `test-hub-${Date.now()}`;
  t.after(async () => {
    await db.pool.query('DELETE FROM external_threads WHERE external_id = $1', [externalId]);
    await db.close();
  });
  const base = payload({ externalId }).thread;
  const parsed = (thread) => ({ ...thread, contact: { ...thread.contact } });

  const first = await db.syncExternalThread(companyId, 'hub', parsed(base));
  const id = first.id;
  assert.equal(first.created, true);
  assert.equal(first.newContactMessages, 1, 'the opening message is the funder\'s');
  const again = await db.syncExternalThread(companyId, 'hub', parsed(base));
  assert.equal(again.id, id, 'same thread, not a second one');
  assert.equal(again.created, false);
  assert.equal(again.newContactMessages, 0, 'a re-delivery is not news');
  let thread = await db.getExternalThread(companyId, id);
  assert.equal(thread.messages.length, 2);

  const third = { externalId: 'msg-2', author: 'contact', authorName: 'Rina', body: 'Rabu cocok.', occurredAt: '2026-10-02T08:30:00.000Z' };
  const reply = await db.syncExternalThread(companyId, 'hub', parsed({ ...base, status: 'closed', lastMessageAt: third.occurredAt, messages: [...base.messages, third] }));
  assert.equal(reply.newContactMessages, 1);
  thread = await db.getExternalThread(companyId, id);
  assert.equal(thread.status, 'closed');
  assert.equal(thread.messages.length, 3);

  const wiped = {
    ...base, anonymizedAt: '2026-10-03T00:00:00.000Z', contact: { name: '(dihapus)', email: '', organization: null },
    messages: [...base.messages, third].map((m) => (m.author === 'contact' ? { ...m, body: '', authorName: null } : m)),
  };
  await db.syncExternalThread(companyId, 'hub', parsed(wiped));
  thread = await db.getExternalThread(companyId, id);
  assert.equal(thread.contactEmail, '');
  assert.ok(thread.anonymizedAt);
  assert.deepEqual(thread.messages.filter((m) => m.author === 'contact').map((m) => m.body), ['', '']);
  assert.equal(thread.messages.find((m) => m.author === 'team').body, 'Terima kasih.');

  const list = await db.listExternalThreads(companyId, { source: 'hub' });
  assert.ok(list.some((row) => row.id === id && row.messageCount === 3));

  // Kiriman lama berisi data pribadi datang terlambat (diulang, atau diputar
  // ulang dalam jendela 5 menit): anonimisasi tidak boleh terbalik.
  const replay = await db.syncExternalThread(companyId, 'hub', parsed({ ...base, status: 'closed', lastMessageAt: third.occurredAt, messages: [...base.messages, third] }));
  assert.equal(replay.id, id);
  assert.equal(replay.created, false);
  assert.equal(replay.newContactMessages, 0, 'a refused re-delivery rings nothing');
  thread = await db.getExternalThread(companyId, id);
  assert.ok(thread.anonymizedAt, 'tetap anonim');
  assert.equal(thread.contactEmail, '');
  assert.deepEqual(thread.messages.filter((m) => m.author === 'contact').map((m) => m.body), ['', '']);

  // The source switch, and the bell for supervisors only.
  assert.equal(await db.isExternalSourceEnabled(companyId, 'hub'), true);
  await db.setExternalSourceEnabled(companyId, 'hub', false);
  assert.equal(await db.isExternalSourceEnabled(companyId, 'hub'), false);
  const sources = await db.listExternalSources(companyId);
  assert.ok(sources.some((x) => x.source === 'hub' && x.enabled === false && x.lastReceivedAt));
  await db.setExternalSourceEnabled(companyId, 'hub', true);
  const rung = await db.createHubNotifications({ chatId: `hub:${id}`, body: 'uji' }, companyId);
  t.after(() => db.pool.query('DELETE FROM notifications WHERE chat_id = $1', [`hub:${id}`]).catch(() => {}));
  const roles = await db.pool.query(
    'SELECT DISTINCT m.role FROM company_members m WHERE m.company_id = $1 AND m.user_id = ANY($2::uuid[])', [companyId, rung]);
  assert.ok(roles.rows.every((r) => ['owner', 'admin', 'supervisor'].includes(r.role)));
});

test('syncExternalThread: kiriman yang lebih lama tidak menimpa, pesan yang hilang di sumber ikut hilang', { skip: !process.env.DATABASE_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const companyId = await db.resolveCompanyId('tradersmastermind');
  const externalId = `test-hub-order-${Date.now()}`;
  t.after(async () => {
    await db.pool.query('DELETE FROM external_threads WHERE external_id = $1', [externalId]);
    await db.close();
  });
  const base = payload({ externalId }).thread;
  const parsed = (thread) => ({ ...thread, contact: { ...thread.contact } });
  const third = { externalId: 'msg-2', author: 'contact', authorName: 'Rina', body: 'Rabu cocok.', occurredAt: '2026-10-02T08:30:00.000Z' };

  const { id } = await db.syncExternalThread(companyId, 'hub', parsed({ ...base, status: 'closed', lastMessageAt: third.occurredAt, messages: [...base.messages, third] }));
  await db.syncExternalThread(companyId, 'hub', parsed(base)); // lebih lama
  let thread = await db.getExternalThread(companyId, id);
  assert.equal(thread.status, 'closed');
  assert.equal(thread.messages.length, 3);

  await db.syncExternalThread(companyId, 'hub', parsed({ ...base, lastMessageAt: third.occurredAt, messages: [base.messages[0]] }));
  thread = await db.getExternalThread(companyId, id);
  assert.equal(thread.messages.length, 1);
});

test('percakapan baru membunyikan lonceng supervisor, dengan tautan hub:', async (t) => {
  const { server, bells } = await app(t);
  await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload()) });
  assert.equal(bells.length, 1);
  assert.equal(bells[0].chatId, 'hub:thread-uuid-1');
  assert.match(bells[0].body, /Percakapan baru di Agnive Hub: Rina — Pinara/);
});

test('balasan tim atau kiriman ulang tidak membunyikan lonceng', async (t) => {
  const { server, bells } = await app(t, { outcome: { created: false, newContactMessages: 0 } });
  await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload()) });
  assert.equal(bells.length, 0);
});

test('balasan baru dari pendana membunyikan lonceng', async (t) => {
  const { server, bells } = await app(t, { outcome: { created: false, newContactMessages: 1 } });
  await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload()) });
  assert.match(bells[0].body, /Rina membalas di Agnive Hub/);
});

test('sumber dimatikan: pesan tetap disimpan, lonceng diam', async (t) => {
  const { server, synced, bells } = await app(t, { sourceEnabled: false });
  const res = await server.inject({ method: 'POST', url: '/webhook/insight', ...signed(payload()) });
  assert.equal(res.statusCode, 200);
  assert.equal(synced.length, 1);
  assert.equal(bells.length, 0);
});

const loginAs = async (server, user) =>
  (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];

test('saklar sumber: hanya supervisor, dan nama sumber yang tidak dikenal ditolak', async (t) => {
  const { server, switches } = await app(t);
  const agentCookie = await loginAs(server, agent);
  assert.equal((await server.inject({ method: 'GET', url: '/v1/integrations/sources', headers: { cookie: agentCookie } })).statusCode, 403);
  assert.equal((await server.inject({ method: 'PATCH', url: '/v1/integrations/sources/hub', headers: { cookie: agentCookie }, payload: { enabled: false } })).statusCode, 403);
  const cookie = await loginAs(server, owner);
  const list = await server.inject({ method: 'GET', url: '/v1/integrations/sources', headers: { cookie } });
  assert.deepEqual(list.json().sources.map((x) => [x.source, x.name, x.threadCount]), [['hub', 'Agnive Hub', 2]]);
  const off = await server.inject({ method: 'PATCH', url: '/v1/integrations/sources/hub', headers: { cookie }, payload: { enabled: false } });
  assert.equal(off.statusCode, 200);
  assert.deepEqual(switches, [{ companyId: 'company-agnive', source: 'hub', enabled: false }]);
  const unknown = await server.inject({ method: 'PATCH', url: '/v1/integrations/sources/shopee', headers: { cookie }, payload: { enabled: true } });
  assert.equal(unknown.statusCode, 400);
});

test('catatan di percakapan hub: hanya supervisor yang bisa membaca atau menulis', async (t) => {
  const { server } = await app(t);
  const agentCookie = await loginAs(server, agent);
  const url = '/v1/chats/hub:thread-uuid-1/notes';
  assert.equal((await server.inject({ method: 'GET', url, headers: { cookie: agentCookie } })).statusCode, 403);
  assert.equal((await server.inject({ method: 'POST', url, headers: { cookie: agentCookie }, payload: { body: 'halo' } })).statusCode, 403);
  const cookie = await loginAs(server, owner);
  assert.equal((await server.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 200);
});
