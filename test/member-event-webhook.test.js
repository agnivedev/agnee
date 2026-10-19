'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildApp } = require('../src/server');

/*
 * WordPress member → Agnee: satu event member (account terhubung, penarikan,
 * login perangkat baru) menjadi satu WhatsApp ke member itu. Bertanda tangan
 * dengan secret lead, dedupe per id, jeda per chat per type, kuota per jam,
 * dan respons tanpa data pribadi.
 */

const LEGACY_SECRET = 'event-legacy-secret';
const owner = { id: 'owner-1', companyId: 'c-acme', email: 'own@acme.test', displayName: 'Owner', role: 'owner' };
const CHAT = '628123456789@c.us';

const sign = (body, secret, timestamp = Date.now()) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { payload: raw, headers: { 'content-type': 'application/json', 'x-agnive-timestamp': String(timestamp), 'x-agnive-signature': signature } };
};
const eventBody = (over = {}, source = 'bullbabe-member') => ({
  version: 1, source,
  event: { id: 'acct-42-linked', type: 'account_linked', whatsapp: '08123456789', name: 'Budi Santoso', language: 'id', text: 'Halo Budi, account Valetax kamu sudah terhubung.', ...over },
});

/**
 * Fake DB gaya lead-webhook-company.test.js, ditambah company 'bb' untuk rute
 * lama (env LEAD_WEBHOOK_SECRET + LEAD_WEBHOOK_COMPANY seperti lead-webhook.test.js).
 */
async function app(t, { legacySecret = LEGACY_SECRET, optOuts = [], demoMode = true, logs = null, waConns = null } = {}) {
  const hooks = {
    'c-acme': { companyId: 'c-acme', companyName: 'Acme Trading', slug: 'acme', leadSecret: 'secret-lead-acme', verifySecret: 'secret-verify-acme', pullSecret: 'secret-pull-acme', enabled: true, welcomeId: '', welcomeEn: '', confirmId: '', confirmEn: '' },
    'c-beta': { companyId: 'c-beta', companyName: 'Beta', slug: 'beta', leadSecret: 'secret-lead-beta', verifySecret: null, enabled: true, welcomeId: '', welcomeEn: '', confirmId: '', confirmEn: '' },
    'c-gamma': { companyId: 'c-gamma', companyName: 'Gamma', slug: 'gamma', leadSecret: null, verifySecret: 'secret-verify-gamma', enabled: true, welcomeId: '', welcomeEn: '', confirmId: '', confirmEn: '' },
  };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(ref) { return { bb: 'company-bb', acme: 'c-acme', 'c-acme': 'c-acme', beta: 'c-beta', gamma: 'c-gamma' }[ref] || null; },
    async getLeadWebhook(id) { return hooks[id] || null; },
    async authenticateUser(email, password) { return password === 'pass-12345' && email === owner.email ? owner : null; },
    async getActiveSessionUser(userId) { return userId === owner.id ? owner : null; },
    async setPresence() {},
    async getCompanyConfig() { return null; },
    async recordAuditLog() { return { id: 1 }; },
    async listBroadcastOptOuts() { return typeof optOuts === 'function' ? optOuts() : optOuts; },
  };
  if (waConns) {
    // Bentuk produksi: chat belum menempel ke nomor mana pun, nomor company ada tapi belum siap.
    database.getWhatsappChatNumber = async () => null;
    database.listWhatsappConnections = async () => waConns;
  }
  process.env.LEAD_WEBHOOK_SECRET = legacySecret;
  process.env.LEAD_WEBHOOK_COMPANY = 'bb';
  const logger = logs ? { level: 'debug', stream: { write: (line) => logs.push(line) } } : false;
  const instance = await buildApp({ logger, startupEnabled: false, demoMode, database, sessionSecret: 'mev-session' });
  delete process.env.LEAD_WEBHOOK_SECRET;
  delete process.env.LEAD_WEBHOOK_COMPANY;
  t.after(() => instance.close());
  const cookie = (await instance.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: owner.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];
  const sentTo = async (chatId) => {
    const res = await instance.inject({ method: 'GET', url: `/v1/chats/${encodeURIComponent(chatId)}/messages`, headers: { cookie } });
    return (res.json().messages || []).filter((m) => m.fromMe);
  };
  return { server: instance, hooks, sentTo };
}

const legacy = (server, body, secret = LEGACY_SECRET) => server.inject({ method: 'POST', url: '/webhook/event', ...sign(body, secret) });
const company = (server, slug, body, secret) => server.inject({ method: 'POST', url: `/webhook/company/${slug}/event`, ...sign(body, secret) });

