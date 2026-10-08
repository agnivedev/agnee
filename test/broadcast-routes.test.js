'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const SUPERVISOR = {
  id: 'supervisor-1', userId: 'supervisor-1', companyId: 'company-1',
  email: 'owner@example.com', displayName: 'Supervisor', role: 'supervisor', status: 'active',
};
const AGENT = {
  id: 'agent-1', userId: 'agent-1', companyId: 'company-1',
  email: 'agent@example.com', displayName: 'Agent Satu', role: 'agent', status: 'active',
};

const NOW = Math.floor(Date.now() / 1000);

function fakeDatabase({ provider = 'whatsapp_web', audience = null, lidPhones = {} } = {}) {
  const users = [SUPERVISOR, AGENT];
  const audits = [];
  const created = [];
  return {
    audits, created,
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) {
      const user = users.find((item) => item.email === email);
      return user && password === 'password-123' ? user : null;
    },
    async getActiveSessionUser(userId) { return users.find((item) => item.id === userId) || null; },
    async setPresence() {},
    async listTeamMembers() { return users; },
    async getCompanyConfig() { return { whatsappProvider: provider }; },
    async listPlaybookProducts() { return []; },
    async recordAuditLog(entry, companyId) { audits.push({ ...entry, companyId }); return entry; },
    async getPhonesForLids() { return lidPhones; },
    async upsertImportedContacts() { return 0; },
    async countImportedContacts() { return { replied: 0, unproven: 0 }; },
    async savePhoneForLid() {},
    async listBroadcastAudience() {
      if (audience) return audience;
      return [
        { chatId: '62811@c.us', name: 'Budi', phone: '62811', lastInboundAt: NOW - 60, leadStage: 'qualified', optedOut: false },
        { chatId: '62812@c.us', name: 'Sari', phone: '62812', lastInboundAt: NOW - 3 * 86400, leadStage: null, optedOut: false },
        { chatId: '62813@c.us', name: 'Andi', phone: '62813', lastInboundAt: NOW - 60, leadStage: null, optedOut: true },
      ];
    },
    async createBroadcast(input, companyId) {
      const row = { id: '11111111-1111-4111-8111-111111111111', name: input.name, status: 'sending', total: input.recipients.length };
      created.push({ ...input, companyId });
      return row;
    },
    async listBroadcasts() { return []; },
  };
}

async function signIn(app, user) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: user.email, password: 'password-123' },
  });
  assert.equal(login.statusCode, 200);
  return login.headers['set-cookie'].split(';')[0];
}

async function appWith(t, database) {
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'broadcast-secret' });
  t.after(() => app.close());
  return app;
}

test('agent tidak bisa melihat atau membuat broadcast', async (t) => {
  const database = fakeDatabase();
  const app = await appWith(t, database);
  const cookie = await signIn(app, AGENT);
  for (const [method, url, payload] of [
    ['GET', '/v1/broadcasts'],
    ['GET', '/v1/broadcasts/audience'],
    ['POST', '/v1/broadcasts', { name: 'x', body: 'y', chatIds: ['62811@c.us'] }],
  ]) {
    const res = await app.inject({ method, url, headers: { cookie }, payload });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
  }
  assert.equal(database.created.length, 0);
});

