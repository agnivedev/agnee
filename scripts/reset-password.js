#!/usr/bin/env node
'use strict';

/**
 * Mengganti password sebuah akun dengan password acak baru, dicetak SEKALI ke
 * terminal (tidak disimpan di mana pun).
 *
 *   node scripts/reset-password.js pemilik@contoh.com
 */

const crypto = require('node:crypto');
const { Pool } = require('pg');

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 18; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Pemakaian: node scripts/reset-password.js <email>');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    console.error('DATABASE_URL / PGHOST belum diisi.');
    process.exit(1);
  }
  const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
  try {
    const password = randomPassword();
    const result = await pool.query(
      'UPDATE users SET password_hash = $2, updated_at = NOW() WHERE LOWER(email) = LOWER($1) RETURNING email',
      [email, hashPassword(password)],
    );
    if (!result.rowCount) {
      console.error(`${email} tidak ditemukan.`);
      process.exitCode = 1;
      return;
    }
    console.log(`${result.rows[0].email}  password baru: ${password}`);
    console.log('Simpan password ini sekarang — tidak ditampilkan lagi.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => { console.error('Gagal:', error?.message || error); process.exit(1); });
