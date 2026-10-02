'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

/*
 * MCP sign-in is a real Agnee account now — not one shared admin login — and
 * every token is bound to that member and their company.
 */

const MEMBER = { userId: 'user-7', companyId: 'company-1', displayName: 'Rina' };

async function setup(t, extra = {}) {
  const { createMcpOAuth } = await import('../src/mcp-auth.mjs');
  const oauth = createMcpOAuth({
    publicUrl: 'http://127.0.0.1/mcp',
    signingSecret: 'mcp-auth-test',
    statePath: '',
    authenticate: async (email, password) => (email === 'rina@acme.test' && password === 'benar-123' ? MEMBER : null),
    ...extra,
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!(await oauth.handle(req, res, url, '198.51.100.7'))) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Uji', redirect_uris: ['http://localhost/cb'] }),
  }).then((r) => r.json());
  return { oauth, base, client };
}

function authorizeForm(client, scope, email, password, verifier) {
  return new URLSearchParams({
    client_id: client.client_id, redirect_uri: 'http://localhost/cb', response_type: 'code',
    code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    resource: 'http://127.0.0.1/mcp', scope, email, password,
  });
}

async function signIn({ base, client }, scope, password = 'benar-123') {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const res = await fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: authorizeForm(client, scope, 'rina@acme.test', password, verifier),
  });
  if (res.status !== 302) return { status: res.status };
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const token = await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: 'http://localhost/cb', resource: 'http://127.0.0.1/mcp' }),
  }).then((r) => r.json());
  return { status: 302, token };
}

test('token terikat ke anggota dan perusahaannya', async (t) => {
  const ctx = await setup(t);
  const { token } = await signIn(ctx, 'whatsapp:read whatsapp:write');
  const identity = ctx.oauth.verifyAccessToken(token.access_token, 'whatsapp:read');
  assert.equal(identity.userId, MEMBER.userId);
  assert.equal(identity.companyId, MEMBER.companyId);
  assert.ok(identity.scopes.includes('whatsapp:write'));
});

test('token baca saja tidak lolos sebagai token kirim', async (t) => {
  const ctx = await setup(t);
  const { token } = await signIn(ctx, 'whatsapp:read');
  assert.ok(ctx.oauth.verifyAccessToken(token.access_token, 'whatsapp:read'));
  assert.equal(ctx.oauth.verifyAccessToken(token.access_token, 'whatsapp:write'), null);
});

test('password salah ditolak, dan 5 kali salah mengunci sementara', async (t) => {
  const ctx = await setup(t);
  for (let i = 0; i < 5; i += 1) assert.equal((await signIn(ctx, 'whatsapp:read', 'salah-123')).status, 401);
  // Even the right password waits out the lock.
  assert.equal((await signIn(ctx, 'whatsapp:read')).status, 429);
});

test('token gaya lama tanpa perusahaan ditolak', async (t) => {
  const ctx = await setup(t);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'http://127.0.0.1', aud: 'http://127.0.0.1/mcp', sub: 'admin@agnee.local', scope: 'whatsapp:read whatsapp:write', exp: now + 600 })).toString('base64url');
  const sig = crypto.createHmac('sha256', 'mcp-auth-test').update(`${header}.${payload}`).digest('base64url');
  assert.equal(ctx.oauth.verifyAccessToken(`${header}.${payload}.${sig}`, 'whatsapp:read'), null);
});

test('token statis hanya berlaku kalau menyebut anggota, dan hanya untuk membaca', async (t) => {
  const without = await setup(t, { legacyBearerToken: 'statis-panjang' });
  assert.equal(without.oauth.verifyAccessToken('statis-panjang', 'whatsapp:read'), null);

  const withId = await setup(t, { legacyBearerToken: 'statis-panjang', legacyIdentity: { userId: 'user-1', companyId: 'agnive' } });
  assert.deepEqual(withId.oauth.verifyAccessToken('statis-panjang', 'whatsapp:read'), { userId: 'user-1', companyId: 'agnive', scopes: ['whatsapp:read'] });
  assert.equal(withId.oauth.verifyAccessToken('statis-panjang', 'whatsapp:write'), null);
});

test('alamat klien: entri X-Forwarded-For yang ditambahkan Nginx, bukan kiriman klien', async () => {
  const { clientAddressOf } = await import('../src/mcp-auth.mjs');
  // Penyerang mengirim XFF palsu; Nginx menambahkan alamat aslinya di kanan.
  assert.equal(clientAddressOf({ 'x-forwarded-for': '1.2.3.4, 203.0.113.10' }, '172.24.0.1', true), '203.0.113.10');
  assert.equal(clientAddressOf({ 'x-real-ip': '203.0.113.10', 'x-forwarded-for': '9.9.9.9' }, '172.24.0.1', true), '203.0.113.10');
  assert.equal(clientAddressOf({ 'x-forwarded-for': '1.2.3.4' }, '198.51.100.1', false), '198.51.100.1');
});

test('login MCP meneruskan alamat klien ke backend, dan 429 backend tidak dilaporkan sebagai password salah', async (t) => {
  const seen = [];
  const { base, client } = await setup(t, {
    authenticate: async (email, password, clientIp) => { seen.push(clientIp); return { rateLimited: true }; },
  });
  const res = await signIn({ base, client }, 'whatsapp:read');
  assert.equal(res.status, 429);
  assert.deepEqual(seen, ['198.51.100.7']);
});

test('pendaftaran client dibatasi per alamat', async (t) => {
  const { base } = await setup(t);
  const statuses = [];
  // setup() sudah mendaftar satu; jatahnya 10 per jam per alamat.
  for (let i = 0; i < 10; i += 1) {
    const res = await fetch(`${base}/oauth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: `Banjir ${i}`, redirect_uris: ['http://localhost/cb'] }),
    });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 9), Array(9).fill(201));
  assert.equal(statuses[9], 429);
});
