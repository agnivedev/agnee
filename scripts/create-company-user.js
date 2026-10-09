#!/usr/bin/env node
'use strict';

/**
 * Membuat company baru beserta owner (supervisor) dan, kalau diminta, satu
 * agent CS manusia. Password dibuat acak dan dicetak SEKALI ke terminal —
 * tidak disimpan di file mana pun.
 *
 *   node scripts/create-company-user.js \
 *     --company "Citilux" --plan company \
 *     --owner citilux2000@gmail.com --owner-name "Citilux" \
 *     --agent cscitilux@gmail.com   --agent-name "CS Citilux"
 *
 * --plan personal membatasi 1 pengguna, jadi agent hanya bisa ditambah dengan
 * --plan company (5 pengguna). Tanpa --agent, hanya owner yang dibuat.
 *
 * DATABASE_URL (atau PGHOST/PGUSER/PGPASSWORD) menentukan database mana yang
 * disentuh. Untuk produksi, jalankan di dalam container app.
 */

const crypto = require('node:crypto');
const Database = require('../src/database');

function parseArgs(argv) {
  const args = { plan: 'company' };
  const keys = {
    '--company': 'company', '--plan': 'plan',
    '--owner': 'owner', '--owner-name': 'ownerName',
    '--agent': 'agent', '--agent-name': 'agentName',
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys[argv[i]];
    if (!key || argv[i + 1] === undefined) return null;
    args[key] = argv[i + 1];
  }
  return args;
}

function randomPassword() {
  // 18 karakter dari alfabet tanpa karakter yang mudah tertukar (0/O, 1/l/I).
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 18; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args || !args.company || !args.owner || !['personal', 'company'].includes(args.plan)) {
    console.error('Pemakaian: node scripts/create-company-user.js --company <nama> --plan <personal|company> --owner <email> [--owner-name <nama>] [--agent <email>] [--agent-name <nama>]');
    process.exit(1);
  }
  if (args.agent && args.plan === 'personal') {
    console.error('Paket personal hanya 1 pengguna. Pakai --plan company untuk menambah agent.');
    process.exit(1);
  }

  const database = new Database();
  if (!database.enabled) {
    console.error('DATABASE_URL / PGHOST belum diisi.');
    process.exit(1);
  }

  const created = [];
  try {
    const ownerPassword = randomPassword();
    const signup = await database.createCompanySignup({
      companyName: args.company,
      plan: args.plan,
      displayName: args.ownerName || args.company,
      email: args.owner.trim().toLowerCase(),
      password: ownerPassword,
    });
    created.push({ role: 'owner (supervisor)', email: signup.email, password: ownerPassword });

    if (args.agent) {
      const agentPassword = randomPassword();
      const member = await database.createTeamMember({
        email: args.agent.trim().toLowerCase(),
        displayName: args.agentName || `CS ${args.company}`,
        password: agentPassword,
        role: 'agent',
      }, signup.companyId);
      created.push({ role: 'agent', email: member.email, password: agentPassword });
    }

    console.log(`Company "${signup.companyName}" (slug: ${signup.companySlug}), trial sampai ${new Date(signup.trialEndsAt).toISOString()}`);
    for (const row of created) console.log(`${row.role.padEnd(18)} ${row.email}  password: ${row.password}`);
    console.log('Simpan password ini sekarang — tidak ditampilkan lagi.');
  } catch (error) {
    if (error?.code === 'EMAIL_TAKEN') console.error(`Gagal: ${error.message}`);
    else console.error('Gagal:', error?.message || error);
    if (created.length) console.error('Catatan: sebagian sudah terbuat:', created.map((c) => c.email).join(', '));
    process.exitCode = 1;
  } finally {
    await database.pool.end();
  }
}

main();
