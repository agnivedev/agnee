'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const SUPERVISOR = {
  id: 'supervisor-1', userId: 'supervisor-1', companyId: 'company-1',
  email: 'owner@example.com', displayName: 'Supervisor', role: 'supervisor', status: 'active',
};
const AGENT = {
  id: 'agent-1', userId: 'agent-1', companyId: 'company-1',
  email: 'agent@example.com', displayName: 'Agent Satu', role: 'agent', status: 'active',
};
const OTHER_AGENT = {
  id: 'agent-2', userId: 'agent-2', companyId: 'company-1',
  email: 'agent2@example.com', displayName: 'Agent Dua', role: 'agent', status: 'active',
};

function fakeDatabase() {
  const routes = new Map();
  const notifications = [];
  const audits = [];
  const users = [SUPERVISOR, AGENT, OTHER_AGENT];
  return {
    routes, notifications, audits,
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) {
      const user = users.find((item) => item.email === email);
      return user && password === 'password-123' ? user : null;
    },
    async getActiveSessionUser(userId) { return users.find((item) => item.id === userId) || null; },
    async setPresence() {},
    async listTeamMembers() { return users; },
    async getConversationRouting(chatId) { return routes.get(chatId) || null; },
    async saveConversationRouting(change) {
      const member = users.find((item) => item.id === change.assigneeUserId);
      const value = {
        chatId: change.chatId,
        mode: change.mode,
        assigneeUserId: change.assigneeUserId || null,
        assigneeName: member?.displayName || null,
        status: change.status || 'open',
        priority: change.priority || 'normal',
      };
      routes.set(change.chatId, value);
      return value;
    },
    async createTaskNotification({ chatId, userId, actorUserId }) {
      if (!userId || userId === actorUserId) return [];
      notifications.push({ chatId, userId, actorUserId });
      return [userId];
    },
    async recordAuditLog(entry, companyId) {
      const saved = { id: audits.length + 1, ...entry, companyId, createdAt: new Date().toISOString() };
      audits.push(saved);
      return saved;
    },
    async listAuditLogs(companyId, { action = null } = {}) {
      return audits.filter((row) => (!action || row.action === action)).reverse();
    },
    async listAssignedChats() { return [...routes.values()].map((row) => ({ ...row, contactName: null })); },
    async listConversationHandoffs() { return []; },
    async listConversationNotes() { return []; },
    async getLeadState() { return null; },
    async saveLeadState(lead) { return lead; },
  };
}

async function signIn(app, user) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: user.email, password: 'password-123' },
  });
  assert.equal(login.statusCode, 200);
  return login.headers['set-cookie'].split(';')[0];
}

test('supervisor memindahkan penugasan dari daftar tugas, dan yang ditugaskan diberi tahu', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'tasks-secret-1',
  });
  t.after(() => app.close());
  const cookie = await signIn(app, SUPERVISOR);

  // Menugaskan percakapan yang belum jadi tugas: inilah "membuat tugas".
  const assigned = await app.inject({
    method: 'PATCH', url: '/v1/tasks/6281200000001@c.us', headers: { cookie },
    payload: { assigneeUserId: AGENT.id },
  });
  assert.equal(assigned.statusCode, 200);
  assert.equal(assigned.json().assigneeUserId, AGENT.id);
  assert.equal(assigned.json().mode, 'human');
  assert.deepEqual(database.notifications.map((n) => n.userId), [AGENT.id]);

  // Memindahkannya ke agent lain memberi tahu pemegang barunya, sekali.
  const moved = await app.inject({
    method: 'PATCH', url: '/v1/tasks/6281200000001@c.us', headers: { cookie },
    payload: { assigneeUserId: OTHER_AGENT.id, priority: 'urgent' },
  });
  assert.equal(moved.statusCode, 200);
  assert.equal(moved.json().assigneeUserId, OTHER_AGENT.id);
  assert.equal(moved.json().priority, 'urgent');
  assert.deepEqual(database.notifications.map((n) => n.userId), [AGENT.id, OTHER_AGENT.id]);

  // Prioritas yang berubah tanpa pindah pemegang tidak menghasilkan
  // notifikasi kedua untuk orang yang sama.
  const reprioritised = await app.inject({
    method: 'PATCH', url: '/v1/tasks/6281200000001@c.us', headers: { cookie },
    payload: { priority: 'low' },
  });
  assert.equal(reprioritised.statusCode, 200);
  assert.equal(database.notifications.length, 2);
});

test('agent tidak bisa mengambil atau mengubah tugas rekannya', async (t) => {
  const database = fakeDatabase();
  database.routes.set('6281200000002@c.us', {
    chatId: '6281200000002@c.us', mode: 'human',
    assigneeUserId: OTHER_AGENT.id, assigneeName: OTHER_AGENT.displayName,
    status: 'open', priority: 'normal',
  });
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'tasks-secret-2',
  });
  t.after(() => app.close());
  const cookie = await signIn(app, AGENT);

  const steal = await app.inject({
    method: 'PATCH', url: '/v1/tasks/6281200000002@c.us', headers: { cookie },
    payload: { assigneeUserId: AGENT.id },
  });
  assert.equal(steal.statusCode, 403);

  const close = await app.inject({
    method: 'PATCH', url: '/v1/tasks/6281200000002@c.us', headers: { cookie },
    payload: { status: 'closed' },
  });
  assert.equal(close.statusCode, 403);
  assert.equal(database.routes.get('6281200000002@c.us').status, 'open');
  assert.equal(database.notifications.length, 0);
});

test('membuka lead di WhatsApp pribadi tercatat, dan hanya supervisor yang melihat catatannya', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'audit-secret',
  });
  t.after(() => app.close());

  const agentCookie = await signIn(app, AGENT);
  const recorded = await app.inject({
    method: 'POST', url: '/v1/audit/wa-me', headers: { cookie: agentCookie },
    payload: { chatId: '6281200000003@c.us', phone: '6281200000003', contactName: 'Budi' },
  });
  assert.equal(recorded.statusCode, 201);
  assert.equal(database.audits.length, 1);
  assert.equal(database.audits[0].action, 'lead.open_in_whatsapp');
  assert.equal(database.audits[0].actorUserId, AGENT.id);
  assert.equal(database.audits[0].metadata.contactName, 'Budi');

  // Audit adalah alat pengawasan: agent tidak boleh membacanya.
  const agentReads = await app.inject({ method: 'GET', url: '/v1/audit', headers: { cookie: agentCookie } });
  assert.equal(agentReads.statusCode, 403);

  const supervisorCookie = await signIn(app, SUPERVISOR);
  const supervisorReads = await app.inject({
    method: 'GET', url: '/v1/audit?action=lead.open_in_whatsapp', headers: { cookie: supervisorCookie },
  });
  assert.equal(supervisorReads.statusCode, 200);
  assert.equal(supervisorReads.json().entries.length, 1);
});
