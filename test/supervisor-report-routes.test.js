'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const owner = { id: 'owner-1', companyId: 'co-1', email: 'own@t.test', displayName: 'Owner', role: 'owner' };
const agent = { id: 'agent-1', companyId: 'co-1', email: 'ag@t.test', displayName: 'Agen', role: 'agent' };

async function app(t) {
  const saved = new Map([['owner-1', { userId: 'owner-1', displayName: 'Owner', email: owner.email, role: 'owner', frequency: 'off', whatsappNumber: null, lastSentAt: null }]]);
  const audits = [];
  const users = { [owner.email]: owner, [agent.email]: agent };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'pass-12345' ? users[email] || null : null; },
    async getActiveSessionUser(id) { return Object.values(users).find((u) => u.id === id) || null; },
    async setPresence() {},
    async getCompanyConfig() { return { name: 'Toko Uji', timezone: 'Asia/Jakarta', status: 'active' }; },
    async recordAuditLog(entry) { audits.push(entry); return { id: 1 }; },
    async listSupervisorReportSettings() { return [...saved.values()]; },
    async saveSupervisorReportSetting({ userId, frequency, whatsappNumber }) {
      Object.assign(saved.get(userId), { frequency, whatsappNumber });
      return { frequency, whatsappNumber };
    },
    async getChatReportStats() { return { inboundMessages: 10, activeChats: 4, newChats: 1, aiReplies: 8, humanReplies: 1, handoffs: 0, hotLeads: 0 }; },
    async sampleInboundForReport() { return []; },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'rep-session' });
  t.after(() => server.close());
  const login = async (email) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { server, saved, audits, ownerCookie: await login(owner.email), agentCookie: await login(agent.email) };
}

test('agent biasa tidak boleh melihat atau mengubah laporan supervisor', async (t) => {
  const { server, agentCookie } = await app(t);
  assert.equal((await server.inject({ method: 'GET', url: '/v1/reports/supervisors', headers: { cookie: agentCookie } })).statusCode, 403);
  const put = await server.inject({ method: 'PUT', url: '/v1/reports/supervisors/owner-1', headers: { cookie: agentCookie }, payload: { frequency: 'daily', whatsappNumber: '0812' } });
  assert.equal(put.statusCode, 403);
});

test('frekuensi per supervisor disimpan dan dicatat di audit', async (t) => {
  const { server, saved, audits, ownerCookie } = await app(t);
  const res = await server.inject({ method: 'PUT', url: '/v1/reports/supervisors/owner-1', headers: { cookie: ownerCookie }, payload: { frequency: 'monthly', whatsappNumber: '081234567890' } });
  assert.equal(res.statusCode, 200);
  assert.equal(saved.get('owner-1').frequency, 'monthly');
  assert.equal(audits.at(-1).action, 'report.schedule_changed');
  // Nomor tidak masuk metadata audit.
  assert.deepEqual(audits.at(-1).metadata, { frequency: 'monthly' });
});

test('menyalakan laporan tanpa nomor, frekuensi asing, atau supervisor asing ditolak', async (t) => {
  const { server, ownerCookie } = await app(t);
  const put = (userId, payload) => server.inject({ method: 'PUT', url: `/v1/reports/supervisors/${userId}`, headers: { cookie: ownerCookie }, payload });
  assert.equal((await put('owner-1', { frequency: 'daily' })).statusCode, 400);
  assert.equal((await put('owner-1', { frequency: 'hourly', whatsappNumber: '0812' })).statusCode, 400);
  assert.equal((await put('orang-lain', { frequency: 'daily', whatsappNumber: '0812' })).statusCode, 404);
  assert.equal((await put('owner-1', { frequency: 'off' })).statusCode, 200);
});

test('kirim contoh: laporan terkirim ke nomor supervisor lewat WhatsApp company', async (t) => {
  const { server, saved, ownerCookie } = await app(t);
  const noNumber = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie } });
  assert.equal(noNumber.statusCode, 400);
  Object.assign(saved.get('owner-1'), { frequency: 'weekly', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie } });
  assert.equal(res.statusCode, 200, res.body);
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const outbound = (sent.json().messages || []).filter((m) => m.fromMe);
  assert.equal(outbound.length, 1);
  assert.match(outbound[0].body, /Laporan Mingguan — Toko Uji/);
  assert.match(outbound[0].body, /Pesan masuk dari customer: 10/);
});
