'use strict';

/**
 * Konsol platform menampilkan biaya dalam Rupiah dengan kurs dan ambang dari
 * server — angka yang sama dengan email alert. Menguji kontrak API-nya: kurs
 * ikut di tiap respons, dan lencana `costAlert` dihitung server (bukan di
 * browser) memakai ambang paket tenant.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const STAFF = {
  id: 'staff-1', userId: 'staff-1', companyId: 'company-1',
  email: 'staf@agnive.co', displayName: 'Staf Agnive', role: 'owner', status: 'active',
  isPlatformAdmin: true,
};

const COMPANY_ID = '11111111-2222-3333-4444-555555555555';

function fakeDatabase() {
  const base = {
    slug: 'x', name: 'X', status: 'active', planStatus: 'active', trialEndsAt: null,
    createdAt: new Date().toISOString(), aiMessageCount: 0, aiMessageLimit: 0,
    aiCountResetAt: null, maxUsers: 5, maxPlaybooks: 0, maxWhatsapp: 0,
    activeUsers: 1, whatsappNumbers: 1, lastInboundAt: null,
  };
  const rows = [
    { ...base, id: 'a', slug: 'personal-boros', plan: 'personal', costUsd30d: 5 },        // Rp 82.500 >= 50.000
    { ...base, id: 'b', slug: 'personal-hemat', plan: 'personal', costUsd30d: 1 },        // Rp 16.500
    { ...base, id: 'c', slug: 'company-wajar', plan: 'company', costUsd30d: 10 },         // Rp 165.000 < 1.650.000
    { ...base, id: 'd', slug: 'lifetime-boros', plan: 'lifetime', costUsd30d: 150 },      // Rp 2.475.000
    { ...base, id: 'e', slug: 'ditangguhkan', plan: 'company', status: 'suspended', costUsd30d: 900 },
  ];
  return {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) {
      return email === STAFF.email && password === 'password-123' ? STAFF : null;
    },
    async getActiveSessionUser() { return STAFF; },
    async setPresence() {},
    async listTeamMembers() { return [STAFF]; },
    async resolveCompanyId() { return COMPANY_ID; },
    async getPlatformOverview() {
      return {
        totals: { companies: 5, active: 4, suspended: 1, trial: 0, members: 1, inbound30d: 0, costUsd30d: 1066, costUsdToday: 1 },
        tenantGrowth: [], dailyCost: [], dailyInbound: [], topTenants: [], costByPurpose: [],
        trialsEnding: [], planMix: [],
      };
    },
    async listPlatformCompanies() { return { companies: rows.map((r) => ({ ...r })), total: rows.length }; },
    async getPlatformCompany(id) {
      const found = rows.find((r) => r.id === id);
      if (!found) return null;
      return { company: { ...found, timezone: 'Asia/Jakarta', knowledgeClient: 'agnee', inbound30d: 0 }, members: [], connections: [], usage: [] };
    },
    async recordAuditLog() { return { id: 1 }; },
    async getLeadState() { return null; },
    async saveLeadState(lead) { return lead; },
  };
}

async function staffCookie(app) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login', payload: { email: STAFF.email, password: 'password-123' },
  });
  assert.equal(login.statusCode, 200);
  return login.headers['set-cookie'].split(';')[0];
}

test('daftar tenant: lencana biaya tinggi per paket, tenant ditangguhkan tidak ditandai', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'cost-console-1',
  });
  t.after(() => app.close());
  const cookie = await staffCookie(app);

  const res = await app.inject({ method: 'GET', url: '/v1/superhuman/companies', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const flag = Object.fromEntries(body.companies.map((c) => [c.slug, c.costAlert]));
  assert.deepEqual(flag, {
    'personal-boros': true,
    'personal-hemat': false,
    'company-wajar': false,
    'lifetime-boros': true,     // Lifetime memakai ambang Company, dan 150 USD melewatinya
    ditangguhkan: false,        // biayanya tidak bertambah lagi, tidak ada yang perlu diputuskan
  });
  assert.equal(body.companies.find((c) => c.slug === 'personal-boros').costAlertIdr, 50_000);
  assert.equal(body.companies.find((c) => c.slug === 'lifetime-boros').costAlertIdr, 1_650_000);
  assert.deepEqual(body.currency, { usdIdr: 16_500, alertIdr: { personal: 50_000, company: 1_650_000 } });
});

test('beranda dan detail tenant membawa kurs yang sama', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'cost-console-2',
  });
  t.after(() => app.close());
  const cookie = await staffCookie(app);

  const overview = await app.inject({ method: 'GET', url: '/v1/superhuman/overview', headers: { cookie } });
  assert.equal(overview.json().currency.usdIdr, 16_500);

  // Id detail harus UUID; fake mengenali baris lewat 'a'. Pakai route yang sama dengan UUID tiruan.
  const db = fakeDatabase();
  const uuid = '99999999-0000-4000-8000-000000000001';
  const original = db.getPlatformCompany;
  db.getPlatformCompany = async () => original('a').then((d) => ({ ...d, company: { ...d.company, id: uuid } }));
  const app2 = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database: db, sessionSecret: 'cost-console-3',
  });
  t.after(() => app2.close());
  const cookie2 = await staffCookie(app2);
  const detail = await app2.inject({ method: 'GET', url: `/v1/superhuman/companies/${uuid}`, headers: { cookie: cookie2 } });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().company.costAlert, true);
  assert.equal(detail.json().currency.usdIdr, 16_500);
});

test('kurs dan ambang bisa diganti lewat konfigurasi', async (t) => {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database: fakeDatabase(), sessionSecret: 'cost-console-4',
    usdIdrRate: 20_000, costAlertIdr: { personal: 200_000, company: 5_000_000 },
  });
  t.after(() => app.close());
  const cookie = await staffCookie(app);

  const res = await app.inject({ method: 'GET', url: '/v1/superhuman/companies', headers: { cookie } });
  const body = res.json();
  assert.equal(body.currency.usdIdr, 20_000);
  // 5 USD x 20.000 = Rp 100.000 < 200.000, jadi tidak lagi ditandai.
  assert.equal(body.companies.find((c) => c.slug === 'personal-boros').costAlert, false);
  // 150 USD x 20.000 = Rp 3.000.000 < 5.000.000.
  assert.equal(body.companies.find((c) => c.slug === 'lifetime-boros').costAlert, false);
});
