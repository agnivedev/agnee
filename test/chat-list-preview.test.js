'use strict';

/**
 * Daftar inbox: chat yang unread-nya ada tapi lastMessage-nya belum dimuat
 * WhatsApp Web (belum dibuka sejak sesi tertaut) dulu tampil "belum ada pesan".
 * Sekarang pesan terakhirnya diambil untuk halaman yang sedang tampil.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const { WhatsappManager } = require('../src/whatsapp-manager');

const SUPERVISOR = {
  id: 'supervisor-1', userId: 'supervisor-1', companyId: 'company-1',
  email: 'owner@example.com', displayName: 'Supervisor', role: 'supervisor', status: 'active',
};
const NOW = Math.floor(Date.now() / 1000);
const KONEKSI = { id: 'conn-1', companyId: 'company-1', connectionKey: 'whatsapp-main', label: 'Utama' };

function chatPalsu(id, { riwayat = [], lastMessage = null, unreadCount = 3, fetchMessages } = {}) {
  const fetches = { count: 0 };
  return {
    fetches,
    id: { _serialized: id, user: id.split('@')[0] },
    name: id, isGroup: false, timestamp: NOW, unreadCount, pinned: false, archived: false,
    lastMessage,
    async fetchMessages() {
      fetches.count += 1;
      if (fetchMessages) return fetchMessages();
      return riwayat;
    },
  };
}

const pesan = (body, extra = {}) => ({ type: 'chat', body, hasMedia: false, fromMe: false, timestamp: NOW, _data: {}, ...extra });

async function mulai(t, chats) {
  const klien = {
    async getChats() { return chats; },
    async getChatById(id) { return chats.find((c) => c.id._serialized === id); },
  };
  const asliGetClient = WhatsappManager.prototype.getClient;
  const asliGetState = WhatsappManager.prototype.getState;
  WhatsappManager.prototype.getClient = function getClient(id) { return id === KONEKSI.id ? klien : asliGetClient.call(this, id); };
  WhatsappManager.prototype.getState = function getState(id) { return id === KONEKSI.id ? { phase: 'ready' } : asliGetState.call(this, id); };
  t.after(() => { WhatsappManager.prototype.getClient = asliGetClient; WhatsappManager.prototype.getState = asliGetState; });
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return email === SUPERVISOR.email && password === 'password-123' ? SUPERVISOR : null; },
    async getActiveSessionUser(userId) { return userId === SUPERVISOR.id ? SUPERVISOR : null; },
    async setPresence() {},
    async listTeamMembers() { return [SUPERVISOR]; },
    async getCompanyConfig() { return { whatsappProvider: 'whatsapp_web' }; },
    async listWhatsappConnections() { return [KONEKSI]; },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: false, database, sessionSecret: 'preview-secret' });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUPERVISOR.email, password: 'password-123' } });
  assert.equal(login.statusCode, 200);
  return { app, cookie: login.headers['set-cookie'].split(';')[0] };
}

const daftar = async (app, cookie) => (await app.inject({ method: 'GET', url: '/v1/chats?filter=all', headers: { cookie } })).json().chats;

test('chat tanpa lastMessage di memori mendapat pratinjau dari pesan terakhir yang diambil', async (t) => {
  const kosong = chatPalsu('62901@c.us', { riwayat: [pesan('lama'), pesan('Bisa kirim katalog?')] });
  const lengkap = chatPalsu('62902@c.us', { lastMessage: pesan('sudah ada'), unreadCount: 1 });
  const { app, cookie } = await mulai(t, [kosong, lengkap]);
  const chats = await daftar(app, cookie);
  const per = Object.fromEntries(chats.map((c) => [c.id, c.preview]));
  assert.equal(per['62901@c.us'], 'Bisa kirim katalog?');
  assert.equal(per['62902@c.us'], 'sudah ada');
  assert.equal(lengkap.fetches.count, 0, 'chat yang sudah punya pratinjau tidak perlu diambil lagi');
});

test('pesan media tanpa teks diberi label, dan hasil di-cache antar permintaan', async (t) => {
  const foto = chatPalsu('62903@c.us', { riwayat: [pesan('', { type: 'image', hasMedia: true })] });
  const { app, cookie } = await mulai(t, [foto]);
  assert.equal((await daftar(app, cookie))[0].preview, 'Foto');
  assert.equal((await daftar(app, cookie))[0].preview, 'Foto');
  assert.equal(foto.fetches.count, 1);
});

test('gagal mengambil pesan tidak merusak daftar; pratinjau tetap kosong', async (t) => {
  const rusak = chatPalsu('62904@c.us', { fetchMessages: () => { throw new Error('page crashed'); } });
  const { app, cookie } = await mulai(t, [rusak]);
  const chats = await daftar(app, cookie);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].preview, '');
});
