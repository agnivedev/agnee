'use strict';

/**
 * Profil lead website di Postgres sungguhan: simpan idempoten, pencocokan
 * email/nomor account, klaim verifikasi yang hanya dimenangkan sekali, dan
 * isolasi antar company. Yang diuji adalah SQL-nya, jadi DB palsu tidak berguna.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';

async function withCompanies(t, fn) {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const made = [];
  for (const label of ['a', 'b']) {
    const { rows } = await db.pool.query(
      'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id',
      [`Uji lead ${label}`, `uji-lead-${label}-${stamp}`],
    );
    made.push(rows[0].id);
  }
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [made]);
    await db.close();
  });
  return fn(db, made[0], made[1]);
}

const lead = (overrides = {}) => ({
  submissionId: '1', chatId: '6281111111111@c.us', name: 'Rina Wijaya', email: 'Rina@Example.com',
  broker: 'Exness', accountStatus: 'new', accountNumber: '', language: 'id', ...overrides,
});

test('simpan profil: kiriman ulang submission yang sama tidak menimpa apa pun', { skip }, (t) => withCompanies(t, async (db, a) => {
  assert.ok(await db.saveWebsiteLeadProfile(lead(), a));
  assert.equal(await db.saveWebsiteLeadProfile(lead({ name: 'Nama Lain' }), a), null);
  const found = await db.findWebsiteLeadsForVerification(a, { emails: ['rina@example.com'], accounts: [] });
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Rina Wijaya');
}));

test('cocok lewat email tanpa beda huruf, atau lewat nomor account', { skip }, (t) => withCompanies(t, async (db, a) => {
  await db.saveWebsiteLeadProfile(lead(), a);
  await db.saveWebsiteLeadProfile(lead({ submissionId: '2', chatId: '6282222222222@c.us', email: '', accountNumber: '55512345', broker: 'Valetax' }), a);
  assert.equal((await db.findWebsiteLeadsForVerification(a, { emails: ['rina@example.com'], accounts: [] })).length, 1);
  assert.equal((await db.findWebsiteLeadsForVerification(a, { emails: [], accounts: ['55512345'] })).length, 1);
  assert.equal((await db.findWebsiteLeadsForVerification(a, { emails: ['lain@example.com'], accounts: ['99999999'] })).length, 0);
  assert.equal((await db.findWebsiteLeadsForVerification(a, { emails: [], accounts: [] })).length, 0);
}));

test('klaim verifikasi hanya dimenangkan sekali, konfirmasi hanya sekali', { skip }, (t) => withCompanies(t, async (db, a) => {
  await db.saveWebsiteLeadProfile(lead(), a);
  const [row] = await db.findWebsiteLeadsForVerification(a, { emails: ['rina@example.com'], accounts: [] });
  const [first, second] = await Promise.all([
    db.claimWebsiteLeadVerification(row.id, 'anduman', a),
    db.claimWebsiteLeadVerification(row.id, 'anduman', a),
  ]);
  assert.equal([first, second].filter(Boolean).length, 1, 'tepat satu pemanggil yang menang');
  // Sudah verified tetapi belum dikonfirmasi: masih ditemukan supaya bisa dicoba lagi.
  assert.equal((await db.findWebsiteLeadsForVerification(a, { emails: ['rina@example.com'], accounts: [] })).length, 1);
  assert.equal(await db.markWebsiteLeadConfirmed(row.id, a), true);
  assert.equal(await db.markWebsiteLeadConfirmed(row.id, a), false);
  assert.equal((await db.findWebsiteLeadsForVerification(a, { emails: ['rina@example.com'], accounts: [] })).length, 0);
}));

test('company lain tidak bisa melihat atau mengklaim lead ini', { skip }, (t) => withCompanies(t, async (db, a, b) => {
  await db.saveWebsiteLeadProfile(lead(), a);
  const [row] = await db.findWebsiteLeadsForVerification(a, { emails: ['rina@example.com'], accounts: [] });
  assert.equal((await db.findWebsiteLeadsForVerification(b, { emails: ['rina@example.com'], accounts: [] })).length, 0);
  assert.equal(await db.claimWebsiteLeadVerification(row.id, 'anduman', b), null);
  assert.equal(await db.markWebsiteLeadConfirmed(row.id, b), false);
  // submissionId yang sama boleh ada di company lain.
  assert.ok(await db.saveWebsiteLeadProfile(lead(), b));
}));

test('nilai di luar daftar ditolak oleh constraint', { skip }, (t) => withCompanies(t, async (db, a) => {
  await assert.rejects(db.pool.query(
    "INSERT INTO website_leads (company_id, submission_id, chat_id, name, status) VALUES ($1, 'x', 'c', 'n', 'hacked')", [a]));
}));

test('cocok lewat email broker yang berbeda dari email member, atau lewat submissionId', { skip }, (t) => withCompanies(t, async (db, a, b) => {
  await db.saveWebsiteLeadProfile(lead({ submissionId: 'member-12', email: 'dewi@member.test', brokerEmail: 'Dewi.Trade@Valetax.test', broker: 'Valetax' }), a);
  assert.equal((await db.findWebsiteLeadsForVerification(a, { emails: ['dewi.trade@valetax.test'] })).length, 1);
  assert.equal((await db.findWebsiteLeadsForVerification(a, { submissionIds: ['member-12'] })).length, 1);
  assert.equal((await db.findWebsiteLeadsForVerification(b, { submissionIds: ['member-12'], emails: ['dewi.trade@valetax.test'] })).length, 0);
}));
