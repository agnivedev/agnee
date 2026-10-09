'use strict';

/**
 * Tautkan nomor lewat kode 8 karakter (tanpa QR).
 *
 * Yang diuji di sini: normalisasi nomor, syarat fase, jeda antar-permintaan,
 * dan bahwa kodenya tidak bocor lewat status yang terbuka untuk agent.
 * Pemanggilan ke WhatsApp sungguhan tidak bisa diuji tanpa nomor asli.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { WhatsappManager, normalizePairingPhone } = require('../src/whatsapp-manager');
const { buildApp } = require('../src/server');

function managerDenganClient({ phase = 'waiting_for_qr', requestPairingCode } = {}) {
  const manager = new WhatsappManager();
  const entry = manager._getEntry('conn-1', 'company-1');
  entry.state.phase = phase;
  entry.client = {
    pupPage: { isClosed: () => false },
    requestPairingCode: requestPairingCode || (async () => 'ABCD1234'),
  };
  return { manager, entry };
}

test('normalizePairingPhone: digit saja, awalan 0 jadi 62, bentuk tak masuk akal ditolak', () => {
  assert.equal(normalizePairingPhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizePairingPhone('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalizePairingPhone('6281234567890'), '6281234567890');
  assert.equal(normalizePairingPhone('0062 812 3456 7890'), '6281234567890');
  assert.equal(normalizePairingPhone('12025550108'), '12025550108');
  assert.equal(normalizePairingPhone('123'), null);
  assert.equal(normalizePairingPhone('1234567890123456'), null);
  assert.equal(normalizePairingPhone('abc'), null);
  assert.equal(normalizePairingPhone(undefined), null);
});

test('requestPairingCode meneruskan nomor ke client dan menyimpan kodenya', async () => {
  const calls = [];
  const { manager } = managerDenganClient({
    requestPairingCode: async (...args) => { calls.push(args); return 'WXYZ5678'; },
  });
  const result = await manager.requestPairingCode('conn-1', '6281234567890');
  assert.equal(result.code, 'WXYZ5678');
  assert.deepEqual(calls, [['6281234567890', true]]);
  assert.equal(manager.currentPairingCode('conn-1').code, 'WXYZ5678');
});

test('requestPairingCode ditolak 409 kalau nomor tidak sedang menunggu pairing', async () => {
  for (const phase of ['starting', 'syncing', 'ready', 'error']) {
    const { manager } = managerDenganClient({ phase });
    await assert.rejects(manager.requestPairingCode('conn-1', '6281234567890'), (e) => e.statusCode === 409, phase);
  }
  const kosong = new WhatsappManager();
  await assert.rejects(kosong.requestPairingCode('tidak-ada', '6281234567890'), (e) => e.statusCode === 409);
});

test('requestPairingCode: permintaan kedua dalam jeda ditolak 429 dan tidak menyentuh WhatsApp', async () => {
  let panggilan = 0;
  const { manager } = managerDenganClient({ requestPairingCode: async () => { panggilan += 1; return 'AAAA1111'; } });
  await manager.requestPairingCode('conn-1', '6281234567890');
  await assert.rejects(manager.requestPairingCode('conn-1', '6281234567890'), (e) => e.statusCode === 429);
  assert.equal(panggilan, 1);
});

test('requestPairingCode: kegagalan WhatsApp jadi 502 berpesan jelas, kode lama tidak tersisa', async () => {
  const { manager } = managerDenganClient({ requestPairingCode: async () => { throw new Error('boom internal'); } });
  await assert.rejects(manager.requestPairingCode('conn-1', '6281234567890'), (e) => {
    assert.equal(e.statusCode, 502);
    assert.doesNotMatch(e.message, /boom internal/);
    return true;
  });
  assert.equal(manager.currentPairingCode('conn-1'), null);
});

test('kode pairing tidak ikut di publicState dan hilang begitu fase berpindah', async () => {
  const { manager, entry } = managerDenganClient();
  await manager.requestPairingCode('conn-1', '6281234567890');
  assert.equal(JSON.stringify(manager.publicState('conn-1')).includes('ABCD1234'), false);
  entry.state.phase = 'syncing';
  assert.equal(manager.currentPairingCode('conn-1'), null);
});

const SUPERVISOR = {
  id: 'sup-1', userId: 'sup-1', companyId: 'company-1',
  email: 'sup@pelanggan.test', displayName: 'Supervisor', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};

function fakeDatabase() {
  return {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) {
      return email === SUPERVISOR.email && password === 'password-123' ? SUPERVISOR : null;
    },
    async getActiveSessionUser() { return SUPERVISOR; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getCompanyConfig() { return { planStatus: 'active', knowledgeClient: 'bzone' }; },
  };
}

test('POST /v1/whatsapp/pairing-code: nomor tak valid 400, nomor valid di mode demo dapat kode', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: fakeDatabase(), sessionSecret: 'pairing-code-1',
  });
  t.after(() => app.close());
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: SUPERVISOR.email, password: 'password-123' },
  });
  const cookie = login.headers['set-cookie'].split(';')[0];

  const buruk = await app.inject({
    method: 'POST', url: '/v1/whatsapp/pairing-code', headers: { cookie },
    payload: { phoneNumber: '12-34' },
  });
  assert.equal(buruk.statusCode, 400);

  const baik = await app.inject({
    method: 'POST', url: '/v1/whatsapp/pairing-code', headers: { cookie },
    payload: { phoneNumber: '0812 3456 7890' },
  });
  assert.equal(baik.statusCode, 200);
  assert.equal(baik.json().demoMode, true);
  assert.match(baik.json().code, /^[A-Z0-9]{8}$/);
});
