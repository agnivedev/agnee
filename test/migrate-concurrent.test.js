'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Dua proses yang menyala bersamaan dulu sama-sama menjalankan migrasi baru,
 * lalu yang kedua gagal di INSERT schema_migrations dan connect() melempar.
 * Itu sumber kegagalan "acak" test DB setiap kali ada file migrasi baru.
 *
 * 041 dipakai karena isinya idempoten (UPDATE ... WHERE onboarded_at IS NULL):
 * menjalankannya ulang tidak mengubah apa pun.
 */
test('migrasi aman saat beberapa proses menyala bersamaan', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async () => {
  const name = '041_onboarded_existing_users.sql';
  const setup = new Database({ connectionString: DB_URL });
  await setup.connect();
  await setup.pool.query('DELETE FROM schema_migrations WHERE name = $1', [name]);

  const dbs = Array.from({ length: 4 }, () => new Database({ connectionString: DB_URL }));
  try {
    await Promise.all(dbs.map((db) => db.connect()));
    const applied = await setup.pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations WHERE name = $1', [name]);
    assert.equal(applied.rows[0].n, 1);
  } finally {
    await Promise.all(dbs.map((db) => db.close()));
    await setup.close();
  }
});
