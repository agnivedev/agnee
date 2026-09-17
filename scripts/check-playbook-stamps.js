#!/usr/bin/env node
'use strict';

/**
 * Memastikan tiap berkas SQL yang menulis playbook_docs punya stempel
 * `seed_written_at`, dan stempel itu tidak tertinggal di belakang isinya.
 *
 * KENAPA INI ADA: seed playbook menolak menimpa dokumen yang di database lebih
 * baru dari stempelnya. Pengaman itu hanya sekuat stempelnya — kalau seseorang
 * menyunting isi playbook di berkas seed tapi lupa menaikkan stempelnya,
 * perubahannya diam-diam tidak pernah terpasang di produksi.
 *
 *   node scripts/check-playbook-stamps.js
 *   node scripts/check-playbook-stamps.js --fix
 *
 * KENAPA SIDIK JARI, BUKAN TANGGAL COMMIT (diganti 2026-09-18):
 *
 * Versi sebelumnya membandingkan stempel dengan tanggal commit terakhir yang
 * menyentuh berkasnya. Aturan itu terlihat masuk akal dan ternyata menolak
 * build karena alasan yang tidak ada hubungannya dengan playbook:
 *
 *   1. actions/checkout mengambil kloning dangkal (fetch-depth: 1). Di dalamnya
 *      hanya ada SATU commit, dan commit itu dianggap menyentuh SEMUA berkas —
 *      jadi `git log -1 -- berkas` selalu menjawab HEAD, bahkan untuk berkas
 *      yang tidak ikut berubah sama sekali.
 *   2. Tanggalnya dibandingkan per hari. Commit apa pun yang dibuat lewat
 *      tengah malam, setelah stempel dipasang kemarin, langsung jadi "lebih
 *      baru dari stempel".
 *
 * Gabungan keduanya membuat commit yang tidak menyentuh satu pun berkas seed
 * tetap bisa memerahkan deploy. Itu persis yang terjadi pada a2239f1: fitur
 * /superhuman lolos tes, gagal di sini, dan tidak pernah sampai ke server.
 *
 * Yang sebenarnya ingin dijaga bukan "berapa umur stempelnya", melainkan "isi
 * berkas ini berubah tanpa stempelnya ikut diperbarui". Itu pertanyaan tentang
 * ISI, dan bisa dijawab tanpa git sama sekali: rekam sidik jari isinya di
 * sebelah stempelnya. Pemeriksaannya jadi kebal terhadap kloning dangkal,
 * zona waktu, working tree kotor, dan urutan commit.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Stempelnya boleh tanggal saja atau ISO penuh; yang dibandingkan harinya.
const STAMP_RE = /^\s*seed_written_at CONSTANT TIMESTAMPTZ := '(\d{4}-\d{2}-\d{2})[^']*'/m;
const STAMP_LINE_RE = /^[ \t]*seed_written_at CONSTANT TIMESTAMPTZ := .*$/m;
const SHA_LINE_RE = /^[ \t]*-- seed_content_sha: ([0-9a-f]{64})[ \t]*$/m;
// Varian yang ikut menelan barisnya. Membuang teksnya saja menyisakan baris
// kosong, sehingga sidik jari berkas yang belum punya baris sha tidak akan
// pernah sama dengan sidik jari berkas yang sudah punya — dan pemeriksaannya
// gagal tepat setelah dipasang.
const STAMP_LINE_STRIP = /^[ \t]*seed_written_at CONSTANT TIMESTAMPTZ := .*\n?/m;
const SHA_LINE_STRIP = /^[ \t]*-- seed_content_sha: [0-9a-f]{64}[ \t]*\n?/m;

function readStamp(sql) {
  const match = sql.match(STAMP_RE);
  return match ? match[1] : null;
}

function readSha(sql) {
  const match = sql.match(SHA_LINE_RE);
  return match ? match[1] : null;
}

function writesPlaybookDocs(sql) {
  return /INSERT INTO playbook_docs\b/.test(sql);
}

/**
 * Sidik jari ISI berkas — yaitu segalanya kecuali dua baris yang memang
 * berubah setiap kali distempel ulang.
 *
 * Kalau stempelnya sendiri ikut dihitung, setiap penyetempelan mengubah sidik
 * jarinya, dan tidak ada yang bisa dibandingkan dengan apa pun.
 */
