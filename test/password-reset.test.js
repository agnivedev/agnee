'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pr = require('../src/password-reset');
const { buildApp } = require('../src/server');

test('token acak kuat, hash SHA-256 deterministik dan beda dari token', () => {
  const a = pr.generateResetToken();
  const b = pr.generateResetToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 43);
  const h = pr.hashResetToken(a);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, pr.hashResetToken(a));
  assert.notEqual(h, a);
});

test('pembatas laju: lewat batas ditolak, jendela baru membuka lagi', () => {
  let t = 1000;
  const lim = pr.createLimiter({ max: 2, windowMs: 100, now: () => t });
  assert.equal(lim.hit('k'), true);
  assert.equal(lim.hit('k'), true);
  assert.equal(lim.hit('k'), false);
  assert.equal(lim.hit('lain'), true);
  t += 101;
  assert.equal(lim.hit('k'), true);
  lim.stop();
});

test('tautan memakai domain konfigurasi, token di-encode', () => {
  assert.equal(pr.buildResetLink('https://app.agnee.agnive.co/', 'a b'), 'https://app.agnee.agnive.co/?token=a%20b');
});

/** Database tiruan yang meniru perilaku token (kedaluwarsa, sekali pakai) dan pencabutan sesi. */
function fakeDatabase() {
  const user = { id: 'u1', userId: 'u1', companyId: 'c1', email: 'ani@pelanggan.test', displayName: 'Ani', role: 'owner', status: 'active', isPlatformAdmin: false };
  const state = { tokens: [], password: 'password-123', validAfter: null, audit: [] };
  return {
    state, enabled: true, async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) {
      return email.toLowerCase() === user.email && password === state.password ? user : null;
    },
    async getActiveSessionUser() { return { ...user, sessionsValidAfter: state.validAfter }; },
    async setPresence() {},
    async createPasswordResetToken(email, tokenHash, expiresAt) {
      if (email !== user.email) return null;
      state.tokens.forEach((x) => { x.used = true; });
      state.tokens.push({ tokenHash, expiresAt, used: false });
      return user;
    },
    async consumePasswordResetToken(tokenHash, password, now) {
      const tok = state.tokens.find((x) => x.tokenHash === tokenHash && !x.used && x.expiresAt > now);
      if (!tok) return null;
      tok.used = true; state.password = password; state.validAfter = now;
      return { userId: user.id, companyIds: ['c1'] };
    },
    async recordAuditLog(row, companyId) { state.audit.push({ ...row, companyId }); },
  };
}

async function setup(t, { smtp = true } = {}) {
  const database = fakeDatabase();
  const sent = [];
  const mailer = { smtpReady: smtp, async send(m) { sent.push(m); } };
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'reset-test', passwordResetMailer: mailer,
  });
  t.after(() => app.close());
  const ask = (email, ip = '10.0.0.1') => app.inject({
    method: 'POST', url: '/v1/auth/password-reset/request', payload: { email }, remoteAddress: ip,
  });
  const tokenFrom = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  return { app, database, sent, ask, tokenFrom };
}

test('anti-enumerasi: email terdaftar dan tidak terdaftar dijawab sama persis', async (t) => {
  const { ask, sent } = await setup(t);
  const a = await ask('ani@pelanggan.test');
  const b = await ask('tidak-ada@pelanggan.test');
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, a.statusCode);
  assert.equal(b.body, a.body);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ani@pelanggan.test');
  assert.match(sent[0].text, /^.*https:\/\/app\.agnee\.agnive\.co\/\?token=/m);
});

test('tautan reset tidak memakai header Host', async (t) => {
  const { app, sent } = await setup(t);
  await app.inject({
    method: 'POST', url: '/v1/auth/password-reset/request', payload: { email: 'ani@pelanggan.test' },
    headers: { host: 'jahat.example', 'x-forwarded-host': 'jahat.example' },
  });
  assert.ok(!sent[0].text.includes('jahat.example'));
});

