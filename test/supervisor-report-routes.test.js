'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const owner = { id: 'owner-1', companyId: 'co-1', email: 'own@t.test', displayName: 'Owner', role: 'owner' };
const agent = { id: 'agent-1', companyId: 'co-1', email: 'ag@t.test', displayName: 'Agen', role: 'agent' };

async function app(t, overrides = {}) {
  const saved = new Map([['owner-1', { userId: 'owner-1', displayName: 'Owner', email: owner.email, role: 'owner', frequency: 'off', whatsappNumber: null, lastSentAt: null }]]);
  const audits = [];
  const tpl = { value: null };
  const periods = [];
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
    async getReportTemplate() { return tpl.value; },
    async saveReportTemplate(_company, template) { tpl.value = template; },
    async listSupervisorReportSettings() { return [...saved.values()]; },
    async saveSupervisorReportSetting({ userId, frequency, whatsappNumber }) {
      Object.assign(saved.get(userId), { frequency, whatsappNumber });
      return { frequency, whatsappNumber };
    },
    async getChatReportStats() { return { inboundMessages: 10, activeChats: 4, newChats: 1, aiReplies: 8, humanReplies: 1, handoffs: 0, hotLeads: 0 }; },
    async sampleInboundForReport() { return []; },
    async getChatReportChats(_company, from, to) {
      periods.push([from, to]);
      return { waiting: 1, chats: [{
        chatId: '6281@c.us', contactName: 'Budi', stage: 'hot', handlingMode: 'human', assigneeName: 'Sari', routingStatus: 'open',
        lastInboundAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), lastOutboundAt: null,
        storedSummary: null, messages: [{ fromMe: false, body: 'Mau paket 3 bulan, ada diskon?' }],
      }] };
    },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'rep-session', ...overrides });
  t.after(() => server.close());
  const login = async (email) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { server, saved, audits, tpl, periods, ownerCookie: await login(owner.email), agentCookie: await login(agent.email) };
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
  assert.match(outbound[0].body, /Laporan 7 Hari Terakhir — Toko Uji/);
  assert.match(outbound[0].body, /Pesan masuk dari customer: 10/);
});

test('template laporan: agent ditolak; penanda tak dikenal ditolak; tersimpan dan dicatat', async (t) => {
  const { server, tpl, audits, ownerCookie, agentCookie } = await app(t);
  const call = (method, url, cookie, payload) => server.inject({ method, url, headers: { cookie }, payload });
  assert.equal((await call('GET', '/v1/reports/template', agentCookie)).statusCode, 403);
  assert.equal((await call('PUT', '/v1/reports/template', agentCookie, { template: 'x' })).statusCode, 403);

  const initial = (await call('GET', '/v1/reports/template', ownerCookie)).json();
  assert.equal(initial.isDefault, true);
  assert.ok(initial.placeholders.some((p) => p.key === 'name'));

  const bad = await call('PUT', '/v1/reports/template', ownerCookie, { template: 'Halo {nama}' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /\{nama\}/);
  assert.equal(tpl.value, null);

  const ok = await call('PUT', '/v1/reports/template', ownerCookie, { template: 'Halo {name}, {inbound} pesan di {company}' });
  assert.equal(ok.statusCode, 200);
  assert.equal(tpl.value, 'Halo {name}, {inbound} pesan di {company}');
  assert.equal(audits.at(-1).action, 'report.template_changed');
  assert.equal((await call('GET', '/v1/reports/template', ownerCookie)).json().isDefault, false);

  // Menyimpan teks yang sama dengan bawaan = kembali ke bawaan (tidak disimpan).
  await call('PUT', '/v1/reports/template', ownerCookie, { template: initial.defaultTemplate });
  assert.equal(tpl.value, null);
});

test('template laporan: pratinjau memakai angka contoh dan tidak menyimpan', async (t) => {
  const { server, tpl, ownerCookie } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/v1/reports/template/preview', headers: { cookie: ownerCookie }, payload: { template: 'Hai {name}: {inbound} pesan' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().text, 'Hai Owner: 128 pesan');
  assert.equal(tpl.value, null);
  const bad = await server.inject({ method: 'POST', url: '/v1/reports/template/preview', headers: { cookie: ownerCookie }, payload: { template: '{salah}' } });
  assert.equal(bad.statusCode, 400);
});

test('kirim contoh memakai template company dan nama penerima', async (t) => {
  const { server, tpl, ownerCookie } = await app(t);
  tpl.value = 'Untuk {name}: {inbound} pesan';
  await server.inject({ method: 'PUT', url: '/v1/reports/supervisors/owner-1', headers: { cookie: ownerCookie }, payload: { frequency: 'daily', whatsappNumber: '081234567890' } });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie } });
  assert.equal(res.statusCode, 200);
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const body = (sent.json().messages || []).filter((m) => m.fromMe).at(-1).body;
  assert.match(body, /^\*CONTOH\*/);
  assert.match(body, /Untuk Owner: 10 pesan$/);
});