/** Jam palsu hanya untuk Date: setTimeout tetap asli, Fastify tetap jalan. */
const fakeClock = (t) => { t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); return (ms) => t.mock.timers.tick(ms); };

test('rute lama: event bertanda tangan benar terkirim apa adanya ke nomor member', async (t) => {
  const { server, sentTo } = await app(t);
  const res = await legacy(server, eventBody());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, sent: true });
  const sent = await sentTo(CHAT);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, 'Halo Budi, account Valetax kamu sudah terhubung.');
});

test('rute lama: source bullbabe-wp diterima, source lain ditolak 400', async (t) => {
  const { server, sentTo } = await app(t);
  assert.equal((await legacy(server, eventBody({ id: 'wd-1-done', type: 'withdrawal_done' }, 'bullbabe-wp'))).json().sent, true);
  for (const source of ['bullbabe-landing', 'anduman', 'acme-crm']) {
    assert.equal((await legacy(server, eventBody({ id: `x-${source}` }, source))).statusCode, 400, source);
  }
  assert.equal((await sentTo(CHAT)).length, 1);
});

test('rute lama tanpa LEAD_WEBHOOK_SECRET tertutup (404)', async (t) => {
  const { server } = await app(t, { legacySecret: '' });
  assert.equal((await legacy(server, eventBody(), '')).statusCode, 404);
});

test('rute per company: secret lead company berlaku, source bebas yang rapi', async (t) => {
  const { server, sentTo } = await app(t);
  const res = await company(server, 'acme', eventBody({}, 'acme-member'), 'secret-lead-acme');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, sent: true });
  assert.equal((await sentTo(CHAT)).length, 1);
  assert.equal((await company(server, 'acme', eventBody({ id: 'other' }, 'a b<script>'), 'secret-lead-acme')).statusCode, 400);
});

test('rute per company: secret lain, secret verify, company tak dikenal, dimatikan, atau tanpa secret lead', async (t) => {
  const { server, hooks, sentTo } = await app(t);
  assert.equal((await company(server, 'acme', eventBody(), 'secret-lead-beta')).statusCode, 401);
  assert.equal((await company(server, 'acme', eventBody(), 'secret-verify-acme')).statusCode, 401);
  assert.equal((await company(server, 'acme', eventBody(), LEGACY_SECRET)).statusCode, 401);
  assert.equal((await company(server, 'tidak-ada', eventBody(), 'x')).statusCode, 404);
  assert.equal((await company(server, 'gamma', eventBody(), 'secret-verify-gamma')).statusCode, 404);
  hooks['c-acme'].enabled = false;
  assert.equal((await company(server, 'acme', eventBody(), 'secret-lead-acme')).statusCode, 404);
  assert.equal((await sentTo(CHAT)).length, 0);
});

test('dedupe dan jeda terpisah per scope: rute lama dan company tidak saling menahan', async (t) => {
  const { server, sentTo } = await app(t);
  assert.equal((await legacy(server, eventBody())).json().sent, true);
  assert.equal((await company(server, 'acme', eventBody({}, 'acme-member'), 'secret-lead-acme')).json().sent, true);
  assert.equal((await sentTo(CHAT)).length, 2);
});

test('tanda tangan salah, kedaluwarsa, atau body diubah: 401 dan tidak ada yang terkirim', async (t) => {
  const { server, sentTo } = await app(t);
  assert.equal((await legacy(server, eventBody(), 'bukan-secret-nya')).statusCode, 401);
  const stale = await server.inject({ method: 'POST', url: '/webhook/event', ...sign(eventBody(), LEGACY_SECRET, Date.now() - 10 * 60_000) });
  assert.equal(stale.statusCode, 401);
  assert.equal(stale.json().error, 'Stale request');
  const future = await server.inject({ method: 'POST', url: '/webhook/event', ...sign(eventBody(), LEGACY_SECRET, Date.now() + 10 * 60_000) });
  assert.equal(future.statusCode, 401);
  const signed = sign(eventBody(), LEGACY_SECRET);
  const swapped = await server.inject({ method: 'POST', url: '/webhook/event', headers: signed.headers, payload: signed.payload.replace('08123456789', '08999888777') });
  assert.equal(swapped.statusCode, 401);
  const unsigned = await server.inject({ method: 'POST', url: '/webhook/event', headers: { 'content-type': 'application/json', 'x-api-key': 'dev-api-key' }, payload: JSON.stringify(eventBody()) });
  assert.equal(unsigned.statusCode, 401);
  assert.equal((await sentTo(CHAT)).length, 0);
  assert.equal((await sentTo('628999888777@c.us')).length, 0);
});

