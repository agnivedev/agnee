'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildApp } = require('../src/server');

/*
 * Robot Anduman -> Agnee: daftar klien di portal IB sebuah broker. Agnee
 * mencocokkan dengan lead dari website, menandainya terverifikasi, dan
 * mengirim satu WhatsApp konfirmasi per lead.
 */

const SECRET = 'lead-verify-test-secret';
const owner = { id: 'owner-1', companyId: 'company-bb', email: 'own@bb.test', displayName: 'Owner', role: 'owner' };

function seedLeads() {
  return [
    { id: 'l1', chatId: '6281111111111@c.us', name: 'Rina Wijaya', email: 'Rina@Example.com', broker: 'Exness', accountNumber: '', language: 'id', status: 'new', confirmationSentAt: null },
    { id: 'l2', chatId: '6282222222222@c.us', name: 'Budi Santoso', email: 'budi@example.com', broker: 'Blueberry Markets', accountNumber: '55512345', language: 'id', status: 'new', confirmationSentAt: null },
    { id: 'l3', chatId: '6283333333333@c.us', name: 'Citra Lestari', email: 'citra@example.com', broker: 'TMGM', accountNumber: '', language: 'en', status: 'new', confirmationSentAt: null },
    { id: 'l4', submissionId: 'member-12', chatId: '6284444444444@c.us', name: 'Dewi Anggraini', email: 'dewi@member.test', brokerEmail: 'dewi.trade@valetax.test', broker: 'Valetax', accountNumber: '', language: 'id', status: 'new', confirmationSentAt: null },
  ];
}

function signed(body, { secret = SECRET, timestamp = Date.now() } = {}) {
  const raw = JSON.stringify(body);
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-agnive-timestamp': String(timestamp), 'x-agnive-signature': signature } };
}

const body = (broker, registrations, extra = {}) => ({ version: 1, source: 'anduman', broker, registrations, ...extra });