test('kirim sekarang: periode dipilih, judulnya mengikuti periode, dan detail chat ikut terkirim', async (t) => {
  const { server, saved, periods, ownerCookie } = await app(t);
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const send = (payload) => server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie }, payload });

  const res = await send({ period: 'yesterday' });
  assert.equal(res.statusCode, 200, res.body);
  const [from, to] = periods.at(-1);
  assert.equal(to - from, 24 * 3_600_000, 'kemarin = satu hari kalender penuh');
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const body = (sent.json().messages || []).filter((m) => m.fromMe).at(-1).body;
  assert.match(body, /\*Laporan Kemarin — Toko Uji\*/);
  assert.match(body, /• Menunggu balasan kita: 1/);
  assert.match(body, /\*1\. Budi\*\nIsi: Mau paket 3 bulan, ada diskon\?\nStatus: Panas · Customer menunggu balasan 3 jam · Dipegang Sari\nTindakan: Balas dan dorong ke closing — \*Sari\*/);

  assert.equal((await send({ period: 'bulan-depan' })).statusCode, 400);
});

test('template tanpa {chat_details} tidak mengambil data chat sama sekali', async (t) => {
  const { server, saved, tpl, periods, ownerCookie } = await app(t);
  tpl.value = 'Ringkas {inbound}';
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie }, payload: { period: 'today' } });
  assert.equal(res.statusCode, 200);
  assert.equal(periods.length, 0);
});

test('ringkasan isi dan langkah berikutnya datang dari SATU panggilan model untuk semua chat', async (t) => {
  const prompts = [];
  const llmService = {
    enabled: true, model: 'fake',
    async generateReply(transcript, options) {
      prompts.push({ transcript, purpose: options.purpose });
      return { text: 'Hasil:\n```json\n[{"id":1,"summary":"Minta diskon paket 3 bulan","nextStep":"Kirim penawaran paket 3 bulan"}]\n```' };
    },
  };
  const { server, saved, ownerCookie } = await app(t, { llmService });
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie }, payload: { period: '7d' } });
  assert.equal(res.statusCode, 200, res.body);
  const digestCalls = prompts.filter((p) => p.purpose === 'supervisor_report' && p.transcript.includes('Mau paket 3 bulan'));
  assert.equal(digestCalls.length, 1);
  assert.match(digestCalls[0].transcript, /^#1\nCustomer: Mau paket 3 bulan, ada diskon\?/);
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const body = (sent.json().messages || []).filter((m) => m.fromMe).at(-1).body;
  assert.match(body, /Isi: Minta diskon paket 3 bulan\nStatus: Panas/);
  assert.match(body, /Tindakan: Kirim penawaran paket 3 bulan — \*Sari\*/);
});

test('model gagal: detail chat tetap terkirim dengan pesan terakhir customer dan tindakan bawaan', async (t) => {
  const llmService = { enabled: true, model: 'fake', async generateReply() { throw new Error('model down'); } };
  const { server, saved, ownerCookie } = await app(t, { llmService });
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie }, payload: { period: 'today' } });
  assert.equal(res.statusCode, 200, res.body);
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const body = (sent.json().messages || []).filter((m) => m.fromMe).at(-1).body;
  assert.match(body, /Isi: Mau paket 3 bulan, ada diskon\?/);
  assert.match(body, /Tindakan: Balas dan dorong ke closing — \*Sari\*/);
});