test('body mentah ikut ditandatangani: tanda tangan atas body kosong tidak berlaku, body > 64 KB ditolak 413', async (t) => {
  const { server, sentTo } = await app(t);
  // Tanpa captureRawBody, HMAC dihitung atas body kosong; tanda tangan seperti ini harus gagal.
  const timestamp = Date.now();
  const emptySig = 'sha256=' + crypto.createHmac('sha256', LEGACY_SECRET).update(`${timestamp}.`).digest('hex');
  const res = await server.inject({ method: 'POST', url: '/webhook/event', headers: { 'content-type': 'application/json', 'x-agnive-timestamp': String(timestamp), 'x-agnive-signature': emptySig }, payload: JSON.stringify(eventBody()) });
  assert.equal(res.statusCode, 401);
  // Spasi tambahan mengubah body mentah walau JSON-nya sama.
  const signed = sign(eventBody(), LEGACY_SECRET);
  assert.equal((await server.inject({ method: 'POST', url: '/webhook/event', headers: signed.headers, payload: `${signed.payload} ` })).statusCode, 401);
  const big = eventBody({ text: 'x'.repeat(70 * 1024) });
  assert.equal((await legacy(server, big)).statusCode, 413);
  assert.equal((await company(server, 'acme', big, 'secret-lead-acme')).statusCode, 413);
  assert.equal((await sentTo(CHAT)).length, 0);
});

test('payload tidak sah ditolak 400', async (t) => {
  const { server, sentTo } = await app(t);
  const cases = [
    { ...eventBody(), version: 2 },
    { version: 1, source: 'bullbabe-member' },
    { version: 1, source: 'bullbabe-member', event: [] },
    eventBody({ id: '' }),
    eventBody({ id: 'ada spasi' }),
    eventBody({ id: 'x'.repeat(81) }),
    eventBody({ id: 42 }),
    eventBody({ type: 'withdrawal_requested' }),
    eventBody({ type: undefined }),
    eventBody({ whatsapp: undefined }),
    eventBody({ whatsapp: '   ' }),
    eventBody({ text: { body: 'x' } }),
  ];
  for (const bad of cases) {
    const res = await legacy(server, bad);
    assert.equal(res.statusCode, 400, JSON.stringify(bad.event));
    assert.deepEqual(res.json(), { error: 'Invalid event payload' });
  }
  assert.equal((await sentTo(CHAT)).length, 0);
});

test('generic: penerima memakai text dari pengirim; text lebih dari 1000 karakter dipotong, bukan ditolak', async (t) => {
  const { server, sentTo } = await app(t);
  const res = await legacy(server, eventBody({ id: 'rebate-1', type: 'generic', text: 'Rebate masuk hari ini.' }));
  assert.deepEqual(res.json(), { ok: true, sent: true });
  const long = await legacy(server, eventBody({ id: 'rebate-2', type: 'account_linked', text: 'x'.repeat(1500) }));
  assert.equal(long.statusCode, 200);
  const bodies = (await sentTo(CHAT)).map((m) => m.body);
  assert.ok(bodies.includes('Rebate masuk hari ini.'));
  assert.ok(bodies.includes('x'.repeat(1000)));
});

test('nomor WhatsApp tidak sah ditolak 400, termasuk alamat grup atau @lid', async (t) => {
  const { server, sentTo } = await app(t);
  for (const whatsapp of ['12', 'bukan nomor', '1234567890123456', '120363025@g.us', '628123456789@c.us', '99887766@lid', `0812${'0'.repeat(40)}`]) {
    const res = await legacy(server, eventBody({ id: `n-${whatsapp.length}`, whatsapp }));
    assert.equal(res.statusCode, 400, whatsapp);
    assert.deepEqual(res.json(), { error: 'Invalid WhatsApp number' });
  }
  assert.equal((await sentTo(CHAT)).length, 0);
  // Tiga penulisan untuk nomor yang sama berakhir di chat yang sama.
  for (const [i, whatsapp] of ['+62 812-3456-789', '628123456789', '0812 3456 789'].entries()) {
    const type = ['generic', 'registered', 'withdrawal_done'][i];
    assert.deepEqual((await legacy(server, eventBody({ id: `ok-${i}`, type, whatsapp }))).json(), { ok: true, sent: true }, whatsapp);
  }
  assert.equal((await sentTo(CHAT)).length, 3);
});

