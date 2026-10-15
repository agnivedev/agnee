'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildApp } = require('../src/server');

/*
 * Website → Agnee: lead baru dari landing page Bull Babe. Bertanda tangan,
 * dibatasi waktu, dan menyapa orang yang sama paling banyak sekali per hari.
 */

const SECRET = 'lead-webhook-test-secret';
const owner = { id: 'owner-1', companyId: 'company-bb', email: 'own@bb.test', displayName: 'Owner', role: 'owner' };

function payload(overrides = {}) {
  return {
    version: 1,
    source: 'bullbabe-landing',
    lead: {
      submissionId: '17',
      name: 'Rina Wijaya',
      whatsapp: '08123456789',
      email: 'rina@example.com',
      broker: 'Exness',
      accountStatus: 'new',
      accountNumber: '',
      language: 'id',
      ...overrides,
    },
  };
}

function signed(body, { secret = SECRET, timestamp = Date.now() } = {}) {
  const raw = JSON.stringify(body);
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-agnive-timestamp': String(timestamp), 'x-agnive-signature': signature } };
}

async function app(t, { secret = SECRET, company = 'bb', optOuts = [] } = {}) {
  const saved = [];
  const profiles = [];
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(ref) { return ref === 'bb' ? 'company-bb' : null; },
    async authenticateUser(email, password) { return password === 'pass-12345' && email === owner.email ? owner : null; },
    async getActiveSessionUser(userId) { return userId === owner.id ? owner : null; },
    async setPresence() {},
    async getCompanyConfig() { return null; },
    async recordWebsiteLead(lead, companyId) { saved.push({ ...lead, companyId }); return lead; },
    async saveWebsiteLeadProfile(lead) { profiles.push(lead); return { id: 'x' }; },
    async listBroadcastOptOuts() { return optOuts; },
    async recordAuditLog() { return { id: 1 }; },
  };
  process.env.LEAD_WEBHOOK_SECRET = secret;
  process.env.LEAD_WEBHOOK_COMPANY = company;
  const instance = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'lw-session' });
  delete process.env.LEAD_WEBHOOK_SECRET;
  delete process.env.LEAD_WEBHOOK_COMPANY;
  t.after(() => instance.close());
  const cookie = (await instance.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: owner.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  const sentTo = async (chatId) => {
    const res = await instance.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent(chatId)}/messages`, headers: { cookie } });
    return (res.json().messages || []).filter((m) => m.fromMe);
  };
  return { server: instance, saved, profiles, sentTo };
}

test('lead bertanda tangan benar: tercatat di pipeline dan disambut satu kali', async (t) => {
  const { server, saved, sentTo } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload()) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, welcomed: true });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].chatId, '628123456789@c.us');
  assert.match(saved[0].title, /Rina Wijaya · Exness/);
  const sent = await sentTo('628123456789@c.us');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /^Halo Rina, terima kasih sudah daftar/);
  assert.match(sent[0].body, /Kamu pilih Exness/);
  assert.match(sent[0].body, /Setelah selesai daftar/);
  assert.match(sent[0].body, /Jangan pernah kirim password/);
});

test('sudah punya account: pesannya soal pindah IB; bahasa Inggris mengikuti language', async (t) => {
  const { server, sentTo } = await app(t);
  await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload({ submissionId: '20', accountStatus: 'have', accountNumber: '12345678' })) });
  assert.match((await sentTo('628123456789@c.us'))[0].body, /dipindah ke IB kami/);
  await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload({ submissionId: '21', whatsapp: '08999888777', language: 'en', broker: 'Belum tahu' })) });
  const en = (await sentTo('628999888777@c.us'))[0].body;
  assert.match(en, /^Hi Rina, thanks for registering/);
  assert.doesNotMatch(en, /You picked/);
});

test('welcomeText dari WordPress dipakai apa adanya menggantikan teks umum', async (t) => {
  const { server, sentTo } = await app(t);
  const text = 'Halo Rina, balas dengan email yang kamu pakai mendaftar di Valetax ya.';
  await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload({ submissionId: '30', broker: 'Valetax', welcomeText: text })) });
  const sent = await sentTo('628123456789@c.us');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, text);
});

test('kiriman ulang submission yang sama tidak mengirim pesan kedua', async (t) => {
  const { server, sentTo } = await app(t);
  const first = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload()) });
  const again = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload()) });
  assert.equal(first.statusCode, 200);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().duplicate, true);
  assert.equal((await sentTo('628123456789@c.us')).length, 1);
});

test('nomor yang sama dengan submission baru tidak disapa dua kali dalam sehari', async (t) => {
  const { server, saved, sentTo } = await app(t);
  await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload()) });
  const second = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload({ submissionId: '18', broker: 'TMGM' })) });
  assert.deepEqual(second.json(), { ok: true, welcomed: false, reason: 'already_welcomed_today' });
  assert.equal((await sentTo('628123456789@c.us')).length, 1);
  assert.equal(saved.length, 2, 'lead kedua tetap tercatat');
});

test('nomor yang berhenti dari broadcast tidak disapa', async (t) => {
  const { server, saved, sentTo } = await app(t, { optOuts: [{ chatId: '628123456789@c.us' }] });
  const res = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload()) });
  assert.deepEqual(res.json(), { ok: true, welcomed: false, reason: 'opted_out' });
  assert.equal((await sentTo('628123456789@c.us')).length, 0);
  assert.equal(saved.length, 1);
});

test('tanpa secret atau company pintunya tertutup (404)', async (t) => {
  const { server } = await app(t, { secret: '' });
  const res = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload()) });
  assert.equal(res.statusCode, 404);
});

test('tanda tangan salah atau kedaluwarsa ditolak', async (t) => {
  const { server, saved } = await app(t);
  const wrong = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload(), { secret: 'bukan-secret-nya' }) });
  assert.equal(wrong.statusCode, 401);
  const stale = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload(), { timestamp: Date.now() - 10 * 60_000 }) });
  assert.equal(stale.statusCode, 401);
  const tampered = signed(payload());
  const swapped = await server.inject({ method: 'POST', url: '/webhook/lead', headers: tampered.headers, payload: tampered.payload.replace('Rina', 'Budi') });
  assert.equal(swapped.statusCode, 401);
  assert.equal(saved.length, 0);
});

test('API_KEY layanan tidak berlaku untuk webhook ini', async (t) => {
  const { server } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead', headers: { 'content-type': 'application/json', 'x-api-key': 'dev-api-key' }, payload: JSON.stringify(payload()) });
  assert.equal(res.statusCode, 401);
});

test('payload tidak sah ditolak 400', async (t) => {
  const { server } = await app(t);
  for (const bad of [
    { ...payload(), version: 2 },
    { ...payload(), source: 'hub' },
    payload({ name: '  ' }),
    payload({ submissionId: '' }),
    payload({ whatsapp: '12' }),
  ]) {
    const res = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(bad) });
    assert.equal(res.statusCode, 400, JSON.stringify(bad.lead));
  }
});

test('member WordPress (source bullbabe-member): brokerEmail Valetax disimpan, bukan dibuang', async (t) => {
  const { server, profiles } = await app(t);
  const body = payload({ submissionId: 'member-12', broker: 'Valetax', email: 'dewi@member.test', brokerEmail: ' Dewi.Trade@Valetax.test ', accountNumber: 'dewi.trade@valetax.test' });
  body.source = 'bullbabe-member';
  const res = await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(body) });
  assert.equal(res.statusCode, 200);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].submissionId, 'member-12');
  assert.equal(profiles[0].brokerEmail, 'dewi.trade@valetax.test');
  assert.equal(profiles[0].email, 'dewi@member.test');
  assert.equal(profiles[0].accountNumber, '');
});

test('brokerEmail yang bukan email dikosongkan', async (t) => {
  const { server, profiles } = await app(t);
  await server.inject({ method: 'POST', url: '/webhook/lead', ...signed(payload({ submissionId: '90', brokerEmail: 'bukan-email' })) });
  assert.equal(profiles[0].brokerEmail, '');
});
