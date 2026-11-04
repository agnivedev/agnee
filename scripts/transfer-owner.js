#!/usr/bin/env node
'use strict';

/**
 * Memindahkan owner sebuah company ke akun yang SUDAH ada, termasuk akun
 * platform admin (yang ditolak oleh addExistingUserToCompany). Owner lama
 * dinonaktifkan dari company itu (bukan dihapus; bisa diaktifkan lagi).
 *
 *   node scripts/transfer-owner.js --company contoh --from owner-lama@contoh.com --to owner-baru@contoh.com
 *
 * Tanpa --apply hanya simulasi (rollback).
 */

const Database = require('../src/database');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const company = arg('--company');
  const from = arg('--from');
  const to = arg('--to');
  const apply = process.argv.includes('--apply');
  if (!company || !from || !to) {
    console.error('Pemakaian: node scripts/transfer-owner.js --company <slug> --from <email> --to <email> [--apply]');
    process.exit(1);
  }
  const database = new Database();
  if (!database.enabled) {
    console.error('DATABASE_URL / PGHOST belum diisi.');
    process.exit(1);
  }
  const client = await database.pool.connect();
  try {
    const companyId = await database.resolveCompanyId(company);
    if (!companyId) throw new Error(`Company "${company}" tidak ditemukan.`);
    await client.query('BEGIN');
    const users = (await client.query(
      'SELECT id, LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1)',
      [[from.toLowerCase(), to.toLowerCase()]],
    )).rows;
    const fromUser = users.find((u) => u.email === from.toLowerCase());
    const toUser = users.find((u) => u.email === to.toLowerCase());
    if (!fromUser) throw new Error(`${from} tidak ditemukan.`);
    if (!toUser) throw new Error(`${to} tidak ditemukan.`);

    // Nonaktifkan owner lama dulu supaya kursi dilepas sebelum yang baru masuk.
    const off = await client.query(
      `UPDATE company_members SET status = 'suspended', updated_at = NOW()
       WHERE company_id = $1 AND user_id = $2 RETURNING role`, [companyId, fromUser.id]);
    if (!off.rowCount) throw new Error(`${from} bukan anggota company ini.`);

    const seats = (await client.query(
      `SELECT COUNT(*)::int AS taken, (SELECT max_users FROM companies WHERE id = $1) AS max
       FROM company_members WHERE company_id = $1 AND status = 'active' AND user_id <> $2`,
      [companyId, toUser.id])).rows[0];
    if (seats.max > 0 && seats.taken >= seats.max) throw new Error(`Kursi penuh (${seats.max}).`);

    await client.query(`
      INSERT INTO company_members (company_id, user_id, role, status, joined_at)
      VALUES ($1, $2, 'owner', 'active', NOW())
      ON CONFLICT (company_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = NOW()
    `, [companyId, toUser.id]);

    if (apply) {
      await client.query('COMMIT');
      console.log(`Selesai: ${to} jadi owner ${company}; ${from} dinonaktifkan.`);
    } else {
      await client.query('ROLLBACK');
      console.log(`SIMULASI OK (tidak ada yang berubah): ${to} akan jadi owner ${company}; ${from} dinonaktifkan. Tambahkan --apply untuk menjalankan.`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Gagal:', error?.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
    await database.pool.end();
  }
}

main();
