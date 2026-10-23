'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const owner = { id: 'owner-1', companyId: 'co-1', email: 'own@t.test', displayName: 'Owner', role: 'owner' };
const agent = { id: 'agent-1', companyId: 'co-1', email: 'ag@t.test', displayName: 'Agen', role: 'agent' };

async function app(t, { db: dbOverrides = {}, ...overrides } = {}) {
  const saved = new Map([['owner-1', { userId: 'owner-1', displayName: 'Owner', email: owner.email, role: 'owner', frequency: 'off', whatsappNumber: null, lastSentAt: null }]]);
  const audits = [];
  const tpl = { value: null };
  const periods = [];
  let manyChats = 0;
  const statWindows = [];
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
    // Jendela terbaru (to mendekati sekarang) diberi angka lebih besar dari pembandingnya.
    async getChatReportStats(_company, from, to) {
      statWindows.push([from, to]);
      const recent = Date.now() - to.getTime() < 3600_000 * 24 * 2;
      return { inboundMessages: recent ? 12 : 10, activeChats: 4, newChats: 1, aiReplies: 8, humanReplies: 1, handoffs: 0, hotLeads: 0 };
    },
    async sampleInboundForReport() { return []; },
    async getChatReportChats(_company, from, to) {
      periods.push([from, to]);
      if (manyChats) {
        return { waiting: 30, followUpTotal: 30, chats: Array.from({ length: manyChats }, (_, i) => ({
          chatId: `${i}@c.us`, contactName: `Customer ${i + 1}`, stage: 'warm', handlingMode: 'human', assigneeName: 'Sari', routingStatus: 'open',
          lastInboundAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), lastOutboundAt: null,
          storedSummary: `Ringkasan ${i + 1} ${'x'.repeat(280)}`, messages: [{ fromMe: false, body: `Pesan ${i + 1}` }],
        })) };
      }
      return { waiting: 1, followUpTotal: 1, chats: [{
        chatId: '6281@c.us', contactName: 'Budi', stage: 'hot', handlingMode: 'human', assigneeName: 'Sari', routingStatus: 'open',
        lastInboundAt: new Date(Date.now() - 3.5 * 3_600_000).toISOString(), lastOutboundAt: null,
        storedSummary: null, messages: [{ fromMe: false, body: 'Mau paket 3 bulan, ada diskon?' }],
      }] };
    },
  };
  Object.assign(database, dbOverrides);
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'rep-session', ...overrides });
  t.after(() => server.close());
  const login = async (email) => (await server.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  return { server, saved, audits, tpl, periods, statWindows, setManyChats: (n) => { manyChats = n; }, ownerCookie: await login(owner.email), agentCookie: await login(agent.email) };
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
  assert.match(outbound[0].body, /\*Laporan Chat — Toko Uji\*/);
  assert.match(outbound[0].body, /\*7 hari terakhir\*/);
  assert.match(outbound[0].body, /Pesan masuk dari customer: 12 \(\+2\)/);
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
  assert.match(body, /Untuk Owner: 12 pesan$/);
});

test('kirim sekarang: tanpa pilihan periode; semua periode dan pembandingnya diambil, plus detail chat', async (t) => {
  const { server, saved, statWindows, periods, ownerCookie } = await app(t);
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(statWindows.length, 8, 'empat periode, masing-masing dengan pembandingnya');
  // Chat penting memakai 7 hari terakhir.
  const [from, to] = periods.at(-1);
  assert.equal(Math.round((to - from) / 86_400_000), 7);
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const body = (sent.json().messages || []).filter((m) => m.fromMe).at(-1).body;
  for (const label of ['*Kemarin*', '*7 hari terakhir*', '*30 hari terakhir*']) assert.ok(body.includes(label), label);
  assert.match(body, /\*Hari ini \(sampai \d\d\.\d\d\)\*/);
  assert.match(body, /• Menunggu balasan kita: 1 chat/);
  assert.match(body, /\*1\. Budi\*\nIsi: Mau paket 3 bulan, ada diskon\?\nStatus: Panas · Customer menunggu balasan 3 jam · Dipegang Sari\nTindakan: Balas dan dorong ke closing — \*Sari\*/);
});

test('template tanpa {chat_details} tidak mengambil data chat sama sekali', async (t) => {
  const { server, saved, tpl, periods, ownerCookie } = await app(t);
  tpl.value = 'Ringkas {inbound}';
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie }, });
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
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie }, });
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
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie }, });
  assert.equal(res.statusCode, 200, res.body);
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const body = (sent.json().messages || []).filter((m) => m.fromMe).at(-1).body;
  assert.match(body, /Isi: Mau paket 3 bulan, ada diskon\?/);
  assert.match(body, /Tindakan: Balas dan dorong ke closing — \*Sari\*/);
});

