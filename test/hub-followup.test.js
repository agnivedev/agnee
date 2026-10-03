'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { addWorkingDays, hubReplyDueAt, workingDaysSince } = require('../src/hub-followup');
const { buildApp } = require('../src/server');
const Database = require('../src/database.js');

/*
 * Agnee Express, Fase 4 (Hanny, 3 Oct 2026): a funder who has waited two
 * working days (Mon–Fri, Asia/Jakarta) for the research team rings Agnive
 * staff — the PJ if there is one, otherwise every supervisor — once per wait.
 */

const jkt = (iso) => new Date(`${iso}+07:00`).getTime();
const at = (ms) => new Date(ms).toISOString();

test('dua hari kerja melompati akhir pekan', () => {
  // Wednesday 10:00 → Friday 10:00
  assert.equal(at(addWorkingDays(jkt('2026-10-07T10:00:00'))), at(jkt('2026-10-09T10:00:00')));
  // Friday 16:00 → Tuesday 16:00
  assert.equal(at(addWorkingDays(jkt('2026-10-09T16:00:00'))), at(jkt('2026-10-13T16:00:00')));
  // Saturday 10:00 → Tuesday 10:00
  assert.equal(at(addWorkingDays(jkt('2026-10-10T10:00:00'))), at(jkt('2026-10-13T10:00:00')));
});

test('jatuh tempo hanya ada saat pendana yang terakhir menulis', () => {
  const funderLast = { status: 'open', messages: [{ author: 'team', occurredAt: '2026-10-05T03:00:00Z' }, { author: 'contact', occurredAt: '2026-10-07T03:00:00Z' }] };
  assert.equal(hubReplyDueAt(funderLast), at(jkt('2026-10-09T10:00:00')));
  assert.equal(hubReplyDueAt({ ...funderLast, messages: [...funderLast.messages, { author: 'team', occurredAt: '2026-10-07T05:00:00Z' }] }), null);
  assert.equal(hubReplyDueAt({ ...funderLast, status: 'closed' }), null);
  assert.equal(hubReplyDueAt({ ...funderLast, anonymizedAt: '2026-10-08T00:00:00Z' }), null);
});

test('hitungan hari kerja untuk kalimat pengingat', () => {
  assert.equal(workingDaysSince(jkt('2026-10-09T16:00:00'), jkt('2026-10-13T17:00:00')), 2); // Fri → Tue
});

const owner = { id: 'owner-1', companyId: 'c1', email: 'own@x.test', displayName: 'Rani', role: 'owner' };
const sup2 = { id: 'sup-2', companyId: 'c1', email: 'sup@x.test', displayName: 'Sari', role: 'supervisor' };
const agent = { id: 'agent-1', companyId: 'c1', email: 'ag@x.test', displayName: 'Budi', role: 'agent' };

function setup(t, { sourceEnabled = true, waiting = [] } = {}) {
  const reminders = [];
  const marked = [];
  const assigned = [];
  const tasks = [];
  const thread = { id: 't1', status: 'open', contactName: 'Rina', context: { productName: 'Pinara' }, messages: [], awaitingSince: '2026-10-07T03:00:00.000Z', assigneeUserId: null };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'pass-12345' ? [owner, sup2, agent].find((u) => u.email === email) || null : null; },
    async getActiveSessionUser(id) { return [owner, sup2, agent].find((u) => u.id === id) || null; },
    async setPresence() {},
    async getExternalThread(_c, id) { return id === 't1' ? { ...thread } : null; },
    async setExternalThreadAssignee(c, id, userId) { assigned.push(userId); thread.assigneeUserId = userId; return id; },
    async createTaskNotification(input) { tasks.push(input); return [input.userId]; },
    async listAwaitingExternalThreads() { return waiting; },
    async isExternalSourceEnabled() { return sourceEnabled; },
    async createHubReminder(input, companyId) { reminders.push({ ...input, companyId }); return [input.userId || 'all']; },
    async markExternalThreadReminded(id, since) { marked.push({ id, since }); },
  };
  return buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'hub-f4' })
    .then((app) => { t.after(() => app.close()); return { app, reminders, marked, assigned, tasks }; });
}
const login = async (app, user) => (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];

