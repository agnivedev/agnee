#!/usr/bin/env node
'use strict';

/**
 * Menambah satu anggota ke company yang sudah ada. Password acak dicetak
 * SEKALI ke terminal, tidak disimpan di mana pun.
 *
 *   node scripts/add-team-member.js --company contoh --email cs1@contoh.com --name Nama [--role agent]
 */

const crypto = require('node:crypto');
const Database = require('../src/database');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 18; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

async function main() {
  const company = arg('--company');
  const email = arg('--email');
  if (!company || !email) {
    console.error('Pemakaian: node scripts/add-team-member.js --company <slug> --email <email> [--name <nama>] [--role agent]');
    process.exit(1);
  }
  const database = new Database();
  if (!database.enabled) {
    console.error('DATABASE_URL / PGHOST belum diisi.');
    process.exit(1);
  }
  try {
    const companyId = await database.resolveCompanyId(company);
    if (!companyId) {
      console.error(`Company "${company}" tidak ditemukan.`);
      process.exitCode = 1;
      return;
    }
    const password = randomPassword();
    const member = await database.createTeamMember({
      email: email.trim().toLowerCase(),
      displayName: arg('--name') || email,
      password,
      role: arg('--role') || 'agent',
    }, companyId);
    console.log(`${(arg('--role') || 'agent').padEnd(18)} ${member.email}  password: ${password}`);
    console.log('Simpan password ini sekarang — tidak ditampilkan lagi.');
  } catch (error) {
    console.error('Gagal:', error?.message || error);
    process.exitCode = 1;
  } finally {
    await database.pool.end();
  }
}

main();
