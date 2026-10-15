#!/usr/bin/env node
// Kirim hasil bacaan portal IB (robot Anduman) ke Agnee: POST /webhook/lead-verify.
//
//   LEAD_VERIFY_URL=https://app.agnee.agnive.co/webhook/lead-verify \
//   LEAD_VERIFY_SECRET=... \
//   node scripts/lead-verify-push.mjs --broker exness --file result.json [--dry-run]
//
// result.json boleh berupa array baris, atau objek { rows: [...] } seperti output
// playbook_runner Anduman. Kolom yang dikenali per baris (huruf besar/kecil bebas):
//   email | client_email           -> email klien
//   account | account_number | login | trading_account  -> nomor account MT4/MT5
//   registered_at | registration_date | date              -> opsional
// Baris tanpa email dan tanpa nomor account dilewati. Secret hanya dari
// environment, tidak pernah dari argumen atau file.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX_ROWS = 500;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function pick(row, names) {
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]));
  for (const n of names) if (lower[n] !== undefined && lower[n] !== null && String(lower[n]).trim() !== '') return String(lower[n]).trim();
  return '';
}

export function buildRegistrations(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const email = pick(row, ['email', 'client_email']);
    const accountNumber = pick(row, ['account', 'account_number', 'login', 'trading_account']).replace(/\D/g, '');
    if (!email && !accountNumber) continue;
    const registeredAt = pick(row, ['registered_at', 'registration_date', 'date']);
    out.push({ ...(email ? { email } : {}), ...(accountNumber ? { accountNumber } : {}), ...(registeredAt ? { registeredAt } : {}) });
  }
  return out;
}

export function signRequest(secret, body, timestamp = Date.now()) {
  const raw = JSON.stringify(body);
  const signature = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return { raw, headers: { 'content-type': 'application/json', 'x-agnive-timestamp': String(timestamp), 'x-agnive-signature': signature } };
}

async function main() {
  const broker = arg('broker');
  const file = arg('file');
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.LEAD_VERIFY_URL;
  const secret = process.env.LEAD_VERIFY_SECRET;
  if (!broker || !file) throw new Error('Pakai: --broker <exness|tmgm|...> --file <result.json> [--dry-run]');
  const registrations = buildRegistrations(JSON.parse(readFileSync(file, 'utf8')));
  if (!registrations.length) throw new Error('Tidak ada baris dengan email atau nomor account.');
  const batches = [];
  for (let i = 0; i < registrations.length; i += MAX_ROWS) batches.push(registrations.slice(i, i + MAX_ROWS));
  if (dryRun) {
    console.log(JSON.stringify({ broker, rows: registrations.length, batches: batches.length }));
    return;
  }
  if (!url || !secret) throw new Error('LEAD_VERIFY_URL dan LEAD_VERIFY_SECRET wajib diisi di environment.');
  for (const batch of batches) {
    const { raw, headers } = signRequest(secret, { version: 1, source: 'anduman', broker, registrations: batch });
    const res = await fetch(url, { method: 'POST', headers, body: raw });
    const text = await res.text();
    console.log(`${res.status} ${text}`);
    if (!res.ok) process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