test('calon penerima tidak memuat yang membalas STOP', async (t) => {
  const app = await appWith(t, fakeDatabase());
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({ method: 'GET', url: '/v1/broadcasts/audience', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().recipients.map((r) => r.chatId), ['62811@c.us', '62812@c.us']);
  assert.equal(res.json().excluded.optedOut, 1);
  assert.equal(res.json().pace.dailyCap, 300);
});

test('Cloud API: hanya customer yang chat dalam 24 jam', async (t) => {
  const app = await appWith(t, fakeDatabase({ provider: 'cloud_api' }));
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({ method: 'GET', url: '/v1/broadcasts/audience', headers: { cookie } });
  assert.deepEqual(res.json().recipients.map((r) => r.chatId), ['62811@c.us']);
  assert.equal(res.json().excluded.outsideCloudWindow, 1);
});

test('chatId di luar daftar sah dibuang, bukan dikirimi', async (t) => {
  const database = fakeDatabase();
  const app = await appWith(t, database);
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({
    method: 'POST', url: '/v1/broadcasts', headers: { cookie },
    payload: {
      name: ' Promo Oktober ', body: 'Halo {nama}',
      // 62813 membalas STOP; 999 bukan customer company ini sama sekali.
      chatIds: ['62811@c.us', '62813@c.us', '999@c.us', '62811@c.us'],
    },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().dropped, 3);
  assert.deepEqual(database.created[0].recipients.map((r) => r.chatId), ['62811@c.us']);
  assert.equal(database.created[0].name, 'Promo Oktober');
  assert.equal(database.created[0].companyId, 'company-1');

  const audit = database.audits.find((row) => row.action === 'broadcast.started');
  assert.ok(audit, 'broadcast yang dimulai harus tercatat di jejak audit');
  assert.equal(audit.metadata.recipients, 1);
  assert.equal(audit.actorUserId, SUPERVISOR.id);
});

test('tanpa satu pun penerima sah, broadcast tidak dibuat', async (t) => {
  const database = fakeDatabase();
  const app = await appWith(t, database);
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({
    method: 'POST', url: '/v1/broadcasts', headers: { cookie },
    payload: { name: 'Promo', body: 'Halo', chatIds: ['62813@c.us'] },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(database.created.length, 0);
  assert.equal(database.audits.length, 0);
});

// Beweix, 8 Okt: semua calon penerimanya berbentuk '@lid' dan lid_phone_map
// masih kosong. Lead List menyelesaikan nomornya lewat fillLidPhones, daftar
// broadcast tidak, jadi layar menampilkan digit id samaran seolah nomor telepon.
test('chat @lid mendapat nomor dari peta, bukan dibiarkan kosong', async (t) => {
  const app = await appWith(t, fakeDatabase({
    audience: [
      { chatId: '98765432100@lid', name: 'Dewi', phone: null, lastInboundAt: NOW - 60, leadStage: null, optedOut: false },
    ],
    lidPhones: { '98765432100@lid': '628123456789' },
  }));
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({ method: 'GET', url: '/v1/broadcasts/audience', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().recipients[0].phone, '628123456789');
});

test('chat @lid yang belum terpetakan tetap tanpa nomor, tidak diisi digit id samaran', async (t) => {
  const app = await appWith(t, fakeDatabase({
    audience: [
      { chatId: '98765432100@lid', name: null, phone: null, lastInboundAt: NOW - 60, leadStage: null, optedOut: false },
    ],
    lidPhones: {},
  }));
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({ method: 'GET', url: '/v1/broadcasts/audience', headers: { cookie } });
  const [row] = res.json().recipients;
  assert.equal(row.phone, null);
  assert.ok(!JSON.stringify(row).includes('phone":"98765432100'), 'id samaran tidak boleh jadi nomor');
});

// ---- kontak yang belum terlihat membalas ----

const CAMPUR = [
  { chatId: '62901@c.us', name: 'Pernah', phone: '62901', lastInboundAt: NOW - 60, leadStage: null, optedOut: false, relation: 'replied', waLabels: ['Pelanggan'] },
  { chatId: '62902@c.us', name: 'Belum', phone: '62902', lastInboundAt: null, leadStage: null, optedOut: false, relation: 'unproven', waLabels: [] },
];

async function kirim(app, cookie, payload) {
  return app.inject({ method: 'POST', url: '/v1/broadcasts', headers: { cookie }, payload: { name: 'Uji', body: 'Halo', ...payload } });
}

test('daftar penerima membawa hubungan dan label WhatsApp ke layar', async (t) => {
  const app = await appWith(t, fakeDatabase({ audience: CAMPUR }));
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({ method: 'GET', url: '/v1/broadcasts/audience', headers: { cookie } });
  const per = Object.fromEntries(res.json().recipients.map((r) => [r.chatId, r]));
  assert.equal(per['62901@c.us'].relation, 'replied');
  assert.deepEqual(per['62901@c.us'].waLabels, ['Pelanggan']);
  assert.equal(per['62902@c.us'].relation, 'unproven');
});

test('tanpa pengakuan risiko, kontak yang belum terlihat membalas DIBUANG server', async (t) => {
  const database = fakeDatabase({ audience: CAMPUR });
  const app = await appWith(t, database);
  const cookie = await signIn(app, SUPERVISOR);
  const res = await kirim(app, cookie, { chatIds: ['62901@c.us', '62902@c.us'] });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().droppedUnproven, 1);
  assert.deepEqual(database.created[0].recipients.map((r) => r.chatId), ['62901@c.us']);
});

test('dengan pengakuan risiko, kontak yang belum terlihat membalas ikut, dan tercatat di audit', async (t) => {
  const database = fakeDatabase({ audience: CAMPUR });
  const app = await appWith(t, database);
  const cookie = await signIn(app, SUPERVISOR);
  const res = await kirim(app, cookie, { chatIds: ['62901@c.us', '62902@c.us'], acceptUnproven: true });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().droppedUnproven, 0);
  assert.deepEqual(database.created[0].recipients.map((r) => r.chatId).sort(), ['62901@c.us', '62902@c.us']);
  const audit = database.audits.find((a) => a.action === 'broadcast.started');
  assert.equal(audit.metadata.unprovenRecipients, 1);
});

test('hanya kontak yang belum terlihat membalas, tanpa pengakuan: ditolak, tidak dibuat', async (t) => {
  const database = fakeDatabase({ audience: CAMPUR });
  const app = await appWith(t, database);
  const cookie = await signIn(app, SUPERVISOR);
  const res = await kirim(app, cookie, { chatIds: ['62902@c.us'] });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().error, /belum terlihat membalas/);
  assert.equal(database.created.length, 0);
});

// ---- rute impor ----

test('agent tidak bisa memicu atau melihat impor chat', async (t) => {
  const app = await appWith(t, fakeDatabase());
  const cookie = await signIn(app, AGENT);
  for (const [method, payload] of [['GET'], ['POST', {}], ['DELETE']]) {
    const res = await app.inject({ method, url: '/v1/contacts/import', headers: { cookie }, payload });
    assert.equal(res.statusCode, 403, method);
  }
});

test('impor ditolak di mode demo karena tidak ada chat sungguhan', async (t) => {
  const app = await appWith(t, fakeDatabase());
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({ method: 'POST', url: '/v1/contacts/import', headers: { cookie }, payload: {} });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().error, /demo/i);
});

test('impor ditolak untuk Cloud API, yang tidak punya daftar chat lama', async (t) => {
  const app = await appWith(t, fakeDatabase({ provider: 'cloud_api' }));
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({ method: 'POST', url: '/v1/contacts/import', headers: { cookie }, payload: {} });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().error, /Cloud API/);
});

test('status impor kosong sebelum pernah dijalankan', async (t) => {
  const database = { ...fakeDatabase(), async countImportedContacts() { return { replied: 3, unproven: 2 }; } };
  const app = await appWith(t, database);
  const cookie = await signIn(app, SUPERVISOR);
  const res = await app.inject({ method: 'GET', url: '/v1/contacts/import', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().run, null);
  assert.deepEqual(res.json().imported, { replied: 3, unproven: 2 });
  assert.equal(res.json().busyElsewhere, false);
});

