'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Baris `users` dipakai bersama oleh semua company. Dulu menambah anggota
 * dengan email yang sudah terdaftar menimpa password akun itu, jadi supervisor
 * company mana pun bisa login sebagai orang di company lain. Yang diuji adalah
 * SQL-nya sendiri, jadi butuh Postgres asli.
 */
test('anggota tim tidak bisa mengambil alih akun company lain', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const stamp = Date.now();
  const victimEmail = `korban-${stamp}@takeover.test`;
  const loneEmail = `sendiri-${stamp}@takeover.test`;

  const company = async (slug) => (await db.pool.query(
    `INSERT INTO companies (slug, name, max_users) VALUES ($1, $1, 0) RETURNING id`, [slug],
  )).rows[0].id;
  const victimCompany = await company(`korban-${stamp}`);
  const attackerCompany = await company(`penyerang-${stamp}`);

  t.after(async () => {
    await db.pool.query('DELETE FROM audit_logs WHERE company_id = ANY($1)', [[victimCompany, attackerCompany]]).catch(() => {});
    await db.pool.query('DELETE FROM company_members WHERE company_id = ANY($1)', [[victimCompany, attackerCompany]]);
    await db.pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%-${stamp}@takeover.test`]);
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [[victimCompany, attackerCompany]]);
    await db.close();
  });

  const victim = await db.createTeamMember(
    { email: victimEmail, displayName: 'Korban', password: 'password-korban', role: 'supervisor' },
    victimCompany,
  );

  await t.test('email yang hidup di company lain ditolak, password tidak berubah', async () => {
    await assert.rejects(
      db.createTeamMember({ email: victimEmail.toUpperCase(), displayName: 'Palsu', password: 'password-penyerang', role: 'agent' }, attackerCompany),
      (error) => error.code === 'EMAIL_TAKEN',
    );
    assert.equal(await db.authenticateUser(victimEmail, 'password-penyerang'), null);
    const login = await db.authenticateUser(victimEmail, 'password-korban');
    assert.equal(login?.companyId, victimCompany);
    assert.equal(login?.displayName, 'Korban');
  });

  await t.test('akun platform admin tidak bisa ditambahkan ulang', async () => {
    await db.pool.query('UPDATE users SET is_platform_admin = TRUE WHERE id = $1', [victim.id]);
    await assert.rejects(
      db.createTeamMember({ email: victimEmail, displayName: 'Palsu', password: 'password-penyerang', role: 'agent' }, victimCompany),
      (error) => error.code === 'EMAIL_TAKEN',
    );
    await db.pool.query('UPDATE users SET is_platform_admin = FALSE WHERE id = $1', [victim.id]);
  });

  await t.test('anggota yang dinonaktifkan di company sendiri boleh diaktifkan lagi', async () => {
    const lone = await db.createTeamMember({ email: loneEmail, displayName: 'Agent', password: 'password-lama', role: 'agent' }, attackerCompany);
    await db.deactivateTeamMember(lone.id, attackerCompany);
    const again = await db.createTeamMember({ email: loneEmail, displayName: 'Agent Baru', password: 'password-baru', role: 'agent' }, attackerCompany);
    assert.equal(again.id, lone.id);
    assert.ok(await db.authenticateUser(loneEmail, 'password-baru'));
  });

  await t.test('login akun yang juga anggota company lain tidak bisa diubah dari sini', async () => {
    // Keanggotaan ganda yang sah (dibuat staf platform), bukan lewat jalur tadi.
    await db.pool.query(
      `INSERT INTO company_members (company_id, user_id, role, status, joined_at) VALUES ($1, $2, 'agent', 'active', NOW())`,
      [attackerCompany, victim.id],
    );
    for (const change of [{ password: 'password-penyerang' }, { email: `ganti-${stamp}@takeover.test` }, { displayName: 'Palsu' }]) {
      await assert.rejects(
        db.updateTeamMember(victim.id, change, attackerCompany),
        (error) => error.code === 'SHARED_ACCOUNT',
      );
    }
    assert.ok(await db.authenticateUser(victimEmail, 'password-korban'));
  });

  await t.test('anggota yang hanya milik company ini tetap bisa diubah', async () => {
    const lone = (await db.pool.query('SELECT id FROM users WHERE email = $1', [loneEmail])).rows[0];
    const updated = await db.updateTeamMember(lone.id, { displayName: 'Agent Ganti' }, attackerCompany);
    assert.equal(updated.displayName, 'Agent Ganti');
  });

  await t.test('company yang ditutup dari konsol tidak bisa login dan sesinya putus', async () => {
    await db.pool.query(`UPDATE companies SET status = 'closed' WHERE id = $1`, [victimCompany]);
    try {
      // Korban masih anggota company penyerang dari subtest sebelumnya, jadi
      // login harus jatuh ke company yang masih aktif, bukan ditolak total.
      const login = await db.authenticateUser(victimEmail, 'password-korban');
      assert.equal(login?.companyId, attackerCompany);
      assert.equal(await db.getActiveSessionUser(victim.id, victimCompany), null);
    } finally {
      await db.pool.query(`UPDATE companies SET status = 'active' WHERE id = $1`, [victimCompany]);
    }
  });
});