test('SMTP kosong: jawaban tetap sama, tidak ada yang terkirim', async (t) => {
  const { ask, sent } = await setup(t, { smtp: false });
  const r = await ask('ani@pelanggan.test');
  assert.equal(r.statusCode, 200);
  assert.equal(sent.length, 0);
});

test('token sekali pakai; password baru berlaku; audit tanpa token/password', async (t) => {
  const { app, database, sent, ask, tokenFrom } = await setup(t);
  await ask('ani@pelanggan.test');
  const token = tokenFrom(sent[0]);
  const confirm = (password) => app.inject({ method: 'POST', url: '/v1/auth/password-reset/confirm', payload: { token, password } });
  const ok = await confirm('password-baru-1');
  assert.equal(ok.statusCode, 200);
  assert.equal((await confirm('password-baru-2')).statusCode, 400);
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'ani@pelanggan.test', password: 'password-baru-1' } });
  assert.equal(login.statusCode, 200);
  const rows = database.state.audit;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'auth.password_reset');
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes(token) && !dump.includes('password-baru-1'));
});

test('permintaan baru membatalkan token lama', async (t) => {
  const { app, sent, ask, tokenFrom } = await setup(t);
  await ask('ani@pelanggan.test', '10.0.0.2');
  await ask('ani@pelanggan.test', '10.0.0.3');
  const lama = await app.inject({ method: 'POST', url: '/v1/auth/password-reset/confirm', payload: { token: tokenFrom(sent[0]), password: 'password-baru-1' } });
  assert.equal(lama.statusCode, 400);
  const baru = await app.inject({ method: 'POST', url: '/v1/auth/password-reset/confirm', payload: { token: tokenFrom(sent[1]), password: 'password-baru-1' } });
  assert.equal(baru.statusCode, 200);
});

test('token kedaluwarsa ditolak', async (t) => {
  const { app, database, sent, ask, tokenFrom } = await setup(t);
  await ask('ani@pelanggan.test');
  database.state.tokens[0].expiresAt = new Date(Date.now() - 1000);
  const r = await app.inject({ method: 'POST', url: '/v1/auth/password-reset/confirm', payload: { token: tokenFrom(sent[0]), password: 'password-baru-1' } });
  assert.equal(r.statusCode, 400);
});

test('rate limit: per email diam-diam, per IP 429', async (t) => {
  const { ask, sent } = await setup(t);
  for (let i = 0; i < 5; i += 1) assert.equal((await ask('ani@pelanggan.test', '10.1.0.1')).statusCode, 200);
  assert.equal(sent.length, 3); // per email: 3/jam, sisanya tidak mengirim tapi tetap 200
  let last;
  for (let i = 0; i < 12; i += 1) last = await ask(`x${i}@pelanggan.test`, '10.2.0.1');
  assert.equal(last.statusCode, 429);
  assert.ok(last.headers['retry-after']);
});

test('password baru terlalu pendek ditolak', async (t) => {
  const { app } = await setup(t);
  const r = await app.inject({ method: 'POST', url: '/v1/auth/password-reset/confirm', payload: { token: 'x'.repeat(43), password: 'pendek' } });
  assert.equal(r.statusCode, 400);
});

test('reset mencabut sesi lama; login baru sesudahnya tetap hidup', async (t) => {
  const { app, sent, ask, tokenFrom } = await setup(t);
  const login = () => app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'ani@pelanggan.test', password: 'password-123' } });
  const lama = (await login()).headers['set-cookie'].split(';')[0];
  const me = (cookie) => app.inject({ method: 'GET', url: '/v1/team', headers: { cookie } });
  assert.notEqual((await me(lama)).statusCode, 401);

  await ask('ani@pelanggan.test');
  await app.inject({ method: 'POST', url: '/v1/auth/password-reset/confirm', payload: { token: tokenFrom(sent[0]), password: 'password-baru-1' } });
  assert.equal((await me(lama)).statusCode, 401);

  await new Promise((r) => setTimeout(r, 5));
  const baru = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'ani@pelanggan.test', password: 'password-baru-1' } });
  assert.notEqual((await me(baru.headers['set-cookie'].split(';')[0])).statusCode, 401);
});
