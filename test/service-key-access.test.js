'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/*
 * The service key (API_KEY) is what the MCP gateway uses to reach the
 * backend. It used to mean "supervisor of whichever company you name, from
 * anywhere". These tests pin what it means now: inside the network only, the
 * four MCP routes only, and always as a real, active member with that
 * member's own role.
 */

const KEY = 'service-key-test';
const agentOne = { id: 'agent-1', companyId: 'company-1', email: 'a1@acme.test', displayName: 'Agent 1', role: 'agent' };
const agentTwo = { id: 'agent-2', companyId: 'company-1', email: 'a2@acme.test', displayName: 'Agent 2', role: 'agent' };
const owner = { id: 'owner-1', companyId: 'company-1', email: 'own@acme.test', displayName: 'Owner', role: 'owner' };
const outsider = { id: 'outsider-1', companyId: 'company-2', email: 'x@other.test', displayName: 'Other', role: 'owner' };
const members = [agentOne, agentTwo, owner, outsider];

function fakeDatabase() {
  const routes = new Map();
  routes.set('6281200000009@c.us', {
    chatId: '6281200000009@c.us', mode: 'human', assigneeUserId: agentTwo.id, assigneeName: agentTwo.displayName, status: 'open', priority: 'normal',
  });
  return {
    connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(ref) { return { acme: 'company-1', 'company-1': 'company-1', other: 'company-2' }[ref] || null; },
    async getActiveSessionUser(userId, companyId) {
      return members.find((m) => m.id === userId && m.companyId === companyId) || null;
    },
    async setPresence() {},
    async listTeamMembers() { return [agentOne, agentTwo, owner]; },
    async getConversationRouting(chatId) { return routes.get(chatId) || null; },
    async listConversationHandoffs() { return []; },
    async listConversationNotes() { return []; },
    async getLeadState() { return null; },
    async saveLeadState(lead) { return lead; },
    async getCompanyConfig() { return { planStatus: 'beta' }; },
  };
}

async function app(t) {
  const instance = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(),
    apiKey: KEY, sessionSecret: 'service-key-session',
  });
  t.after(() => instance.close());
  return instance;
}

const as = (user, company = 'acme') => ({ 'x-api-key': KEY, 'x-agnee-company': company, 'x-agnee-user': user.id });

test('kunci layanan wajib menyebut anggota, bukan hanya perusahaan', async (t) => {
  const server = await app(t);
  const res = await server.inject({ method: 'GET', url: '/v1/chats', headers: { 'x-api-key': KEY, 'x-agnee-company': 'acme' } });
  assert.equal(res.statusCode, 400);
});

test('kunci layanan dari internet (lewat nginx) ditolak', async (t) => {
  const server = await app(t);
  for (const header of ['x-forwarded-for', 'x-real-ip']) {
    const res = await server.inject({ method: 'GET', url: '/v1/chats', headers: { ...as(owner), [header]: '203.0.113.9' } });
    assert.equal(res.statusCode, 403, header);
  }
});

test('kunci layanan tidak membuka admin, konsol platform, atau pengaturan paket', async (t) => {
  const server = await app(t);
  for (const [method, url] of [
    ['GET', '/v1/admin/config'],
    ['PATCH', '/v1/admin/company'],
    ['GET', '/v1/superhuman/companies'],
    ['GET', '/v1/integrations/mayar'],
  ]) {
    const res = await server.inject({ method, url, headers: as(owner), payload: method === 'PATCH' ? { planStatus: 'active' } : undefined });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
  }
});

test('kunci layanan tidak bisa menyeberang ke perusahaan lain', async (t) => {
  const server = await app(t);
  // outsider is an owner — of company-2, not acme.
  const res = await server.inject({ method: 'GET', url: '/v1/chats', headers: as(outsider, 'acme') });
  assert.equal(res.statusCode, 403);
});

test('lewat kunci layanan, agent tunduk pada aturan klaim yang sama', async (t) => {
  const server = await app(t);
  const held = '/v1/chats/6281200000009@c.us/messages';
  const byOther = await server.inject({ method: 'GET', url: held, headers: as(agentOne) });
  assert.equal(byOther.statusCode, 403, 'chat held by another agent');

  // Dulu kunci ini = supervisor, jadi bisa membalas chat yang belum diambil
  // alih siapa pun. Sekarang ia membawa peran agent itu.
  const unclaimed = await server.inject({
    method: 'POST', url: '/v1/messages/send', headers: as(agentOne),
    payload: { chatId: '6281200000001@c.us', text: 'halo', clientRequestId: 'svc-key-test-0001' },
  });
  assert.equal(unclaimed.statusCode, 403);

  const bySupervisor = await server.inject({
    method: 'POST', url: '/v1/messages/send', headers: as(owner),
    payload: { chatId: '6281200000001@c.us', text: 'halo', clientRequestId: 'svc-key-test-0002' },
  });
  assert.equal(bySupervisor.statusCode, 200);
});

test('kunci yang salah tetap tidak berarti apa-apa', async (t) => {
  const server = await app(t);
  const res = await server.inject({ method: 'GET', url: '/v1/chats', headers: { ...as(owner), 'x-api-key': 'salah' } });
  assert.equal(res.statusCode, 401);
});
