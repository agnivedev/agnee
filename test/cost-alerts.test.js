'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CostAlertMonitor, createMailer, createWhatsappChannel, evaluate, buildAlertMessage, thresholdFor, positiveNumber,
  DEFAULT_USD_IDR_RATE, DEFAULT_THRESHOLDS_IDR, REMINDER_DAYS,
} = require('../src/cost-alerts');

const RATE = 16_500;
const THRESHOLDS = { personal: 50_000, company: 1_650_000 };
const NOW = new Date('2026-10-08T03:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const options = { rate: RATE, thresholds: THRESHOLDS, now: NOW };

const row = (over) => ({
  id: 'c1', slug: 'acme', name: 'Acme', plan: 'company', status: 'active',
  costUsd30d: 0, calls30d: 10, notifiedAt: null, ...over,
});

test('ambang: Personal $3 dan Company $100 pada kurs bawaan', () => {
  // Angka dari keputusan produk; kalau kurs bawaan atau ambangnya berubah, ini
  // harus berubah dengan sengaja.
  assert.equal(DEFAULT_USD_IDR_RATE, 16_500);
  assert.ok(Math.abs(DEFAULT_THRESHOLDS_IDR.personal / DEFAULT_USD_IDR_RATE - 3) < 0.05);
  assert.equal(DEFAULT_THRESHOLDS_IDR.company / DEFAULT_USD_IDR_RATE, 100);
});

test('evaluate: tepat di ambang sudah dihitung melewati', () => {
  const { alerts } = evaluate([
    row({ id: 'p-over', plan: 'personal', costUsd30d: 50_000 / RATE }),
    row({ id: 'p-under', plan: 'personal', costUsd30d: 2.9 }),
    row({ id: 'c-over', plan: 'company', costUsd30d: 100 }),
    row({ id: 'c-under', plan: 'company', costUsd30d: 99 }),
  ], options);
  assert.deepEqual(alerts.map((a) => a.id).sort(), ['c-over', 'p-over']);
});

test('evaluate: Lifetime memakai ambang Company, bukan Personal', () => {
  assert.equal(thresholdFor('lifetime', THRESHOLDS), THRESHOLDS.company);
  const { alerts } = evaluate([
    row({ id: 'l-small', plan: 'lifetime', costUsd30d: 10 }),   // Rp165.000: melewati Personal, bukan Company
    row({ id: 'l-big', plan: 'lifetime', costUsd30d: 120 }),
  ], options);
  assert.deepEqual(alerts.map((a) => a.id), ['l-big']);
});

test('evaluate: tenant yang ditangguhkan atau ditutup dilewati', () => {
  const { alerts } = evaluate([
    row({ id: 's', status: 'suspended', costUsd30d: 500 }),
    row({ id: 'x', status: 'closed', costUsd30d: 500 }),
  ], options);
  assert.equal(alerts.length, 0);
});

test('evaluate: tidak mengingatkan tiap jam, hanya setelah REMINDER_DAYS', () => {
  const over = { costUsd30d: 150 };
  const recent = row({ ...over, notifiedAt: new Date(NOW - 1 * DAY) });
  const stale = row({ ...over, id: 'c2', notifiedAt: new Date(NOW - (REMINDER_DAYS + 1) * DAY) });
  const { alerts } = evaluate([recent, stale], options);
  assert.deepEqual(alerts.map((a) => a.id), ['c2']);
  assert.equal(alerts[0].firstTime, false, 'bukan lonjakan baru, hanya pengingat');
});

test('evaluate: turun di bawah ambang mempersenjatai ulang supaya lonjakan berikutnya dikabari', () => {
  const { alerts, rearm } = evaluate([
    row({ id: 'back', costUsd30d: 5, notifiedAt: new Date(NOW - DAY) }),
    row({ id: 'never', costUsd30d: 5, notifiedAt: null }),
  ], options);
  assert.equal(alerts.length, 0);
  assert.deepEqual(rearm, ['back'], 'yang tak pernah dikabari tak perlu direset');
});

test('evaluate: yang paling parah (rasio terhadap ambang) paling atas', () => {
  const { alerts } = evaluate([
    row({ id: 'mild', costUsd30d: 110 }),
    row({ id: 'bad', costUsd30d: 400 }),
  ], options);
  assert.deepEqual(alerts.map((a) => a.id), ['bad', 'mild']);
});

test('email: Rupiah semua, satu ringkasan, dan menegaskan layanan tidak dihentikan', () => {
  const { alerts } = evaluate([
    row({ id: 'a', name: 'Acme', costUsd30d: 150, calls30d: 4321 }),
    row({ id: 'b', name: 'Budi Store', slug: 'budi', plan: 'personal', costUsd30d: 8 }),
  ], options);
  const email = buildAlertMessage(alerts, { consoleUrl: 'https://app.agnee.agnive.co/superhuman' });
  assert.match(email.subject, /2 perusahaan/);
  assert.match(email.text, /Rp 2\.475\.000/);          // 150 x 16.500
  assert.match(email.text, /Rp 1\.650\.000/);          // ambangnya
  assert.match(email.text, /Rp 132\.000/);             // 8 x 16.500
  assert.match(email.text, /4321/);
  assert.match(email.text, /TIDAK dihentikan/);
  assert.match(email.text, /https:\/\/app\.agnee\.agnive\.co\/superhuman/);
  assert.ok(!email.text.includes('$'), 'tidak ada tanda dolar di teks untuk manusia');
});

test('email: satu tenant memakai namanya di subjek', () => {
  const { alerts } = evaluate([row({ costUsd30d: 150 })], options);
  assert.equal(buildAlertMessage(alerts, { consoleUrl: 'x' }).subject, '[Agnee] Biaya AI tinggi: Acme');
});

test('positiveNumber: nilai env rusak jatuh ke cadangan, bukan mematikan alert', () => {
  assert.equal(positiveNumber('abc', 7), 7);
  assert.equal(positiveNumber('', 7), 7);
  assert.equal(positiveNumber('0', 7), 7);
  assert.equal(positiveNumber('-5', 7), 7);
  assert.equal(positiveNumber('20000', 7), 20000);
});

// ── Pengirim ───────────────────────────────────────────────────────────────

test('mailer: butuh penerima, pengirim, dan host SMTP sekaligus', () => {
  const full = { COST_ALERT_EMAIL_TO: 'tim@agnive.co', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'bot@agnive.co' };
  assert.equal(createMailer(full).configured, true);
  assert.equal(createMailer({ ...full, COST_ALERT_EMAIL_TO: '' }).configured, false, 'tanpa penerima');
  assert.equal(createMailer({ ...full, SMTP_HOST: '' }).configured, false, 'tanpa host');
  assert.equal(createMailer({ ...full, SMTP_USER: '' }).configured, false, 'tanpa pengirim');
  assert.equal(createMailer({ ...full, SMTP_USER: '', SMTP_FROM: 'a@b.co' }).configured, true, 'SMTP_FROM menggantikan');
});

test('mailer: mengirim lewat transport dengan from/to yang benar; menolak kalau belum dikonfigurasi', async () => {
  const sent = [];
  const transport = { async sendMail(message) { sent.push(message); } };
  const mailer = createMailer(
    { COST_ALERT_EMAIL_TO: 'tim@agnive.co', SMTP_USER: 'bot@agnive.co' }, { transport },
  );
  await mailer.send({ subject: 'S', text: 'T' });
  assert.deepEqual(sent, [{ from: 'bot@agnive.co', to: 'tim@agnive.co', subject: 'S', text: 'T' }]);
  await assert.rejects(createMailer({}).send({ subject: 'S', text: 'T' }), /belum dikonfigurasi/);
});

// ── Monitor ────────────────────────────────────────────────────────────────

function monitorHarness({ rows, mailerConfigured = true, failSends = 0, extraChannels = [] } = {}) {
  const state = { rows, sent: [], warns: 0, sendAttempts: 0, failSends };
  const database = {
    async listCostAlertCandidates() { return state.rows.map((r) => ({ ...r })); },
    async markCostAlertNotified(ids) { for (const r of state.rows) if (ids.includes(r.id)) r.notifiedAt = NOW; },
    async clearCostAlerts(ids) { for (const r of state.rows) if (ids.includes(r.id)) r.notifiedAt = null; },
  };
  const mailer = {
    name: 'email',
    configured: mailerConfigured,
    async send(email) {
      state.sendAttempts += 1;
      if (state.failSends > 0) { state.failSends -= 1; throw new Error('SMTP down'); }
      state.sent.push(email);
    },
  };
  const monitor = new CostAlertMonitor({
    database, channels: [mailer, ...extraChannels], rate: RATE, thresholds: THRESHOLDS, consoleUrl: 'https://x/superhuman',
    logger: { info() {}, warn() { state.warns += 1; } },
  });
  return { state, monitor };
}

test('monitor: satu email ringkasan, lalu tidak mengirim ulang di putaran berikutnya', async () => {
  const { state, monitor } = monitorHarness({ rows: [
    row({ id: 'a', costUsd30d: 150 }),
    row({ id: 'b', slug: 'b', name: 'B', plan: 'personal', costUsd30d: 9 }),
    row({ id: 'ok', slug: 'ok', name: 'Ok', costUsd30d: 1 }),
  ] });
  const first = await monitor.check(NOW);
  assert.equal(first.sent, true);
  assert.equal(state.sent.length, 1, 'satu email untuk dua tenant');
  assert.deepEqual(state.rows.filter((r) => r.notifiedAt).map((r) => r.id).sort(), ['a', 'b']);

  const second = await monitor.check(new Date(NOW.getTime() + 60 * 60 * 1000));
  assert.equal(second.alerts, 0);
  assert.equal(state.sent.length, 1, 'sejam kemudian tidak ada email baru');
});

test('monitor: gagal kirim berarti belum terkabari, dicoba lagi putaran berikutnya', async () => {
  const { state, monitor } = monitorHarness({ rows: [row({ costUsd30d: 150 })], failSends: 1 });
  const failed = await monitor.check(NOW);
  assert.equal(failed.sent, false);
  assert.equal(failed.reason, 'send_failed');
  assert.equal(state.rows[0].notifiedAt, null, 'tidak ditandai terkabari');

  const retry = await monitor.check(NOW);
  assert.equal(retry.sent, true);
  assert.ok(state.rows[0].notifiedAt);
});

test('monitor: tanpa SMTP tidak mengirim dan tidak menandai, peringatan log hanya sekali', async () => {
  const { state, monitor } = monitorHarness({ rows: [row({ costUsd30d: 150 })], mailerConfigured: false });
  const one = await monitor.check(NOW);
  await monitor.check(NOW);
  assert.equal(one.reason, 'not_configured');
  assert.equal(state.sendAttempts, 0);
  assert.equal(state.rows[0].notifiedAt, null, 'begitu SMTP dipasang langsung terkirim');
  assert.equal(state.warns, 1, 'tidak membanjiri log tiap jam');
});

test('monitor: turun ke bawah ambang mereset penanda, lonjakan berikutnya dikabari lagi', async () => {
  const { state, monitor } = monitorHarness({ rows: [row({ costUsd30d: 150 })] });
  await monitor.check(NOW);
  assert.equal(state.sent.length, 1);

  state.rows[0].costUsd30d = 3;                       // turun
  await monitor.check(new Date(NOW.getTime() + DAY));
  assert.equal(state.rows[0].notifiedAt, null);

  state.rows[0].costUsd30d = 200;                     // naik lagi, jauh sebelum 7 hari
  await monitor.check(new Date(NOW.getTime() + 2 * DAY));
  assert.equal(state.sent.length, 2, 'dikabari lagi tanpa menunggu pengingat mingguan');
});

test('monitor: kegagalan database tidak melempar keluar dari timer', async () => {
  const monitor = new CostAlertMonitor({
    database: { async listCostAlertCandidates() { throw new Error('db mati'); } },
    channels: [{ name: 'email', configured: true, async send() {} }],
    rate: RATE, thresholds: THRESHOLDS, consoleUrl: 'x', logger: { info() {}, warn() {} },
  });
  assert.deepEqual(await monitor.check(NOW), { error: true });
  assert.equal(monitor.running, false, 'penanda berjalan dilepas supaya putaran berikutnya jalan');
});

// ── WhatsApp ───────────────────────────────────────────────────────────────

test('pesan WhatsApp: ringkas, Rupiah, dan nama tenant tidak bisa menyuntik format', () => {
  const { alerts } = evaluate([
    row({ id: 'a', name: '*Acme* _Store_', costUsd30d: 150 }),
  ], options);
  const { whatsapp } = buildAlertMessage(alerts, { consoleUrl: 'https://app.agnee.agnive.co/superhuman' });
  assert.match(whatsapp, /^\*Agnee: biaya AI tinggi\*\n/);
  assert.match(whatsapp, /- Acme Store \(company\): Rp 2\.475\.000, 150% dari ambang Rp 1\.650\.000/);
  assert.match(whatsapp, /Layanan tidak dihentikan/);
  assert.match(whatsapp, /https:\/\/app\.agnee\.agnive\.co\/superhuman$/);
  assert.ok(!whatsapp.includes('$'), 'tidak ada tanda dolar');
  assert.equal((whatsapp.match(/\*/g) || []).length, 2, 'satu-satunya format tebal adalah judulnya sendiri');
});

test('pesan WhatsApp: dipotong di 5 tenant dengan penanda sisanya', () => {
  const many = Array.from({ length: 8 }, (_, i) => row({ id: `t${i}`, slug: `t${i}`, name: `Tenant ${i}`, costUsd30d: 120 + i }));
  const { alerts } = evaluate(many, options);
  const { whatsapp } = buildAlertMessage(alerts, { consoleUrl: 'x' });
  assert.equal(whatsapp.split('\n').filter((line) => line.startsWith('- ')).length, 5);
  assert.match(whatsapp, /\(\+3 perusahaan lainnya\)/);
});

function waHarness({ env, failFor = [], companyId = 'co-pengirim' } = {}) {
  const sent = [];
  const channel = createWhatsappChannel({
    env,
    logger: { warn() {} },
    resolveCompanyId: async (slug) => (slug === 'beweix-digital' ? companyId : null),
    sendText: async (cid, chatId, text) => {
      if (failFor.includes(chatId)) throw new Error('nomor mati');
      sent.push({ cid, chatId, text });
    },
    toChatId: (raw) => {
      const digits = String(raw).replace(/\D/g, '').replace(/^0/, '62');
      if (digits.length < 8) throw new Error('nomor tidak sah');
      return `${digits}@c.us`;
    },
  });
  return { channel, sent };
}

test('kanal WhatsApp: butuh company pengirim DAN penerima sekaligus', () => {
  const ok = { COST_ALERT_WA_COMPANY: 'beweix-digital', COST_ALERT_WA_TO: '0812111' };
  assert.equal(waHarness({ env: ok }).channel.configured, true);
  assert.equal(waHarness({ env: { ...ok, COST_ALERT_WA_COMPANY: '' } }).channel.configured, false);
  assert.equal(waHarness({ env: { ...ok, COST_ALERT_WA_TO: ' , ' } }).channel.configured, false);
  assert.equal(waHarness({ env: {} }).channel.configured, false);
});

test('kanal WhatsApp: mengirim dari company yang ditunjuk ke tiap penerima', async () => {
  const { channel, sent } = waHarness({ env: { COST_ALERT_WA_COMPANY: 'beweix-digital', COST_ALERT_WA_TO: '08121111111, 62812222222' } });
  const result = await channel.send({ whatsapp: 'halo' });
  assert.deepEqual(result, { delivered: 2, total: 2 });
  assert.deepEqual(sent.map((m) => [m.cid, m.chatId, m.text]), [
    ['co-pengirim', '628121111111@c.us', 'halo'],
    ['co-pengirim', '62812222222@c.us', 'halo'],
  ]);
});

test('kanal WhatsApp: sebagian gagal tetap berhasil; semua gagal melempar', async () => {
  const env = { COST_ALERT_WA_COMPANY: 'beweix-digital', COST_ALERT_WA_TO: '08121111111,08122222222' };
  const partial = waHarness({ env, failFor: ['628121111111@c.us'] });
  assert.deepEqual(await partial.channel.send({ whatsapp: 'x' }), { delivered: 1, total: 2 },
    'tidak melempar: itu akan mengirim ulang ke yang sudah menerima');

  const none = waHarness({ env, failFor: ['628121111111@c.us', '628122222222@c.us'] });
  await assert.rejects(none.channel.send({ whatsapp: 'x' }), /nomor mati/);
});

test('kanal WhatsApp: company pengirim tidak ada atau belum dikonfigurasi menolak', async () => {
  const missing = waHarness({ env: { COST_ALERT_WA_COMPANY: 'tidak-ada', COST_ALERT_WA_TO: '08121111111' } });
  await assert.rejects(missing.channel.send({ whatsapp: 'x' }), /tidak ditemukan/);
  await assert.rejects(waHarness({ env: {} }).channel.send({ whatsapp: 'x' }), /belum dikonfigurasi/);
});

// ── Monitor dengan dua kanal ───────────────────────────────────────────────

function fakeChannel(name, { configured = true, fail = false } = {}) {
  const sent = [];
  return {
    name, configured, sent,
    async send(message) { if (fail) throw new Error(`${name} mati`); sent.push(message); },
  };
}

test('monitor: email dan WhatsApp sama-sama dikirim, penanda dipasang sekali', async () => {
  const wa = fakeChannel('whatsapp');
  const { state, monitor } = monitorHarness({ rows: [row({ costUsd30d: 150 })], extraChannels: [wa] });
  const result = await monitor.check(NOW);
  assert.deepEqual(result.delivered, ['email', 'whatsapp']);
  assert.equal(state.sent.length, 1);
  assert.equal(wa.sent.length, 1);
  assert.match(wa.sent[0].whatsapp, /Agnee: biaya AI tinggi/);
  assert.ok(state.rows[0].notifiedAt);
});

test('monitor: satu kanal mati tidak menahan yang lain, dan tetap ditandai terkabari', async () => {
  const wa = fakeChannel('whatsapp', { fail: true });
  const { state, monitor } = monitorHarness({ rows: [row({ costUsd30d: 150 })], extraChannels: [wa] });
  const result = await monitor.check(NOW);
  assert.equal(result.sent, true);
  assert.deepEqual(result.delivered, ['email']);
  assert.deepEqual(result.failed, ['whatsapp']);
  assert.ok(state.rows[0].notifiedAt, 'sudah ada yang menerima, jangan mengulang tiap jam');
});

test('monitor: semua kanal gagal berarti belum terkabari dan dicoba lagi', async () => {
  const wa = fakeChannel('whatsapp', { fail: true });
  const { state, monitor } = monitorHarness({ rows: [row({ costUsd30d: 150 })], failSends: 1, extraChannels: [wa] });
  const first = await monitor.check(NOW);
  assert.equal(first.reason, 'send_failed');
  assert.deepEqual(first.failed.sort(), ['email', 'whatsapp']);
  assert.equal(state.rows[0].notifiedAt, null);

  wa.send = async (message) => { wa.sent.push(message); };   // WhatsApp pulih
  const retry = await monitor.check(NOW);
  assert.equal(retry.sent, true);
  assert.deepEqual(retry.delivered, ['email', 'whatsapp']);
});

test('monitor: hanya WhatsApp yang dikonfigurasi sudah cukup', async () => {
  const wa = fakeChannel('whatsapp');
  const { state, monitor } = monitorHarness({ rows: [row({ costUsd30d: 150 })], mailerConfigured: false, extraChannels: [wa] });
  const result = await monitor.check(NOW);
  assert.deepEqual(result.delivered, ['whatsapp']);
  assert.equal(state.sendAttempts, 0, 'email yang belum dikonfigurasi tidak dicoba');
  assert.ok(state.rows[0].notifiedAt);
});
