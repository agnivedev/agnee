'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const sup = { id: 'u-sup', companyId: 'co-1', email: 'sup@t.test', displayName: 'Sup', role: 'owner' };
const agent = { id: 'u-agent', companyId: 'co-1', email: 'ag@t.test', displayName: 'Agen', role: 'agent' };
const CO_2 = '22222222-2222-4222-8222-222222222222';

async function app(t, { createTeamMember } = {}) {
  const calls = { added: [], created: [], switched: [], audits: [] };
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
    async createTeamMember(body) {
      calls.created.push(body);
      return createTeamMember ? createTeamMember(body) : { id: 'new', email: body.email, role: body.role };
    },
    async addExistingUserToCompany(input, companyId) {
      calls.added.push({ input, companyId });
      if (input.email === 'nobody@t.test') throw Object.assign(new Error('Email ini belum terdaftar di Agnee.'), { code: 'NO_ACCOUNT' });
      if (input.email === 'staf@t.test') throw Object.assign(new Error('x'), { code: 'EMAIL_TAKEN' });
      return { id: 'u-existing', email: input.email, role: input.role, displayName: 'Orang Lama' };
    },
    async listCompaniesForUser(userId) { return [...members].filter((m) => m.startsWith(userId)).map((m) => ({ id: m.split(':')[1] })); },
    async recordAuditLog(entry, companyId) { calls.audits.push({ ...entry, companyId }); return { id: 1 }; },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'mem-session' });
  t.after(() => server.close());
  const login = async (email) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { server, calls, members, supCookie: await login(sup.email), agentCookie: await login(agent.email) };
}

const addMember = (server, cookie, payload) => server.inject({ method: 'POST', url: '/v1/team/members', headers: { cookie }, payload });

test('tanpa password hanya memasukkan akun yang sudah terdaftar, langsung jadi anggota', async (t) => {
  const { server, calls, supCookie } = await app(t);
  const res = await addMember(server, supCookie, { email: 'lama@t.test', role: 'supervisor' });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().existingAccount, true);
  assert.deepEqual(calls.added[0], { input: { email: 'lama@t.test', role: 'supervisor' }, companyId: 'co-1' });
  assert.equal(calls.created.length, 0, 'tidak ada akun baru yang dibuat');
  const audit = calls.audits.find((a) => a.action === 'team.member_added');
  assert.equal(audit.metadata.existingAccount, true);
});

test('email yang belum terdaftar ditolak dengan petunjuk mendaftar dulu', async (t) => {
  const { server, supCookie } = await app(t);
  const res = await addMember(server, supCookie, { email: 'nobody@t.test', role: 'agent' });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().error, /belum terdaftar/);
});

test('email yang dipakai company lain tidak menimpa password: akun dimasukkan, password diabaikan', async (t) => {
  const { server, calls, supCookie } = await app(t, {
    createTeamMember() { throw Object.assign(new Error('Email sudah dipakai akun lain.'), { code: 'EMAIL_TAKEN' }); },
  });
  const res = await addMember(server, supCookie, { email: 'korban@t.test', displayName: 'Korban', password: 'dipilih-penyerang', role: 'agent' });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(Object.keys(calls.added[0].input).sort(), ['email', 'role']);
});

test('akun baru hanya dibuat bila password dan nama diisi', async (t) => {
  const { server, calls, supCookie } = await app(t);
  assert.equal((await addMember(server, supCookie, { email: 'baru@t.test', password: 'password-baru', role: 'agent' })).statusCode, 400);
  const ok = await addMember(server, supCookie, { email: 'baru@t.test', displayName: 'Baru', password: 'password-baru', role: 'agent' });
  assert.equal(ok.statusCode, 201);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.added.length, 0);
});

test('staf platform tidak bisa dimasukkan ke company pelanggan', async (t) => {
  const { server, supCookie } = await app(t);
  assert.equal((await addMember(server, supCookie, { email: 'staf@t.test', role: 'agent' })).statusCode, 409);
});

test('agent tidak boleh menambah anggota', async (t) => {
  const { server, agentCookie } = await app(t);
  assert.equal((await addMember(server, agentCookie, { email: 'a@t.test', role: 'agent' })).statusCode, 403);
});

test('rute undangan lama sudah tidak ada', async (t) => {
  const { server, supCookie } = await app(t);
  assert.equal((await server.inject({ method: 'GET', url: '/v1/auth/invitations', headers: { cookie: supCookie } })).statusCode, 404);
  assert.equal((await server.inject({ method: 'GET', url: '/v1/team/invitations', headers: { cookie: supCookie } })).statusCode, 404);
});

test('pindah company hanya ke company tempat user menjadi anggota; cookie baru memuat company itu', async (t) => {
  const { server, calls, members, agentCookie } = await app(t);
  const swap = (cookie, companyId) => server.inject({ method: 'POST', url: '/v1/auth/switch-company', headers: { cookie }, payload: { companyId } });
  assert.equal((await swap(agentCookie, CO_2)).statusCode, 403);
  members.add(`u-agent:${CO_2}`);
  const ok = await swap(agentCookie, CO_2);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().user.companyId, CO_2);
  const cookie = ok.headers['set-cookie'].split(';')[0];
  const session = await server.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  assert.equal(session.json().user.companyId, CO_2);
  assert.deepEqual(calls.switched.at(-1), ['u-agent', CO_2]);
  assert.equal((await swap(agentCookie, 'bukan-uuid')).statusCode, 400);
});

test('daftar company hanya memuat keanggotaan milik sesi', async (t) => {
  const { server, members, agentCookie } = await app(t);
  members.add(`u-agent:${CO_2}`);
  const res = await server.inject({ method: 'GET', url: '/v1/auth/companies', headers: { cookie: agentCookie } });
  assert.deepEqual(res.json().companies.map((c) => c.id).sort(), ['co-1', CO_2].sort());
});
