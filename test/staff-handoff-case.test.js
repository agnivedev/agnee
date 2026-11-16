'use strict';

/**
 * Kasus ESBEJE 6–9 Nov 2026 (customer "Rusnandar", nomor tidak dipakai di sini).
 *
 * Staf menulis "kami bantu buatkan proforma invoice", lalu customer membalas
 * "Utk apa kak?", "Kan udh", "Ok skip ya". Dulu AI menjelaskan proforma,
 * berjanji "saya cek dulu", memperkenalkan diri lagi, dan menulis pesan seolah
 * kepada staf ("draft ... ke customer ... belum mengirimnya"). Jalur yang diuji
 * di sini sama dengan chat sungguhan: handleInboundMessage dengan klien
 * WhatsApp tiruan, jadi riwayat, penulis pesan, dan penjaga keluaran ikut jalan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const { WhatsappManager } = require('../src/whatsapp-manager');

const CO = 'co-1';
const CHAT = '5265629929633@lid';
const KONEKSI = { id: 'conn-1', companyId: CO, connectionKey: 'wa-main', label: 'Utama' };
const NOW = Math.floor(Date.now() / 1000);
const SUP = { id: 'sup-1', userId: 'sup-1', companyId: CO, email: 's@t.test', displayName: 'Sup', role: 'supervisor', status: 'active' };

const STAF_ID = `true_${CHAT}_3EB0A5F30A3F191D1A5E61`;
const AI_TEKS = 'Sore kak, saya Agnes dari ESBEJE. Lagi bangun dari awal atau pasang keramik kak?';
const RIWAYAT_WA = [
  { id: { _serialized: `false_${CHAT}_A1` }, fromMe: false, type: 'chat', body: 'Sore mba', timestamp: NOW - 900 },
  { id: { _serialized: `true_${CHAT}_AI1` }, fromMe: true, type: 'chat', body: AI_TEKS, timestamp: NOW - 890 },
  { id: { _serialized: `false_${CHAT}_A2` }, fromMe: false, type: 'chat', body: '1 lembar', timestamp: NOW - 880 },
  { id: { _serialized: STAF_ID }, fromMe: true, type: 'chat', body: 'Pagi kak Rusnandar, utk pesanan 1 lembar triplek 3mm kami bantu buatkan proforma invoice yah', timestamp: NOW - 60 },
];

async function setup(t, { reply = 'Baik kak.', members = [SUP], history = RIWAYAT_WA, authors = null } = {}) {
  const state = { calls: [], routing: [], unansweredAsked: [], phone: [], sent: [] };
  const chat = {
    id: { _serialized: CHAT }, isGroup: false,
    async fetchMessages() { return history; },
  };
  const klien = { async getChatById() { return chat; }, async getChats() { return [chat]; } };
  const asliGetClient = WhatsappManager.prototype.getClient;
  const asliGetState = WhatsappManager.prototype.getState;
  WhatsappManager.prototype.getClient = function getClient(id) { return id === KONEKSI.id ? klien : asliGetClient.call(this, id); };
  WhatsappManager.prototype.getState = function getState(id) { return id === KONEKSI.id ? { phase: 'ready' } : asliGetState.call(this, id); };
  t.after(() => { WhatsappManager.prototype.getClient = asliGetClient; WhatsappManager.prototype.getState = asliGetState; });

  let current = { mode: 'ai' };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone', whatsappProvider: 'whatsapp_web', aiMessageLimit: 0, aiMessageCount: 0 }; },
    async incrementAiMessageCount() { return { exceeded: false, count: 1, limit: 0 }; },
    async listWhatsappConnections() { return [KONEKSI]; },
    async listTeamMembers() { return members; },
    async getReplyDelaySettings() { return { replyDelayEnabled: false }; },
    async getFollowUpSettings() { return { enabled: false }; },
    async getHandoffNotifyNumbers() { return []; },
    async getPlaybookContext() { return ''; },
    // Siapa penulis tiap pesan keluar: id staf tercatat sebagai 'human'; balasan AI dikenali dari isinya.
    async listOutboundAuthors(_c, _chat, ids) {
      const map = new Map();
      if (ids.includes(STAF_ID)) map.set(STAF_ID, { author: 'human', authorName: 'Fera', body: 'x' });
      return authors ? authors(ids) : map;
    },
    async listAutomatedBodies() { return new Set([AI_TEKS]); },
    async getConversationRouting() { return current; },
    async saveConversationRouting(change) {
      state.routing.push(change);
      current = { chatId: change.chatId, mode: change.mode, assigneeUserId: change.assigneeUserId || null, autoAssigned: Boolean(change.autoAssigned), status: 'open', priority: 'normal', updatedAt: new Date().toISOString() };
      return current;
    },
    async recordPhoneReply(entry) { state.phone.push(entry); return true; },
    async recordOutboundReply() { return true; },
    async recordInboundMessage() { return true; },
    async getUnansweredInbound(companyId, chatId) { state.unansweredAsked.push([companyId, chatId]); return null; },
    async returnIdleAutoAssignedToAi() { current = { mode: 'ai' }; return [{ companyId: CO, chatId: CHAT }]; },
    async createTaskNotification() { return []; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const llmService = {
    enabled: true,
    async generateReply(text, opts) { state.calls.push({ text, ...opts }); return { text: typeof reply === 'function' ? reply(text, opts) : reply, model: 'tiruan', usage: {} }; },
    async generateJson() { return null; },
  };
  const server = await buildApp({
    logger: false, startupEnabled: false, demoMode: false, database, llmService, llmEnabled: true, openrouterApiKey: 'k',
    sessionSecret: 'staf-case', phoneReplySettleMs: 0,
  });
  t.after(() => server.close());
  const customer = (body, id = `false_${CHAT}_CUR`) => ({
    from: CHAT, body, type: 'chat', hasMedia: false, timestamp: NOW, id: { _serialized: id },
    _data: {}, async reply(text) { state.sent.push(text); },
  });
  return { server, state, customer };
}

test('pesan staf di riwayat diberi penanda dan AI menerima aturan "staf sudah turun tangan"', async (t) => {
  const { server, state, customer } = await setup(t, { reply: 'Baik kak, rekan kami yang menulisnya akan menjelaskan langsung di chat ini.' });
  await server.handleInboundMessage(CO, customer('Utk apa kak?'), {});
  const call = state.calls.find((c) => c.purpose === 'auto_reply');
  assert.ok(call, 'model dipanggil untuk menjawab');
  const staf = call.history.find((h) => String(h.content).includes('proforma invoice yah'));
  assert.equal(staf.role, 'assistant');
  assert.match(staf.content, /^\[Staf tim, bukan kamu\]/, 'kalimat staf berlabel, bukan dianggap tulisan AI');
  const ai = call.history.find((h) => String(h.content).includes('Agnes dari ESBEJE'));
  assert.doesNotMatch(ai.content, /\[Staf tim/, 'tulisan AI sendiri tidak berlabel');
  assert.match(call.systemPrompt, /Staf manusia sudah turun tangan/);
  assert.match(call.systemPrompt, /Ok skip ya/);
});

test('tanpa pesan staf di riwayat: tidak ada penanda dan tidak ada aturan staf (chat biasa tetap dijawab AI)', async (t) => {
  const { server, state, customer } = await setup(t, { history: RIWAYAT_WA.filter((m) => m.id._serialized !== STAF_ID) });
  await server.handleInboundMessage(CO, customer('Berapa harga semen?'), {});
  const call = state.calls.find((c) => c.purpose === 'auto_reply');
  assert.ok(call);
  assert.ok(call.history.every((h) => !String(h.content).includes('[Staf tim')));
  assert.doesNotMatch(call.systemPrompt, /Staf manusia sudah turun tangan/);
  assert.equal(state.sent.length, 1, 'customer dijawab');
});

test('balasan salah peran dari chat 9 Nov tidak sampai ke customer', async (t) => {
  const salahPeran = [
    'Oke, saya lewati alur otomatisnya.',
    'Pesanan triplek 3mm 4x8 MC/UT 1 lembar (Rp 62.000) dan alamat yang sudah diberikan customer tidak saya proses lebih lanjut di sini.',
    'Kalau mau saya kirim ke customer, ini draft singkatnya:',
    'Untuk proforma dan pengirimannya, tim kami yang akan melanjutkan langsung dengan kakak.',
    'Saya belum mengirimnya.',
  ].join('\n');
  const { server, state, customer } = await setup(t, { reply: salahPeran });
  await server.handleInboundMessage(CO, customer('Ok skip ya'), {});
  const terkirim = state.sent.join('\n');
  assert.ok(terkirim, 'masih ada kalimat yang pantas dikirim');
  assert.doesNotMatch(terkirim, /draft|alur otomatis|ke customer|belum mengirim|diberikan customer/i);
  assert.match(terkirim, /tim kami yang akan melanjutkan/);
});

test('"Minta no admin nya": dijawab tegas, chat diserahkan ke supervisor, tanpa mengarang nomor', async (t) => {
  const { server, state, customer } = await setup(t, { reply: 'tidak dipakai' });
  await server.handleInboundMessage(CO, customer('Minta no admin nya'), {});
  assert.equal(state.routing.length, 1);
  assert.equal(state.routing[0].mode, 'human');
  assert.equal(state.routing[0].assigneeUserId, 'sup-1');
  assert.match(state.sent.join('\n'), /admin kami membalas langsung lewat WhatsApp ini/);
  assert.doesNotMatch(state.sent.join('\n'), /\d{8,}/);
});

test('staf membalas dari HP: chat diambil alih (AI diam) dan bisa kembali lewat penyapu', async (t) => {
  const { server, state, customer } = await setup(t, { reply: 'Siap kak.' });
  await server.handleOwnMessage(CO, {
    to: CHAT, id: { _serialized: `true_${CHAT}_PHONE1` }, body: 'Sebentar ya kak saya cek', type: 'chat', timestamp: NOW,
  });
  assert.equal(state.phone.length, 1, 'balasan HP tercatat');
  assert.equal(state.routing.length, 1);
  assert.equal(state.routing[0].mode, 'human');
  assert.equal(state.routing[0].autoAssigned, true, 'ditandai otomatis supaya penyapu boleh mengembalikannya');
  // Selagi staf memegang chat, AI tidak menjawab.
  await server.handleInboundMessage(CO, customer('Gimana kak?'), {});
  assert.equal(state.sent.length, 0);
  assert.equal(state.calls.filter((c) => c.purpose === 'auto_reply').length, 0);
  // Staf pergi: penyapu mengembalikan ke AI DAN memeriksa pesan customer yang menunggu.
  await server.sweepAutoAssigned();
  assert.deepEqual(state.unansweredAsked, [[CO, CHAT]], 'pesan yang menunggu diperiksa untuk dijawab AI');
});

test('balasan HP di chat yang sudah dipegang manusia tidak mengubah routing', async (t) => {
  const { server, state } = await setup(t);
  await server.handleOwnMessage(CO, { to: CHAT, id: { _serialized: `true_${CHAT}_P1` }, body: 'halo', type: 'chat', timestamp: NOW });
  await server.handleOwnMessage(CO, { to: CHAT, id: { _serialized: `true_${CHAT}_P2` }, body: 'halo lagi', type: 'chat', timestamp: NOW });
  assert.equal(state.routing.length, 1, 'diambil alih sekali saja');
});