test('PJ: hanya supervisor yang menunjuk, dan PJ-nya harus supervisor', async (t) => {
  const { app, assigned, tasks } = await setup(t);
  const asAgent = await login(app, agent);
  assert.equal((await app.inject({ method: 'PATCH', url: '/v1/external/threads/t1', headers: { cookie: asAgent }, payload: { assigneeUserId: owner.id } })).statusCode, 403);
  const cookie = await login(app, owner);
  const toAgent = await app.inject({ method: 'PATCH', url: '/v1/external/threads/t1', headers: { cookie }, payload: { assigneeUserId: agent.id } });
  assert.equal(toAgent.statusCode, 400);
  const ok = await app.inject({ method: 'PATCH', url: '/v1/external/threads/t1', headers: { cookie }, payload: { assigneeUserId: sup2.id } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(assigned, [sup2.id]);
  assert.equal(tasks[0].userId, sup2.id);
  assert.equal(tasks[0].chatId, 'hub:t1');
  const cleared = await app.inject({ method: 'PATCH', url: '/v1/external/threads/t1', headers: { cookie }, payload: { assigneeUserId: null } });
  assert.equal(cleared.statusCode, 200);
  assert.equal(assigned[1], null);
});

test('pengingat: setelah 2 hari kerja, ke PJ kalau ada, sekali per masa tunggu', async (t) => {
  const waiting = [
    { id: 'due', companyId: 'c1', contactName: 'Rina', context: { productName: 'Pinara' }, awaitingSince: at(jkt('2026-10-07T10:00:00')), assigneeUserId: 'sup-2' },
    { id: 'notyet', companyId: 'c1', contactName: 'Hendra', context: { productName: 'Maggotin' }, awaitingSince: at(jkt('2026-10-09T09:00:00')), assigneeUserId: null },
  ];
  const { app, reminders, marked } = await setup(t, { waiting });
  const n = await app.runHubFollowUpSweep(jkt('2026-10-09T11:00:00')); // Friday 11:00
  assert.equal(n, 1);
  assert.equal(reminders[0].chatId, 'hub:due');
  assert.equal(reminders[0].userId, 'sup-2');
  assert.match(reminders[0].body, /Rina menunggu balasan tim 2 hari kerja — Pinara/);
  assert.deepEqual(marked, [{ id: 'due', since: waiting[0].awaitingSince }]);
});

test('pengingat: sumber dimatikan = diam, dan tidak ditandai', async (t) => {
  const waiting = [{ id: 'due', companyId: 'c1', contactName: 'Rina', context: {}, awaitingSince: at(jkt('2026-10-01T10:00:00')), assigneeUserId: null }];
  const { app, reminders, marked } = await setup(t, { waiting, sourceEnabled: false });
  assert.equal(await app.runHubFollowUpSweep(jkt('2026-10-09T11:00:00')), 0);
  assert.equal(reminders.length, 0);
  assert.equal(marked.length, 0);
});

/* The SQL, against real Postgres — skipped without DATABASE_URL (CI has one). */
test('awaiting_since, daftar menunggu, PJ, dan statistik di Postgres', { skip: !process.env.DATABASE_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const companyId = await db.resolveCompanyId('tradersmastermind');
  const externalId = `test-f4-${Date.now()}`;
  t.after(async () => {
    await db.pool.query('DELETE FROM external_threads WHERE external_id = $1', [externalId]);
    await db.close();
  });
  const base = {
    externalId, status: 'open', contact: { name: 'Rina', email: 'r@x.co', organization: null },
    context: { listingSlug: externalId, productName: 'Pinara', kind: 'funding', amount: 250000000 },
    anonymizedAt: null, startedAt: '2026-10-01T03:00:00.000Z', lastMessageAt: '2026-10-01T03:00:00.000Z',
    messages: [{ externalId: 'o', author: 'contact', authorName: 'Rina', body: 'Halo', occurredAt: '2026-10-01T03:00:00.000Z' }],
  };
  const { id } = await db.syncExternalThread(companyId, 'hub', base);
  let row = (await db.getExternalThread(companyId, id));
  assert.equal(new Date(row.awaitingSince).toISOString(), '2026-10-01T03:00:00.000Z');
  assert.ok((await db.listAwaitingExternalThreads('hub')).some((x) => x.id === id));

  await db.markExternalThreadReminded(id, row.awaitingSince);
  assert.ok(!(await db.listAwaitingExternalThreads('hub')).some((x) => x.id === id), 'reminded once');

  const replied = { ...base, lastMessageAt: '2026-10-02T03:00:00.000Z', messages: [...base.messages, { externalId: 'r', author: 'team', authorName: 'Andi', body: 'Hai', occurredAt: '2026-10-02T03:00:00.000Z' }] };
  await db.syncExternalThread(companyId, 'hub', replied);
  row = await db.getExternalThread(companyId, id);
  assert.equal(row.awaitingSince, null, 'the team had the last word');

  const again = { ...replied, lastMessageAt: '2026-10-03T03:00:00.000Z', messages: [...replied.messages, { externalId: 'f2', author: 'contact', authorName: 'Rina', body: 'Lalu?', occurredAt: '2026-10-03T03:00:00.000Z' }] };
  await db.syncExternalThread(companyId, 'hub', again);
  assert.ok((await db.listAwaitingExternalThreads('hub')).some((x) => x.id === id), 'a new wait can ring again');

  const sup = (await db.pool.query("SELECT user_id FROM company_members WHERE company_id = $1 AND role IN ('owner','admin','supervisor') AND status = 'active' LIMIT 1", [companyId])).rows[0]?.user_id;
  if (sup) {
    await db.setExternalThreadAssignee(companyId, id, sup);
    assert.equal((await db.getExternalThread(companyId, id)).assigneeUserId, sup);
    const rung = await db.createHubReminder({ chatId: `hub:${id}`, body: 'uji', userId: sup }, companyId);
    t.after(() => db.pool.query('DELETE FROM notifications WHERE chat_id = $1', [`hub:${id}`]).catch(() => {}));
    assert.deepEqual(rung, [sup]);
  }

  // Other test files write Hub threads into the same company at the same
  // time, so only what is ours is asserted exactly.
  const stats = await db.externalThreadStats(companyId, 'hub', 365);
  assert.ok(stats.total >= 1);
  assert.ok(stats.replied >= 1);
  assert.equal(typeof stats.medianFirstReplyHours, 'number');
  const mine = stats.byListing.find((x) => x.slug === externalId);
  assert.deepEqual(mine && { total: mine.total, awaiting: mine.awaiting }, { total: 1, awaiting: 1 });
});