async function app(t, { secret = SECRET, leads = seedLeads() } = {}) {
  const stages = [];
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(ref) { return ref === 'bb' ? 'company-bb' : null; },
    async authenticateUser(email, password) { return password === 'pass-12345' && email === owner.email ? owner : null; },
    async getActiveSessionUser(userId) { return userId === owner.id ? owner : null; },
    async setPresence() {},
    async getCompanyConfig() { return null; },
    async recordAuditLog() { return { id: 1 }; },
    async findWebsiteLeadsForVerification(_c, { emails, accounts, submissionIds = [] }) {
      return leads.filter((l) => (l.status === 'new' || !l.confirmationSentAt)
        && ((l.email && emails.includes(l.email.toLowerCase()))
          || (l.brokerEmail && emails.includes(l.brokerEmail.toLowerCase()))
          || (l.accountNumber && accounts.includes(l.accountNumber))
          || (l.submissionId && submissionIds.includes(l.submissionId))));
    },
    async claimWebsiteLeadVerification(id) {
      const lead = leads.find((l) => l.id === id);
      if (!lead || lead.status !== 'new') return null;
      lead.status = 'verified';
      return { id };
    },
    async markWebsiteLeadConfirmed(id) {
      const lead = leads.find((l) => l.id === id);
      if (!lead || lead.confirmationSentAt) return false;
      lead.confirmationSentAt = 'now';
      return true;
    },
    async setPipelineStage(chatId, stage, by, companyId) { stages.push({ chatId, stage, by, companyId }); return { chatId, pipelineStage: stage }; },
  };
  process.env.LEAD_VERIFY_SECRET = secret;
  process.env.LEAD_WEBHOOK_COMPANY = 'bb';
  const instance = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'lv-session' });
  delete process.env.LEAD_VERIFY_SECRET;
  delete process.env.LEAD_WEBHOOK_COMPANY;
  t.after(() => instance.close());
  const cookie = (await instance.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: owner.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  const sentTo = async (chatId) => {
    const res = await instance.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent(chatId)}/messages`, headers: { cookie } });
    return (res.json().messages || []).filter((m) => m.fromMe);
  };
  return { server: instance, leads, stages, sentTo };
}

test('email cocok (tanpa beda huruf besar): lead terverifikasi dan dikonfirmasi satu kali', async (t) => {
  const { server, leads, stages, sentTo } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('Exness', [{ email: 'rina@example.COM', registeredAt: '2026-10-14' }, { email: 'orang-lain@example.com' }])) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, received: 2, matched: 1, confirmed: 1, alreadyConfirmed: 0, failed: 0 });
  assert.equal(leads[0].status, 'verified');
  assert.ok(leads[0].confirmationSentAt);
  assert.deepEqual(stages, [{ chatId: '6281111111111@c.us', stage: 'closing', by: 'lead-verify', companyId: 'company-bb' }]);
  const sent = await sentTo('6281111111111@c.us');
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /^Halo Rina, kabar baik: account Exness kamu sudah terhubung/);
});

test('kiriman ulang robot tidak mengirim konfirmasi kedua', async (t) => {
  const { server, sentTo } = await app(t);
  const req = signed(body('Exness', [{ email: 'rina@example.com' }]));
  await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...req });
  const again = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('Exness', [{ email: 'rina@example.com' }])) });
  assert.equal(again.json().matched, 0);
  assert.equal(again.json().confirmed, 0);
  assert.equal((await sentTo('6281111111111@c.us')).length, 1);
});

test('cocok lewat nomor account, dan "Blueberry Markets" sama dengan "blueberry"', async (t) => {
  const { server, leads, sentTo } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('blueberry', [{ accountNumber: '55512345' }])) });
  assert.equal(res.json().confirmed, 1);
  assert.equal(leads[1].status, 'verified');
  assert.equal((await sentTo('6282222222222@c.us')).length, 1);
});

test('broker yang berbeda tidak mengonfirmasi lead orang lain', async (t) => {
  const { server, leads, sentTo } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('Valetax', [{ email: 'rina@example.com' }])) });
  assert.equal(res.json().matched, 0);
  assert.equal(leads[0].status, 'new');
  assert.equal((await sentTo('6281111111111@c.us')).length, 0);
});

test('konfirmasi mengikuti bahasa lead', async (t) => {
  const { server, sentTo } = await app(t);
  await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('TMGM', [{ email: 'citra@example.com' }])) });
  assert.match((await sentTo('6283333333333@c.us'))[0].body, /^Hi Citra, good news: your TMGM account is now linked/);
});

test('respons hanya berisi angka, tanpa data lead', async (t) => {
  const { server } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('Exness', [{ email: 'rina@example.com' }])) });
  const text = res.body;
  assert.doesNotMatch(text, /rina|example|Wijaya|6281111111111/i);
});

test('tanpa secret pintunya tertutup, dan secret webhook lead tidak berlaku', async (t) => {
  const closed = await app(t, { secret: '' });
  const res = await closed.server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('Exness', [{ email: 'rina@example.com' }])) });
  assert.equal(res.statusCode, 404);
  const { server } = await app(t);
  const wrong = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('Exness', [{ email: 'rina@example.com' }]), { secret: 'secret-webhook-lead' }) });
  assert.equal(wrong.statusCode, 401);
});

test('tanda tangan kedaluwarsa atau isi diubah ditolak', async (t) => {
  const { server, leads } = await app(t);
  const stale = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(body('Exness', [{ email: 'rina@example.com' }]), { timestamp: Date.now() - 10 * 60_000 }) });
  assert.equal(stale.statusCode, 401);
  const req = signed(body('Exness', [{ email: 'rina@example.com' }]));
  const tampered = await server.inject({ method: 'POST', url: '/webhook/lead-verify', headers: req.headers, payload: req.payload.replace('rina', 'budi') });
  assert.equal(tampered.statusCode, 401);
  assert.equal(leads[0].status, 'new');
});

test('payload tidak sah ditolak 400', async (t) => {
  const { server } = await app(t);
  const many = Array.from({ length: 501 }, (_, i) => ({ email: `u${i}@example.com` }));
  for (const bad of [
    { ...body('Exness', [{ email: 'rina@example.com' }]), version: 2 },
    { ...body('Exness', [{ email: 'rina@example.com' }]), source: 'wordpress' },
    body('', [{ email: 'rina@example.com' }]),
    body('Exness', []),
    body('Exness', [{ email: 'bukan-email' }, { accountNumber: '12' }]),
    body('Exness', many),
  ]) {
    const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(bad) });
    assert.equal(res.statusCode, 400, JSON.stringify(bad).slice(0, 80));
  }
});

test('skrip pengirim (lead-verify-push) menghasilkan tanda tangan yang diterima Agnee', async (t) => {
  const { buildRegistrations, signRequest } = await import('../scripts/lead-verify-push.mjs');
  const { server, leads } = await app(t);
  const registrations = buildRegistrations({ rows: [{ Email: 'rina@example.com', Login: '9999 8888' }, { foo: 'baris tanpa data' }] });
  assert.deepEqual(registrations, [{ email: 'rina@example.com', accountNumber: '99998888' }]);
  const { raw, headers } = signRequest(SECRET, { version: 1, source: 'anduman', broker: 'exness', registrations });
  const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', headers, payload: raw });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().confirmed, 1);
  assert.equal(leads[0].status, 'verified');
});

const wpBody = (rows, extra = {}) => ({ version: 1, source: 'bullbabe-wp', broker: 'Valetax', registrations: rows, ...extra });

test('WordPress: email broker (beda dari email member) mengonfirmasi lead Valetax', async (t) => {
  const { server, leads, stages, sentTo } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(wpBody([{ email: 'Dewi.Trade@valetax.test' }])) });
  assert.deepEqual(res.json(), { ok: true, received: 1, matched: 1, confirmed: 1, alreadyConfirmed: 0, failed: 0 });
  assert.equal(leads[3].status, 'verified');
  assert.deepEqual(stages, [{ chatId: '6284444444444@c.us', stage: 'closing', by: 'lead-verify', companyId: 'company-bb' }]);
  assert.equal((await sentTo('6284444444444@c.us')).length, 1);
});

test('WordPress: submissionId member-12 cocok pasti, dan kiriman ulang tidak mengirim dua kali', async (t) => {
  const { server, sentTo } = await app(t);
  const req = () => signed(wpBody([{ submissionId: 'member-12', email: 'apa-saja@valetax.test' }]));
  assert.equal((await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...req() })).json().confirmed, 1);
  const again = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...req() });
  assert.equal(again.json().confirmed, 0);
  assert.equal((await sentTo('6284444444444@c.us')).length, 1);
});

test('WordPress: submissionId untuk broker lain tidak mengonfirmasi', async (t) => {
  const { server, leads } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(wpBody([{ submissionId: 'member-12' }], { broker: 'Exness' })) });
  assert.equal(res.json().matched, 0);
  assert.equal(leads[3].status, 'new');
});

test('source yang tidak dikenal ditolak', async (t) => {
  const { server } = await app(t);
  const res = await server.inject({ method: 'POST', url: '/webhook/lead-verify', ...signed(wpBody([{ submissionId: 'member-12' }], { source: 'lainnya' })) });
  assert.equal(res.statusCode, 400);
});