test('daftar chat panjang dikirim sebagai pesan terpisah, berurutan, setelah pesan angka', async (t) => {
  const { server, saved, setManyChats, ownerCookie } = await app(t);
  setManyChats(24);
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie } });
  assert.equal(res.statusCode, 200, res.body);
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const bodies = (sent.json().messages || []).filter((m) => m.fromMe).map((m) => m.body);
  assert.ok(bodies.length >= 3, `pesan terkirim ${bodies.length}`);
  assert.match(bodies[0], /\*Laporan Chat — Toko Uji\*/);
  assert.match(bodies[0], /\*30 hari terakhir/);
  assert.doesNotMatch(bodies[0], /follow-up/);
  assert.match(bodies[1], /^\*Chat yang perlu di-follow up\* \(30\)/);
  assert.match(bodies[2], /^\*Chat yang perlu di-follow up\* \(lanjutan\)/);
  assert.ok(bodies.every((b) => b.length <= 3800));
  assert.doesNotMatch(bodies[1], /CONTOH/, 'label CONTOH hanya di pesan pertama');
});

test('ringkasan model dipanggil per batch 8 chat dan hasilnya jatuh ke chat yang benar', async (t) => {
  const calls = [];
  const llmService = {
    enabled: true, model: 'fake',
    async generateReply(transcript, options) {
      if (options.purpose !== 'supervisor_report' || !transcript.includes('#1')) return { text: '' };
      calls.push(transcript);
      // Setiap chat dijawab dengan nomor pesannya sendiri, supaya salah tempel terlihat.
      const items = [...transcript.matchAll(/^#(\d+)\n(?:Ringkasan lama:[^\n]*\n)?Customer: (Pesan \d+)/gm)];
      return { text: JSON.stringify(items.map((m) => ({ id: Number(m[1]), summary: `Ringkasan model untuk ${m[2]}`, nextStep: 'Hubungi' }))) };
    },
  };
  const { server, saved, setManyChats, ownerCookie } = await app(t, { llmService });
  setManyChats(20);
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(calls.length, 3, '20 chat = 8 + 8 + 4');
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const all = (sent.json().messages || []).filter((m) => m.fromMe).map((m) => m.body).join('\n');
  for (const n of [1, 9, 17, 20]) assert.match(all, new RegExp(`\\*${n}\\. Customer ${n}\\*\\nIsi: Ringkasan model untuk Pesan ${n}\\n`));
});

test('AI membalas customer mati: laporan tetap diringkas AI, chat dipegang tim, spam disembunyikan', async (t) => {
  const prompts = [];
  const llmService = {
    enabled: true, model: 'fake',
    async generateReply(transcript, options) {
      prompts.push({ transcript, purpose: options.purpose });
      return { text: '[{"id":1,"summary":"Tanya lampu 18 watt","nextStep":"Kirim katalog 18 watt","needsFollowUp":true},'
        + '{"id":2,"summary":"Menawarkan jasa SEO","nextStep":"-","needsFollowUp":false},'
        + '{"id":3,"summary":"Minta penawaran proyek","nextStep":"Tanyakan jumlah titik lampu","needsFollowUp":true}]' };
    },
  };
  const chat = (i, body) => ({
    chatId: `${i}@lid`, contactName: `Customer ${i}`, stage: 'cold', handlingMode: 'ai', assigneeName: null, routingStatus: 'open',
    lastInboundAt: new Date(Date.now() - 50 * 3_600_000).toISOString(), lastOutboundAt: null,
    storedSummary: null, messages: [{ fromMe: false, body }],
  });
  const { server, saved, ownerCookie } = await app(t, {
    llmService,
    db: {
      async getAiSettings() { return { enabled: false, modelChain: ['m'] }; },
      async getChatReportChats() {
        return { waiting: 3, followUpTotal: 3, chats: [chat(1, 'ada 18 watt?'), chat(2, 'Jasa SEO murah kak'), chat(3, 'Mau konsultasi proyek')] };
      },
    },
  });
  Object.assign(saved.get('owner-1'), { frequency: 'daily', whatsappNumber: '081234567890' });
  const res = await server.inject({ method: 'POST', url: '/v1/reports/supervisors/owner-1/test', headers: { cookie: ownerCookie } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(prompts.filter((p) => p.purpose === 'supervisor_report' && p.transcript.includes('ada 18 watt')).length, 1);
  const sent = await server.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent('6281234567890@c.us')}/messages`, headers: { cookie: ownerCookie } });
  const body = (sent.json().messages || []).filter((m) => m.fromMe).at(-1).body;
  assert.match(body, /AI membalas customer: \*mati\* — semua chat harus dibalas tim/);
  assert.match(body, /Chat yang perlu di-follow up\* \(2\)/);
  assert.match(body, /Tanya lampu 18 watt\nStatus: Baru · Customer menunggu balasan 2 hari · Dipegang Tim\nTindakan: Kirim katalog 18 watt — \*Tim\*/);
  assert.doesNotMatch(body, /SEO|AI belum membalas|Dipegang AI/);
  assert.match(body, /1 chat lain tidak ditampilkan/);
});