test('id yang sama dalam 24 jam: duplicate, tidak dikirim lagi', async (t) => {
  const { server, sentTo } = await app(t);
  assert.deepEqual((await legacy(server, eventBody())).json(), { ok: true, sent: true });
  const again = await legacy(server, eventBody({ text: 'Teks berbeda' }));
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.json(), { ok: true, sent: false, reason: 'duplicate' });
  // Nomor lain dengan id yang sama tetap duplicate: id unik per kejadian.
  assert.equal((await legacy(server, eventBody({ whatsapp: '08999888777' }))).json().reason, 'duplicate');
  assert.equal((await sentTo(CHAT)).length, 1);
  assert.equal((await sentTo('628999888777@c.us')).length, 0);
});

test('kiriman serentak dengan id yang sama hanya terkirim sekali', async (t) => {
  const { server, sentTo } = await app(t);
  const results = await Promise.all([legacy(server, eventBody()), legacy(server, eventBody()), legacy(server, eventBody())]);
  assert.equal(results.filter((r) => r.json().sent === true).length, 1);
  assert.equal(results.filter((r) => r.json().reason === 'duplicate').length, 2);
  assert.equal((await sentTo(CHAT)).length, 1);
});

test('jeda per chat per type 60 detik; type lain dan chat lain tidak tertahan', async (t) => {
  const { server, sentTo } = await app(t);
  const tick = fakeClock(t);
  assert.equal((await legacy(server, eventBody({ id: 'g-1', type: 'generic' }))).json().sent, true);
  tick(30_000);
  assert.deepEqual((await legacy(server, eventBody({ id: 'g-2', type: 'generic' }))).json(), { ok: true, sent: false, reason: 'throttled' });
  assert.equal((await legacy(server, eventBody({ id: 'wd-1', type: 'withdrawal_processing' }))).json().sent, true);
  assert.equal((await legacy(server, eventBody({ id: 'g-3', type: 'generic', whatsapp: '08999888777' }))).json().sent, true);
  tick(31_000);
  assert.equal((await legacy(server, eventBody({ id: 'g-4', type: 'generic' }))).json().sent, true);
  // Event yang tertahan tetap dianggap selesai: id yang sama sesudah jeda = duplicate.
  assert.equal((await legacy(server, eventBody({ id: 'g-2', type: 'generic' }))).json().reason, 'duplicate');
  assert.equal((await sentTo(CHAT)).length, 3);
});

test('login perangkat baru: jeda 10 menit per chat', async (t) => {
  const { server, sentTo } = await app(t);
  const tick = fakeClock(t);
  const login = (id) => legacy(server, eventBody({ id, type: 'login_new_device', text: '' }));
  assert.equal((await login('login-7-aaaa1111')).json().sent, true);
  tick(2 * 60_000);
  assert.equal((await login('login-7-bbbb2222')).json().reason, 'throttled');
  tick(7 * 60_000 + 59_000); // 9 menit 59 detik
  assert.equal((await login('login-7-cccc3333')).json().reason, 'throttled');
  tick(2_000); // 10 menit 1 detik
  assert.equal((await login('login-7-dddd4444')).json().sent, true);
  assert.equal((await sentTo(CHAT)).length, 2);
});

test('lebih dari 200 kiriman per jam per scope: 429, id tidak dianggap selesai', async (t) => {
  const { server, sentTo } = await app(t);
  const tick = fakeClock(t);
  for (let i = 0; i < 200; i += 1) {
    const res = await legacy(server, eventBody({ id: `cap-${i}`, type: 'generic', whatsapp: `0812${String(i).padStart(7, '0')}` }));
    assert.equal(res.json().sent, true, `kiriman ke-${i + 1}`);
  }
  const over = await legacy(server, eventBody({ id: 'cap-over', type: 'generic' }));
  assert.equal(over.statusCode, 429);
  assert.deepEqual(over.json(), { error: 'Too many events this hour' });
  assert.equal((await sentTo(CHAT)).length, 0);
  // Scope lain punya kuota sendiri.
  assert.equal((await company(server, 'acme', eventBody({ id: 'cap-over', type: 'generic' }, 'acme-member'), 'secret-lead-acme')).json().sent, true);
  tick(60 * 60_000 + 1_000);
  const retry = await legacy(server, eventBody({ id: 'cap-over', type: 'generic' }));
  assert.deepEqual(retry.json(), { ok: true, sent: true });
  assert.equal((await sentTo(CHAT)).length, 2);
});

