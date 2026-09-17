'use strict';

/**
 * Gerbang konsol platform (/v1/superhuman/).
 *
 * Konsol ini adalah satu-satunya bagian API yang sengaja melihat lintas tenant,
 * jadi yang diuji di sini bukan fiturnya melainkan siapa yang TIDAK boleh
 * masuk. Isolasi tenant sudah pernah diverifikasi lewat probe 403 lintas
 * company; berkas ini menjaga agar pintu baru ini tidak diam-diam membatalkan
 * hasil itu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const OWNER = {
  id: 'owner-1', userId: 'owner-1', companyId: 'company-1',
  email: 'owner@pelanggan.test', displayName: 'Owner Pelanggan', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};
const STAFF = {
  id: 'staff-1', userId: 'staff-1', companyId: 'company-1',
  email: 'staf@agnive.co', displayName: 'Staf Agnive', role: 'owner', status: 'active',
  isPlatformAdmin: true,
};

function fakeDatabase({ liveOverrides = {} } = {}) {
  const users = [OWNER, STAFF];
  const audits = [];
  const patches = [];
  const company = {
    id: '11111111-2222-3333-4444-555555555555',
    slug: 'pelanggan-satu', name: 'Pelanggan Satu',
    plan: 'personal', status: 'active', planStatus: 'trial',
    trialEndsAt: null, createdAt: new Date().toISOString(),
    aiMessageCount: 10, aiMessageLimit: 500, aiCountResetAt: null,
    maxUsers: 1, maxPlaybooks: 1, maxWhatsapp: 1,
    activeUsers: 1, whatsappNumbers: 0, lastInboundAt: null, costUsd30d: 0,
    timezone: 'Asia/Jakarta', knowledgeClient: 'agnee', inbound30d: 0,
  };
  return {
    audits, patches, company,
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) {
      const user = users.find((item) => item.email === email);
      return user && password === 'password-123' ? user : null;
    },
    async getActiveSessionUser(userId) {
      const user = users.find((item) => item.id === userId);
      if (!user) return null;
      // Sengaja bisa berbeda dari hasil login: di sinilah pencabutan peran
      // menggigit sesi yang sedang berjalan.
      return { ...user, ...(liveOverrides[userId] || {}) };
    },
    async setPresence() {},
    async listTeamMembers() { return users; },
    async resolveCompanyId() { return company.id; },
    async listPlatformCompanies() { return { companies: [company], total: 1 }; },
    async getPlatformOverview() {
      return {
        totals: {
          companies: 1, active: 1, suspended: 0, trial: 1,
          members: 1, inbound30d: 0, costUsd30d: 0.5, costUsdToday: 0.1,
        },
        tenantGrowth: [{ month: '2026-09', added: 1, cumulative: 1 }],
        dailyCost: [{ day: '2026-09-17', costUsd: 0.5 }],
        dailyInbound: [{ day: '2026-09-17', count: 0 }],
        topTenants: [{ id: company.id, slug: company.slug, name: company.name, costUsd: 0.5, calls: 3 }],
        costByPurpose: [{ purpose: 'summary', costUsd: 0.5, calls: 3 }],
        trialsEnding: [],
        planMix: [{ plan: 'personal', planStatus: 'trial', count: 1 }],
      };
    },
    async getPlatformCompany(companyId) {
      if (companyId !== company.id) return null;
      // Salinan, bukan objek yang sama: database sungguhan mengembalikan baris
      // baru setiap pembacaan, dan route membandingkan "sebelum" dengan
      // "sesudah" — dua rujukan ke objek yang sama tidak akan pernah berbeda.
      return { company: { ...company }, members: [], connections: [], usage: [] };
    },
    async updatePlatformCompany(companyId, patch) {
      if (companyId !== company.id) return null;
      patches.push(patch);
      Object.assign(company, patch);
      return { company: { ...company }, members: [], connections: [], usage: [] };
    },
    async recordAuditLog(entry, companyId) {
      const saved = { id: audits.length + 1, ...entry, companyId };
      audits.push(saved);
      return saved;
    },
    async getLeadState() { return null; },
    async saveLeadState(lead) { return lead; },
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

test('owner sebuah tenant tidak bisa masuk konsol platform', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'superhuman-1',
  });
  t.after(() => app.close());

  const cookie = await signIn(app, OWNER);

  // Dia supervisor penuh atas perusahaannya sendiri…
  const ownTeam = await app.inject({ method: 'GET', url: '/v1/team/members', headers: { cookie } });
  assert.equal(ownTeam.statusCode, 200);

  // …dan itu tidak memberinya apa pun atas perusahaan orang lain.
  const platform = await app.inject({ method: 'GET', url: '/v1/superhuman/companies', headers: { cookie } });
  assert.equal(platform.statusCode, 403);

  const detail = await app.inject({
    method: 'GET', url: `/v1/superhuman/companies/${database.company.id}`, headers: { cookie },
  });
  assert.equal(detail.statusCode, 403);
});

test('kunci API tidak pernah menjadi akses platform', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'superhuman-2',
  });
  t.after(() => app.close());

  // Kunci API memberi hak supervisor atas satu company yang ia sebut. Kalau
  // gerbang platform ikut menerimanya, satu kunci yang bocor berubah dari
  // "akses satu tenant" menjadi "akses seluruh pelanggan".
  const headers = { 'x-api-key': 'dev-api-key', 'x-agnee-company': 'pelanggan-satu' };
  const asKey = await app.inject({ method: 'GET', url: '/v1/superhuman/companies', headers });
  assert.equal(asKey.statusCode, 403);
});

test('staf platform melihat daftar tenant, dan pembacaannya meninggalkan jejak', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'superhuman-3',
  });
  t.after(() => app.close());

  const cookie = await signIn(app, STAFF);

  const list = await app.inject({ method: 'GET', url: '/v1/superhuman/companies', headers: { cookie } });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().total, 1);
  assert.equal(list.json().companies[0].slug, 'pelanggan-satu');

  const detail = await app.inject({
    method: 'GET', url: `/v1/superhuman/companies/${database.company.id}`, headers: { cookie },
  });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(
    database.audits.map((row) => row.action),
    ['platform.company.viewed'],
  );

  // Perubahan dicatat dengan nilai sebelum dan sesudahnya…
  const patched = await app.inject({
    method: 'PATCH', url: `/v1/superhuman/companies/${database.company.id}`, headers: { cookie },
    payload: { planStatus: 'active', aiMessageLimit: 5000 },
  });
  assert.equal(patched.statusCode, 200);
  const updated = database.audits.at(-1);
  assert.equal(updated.action, 'platform.company.updated');
  assert.deepEqual(updated.metadata.changes.planStatus, { dari: 'trial', ke: 'active' });
  assert.deepEqual(updated.metadata.changes.aiMessageLimit, { dari: 500, ke: 5000 });

  // …dan menyimpan nilai yang sama tidak menambah jejak yang menenggelamkan
  // perubahan yang sesungguhnya.
  const auditsBefore = database.audits.length;
  const noop = await app.inject({
    method: 'PATCH', url: `/v1/superhuman/companies/${database.company.id}`, headers: { cookie },
    payload: { planStatus: 'active' },
  });
  assert.equal(noop.statusCode, 200);
  assert.equal(database.audits.length, auditsBefore);
});

test('peran platform dibaca dari database, bukan dari cookie yang sudah dipegang', async (t) => {
  // Login saat masih berhak, lalu perannya dicabut. Cookie-nya masih membawa
  // bendera lama dan berlaku 12 jam — tapi revalidasi sesi membaca ulang ke
  // database, jadi permintaan berikutnya sudah ditolak.
  const database = fakeDatabase({ liveOverrides: { 'staff-1': { isPlatformAdmin: false } } });
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'superhuman-4',
  });
  t.after(() => app.close());

  const cookie = await signIn(app, STAFF);
  const after = await app.inject({ method: 'GET', url: '/v1/superhuman/companies', headers: { cookie } });
  assert.equal(after.statusCode, 403);
});

test('id tenant yang bukan UUID ditolak sebelum menyentuh database', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'superhuman-5',
  });
  t.after(() => app.close());

  const cookie = await signIn(app, STAFF);
  const bad = await app.inject({
    method: 'GET', url: '/v1/superhuman/companies/bukan-uuid', headers: { cookie },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(database.audits.length, 0);
});

test('ringkasan beranda dijaga gerbang yang sama, dan tidak dicatat sebagai akses satu tenant', async (t) => {
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'superhuman-6',
  });
  t.after(() => app.close());

  // Owner pelanggan: ditolak, sama seperti route lain di bawah prefix ini.
  const ownerCookie = await signIn(app, OWNER);
  const refused = await app.inject({
    method: 'GET', url: '/v1/superhuman/overview', headers: { cookie: ownerCookie },
  });
  assert.equal(refused.statusCode, 403);

  const staffCookie = await signIn(app, STAFF);
  const overview = await app.inject({
    method: 'GET', url: '/v1/superhuman/overview', headers: { cookie: staffCookie },
  });
  assert.equal(overview.statusCode, 200);
  const body = overview.json();
  assert.equal(body.totals.companies, 1);
  assert.equal(body.dailyCost.length, 1);
  assert.equal(body.topTenants[0].slug, 'pelanggan-satu');

  // Angkanya gabungan lintas tenant, jadi tidak ada satu company pun yang
  // pantas dicatat sebagai "dibuka" — dan audit_logs memang menuntut satu.
  assert.equal(database.audits.length, 0);
});
