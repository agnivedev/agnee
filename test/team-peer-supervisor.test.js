'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/**
 * Sesama supervisor tidak boleh saling mengganti password, peran, atau
 * menonaktifkan. Owner boleh. Dulu satu-satunya batas adalah "bukan owner",
 * jadi supervisor A bisa mengganti password supervisor B lalu masuk sebagai B.
 */
const COMPANY = 'company-1';
const member = (id, role) => ({ id, userId: id, companyId: COMPANY, email: `${id}@tim.test`, displayName: id, role, status: 'active', isPlatformAdmin: false });
const OWNER = member('owner-1', 'owner');
const SUP_A = member('sup-a', 'supervisor');
const SUP_B = member('sup-b', 'supervisor');
const AGENT = member('agent-1', 'agent');
const ALL = [OWNER, SUP_A, SUP_B, AGENT];

function fakeDatabase(calls) {
  return {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'password-123' ? ALL.find((u) => u.email === email) || null : null; },
    async getActiveSessionUser(userId) { return ALL.find((u) => u.id === userId) || null; },
    async setPresence() {},
    async listTeamMembers() { return ALL.map((u) => ({ ...u, presence: 'online' })); },
    async updateTeamMember(userId) { calls.push(['update', userId]); return { id: userId, email: 'x@tim.test' }; },
    async updateTeamMemberRole(userId) { calls.push(['role', userId]); return { id: userId, email: 'x@tim.test' }; },
    async deactivateTeamMember(userId) { calls.push(['remove', userId]); },
    async recordAudit() {},
  };
}

async function masuk(app, user) {
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
  return login.headers['set-cookie'].split(';')[0];
}

const ACTIONS = (target) => [
  ['PATCH', `/v1/team/members/${target}`, { password: 'password-baru-1' }],
  ['PATCH', `/v1/team/members/${target}/role`, { role: 'agent' }],
  ['DELETE', `/v1/team/members/${target}`, undefined],
];

test('supervisor ditolak mengubah sesama supervisor', async (t) => {
  const calls = [];
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(calls), sessionSecret: 'peer-1' });
  t.after(() => app.close());
  const cookie = await masuk(app, SUP_A);
  for (const [method, url, payload] of ACTIONS(SUP_B.id)) {
    const res = await app.inject({ method, url, headers: { cookie }, payload });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
  }
  assert.deepEqual(calls, []);
});

test('supervisor tetap boleh mengubah agent, owner boleh mengubah supervisor', async (t) => {
  const calls = [];
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(calls), sessionSecret: 'peer-2' });
  t.after(() => app.close());
  const supCookie = await masuk(app, SUP_A);
  for (const [method, url, payload] of ACTIONS(AGENT.id)) {
    const res = await app.inject({ method, url, headers: { cookie: supCookie }, payload });
    assert.notEqual(res.statusCode, 403, `${method} ${url}`);
  }
  const ownerCookie = await masuk(app, OWNER);
  for (const [method, url, payload] of ACTIONS(SUP_B.id)) {
    const res = await app.inject({ method, url, headers: { cookie: ownerCookie }, payload });
    assert.notEqual(res.statusCode, 403, `${method} ${url}`);
  }
  assert.equal(calls.length, 6);
});