test('nomor yang berhenti dari broadcast tidak dikirimi', async (t) => {
  const { server, sentTo } = await app(t, { optOuts: [{ chatId: CHAT }] });
  const res = await legacy(server, eventBody());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, sent: false, reason: 'opted_out' });
  assert.equal((await sentTo(CHAT)).length, 0);
  assert.equal((await legacy(server, eventBody({ id: 'other', whatsapp: '08999888777' }))).json().sent, true);
});

test('STOP dari chat @lid: nomornya (kolom phone dari lid_phone_map) juga tidak dikirimi', async (t) => {
  const { server, sentTo } = await app(t, { optOuts: [{ chatId: '99887766@lid', phone: '+62 812-3456-789' }, { chatId: '55443322@lid', phone: null }] });
  assert.deepEqual((await legacy(server, eventBody())).json(), { ok: true, sent: false, reason: 'opted_out' });
  assert.equal((await sentTo(CHAT)).length, 0);
  assert.equal((await legacy(server, eventBody({ id: 'other', whatsapp: '08999888777' }))).json().sent, true);
});

test('daftar berhenti tidak terbaca: 503 tanpa kirim, id boleh dicoba lagi', async (t) => {
  let broken = true;
  const { server, sentTo } = await app(t, { optOuts: () => { if (broken) throw new Error('connection terminated'); return []; } });
  const res = await legacy(server, eventBody());
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: 'Database unavailable' });
  assert.equal((await sentTo(CHAT)).length, 0);
  broken = false;
  assert.deepEqual((await legacy(server, eventBody())).json(), { ok: true, sent: true });
  assert.equal((await sentTo(CHAT)).length, 1);
});

test('satu chat paling banyak 6 kiriman per jam lintas type; chat lain tidak tertahan', async (t) => {
  const { server, sentTo } = await app(t);
  const tick = fakeClock(t);
  const types = ['registered', 'account_linked', 'account_rejected', 'withdrawal_processing', 'withdrawal_done', 'withdrawal_failed', 'login_new_device', 'generic'];
  const results = [];
  for (const [i, type] of types.entries()) results.push((await legacy(server, eventBody({ id: `spam-${i}`, type, text: `teks ${i}` }))).json());
  assert.equal(results.filter((r) => r.sent === true).length, 6);
  assert.deepEqual(results.slice(6), [{ ok: true, sent: false, reason: 'throttled' }, { ok: true, sent: false, reason: 'throttled' }]);
  assert.equal((await sentTo(CHAT)).length, 6);
  assert.equal((await legacy(server, eventBody({ id: 'lain-1', whatsapp: '08999888777' }))).json().sent, true);
  // Rute per company punya hitungan sendiri.
  assert.equal((await company(server, 'acme', eventBody({ id: 'spam-0', type: 'generic' }, 'acme-member'), 'secret-lead-acme')).json().sent, true);
  tick(59 * 60_000);
  assert.equal((await legacy(server, eventBody({ id: 'spam-8', type: 'generic' }))).json().reason, 'throttled');
  tick(60_000 + 1_000);
  assert.equal((await legacy(server, eventBody({ id: 'spam-9', type: 'generic' }))).json().sent, true);
});

