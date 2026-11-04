#!/usr/bin/env node
'use strict';

/**
 * Mengganti nama tampilan pengguna.
 *   node scripts/rename-user.js cs1@contoh.com cs1 cs2@contoh.com cs2
 */

const Database = require('../src/database');

async function main() {
  const pairs = process.argv.slice(2);
  if (!pairs.length || pairs.length % 2) {
    console.error('Pemakaian: node scripts/rename-user.js <email> <nama> [<email> <nama> ...]');
    process.exit(1);
  }
  const database = new Database();
  if (!database.enabled) {
    console.error('DATABASE_URL / PGHOST belum diisi.');
    process.exit(1);
  }
  try {
    for (let i = 0; i < pairs.length; i += 2) {
      const result = await database.pool.query(
        'UPDATE users SET display_name = $2, updated_at = NOW() WHERE LOWER(email) = LOWER($1) RETURNING email, display_name',
        [pairs[i], pairs[i + 1]],
      );
      console.log(result.rows[0] ? `${result.rows[0].email} -> ${result.rows[0].display_name}` : `${pairs[i]}: tidak ditemukan`);
    }
  } finally {
    await database.pool.end();
  }
}

main().catch((error) => { console.error('Gagal:', error?.message || error); process.exit(1); });
