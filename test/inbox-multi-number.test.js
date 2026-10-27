'use strict';

/**
 * Inbox bertab per nomor: /v1/chats?connectionId= hanya memuat satu nomor,
 * tanpa parameter memuat semua dengan label nomornya, dan /v1/inbox/numbers
 * terbuka untuk agent (bukan hanya supervisor) tanpa membocorkan nomor telepon.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const { WhatsappManager } = require('../src/whatsapp-manager');

const AGENT = {
  id: 'agent-1', userId: 'agent-1', companyId: 'company-1',
  email: 'cs@example.com', displayName: 'CS', role: 'agent', status: 'active',
};
const NOW = Math.floor(Date.now() / 1000);
const KONEKSI = [
  { id: 'conn-1', companyId: 'company-1', connectionKey: 'whatsapp-main', label: 'Utama', phoneNumber: '6281@c.us', isActive: true },
  { id: 'conn-2', companyId: 'company-1', connectionKey: 'whatsapp-2', label: 'Toko B', phoneNumber: '6282@c.us', isActive: true },
];

const chatPalsu = (id) => ({
  id: { _serialized: id, user: id.split('@')[0] },
  name: id, isGroup: false, timestamp: NOW, unreadCount: 0, pinned: false, archived: false,
  lastMessage: { type: 'chat', body: 'halo', hasMedia: false, fromMe: false, timestamp: NOW, _data: {} },
  async fetchMessages() { return []; },
});

async function mulai(t) {
  const klien = {
    'conn-1': { async getChats() { return [chatPalsu('1001@c.us')]; } },
    'conn-2': { async getChats() { return [chatPalsu('2002@c.us')]; } },
  };
  const asliGetClient = WhatsappManager.prototype.getClient;
  const asliGetState = WhatsappManager.prototype.getState;
  WhatsappManager.prototype.getClient = function getClient(id) { return klien[id] || asliGetClient.call(this, id); };
  WhatsappManager.prototype.getState = function getState(id) { return klien[id] ? { phase: 'ready' } : asliGetState.call(this, id); };
  t.after(() => { WhatsappManager.prototype.getClient = asliGetClient; WhatsappManager.prototype.getState = asliGetState; });
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return email === AGENT.email && password === 'password-123' ? AGENT : null; },
    async getActiveSessionUser(userId) { return userId === AGENT.id ? AGENT : null; },
    async setPresence() {},
    async listTeamMembers() { return [AGENT]; },
    async getCompanyConfig() { return { whatsappProvider: 'whatsapp_web' }; },
    async listWhatsappConnections() { return KONEKSI; },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: false, database, sessionSecret: 'preview-secret' });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: AGENT.email, password: 'password-123' } });
  assert.equal(login.statusCode, 200);
  return { app, cookie: login.headers['set-cookie'].split(';')[0] };
}

const get = (app, cookie, url) => app.inject({ method: 'GET', url, headers: { cookie } });

test('tanpa connectionId inbox memuat semua nomor beserta labelnya', async (t) => {
  const { app, cookie } = await mulai(t);
  const { chats } = (await get(app, cookie, '/v1/chats?filter=all')).json();
  const per = Object.fromEntries(chats.map((c) => [c.id, c.connectionLabel]));
  assert.deepEqual(per, { '1001@c.us': 'Utama', '2002@c.us': 'Toko B' });
});

test('connectionId membatasi daftar ke satu nomor', async (t) => {
  const { app, cookie } = await mulai(t);
  const { chats } = (await get(app, cookie, '/v1/chats?filter=all&connectionId=conn-2')).json();
  assert.deepEqual(chats.map((c) => c.id), ['2002@c.us']);
});

test('/v1/inbox/numbers terbuka untuk agent dan tanpa nomor telepon', async (t) => {
  const { app, cookie } = await mulai(t);
  const res = await get(app, cookie, '/v1/inbox/numbers');
  assert.equal(res.statusCode, 200);
  const { numbers } = res.json();
  assert.deepEqual(numbers.map((n) => [n.id, n.label, n.phase]), [['conn-1', 'Utama', 'ready'], ['conn-2', 'Toko B', 'ready']]);
  assert.doesNotMatch(res.body, /6281|6282/);
});
