'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server.js');

/**
 * Pesan penutup saat chat dikembalikan ke AI dulu dikirim langsung lewat
 * WhatsApp Web. Company yang memakai Cloud API tidak punya klien WhatsApp Web,
 * jadi pesannya tidak pernah sampai — dan route-nya menjawab 503 "WhatsApp
 * belum siap" walau nomor Cloud API-nya sehat.
 */
const COMPANY = 'company-cloud';
const CHAT = '6281200000009@c.us';
const SUPERVISOR = {
  id: 'sup-1', userId: 'sup-1', companyId: COMPANY, email: 'sup@cloud.test',
  displayName: 'Supervisor', role: 'supervisor', status: 'active', isPlatformAdmin: false,
};

function fakeDatabase(recorded) {
  let routing = { mode: 'human', assigneeUserId: SUPERVISOR.id, status: 'open' };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return email === SUPERVISOR.email && password === 'password-123' ? SUPERVISOR : null; },
    async getActiveSessionUser() { return SUPERVISOR; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', whatsappProvider: 'cloud_api' }; },
    async listTeamMembers() { return [{ ...SUPERVISOR, presence: 'online' }]; },
    async getConversationRouting() { return routing; },
    async saveConversationRouting(next) { routing = { ...routing, ...next }; return routing; },
    async getCloudChatNumber() { return { id: 'n1', phoneNumberId: 'pn-1', accessToken: 'tok', isActive: true, status: 'connected' }; },
    async recordCloudMessage(companyId, message) { recorded.push(message); },
  };
  // Metode lain yang tidak relevan untuk tes ini cukup menjawab kosong.
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

test('pesan penutup company Cloud API terkirim lewat Cloud API', async (t) => {
  const recorded = [];
  const graphCalls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      graphCalls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 });
    }
    return realFetch(url, init);
  };
  t.after(() => { global.fetch = realFetch; });

  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: false,
    database: fakeDatabase(recorded), sessionSecret: 'closing-1',
  });
  t.after(() => app.close());

  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUPERVISOR.email, password: 'password-123' } });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];

  const res = await app.inject({
    method: 'POST', url: `/v1/chats/${CHAT}/routing`, headers: { cookie },
    payload: { mode: 'ai', sendClosingMessage: true, closingMessage: 'Terima kasih, dilanjutkan AI ya.' },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(graphCalls.length, 1);
  assert.equal(graphCalls[0].text.body, 'Terima kasih, dilanjutkan AI ya.');
  assert.equal(recorded[0]?.fromMe, true);
});
