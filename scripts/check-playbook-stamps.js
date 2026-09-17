#!/usr/bin/env node
'use strict';

/**
 * Memastikan tiap berkas SQL yang menulis playbook_docs punya stempel
 * `seed_written_at`, dan stempel itu tidak tertinggal di belakang isinya.
 *
 * KENAPA INI ADA: seed playbook sekarang menolak menimpa dokumen yang di
 * database lebih baru dari stempelnya. Pengaman itu hanya sekuat stempelnya —
 * kalau seseorang menyunting isi playbook di berkas seed tapi lupa menaikkan
 * stempelnya, perubahannya diam-diam tidak pernah terpasang di produksi.
 * Pemeriksaan ini menangkapnya di CI, bukan di produksi.
 *
 *   node scripts/check-playbook-stamps.js
 *
 * Aturannya: tanggal commit terakhir yang menyentuh berkas tidak boleh lebih
 * baru dari stempelnya (dibandingkan per hari, UTC). Perubahan yang belum
 * di-commit tidak diperiksa — commit-nya yang akan memicu kegagalan.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Stempelnya boleh tanggal saja atau ISO penuh; yang dibandingkan harinya.
const STAMP_RE = /^\s*seed_written_at CONSTANT TIMESTAMPTZ := '(\d{4}-\d{2}-\d{2})[^']*'/m;

function readStamp(sql) {
  const match = sql.match(STAMP_RE);
  return match ? match[1] : null;
}

function writesPlaybookDocs(sql) {
  return /INSERT INTO playbook_docs\b/.test(sql);
}

function lastCommitDay(file) {
  const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { encoding: 'utf8' }).trim();
  // Berkas yang belum pernah di-commit tidak punya tanggal commit; tidak ada
  // yang bisa dibandingkan, jadi dianggap lolos.
  return out ? out.slice(0, 10) : null;
}

function check(dir = 'db') {
  const problems = [];
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => path.join(dir, name));

  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8');
    if (!writesPlaybookDocs(sql)) continue;

    const stamp = readStamp(sql);
    if (!stamp) {
      problems.push(`${file}: menulis playbook_docs tapi tidak punya seed_written_at — seed ini bisa memundurkan playbook produksi.`);
      continue;
    }
    const commitDay = lastCommitDay(file);
    if (commitDay && commitDay > stamp) {
      problems.push(`${file}: isinya diubah ${commitDay} tapi seed_written_at masih ${stamp} — naikkan stempelnya, kalau tidak perubahan ini dilewati di database yang playbooknya lebih baru.`);
    }
  }
  return problems;
}

module.exports = { check, readStamp, writesPlaybookDocs };

if (require.main === module) {
  const problems = check();
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length) process.exit(1);
  console.log('✓ stempel seed playbook sinkron dengan isinya.');
}
