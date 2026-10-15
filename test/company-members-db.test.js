'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/** Akun yang sama di beberapa company, di Postgres asli: tambah langsung, password tidak disentuh. */
test('akun yang sudah terdaftar ditambahkan ke company lain tanpa menyentuh akunnya',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const mkCompany = async (name, maxUsers = 0) => (await db.pool.query(
      'INSERT INTO companies (slug, name, max_users) VALUES ($1, $2, $3) RETURNING id', [`mem-${name}-${stamp}`, name, maxUsers],
    )).rows[0].id;
    const a = await mkCompany('a');
    const b = await mkCompany('b');
    const small = await mkCompany('small', 1);
    const emailOf = (name) => `${name}-${stamp}@t.test`;
    // Dibuat lewat jalur sungguhan supaya punya password yang bisa dipakai login.
    const orang = (await db.createTeamMember({ email: emailOf('orang'), displayName: 'Orang Asli', password: 'pass-12345', role: 'agent' }, a)).id;
    const admin = (await db.pool.query(
      "INSERT INTO users (email, display_name, is_platform_admin) VALUES ($1, 'Staf', true) RETURNING id", [emailOf('staf')],
    )).rows[0].id;
    const sup = (await db.pool.query("INSERT INTO users (email, display_name) VALUES ($1, 'Sup') RETURNING id", [emailOf('sup')])).rows[0].id;
    await db.pool.query("INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $2, 'owner')", [b, sup, small]);
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[a, b, small]]);
      await db.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[orang, admin, sup]]);
      await db.pool.end();
    });
    const code = (promise) => promise.then(() => null, (error) => error.code);

    // Belum terdaftar, staf platform, dan sudah anggota: ditolak.
    assert.equal(await code(db.addExistingUserToCompany({ email: `ghaib-${stamp}@t.test` }, b)), 'NO_ACCOUNT');
    assert.equal(await code(db.addExistingUserToCompany({ email: emailOf('staf') }, b)), 'EMAIL_TAKEN');
    assert.equal(await code(db.addExistingUserToCompany({ email: emailOf('orang') }, a)), 'ALREADY_MEMBER');

    // Tambah ke company lain: huruf besar di email tidak masalah; nama dan password tak berubah.
    const before = (await db.pool.query('SELECT password_hash, display_name FROM users WHERE id = $1', [orang])).rows[0];
    const member = await db.addExistingUserToCompany({ email: emailOf('orang').toUpperCase(), role: 'supervisor' }, b);
    assert.equal(member.id, orang);
    assert.equal(member.displayName, 'Orang Asli');
    assert.equal(member.role, 'supervisor');
    assert.deepEqual((await db.pool.query('SELECT password_hash, display_name FROM users WHERE id = $1', [orang])).rows[0], before);
    assert.deepEqual((await db.listCompaniesForUser(orang)).map((c) => c.id).sort(), [a, b].sort());

    // Peran di company lain terpisah dari peran di company asalnya.
    const roles = (await db.pool.query('SELECT company_id, role FROM company_members WHERE user_id = $1', [orang])).rows;
    assert.equal(roles.find((r) => r.company_id === a).role, 'agent');
    assert.equal(roles.find((r) => r.company_id === b).role, 'supervisor');

    // Login membuka company yang terakhir dipakai, bukan yang tertua.
    assert.equal((await db.authenticateUser(emailOf('orang'), 'pass-12345')).companyId, a);
    await db.setLastCompany(orang, b);
    assert.equal((await db.authenticateUser(emailOf('orang'), 'pass-12345')).companyId, b);

    // Dinonaktifkan lalu ditambahkan lagi: aktif kembali dengan peran baru.
    await db.deactivateTeamMember(orang, b);
    assert.equal((await db.listCompaniesForUser(orang)).length, 1);
    const again = await db.addExistingUserToCompany({ email: emailOf('orang'), role: 'agent' }, b);
    assert.equal(again.role, 'agent');
    assert.equal((await db.listCompaniesForUser(orang)).length, 2);

    // Plafon anggota: company 1 kursi yang sudah terisi menolak.
    assert.equal(await code(db.addExistingUserToCompany({ email: emailOf('orang') }, small)), 'USER_LIMIT');
  });
