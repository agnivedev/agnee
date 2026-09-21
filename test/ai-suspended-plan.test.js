'use strict';

/**
 * Paket yang berhenti harus mematikan SEMUA jalur AI, bukan cuma balasan
 * otomatis.
 *
 * Dulu hanya `generateAutoReply()` yang memeriksa `planStatus === 'suspended'`.
 * Ringkasan percakapan, coach, simulate, playground, dan playbook chat/compile
 * tetap memanggil model — perusahaan yang tidak lagi membayar tetap
 * menghasilkan tagihan OpenRouter untuk kita. Kuotanya sendiri sengaja tetap
 * berarti "pesan ke customer" (keputusan Hanny, 21 Sep), jadi jalur-jalur itu
 * memang tidak menagih kuota; yang menahannya adalah status paket ini.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const COMPANY = 'company-berhenti';
const OWNER = {
  id: 'owner-1', userId: 'owner-1', companyId: COMPANY,
  email: 'owner@pelanggan.test', displayName: 'Owner', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};

function fakeDatabase(planStatus) {
  return {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) {
      return email === OWNER.email && password === 'password-123' ? OWNER : null;
    },
    async getActiveSessionUser() { return OWNER; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getCompanyConfig() {
      return { planStatus, knowledgeClient: 'bzone', aiMessageLimit: 0, aiMessageCount: 0 };
    },
    async getPlaybookDoc() { return null; },
    async getPlaybookContext() { return ''; },
  };
}

async function masuk(app) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: OWNER.email, password: 'password-123' },
  });
  assert.equal(login.statusCode, 200);
  return login.headers['set-cookie'].split(';')[0];
}

async function appDenganPaket(t, planStatus, sessionSecret) {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true,
    database: fakeDatabase(planStatus),
    // AI menyala di tingkat platform — supaya yang diuji benar-benar status
    // paket, bukan OPENROUTER_API_KEY yang kebetulan kosong.
    llmEnabled: true, openrouterApiKey: 'kunci-uji',
    sessionSecret,
  });
  t.after(() => app.close());
  return app;
}

const RUTE_AI = [
  ['POST', '/v1/admin/playground/auto-reply', { message: 'Halo', clientId: 'bzone' }],
  ['POST', '/v1/playbooks/persona/chat', { message: 'Halo' }],
];

test('paket berhenti: semua rute AI balas 503 dengan alasan paket, bukan alasan API key', async (t) => {
  const app = await appDenganPaket(t, 'suspended', 'suspended-1');
  const cookie = await masuk(app);

  for (const [method, url, payload] of RUTE_AI) {
    const res = await app.inject({ method, url, headers: { cookie }, payload });
    assert.equal(res.statusCode, 503, `${url} seharusnya 503`);
    // Pesannya harus menunjuk paket — menyuruh orang memeriksa OPENROUTER_API_KEY
    // untuk tagihan yang belum dibayar mengirim mereka ke tempat yang salah.
    assert.match(res.json().error, /paket/i, `${url} harus menyebut paket`);
  }
});

test('paket aktif: rute yang sama tidak ditolak karena status paket', async (t) => {
  const app = await appDenganPaket(t, 'active', 'suspended-2');
  const cookie = await masuk(app);

  for (const [method, url, payload] of RUTE_AI) {
    const res = await app.inject({ method, url, headers: { cookie }, payload });
    // Balasannya boleh gagal karena OpenRouter tidak bisa dihubungi dari test,
    // tapi tidak boleh 503-karena-paket.
    if (res.statusCode === 503) {
      assert.doesNotMatch(res.json().error, /paket/i, `${url} tidak boleh menyalahkan paket`);
    }
  }
});
