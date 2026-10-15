'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const sup = { id: 'u-sup', companyId: 'co-1', email: 'sup@t.test', displayName: 'Sup', role: 'owner' };
const agent = { id: 'u-agent', companyId: 'co-1', email: 'ag@t.test', displayName: 'Agen', role: 'agent' };
const CO_2 = '22222222-2222-4222-8222-222222222222';
const INV = '33333333-3333-4333-8333-333333333333';

async function app(t, { createTeamMember } = {}) {
  const calls = { invited: [], accepted: [], switched: [], audits: [] };
  // Keanggotaan per "userId:companyId" — satu-satunya sumber kebenaran di tiruan ini.
  const members = new Set([`${sup.id}:co-1`, `${agent.id}:co-1`]);
  const users = { [sup.email]: sup, [agent.email]: agent };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'pass-12345' ? users[email] || null : null; },
    async getActiveSessionUser(userId, companyId) {
      if (!members.has(`${userId}:${companyId}`)) return null;
      return { ...Object.values(users).find((u) => u.id === userId), isPlatformAdmin: false };
    },
    async setPresence() {},
    async setLastCompany(userId, companyId) { calls.switched.push([userId, companyId]); },
    async getCompanyUsage() { return { maxUsers: 0, currentUsers: 1 }; },
    async createTeamMember(body) { return createTeamMember ? createTeamMember(body) : { id: 'new', email: body.email, role: body.role }; },
    async createCompanyInvitation(input, companyId) {
      calls.invited.push({ input, companyId });
      if (input.email === 'nobody@t.test') throw Object.assign(new Error('x'), { code: 'NO_ACCOUNT' });
      return { id: INV, email: input.email, role: input.role };
    },
    async listCompanyInvitations() { return [{ id: INV, email: 'x@t.test', role: 'agent' }]; },
    async revokeCompanyInvitation(id, companyId) { return companyId === 'co-1' ? { id, email: 'x@t.test', role: 'agent' } : null; },
    async listInvitationsForUser(userId) { return userId === agent.id ? [{ id: INV, companyName: 'Dua', role: 'agent' }] : []; },
    async acceptCompanyInvitation(id, userId) {
      calls.accepted.push([id, userId]);
      if (userId !== agent.id) throw Object.assign(new Error('Undangan tidak ditemukan'), { code: 'NOT_FOUND' });
      members.add(`${userId}:${CO_2}`);
      return { companyId: CO_2, companyName: 'Dua', role: 'agent' };
    },
    async declineCompanyInvitation() { return null; },
    async listCompaniesForUser(userId) { return [...members].filter((m) => m.startsWith(userId)).map((m) => ({ id: m.split(':')[1] })); },
    async recordAuditLog(entry, companyId) { calls.audits.push({ ...entry, companyId }); return { id: 1 }; },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'inv-session' });
  t.after(() => server.close());
  const login = async (email) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { server, calls, members, supCookie: await login(sup.email), agentCookie: await login(agent.email) };
}

const addMember = (server, cookie, payload) => server.inject({ method: 'POST', url: '/v1/team/members', headers: { cookie }, payload });

test('tanpa password hanya mengundang; email belum terdaftar ditolak dengan petunjuk', async (t) => {
  const { server, calls, supCookie } = await app(t);
  const ok = await addMember(server, supCookie, { email: 'agent@t.test', displayName: 'Orang', role: 'agent' });
  assert.equal(ok.statusCode, 202);
  assert.equal(ok.json().invited, true);
  assert.deepEqual(calls.invited[0], { input: { email: 'agent@t.test', role: 'agent', invitedBy: 'u-sup' }, companyId: 'co-1' });
  assert.equal(calls.audits.at(-1).action, 'team.invitation_sent');

  const none = await addMember(server, supCookie, { email: 'nobody@t.test', displayName: 'Orang', role: 'agent' });
  assert.equal(none.statusCode, 422);
});

test('email yang sudah dipakai company lain menjadi undangan dan password diabaikan', async (t) => {
  const { server, calls, supCookie } = await app(t, {
    createTeamMember() { throw Object.assign(new Error('Email sudah dipakai akun lain.'), { code: 'EMAIL_TAKEN' }); },
  });
  const res = await addMember(server, supCookie, { email: 'korban@t.test', displayName: 'Korban', password: 'dipilih-penyerang', role: 'supervisor' });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(Object.keys(calls.invited[0].input).sort(), ['email', 'invitedBy', 'role']);
  assert.equal(calls.invited[0].input.role, 'supervisor');
});

test('agent tidak boleh mengundang, melihat, atau membatalkan undangan', async (t) => {
  const { server, agentCookie } = await app(t);
  assert.equal((await addMember(server, agentCookie, { email: 'a@t.test', displayName: 'Abc', role: 'agent' })).statusCode, 403);
  assert.equal((await server.inject({ method: 'GET', url: '/v1/team/invitations', headers: { cookie: agentCookie } })).statusCode, 403);
  assert.equal((await server.inject({ method: 'DELETE', url: `/v1/team/invitations/${INV}`, headers: { cookie: agentCookie } })).statusCode, 403);
});

test('supervisor hanya bisa membatalkan undangan company sendiri', async (t) => {
  const { server, supCookie } = await app(t);
  assert.equal((await server.inject({ method: 'GET', url: '/v1/team/invitations', headers: { cookie: supCookie } })).json().invitations.length, 1);
  assert.equal((await server.inject({ method: 'DELETE', url: `/v1/team/invitations/${INV}`, headers: { cookie: supCookie } })).statusCode, 200);
  assert.equal((await server.inject({ method: 'DELETE', url: '/v1/team/invitations/not-a-uuid', headers: { cookie: supCookie } })).statusCode, 400);
});

test('menerima undangan memindahkan sesi ke company itu dan mencatat audit di sana', async (t) => {
  const { server, calls, agentCookie } = await app(t);
  const list = await server.inject({ method: 'GET', url: '/v1/auth/invitations', headers: { cookie: agentCookie } });
  assert.equal(list.json().invitations[0].companyName, 'Dua');

  const res = await server.inject({ method: 'POST', url: `/v1/auth/invitations/${INV}/accept`, headers: { cookie: agentCookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user.companyId, CO_2);
  const cookie = res.headers['set-cookie'].split(';')[0];
  const session = await server.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  assert.equal(session.json().user.companyId, CO_2);
  assert.deepEqual(calls.switched.at(-1), ['u-agent', CO_2]);
  const audit = calls.audits.find((a) => a.action === 'team.invitation_accepted');
  assert.equal(audit.companyId, CO_2);
  assert.equal(audit.actorUserId, 'u-agent');
});

test('undangan milik orang lain tidak bisa diterima', async (t) => {
  const { server, supCookie } = await app(t);
  const res = await server.inject({ method: 'POST', url: `/v1/auth/invitations/${INV}/accept`, headers: { cookie: supCookie } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('pindah company hanya ke company tempat user menjadi anggota', async (t) => {
  const { server, members, agentCookie } = await app(t);
  const swap = (cookie, companyId) => server.inject({ method: 'POST', url: '/v1/auth/switch-company', headers: { cookie }, payload: { companyId } });
  assert.equal((await swap(agentCookie, CO_2)).statusCode, 403);
  members.add(`u-agent:${CO_2}`);
  const ok = await swap(agentCookie, CO_2);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().user.companyId, CO_2);
  assert.equal((await swap(agentCookie, 'bukan-uuid')).statusCode, 400);
});
