#!/usr/bin/env node
'use strict';

/**
 * Memberi, mencabut, dan mendaftar peran platform admin (superadmin Agnee).
 *
 *   node scripts/grant-platform-admin.js --list
 *   node scripts/grant-platform-admin.js --grant  hanny@agnive.co
 *   node scripts/grant-platform-admin.js --revoke orang@agnive.co
 *
 * KENAPA LEWAT SKRIP, BUKAN HALAMAN: peran ini menembus isolasi tenant yang
 * selama ini dijaga ketat. Kalau ada halaman yang bisa mengangkat superadmin
 * baru, maka setiap bug otorisasi di halaman itu berubah menjadi jalan naik ke
 * akses seluruh pelanggan. Dengan hanya ada jalur ini, menambah superadmin
 * menuntut akses shell ke server — hal yang sudah setara dengan akses database
 * itu sendiri, jadi tidak ada kekuasaan baru yang diciptakan.
 *
 * DATABASE_URL menentukan database mana yang disentuh. Untuk produksi,
 * jalankan di dalam container app atau lewat terowongan.
 */

const { Pool } = require('pg');

function parseArgs(argv) {
  const args = { action: null, email: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--list') args.action = 'list';
    else if (argv[i] === '--grant') { args.action = 'grant'; args.email = argv[i + 1]; i += 1; }
    else if (argv[i] === '--revoke') { args.action = 'revoke'; args.email = argv[i + 1]; i += 1; }
  }
  return args;
}

const USAGE = [
  'Pemakaian:',
  '  node scripts/grant-platform-admin.js --list',
  '  node scripts/grant-platform-admin.js --grant  <email>',
  '  node scripts/grant-platform-admin.js --revoke <email>',
].join('\n');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.action || (args.action !== 'list' && !args.email)) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    console.error('DATABASE_URL belum diisi.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (args.action === 'list') {
      const { rows } = await pool.query(`
        SELECT email, display_name, last_login_at
        FROM users WHERE is_platform_admin ORDER BY email
      `);
      if (!rows.length) {
        console.log('Belum ada platform admin.');
        return;
      }
      console.log(`${rows.length} platform admin:`);
      for (const row of rows) {
        const seen = row.last_login_at ? new Date(row.last_login_at).toISOString() : 'belum pernah login';
        console.log(`  ${row.email}  (${row.display_name || '—'})  ${seen}`);
      }
      return;
    }

    const grant = args.action === 'grant';
    const { rows } = await pool.query(`
      UPDATE users SET is_platform_admin = $2, updated_at = NOW()
      WHERE LOWER(email) = LOWER($1)
      RETURNING email, display_name
    `, [args.email, grant]);

    if (!rows.length) {
      // Sengaja tidak membuat user baru: peran ini hanya boleh menempel pada
      // akun yang sudah ada dan sudah terverifikasi lewat jalur biasa.
      console.error(`User ${args.email} tidak ditemukan. Daftarkan akunnya dulu lewat aplikasi.`);
      process.exit(1);
    }
    console.log(`${grant ? 'Diberikan' : 'Dicabut'}: ${rows[0].email} (${rows[0].display_name || '—'})`);
    if (!grant) console.log('Sesi yang sedang berjalan ikut kehilangan akses dalam 60 detik.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
