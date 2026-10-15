'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/** Undangan lintas company di Postgres asli: pemilik email menerima sendiri, password tidak pernah disentuh. */
test('undangan lintas company: terima, tolak, plafon, dan company terakhir dipakai',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const mkCompany = async (name, maxUsers = 0) => (await db.pool.query(
      'INSERT INTO companies (slug, name, max_users) VALUES ($1, $2, $3) RETURNING id', [`inv-${name}-${stamp}`, name, maxUsers],
    )).rows[0].id;
    const mkUser = async (name, { platformAdmin = false } = {}) => (await db.pool.query(
      "INSERT INTO users (email, display_name, password_hash, is_platform_admin) VALUES ($1, $2, 'hash-asli', $3) RETURNING id",
      [`${name}-${stamp}@t.test`, name, platformAdmin],
    )).rows[0].id;
    const join = (companyId, userId, role = 'agent') => db.pool.query(
      'INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)', [companyId, userId, role],
    );

    const a = await mkCompany('a');
    const b = await mkCompany('b');
    const small = await mkCompany('small', 1);
    const sup = await mkUser('sup');
    // Dibuat lewat jalur sungguhan supaya punya password yang bisa dipakai login.
    const orang = (await db.createTeamMember({ email: `orang-${stamp}@t.test`, displayName: 'orang', password: 'pass-12345', role: 'agent' }, a)).id;
    const admin = await mkUser('admin', { platformAdmin: true });
    const stranger = await mkUser('stranger');
    await join(b, sup, 'owner');
    await join(small, sup, 'owner');
    const emailOf = (name) => `${name}-${stamp}@t.test`;
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[a, b, small]]);
      await db.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[sup, orang, admin, stranger]]);
      await db.pool.end();
    });
    const code = (promise) => promise.then(() => null, (error) => error.code);

    // Email belum punya akun, staf platform, dan sudah anggota: semuanya ditolak.
    assert.equal(await code(db.createCompanyInvitation({ email: `ghaib-${stamp}@t.test`, invitedBy: sup }, b)), 'NO_ACCOUNT');
    assert.equal(await code(db.createCompanyInvitation({ email: emailOf('admin'), invitedBy: sup }, b)), 'EMAIL_TAKEN');
    assert.equal(await code(db.createCompanyInvitation({ email: emailOf('orang'), invitedBy: sup }, a)), 'ALREADY_MEMBER');

    // Mengundang dua kali memakai ulang baris yang sama dan memperbarui perannya.
    const first = await db.createCompanyInvitation({ email: emailOf('orang').toUpperCase(), role: 'agent', invitedBy: sup }, b);
    const again = await db.createCompanyInvitation({ email: emailOf('orang'), role: 'supervisor', invitedBy: sup }, b);
    assert.equal(again.id, first.id);
    assert.equal(again.role, 'supervisor');
    assert.equal((await db.listCompanyInvitations(b)).length, 1);

    // Hanya pemilik email yang melihat dan bisa menerimanya.
    assert.equal((await db.listInvitationsForUser(orang)).length, 1);
    assert.equal((await db.listInvitationsForUser(stranger)).length, 0);
    assert.equal(await code(db.acceptCompanyInvitation(first.id, stranger)), 'NOT_FOUND');
    assert.equal(await db.declineCompanyInvitation(first.id, stranger), null);

    const hashBefore = (await db.pool.query('SELECT password_hash FROM users WHERE id = $1', [orang])).rows[0].password_hash;
    const joined = await db.acceptCompanyInvitation(first.id, orang);
    assert.equal(joined.companyId, b);
    assert.equal(joined.role, 'supervisor');
    assert.equal((await db.pool.query('SELECT password_hash FROM users WHERE id = $1', [orang])).rows[0].password_hash, hashBefore);
    assert.equal(await code(db.acceptCompanyInvitation(first.id, orang)), 'NOT_FOUND', 'undangan hanya sekali pakai');
    assert.deepEqual((await db.listCompaniesForUser(orang)).map((c) => c.id).sort(), [a, b].sort());

    // Login membuka company yang terakhir dipakai, bukan yang tertua.
    const loginCompany = async () => (await db.authenticateUser(emailOf('orang'), 'pass-12345')).companyId;
    assert.equal(await loginCompany(), b, 'menerima undangan menjadikan company itu yang terakhir dipakai');
    await db.setLastCompany(orang, a);
    assert.equal(await loginCompany(), a);

    // Menolak: undangan hilang dari daftar dan tidak bisa diterima lagi.
    const second = await db.createCompanyInvitation({ email: emailOf('stranger'), invitedBy: sup }, a);
    assert.deepEqual(await db.declineCompanyInvitation(second.id, stranger), { companyId: a });
    assert.equal(await code(db.acceptCompanyInvitation(second.id, stranger)), 'NOT_FOUND');
    assert.equal((await db.listInvitationsForUser(stranger)).length, 0);

    // Dicabut supervisor: tidak bisa diterima.
    const third = await db.createCompanyInvitation({ email: emailOf('stranger'), invitedBy: sup }, a);
    assert.ok(await db.revokeCompanyInvitation(third.id, a));
    assert.equal(await code(db.acceptCompanyInvitation(third.id, stranger)), 'NOT_FOUND');
    // Company lain tidak bisa mencabutnya.
    const fourth = await db.createCompanyInvitation({ email: emailOf('stranger'), invitedBy: sup }, a);
    assert.equal(await db.revokeCompanyInvitation(fourth.id, b), null);

    // Kedaluwarsa tidak bisa diterima dan tidak terdaftar.
    await db.pool.query("UPDATE company_invitations SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [fourth.id]);
    assert.equal(await code(db.acceptCompanyInvitation(fourth.id, stranger)), 'NOT_FOUND');
    assert.equal((await db.listInvitationsForUser(stranger)).length, 0);
    // ...tetapi bisa diundang ulang (baris dipakai ulang, tidak menabrak indeks unik).
    const fifth = await db.createCompanyInvitation({ email: emailOf('stranger'), invitedBy: sup }, a);
    assert.equal(fifth.id, fourth.id);

    // Plafon anggota: company dengan 1 kursi (sudah terisi sup) menolak undangan baru.
    assert.equal(await code(db.createCompanyInvitation({ email: emailOf('orang'), invitedBy: sup }, small)), 'USER_LIMIT');

    // Plafon undangan menunggu per email lintas company.
    const rivals = [];
    for (let i = 0; i < Database.INVITES_PER_EMAIL - 1; i += 1) {
      const c = await mkCompany(`r${i}`);
      rivals.push(c);
      await db.createCompanyInvitation({ email: emailOf('stranger'), invitedBy: sup }, c);
    }
    // fifth (company a) + 4 rival = 5 menunggu di company lain; undangan dari company ke-6 ditolak.
    assert.equal(await code(db.createCompanyInvitation({ email: emailOf('stranger'), invitedBy: sup }, b)), 'INVITE_LIMIT');
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [rivals]);
  });