test('gagal kirim: 200 send_failed, log tanpa isi pesan dan nomor lengkap, jeda chat tidak terpakai', async (t) => {
  const logs = [];
  // Tanpa demo, bentuk produksi: chat belum menempel, satu nomor company yang belum siap.
  // Jalur kirim bersama (rotasi nomor) ikut mencatat log; nomor lengkap juga tidak boleh muncul di sana.
  const waConns = [{ id: 'conn-main', connectionKey: 'whatsapp-main', label: 'Nomor Utama', phoneNumber: '6281111000099', isActive: true }];
  const { server } = await app(t, { demoMode: false, logs, waConns });
  const res = await legacy(server, eventBody({ text: 'Rahasia isi pesan 7f3a' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, sent: false, reason: 'send_failed' });
  assert.deepEqual((await legacy(server, eventBody({ text: 'Rahasia isi pesan 7f3a' }))).json(), { ok: true, sent: false, reason: 'duplicate' });
  // Id baru untuk chat dan type yang sama dicoba lagi, bukan throttled: jeda dan jatah per chat dikembalikan.
  for (let i = 0; i < 7; i += 1) {
    assert.equal((await legacy(server, eventBody({ id: `acct-42-linked-retry-${i}` }))).json().reason, 'send_failed', `percobaan ${i + 1}`);
  }
  const joined = logs.join('\n');
  assert.match(joined, /Rotasi nomor: tidak ada nomor yang siap mengirim/);
  assert.match(joined, /Member event: message not sent/);
  assert.match(joined, /\*\*\*6789/);
  assert.match(joined, /"reason":"Nomor \\"Nomor Utama\\" yang memegang percakapan ini sedang tidak tersambung/);
  assert.doesNotMatch(joined, /8123456789/);
  assert.doesNotMatch(joined, /Rahasia isi pesan/);
  assert.doesNotMatch(joined, /Budi/);
});

test('teks kosong: teks bawaan per type dan bahasa', async (t) => {
  const { server, sentTo } = await app(t);
  await legacy(server, eventBody({ text: '' }));
  assert.equal((await sentTo(CHAT))[0].body, 'Halo Budi, kabar baik: account trading kamu sudah terhubung. Rinciannya bisa kamu lihat di halaman member.');
  await legacy(server, eventBody({ id: 'wd-9-failed', type: 'withdrawal_failed', language: 'en', text: '   ' }));
  assert.equal((await sentTo(CHAT))[1].body, 'Hi Budi, your withdrawal could not be processed. Check your member page for details, or reply to this chat if you need help.');
  await legacy(server, eventBody({ id: 'login-1', type: 'login_new_device', name: undefined, text: undefined, whatsapp: '08999888777' }));
  assert.match((await sentTo('628999888777@c.us'))[0].body, /^Halo, ada login ke akun member kamu dari perangkat baru\./);
  await legacy(server, eventBody({ id: 'login-2', type: 'login_new_device', name: '', language: 'fr', text: null, whatsapp: '08111222333' }));
  assert.match((await sentTo('628111222333@c.us'))[0].body, /^Halo, ada login/);

  const types = ['registered', 'account_linked', 'account_rejected', 'withdrawal_processing', 'withdrawal_done', 'withdrawal_failed', 'login_new_device', 'generic'];
  const bodies = new Set();
  for (const [i, type] of types.entries()) {
    for (const language of ['id', 'en']) {
      const whatsapp = `0857${String(i).padStart(3, '0')}${language === 'id' ? '1111' : '2222'}`;
      const res = await legacy(server, eventBody({ id: `def-${type}-${language}`, type, language, text: '', name: 'Sari Dewi', whatsapp }));
      assert.deepEqual(res.json(), { ok: true, sent: true });
      const [msg] = await sentTo(`62${whatsapp.slice(1)}@c.us`);
      assert.ok(msg, `${type}/${language} terkirim`);
      assert.match(msg.body, language === 'en' ? /^Hi Sari, / : /^Halo Sari, /);
      assert.doesNotMatch(msg.body, /undefined|null|\{|\}/);
      bodies.add(msg.body);
    }
  }
  assert.equal(bodies.size, types.length * 2, 'setiap type dan bahasa punya teks sendiri');
});

test('respons tidak pernah memuat data pribadi', async (t) => {
  const { server } = await app(t, { optOuts: [{ chatId: '628111222333@c.us' }] });
  const personal = /8123456789|8111222333|Budi|Santoso|Valetax|acct-42/;
  const responses = [
    await legacy(server, eventBody()),
    await legacy(server, eventBody()),
    await legacy(server, eventBody({ id: 'acct-42-b' })),
    await legacy(server, eventBody({ id: 'acct-42-c', whatsapp: '08111222333' })),
    await legacy(server, eventBody({ id: 'acct-42-d', whatsapp: '12' })),
    await legacy(server, eventBody({ id: 'acct 42' })),
    await legacy(server, eventBody({ id: 'acct-42-e' }), 'salah'),
  ];
  assert.deepEqual(responses.map((r) => r.statusCode), [200, 200, 200, 200, 400, 400, 401]);
  assert.deepEqual(responses.slice(0, 4).map((r) => r.json().reason), [undefined, 'duplicate', 'throttled', 'opted_out']);
  for (const res of responses) {
    assert.doesNotMatch(res.payload, personal, res.payload);
    assert.ok(Object.keys(res.json()).every((key) => ['ok', 'sent', 'reason', 'error'].includes(key)), res.payload);
  }
});
