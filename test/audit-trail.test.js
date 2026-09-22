'use strict';

/**
 * Jejak audit untuk tindakan yang akibatnya keluar dari Agnee.
 *
 * Sebelum ini hanya satu tindakan yang tercatat (`lead.open_in_whatsapp`).
 * Mengunduh seluruh daftar customer, mengubah rekening tujuan pembayaran,
 * memutus nomor perusahaan, dan mengubah siapa yang punya akses — semuanya
 * tidak meninggalkan baris apa pun.
 *
 * Yang paling dijaga di sini: `payment.changed` TIDAK boleh memuat nomor
 * rekeningnya. Jejak audit dibaca lewat API oleh setiap supervisor, jadi
 * menaruh nilai rahasia di sana justru menambah tempat kebocoran baru —
 * padahal yang perlu ditelusuri cuma "siapa mengubah, kapan".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const COMPANY = 'company-1';
const SUPERVISOR = {
  id: 'sup-1', userId: 'sup-1', companyId: COMPANY,
  email: 'sup@pelanggan.test', displayName: 'Supervisor', role: 'owner', status: 'active',
  isPlatformAdmin: false,
};
const AGENT = {
  id: 'agent-1', userId: 'agent-1', companyId: COMPANY,
  email: 'agent@pelanggan.test', displayName: 'Agent', role: 'agent', status: 'active',
  isPlatformAdmin: false,
};

function fakeDatabase() {
  const users = [SUPERVISOR, AGENT];
  const audit = [];
  return {
    audit,
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) {
      const user = users.find((item) => item.email === email);
      return user && password === 'password-123' ? user : null;
    },
    async getActiveSessionUser(userId) { return users.find((item) => item.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getCompanyConfig() { return { planStatus: 'active', knowledgeClient: 'bzone' }; },
    async recordAuditLog(entry, companyId) { audit.push({ ...entry, companyId }); return entry; },
    async listAuditLogs(companyId, { action = null } = {}) {
      return audit.filter((row) => row.companyId === companyId && (!action || row.action === action));
    },
    async listTeamMembers() { return users; },
    async updateCompanyConfig(patch) { return { ...patch }; },
    async updateTeamMemberRole(userId, role) { return { id: userId, email: 'agent@pelanggan.test', role }; },
    async deactivateTeamMember() { return true; },
    async listContactExportRows() {
      return [{ chatId: '628111@c.us', phone: '628111', name: 'Customer Satu' }];
    },
    async getCompanyUsage() { return { maxUsers: 5, currentUsers: 2 }; },
  };
}

async function masuk(app, user) {
  const login = await app.inject({
    method: 'POST', url: '/v1/auth/login',
    payload: { email: user.email, password: 'password-123' },
  });
  assert.equal(login.statusCode, 200);
  return login.headers['set-cookie'].split(';')[0];
}

async function appUji(t, database, sessionSecret) {
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, database, sessionSecret,
  });
  t.after(() => app.close());
  return app;
}

test('mengunduh daftar customer meninggalkan jejak, dengan jumlah barisnya', async (t) => {
  const database = fakeDatabase();
  const app = await appUji(t, database, 'audit-1');
  const cookie = await masuk(app, SUPERVISOR);

  const unduh = await app.inject({ method: 'GET', url: '/v1/export/contacts.csv', headers: { cookie } });
  assert.equal(unduh.statusCode, 200);

  const baris = database.audit.filter((row) => row.action === 'contacts.exported');
  assert.equal(baris.length, 1);
  assert.equal(baris[0].metadata.format, 'csv');
  assert.equal(baris[0].metadata.rows, 1);
  assert.equal(baris[0].actorUserId, 'sup-1');
});

test('setelan pembayaran: yang dicatat NAMA kolomnya, bukan nomor rekeningnya', async (t) => {
  const database = fakeDatabase();
  const app = await appUji(t, database, 'audit-2');
  const cookie = await masuk(app, SUPERVISOR);

  const REKENING = '1234567890';
  const ubah = await app.inject({
    method: 'PATCH', url: '/v1/admin/company', headers: { cookie },
    payload: { paymentMethod: 'bank_transfer', bankName: 'BCA', bankAccount: REKENING, bankHolder: 'Agnive' },
  });
  assert.equal(ubah.statusCode, 200);

  const baris = database.audit.filter((row) => row.action === 'payment.changed');
  assert.equal(baris.length, 1);
  assert.deepEqual(baris[0].metadata.fields, ['paymentMethod', 'bankName', 'bankAccount', 'bankHolder']);
  assert.equal(baris[0].metadata.method, 'bank_transfer');

  // Inti tes ini: nomor rekening tidak boleh ada di mana pun dalam barisnya.
  assert.equal(JSON.stringify(baris[0]).includes(REKENING), false);
});

test('perubahan akses tim tercatat: peran diubah dan anggota dinonaktifkan', async (t) => {
  const database = fakeDatabase();
  const app = await appUji(t, database, 'audit-3');
  const cookie = await masuk(app, SUPERVISOR);

  await app.inject({
    method: 'PATCH', url: '/v1/team/members/agent-1/role', headers: { cookie },
    payload: { role: 'supervisor' },
  });
  await app.inject({ method: 'DELETE', url: '/v1/team/members/agent-1', headers: { cookie } });

  const aksi = database.audit.map((row) => row.action);
  assert.equal(aksi.includes('team.role_changed'), true);
  assert.equal(aksi.includes('team.member_removed'), true);
});

test('pekerjaan sehari-hari tidak ikut dicatat', async (t) => {
  const database = fakeDatabase();
  const app = await appUji(t, database, 'audit-4');
  const cookie = await masuk(app, SUPERVISOR);

  // Rute JSON ini dipanggil halaman Lead List setiap kali dibuka. Kalau ikut
  // dicatat, jejak audit penuh oleh pemuatan halaman dan tidak ada lagi yang
  // bisa dibaca di dalamnya.
  await app.inject({ method: 'GET', url: '/v1/export/contacts', headers: { cookie } });
  assert.equal(database.audit.length, 0);
});

test('jejak audit hanya untuk supervisor, dan hanya company-nya sendiri', async (t) => {
  const database = fakeDatabase();
  const app = await appUji(t, database, 'audit-5');

  const cookieSup = await masuk(app, SUPERVISOR);
  await app.inject({ method: 'GET', url: '/v1/export/contacts.csv', headers: { cookie: cookieSup } });

  const dibacaSup = await app.inject({ method: 'GET', url: '/v1/audit', headers: { cookie: cookieSup } });
  assert.equal(dibacaSup.statusCode, 200);
  assert.equal(dibacaSup.json().entries.length, 1);

  const cookieAgent = await masuk(app, AGENT);
  const dibacaAgent = await app.inject({ method: 'GET', url: '/v1/audit', headers: { cookie: cookieAgent } });
  assert.equal(dibacaAgent.statusCode, 403);
});

test('gagal mencatat tidak menggagalkan tindakannya', async (t) => {
  const database = fakeDatabase();
  database.recordAuditLog = async () => { throw new Error('database menolak'); };
  const app = await appUji(t, database, 'audit-6');
  const cookie = await masuk(app, SUPERVISOR);

  // Menghalangi pekerjaan karena audit gagal lebih mahal daripada satu baris
  // yang hilang — unduhannya harus tetap jadi.
  const unduh = await app.inject({ method: 'GET', url: '/v1/export/contacts.csv', headers: { cookie } });
  assert.equal(unduh.statusCode, 200);
});
