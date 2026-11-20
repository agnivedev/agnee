'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');
const pr = require('../src/password-reset');

const DB_URL = process.env.DATABASE_URL;

test('reset password di Postgres asli: hash saja, sekali pakai, kedaluwarsa, sesi dicabut',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const company = (await db.pool.query(
      'INSERT INTO companies (slug, name, max_users) VALUES ($1, $2, 0) RETURNING id', [`rst-${stamp}`, 'Reset Co'])).rows[0].id;
    t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = $1', [company]); await db.close(); });
    const email = `reset-${stamp}@t.test`;
    const user = await db.createTeamMember({ email, displayName: 'Reset', password: 'password-lama', role: 'agent' }, company);

    const t1 = pr.generateResetToken();
    const created = await db.createPasswordResetToken(email.toUpperCase(), pr.hashResetToken(t1), new Date(Date.now() + 60_000));
    assert.equal(created.id, user.id);
    assert.equal(await db.createPasswordResetToken('nope@t.test', 'h', new Date(Date.now() + 60_000)), null);

    const stored = (await db.pool.query('SELECT token_hash FROM password_reset_tokens WHERE user_id = $1', [user.id])).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].token_hash, pr.hashResetToken(t1));
    assert.notEqual(stored[0].token_hash, t1);

    // Token baru membatalkan yang lama.
    const t2 = pr.generateResetToken();
    await db.createPasswordResetToken(email, pr.hashResetToken(t2), new Date(Date.now() + 60_000));
    assert.equal(await db.consumePasswordResetToken(pr.hashResetToken(t1), 'password-x-1'), null);

    const before = await db.getActiveSessionUser(user.id, company);
    assert.equal(before.sessionsValidAfter, null);
    const when = new Date();
    const done = await db.consumePasswordResetToken(pr.hashResetToken(t2), 'password-baru-1', when);
    assert.equal(done.userId, user.id);
    assert.deepEqual(done.companyIds, [company]);
    // Sekali pakai.
    assert.equal(await db.consumePasswordResetToken(pr.hashResetToken(t2), 'password-lain-1'), null);
    assert.equal(await db.authenticateUser(email, 'password-lama'), null);
    assert.ok(await db.authenticateUser(email, 'password-baru-1'));
    const after = await db.getActiveSessionUser(user.id, company);
    assert.equal(new Date(after.sessionsValidAfter).getTime(), when.getTime());

    // Kedaluwarsa.
    const t3 = pr.generateResetToken();
    await db.createPasswordResetToken(email, pr.hashResetToken(t3), new Date(Date.now() - 1000));
    assert.equal(await db.consumePasswordResetToken(pr.hashResetToken(t3), 'password-baru-2'), null);
    assert.ok(await db.authenticateUser(email, 'password-baru-1'));
  });