function fingerprint(sql) {
  const body = sql.replace(STAMP_LINE_STRIP, '').replace(SHA_LINE_STRIP, '');
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Hari ini menurut UTC. Stempel yang sedikit ketinggalan aman; yang mendahului tidak. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Menulis ulang stempel dan sidik jari berkas, dan mengembalikan isinya.
 *
 * Stempel tidak pernah dimundurkan. `today()` memakai UTC sedangkan stempel
 * sebelumnya mungkin ditulis menurut waktu lokal yang sudah berganti hari —
 * tanpa penjagaan ini, menjalankan --fix pada pagi WIB justru menarik stempel
 * satu hari ke belakang, dan seed jadi melewati dokumen yang seharusnya ia
 * perbarui. Stempel yang sudah terlanjur di masa depan dibiarkan apa adanya;
 * check() yang melaporkannya, karena itu keputusan yang butuh manusia.
 */
function restamp(sql, day = today()) {
  const current = readStamp(sql);
  const stamp = current && current > day ? current : day;
  let next = sql.replace(STAMP_LINE_RE, (line) =>
    line.replace(/:= '[^']*'/, `:= '${stamp}'`));
  // Baris sidik jari hidup tepat di atas stempelnya supaya keduanya terbaca
  // sebagai satu hal, dan supaya yang menyuntingnya dengan tangan melihat
  // bahwa ada yang harus ikut diperbarui.
  const shaLine = (indent) => `${indent}-- seed_content_sha: ${fingerprint(next)}`;
  if (SHA_LINE_RE.test(next)) {
    next = next.replace(SHA_LINE_RE, (line) => shaLine(line.match(/^[ \t]*/)[0]));
  } else {
    next = next.replace(STAMP_LINE_RE, (line) => `${shaLine(line.match(/^[ \t]*/)[0])}\n${line}`);
  }
  return next;
}

function seedFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => path.join(dir, name))
    .filter((file) => writesPlaybookDocs(fs.readFileSync(file, 'utf8')));
}

function check(dir = 'db') {
  const problems = [];

  for (const file of seedFiles(dir)) {
    const sql = fs.readFileSync(file, 'utf8');

    const stamp = readStamp(sql);
    if (!stamp) {
      problems.push(`${file}: menulis playbook_docs tapi tidak punya seed_written_at — seed ini bisa memundurkan playbook produksi.`);
      continue;
    }

    // Stempel yang mendahului hari ini membuat seed menimpa dokumen produksi
    // yang sebenarnya lebih baru. Satu hari kelonggaran untuk selisih zona
    // waktu antara yang menyetempel dan yang memeriksa.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    if (stamp > tomorrow) {
      problems.push(`${file}: seed_written_at ${stamp} ada di masa depan — seed ini akan menimpa playbook produksi yang lebih baru darinya.`);
      continue;
    }

    const declared = readSha(sql);
    if (!declared) {
      problems.push(`${file}: belum punya baris "-- seed_content_sha:" — jalankan \`npm run playbooks:stamp\` sekali untuk memasangnya.`);
      continue;
    }
    if (declared !== fingerprint(sql)) {
      problems.push(`${file}: isinya berubah tapi stempelnya tidak — jalankan \`npm run playbooks:stamp\`, kalau tidak perubahan ini dilewati di database yang playbooknya lebih baru.`);
    }
  }
  return problems;
}

function fix(dir = 'db') {
  const changed = [];
  for (const file of seedFiles(dir)) {
    const sql = fs.readFileSync(file, 'utf8');
    if (!readStamp(sql)) continue; // tidak ada stempel untuk dinaikkan; check() yang melaporkannya
    const next = restamp(sql);
    if (next !== sql) {
      fs.writeFileSync(file, next);
      changed.push(file);
    }
  }
  return changed;
}

module.exports = { check, fix, readStamp, readSha, writesPlaybookDocs, fingerprint, restamp };

if (require.main === module) {
  if (process.argv.includes('--fix')) {
    const changed = fix();
    if (!changed.length) console.log('✓ stempel seed playbook sudah sinkron — tidak ada yang diubah.');
    for (const file of changed) console.log(`✓ distempel ulang: ${file}`);
    process.exit(0);
  }
  const problems = check();
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length) process.exit(1);
  console.log('✓ stempel seed playbook sinkron dengan isinya.');
}
