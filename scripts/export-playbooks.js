#!/usr/bin/env node
'use strict';

/**
 * Menarik playbook_docs sebuah company dari database ke berkas seed di repo.
 *
 * KENAPA INI ADA: playbook yang disunting langsung di database produksi tidak
 * punya jalur balik ke git. Begitu itu terjadi, berkas seed berubah sifat —
 * dari alat pemulihan menjadi alat pemundur, karena menjalankannya akan
 * menimpa tulisan yang lebih baru dengan tulisan lama. Itu sudah nyaris
 * terjadi sekali (tiga dokumen Trader's Mastermind, mundur lima hari).
 *
 *   node scripts/export-playbooks.js <slug> [--out berkas.sql] [--check]
 *
 * --check tidak menulis apa pun; ia keluar dengan kode 1 kalau berkas di repo
 * sudah berbeda dari database. Cocok dipasang di CI untuk menangkap drift
 * sebelum seseorang menjalankan seed yang usang.
 *
 * DATABASE_URL menentukan database mana yang dibaca. Untuk produksi, jalankan
 * di dalam container app atau lewat terowongan — jangan menaruh kredensial
 * produksi di sini.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const KINDS = ['persona', 'compliance', 'qna', 'discovery', 'objection', 'closing', 'followup', 'handoff'];

function parseArgs(argv) {
  const args = { slug: null, out: null, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--check') args.check = true;
    else if (argv[i] === '--out') { args.out = argv[i + 1]; i += 1; }
    else if (!args.slug) args.slug = argv[i];
  }
  return args;
}

/**
 * Pembatas dollar-quote yang dijamin tidak muncul di dalam teks.
 *
 * Playbook memuat tanda kutip, backslash, dan potongan markdown; membungkusnya
 * dengan kutip biasa akan pecah pada isi yang sah. Kalau $md$ kebetulan ada di
 * dalam teks, tag dinaikkan sampai unik.
 */
function dollarQuote(text) {
  let tag = 'md';
  while (text.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${text}$${tag}$`;
}

function render(slug, rows, writtenAt = new Date().toISOString()) {
  // Stempel penuh sampai detik, bukan tanggal saja: seed melewati dokumen yang
  // di database lebih baru dari stempel ini, jadi stempel yang dibulatkan ke
  // tengah malam membuat ekspor hari ini terlihat lebih tua daripada suntingan
  // pagi tadi — dan perubahannya diam-diam tidak pernah terpasang.
  const stamp = writtenAt.slice(0, 10);
  const head = `-- Playbook ${slug}, ditarik dari database pada ${stamp}.
--
-- DIHASILKAN OLEH scripts/export-playbooks.js — jangan disunting dengan tangan.
-- Sunting playbook lewat aplikasi, lalu jalankan ekspornya lagi. Menyunting
-- berkas ini langsung membuat repo dan database berbeda tanpa ada yang tahu.
--
-- Idempoten: menjalankannya dua kali tidak menaikkan version, karena version
-- hanya naik ketika isinya benar-benar berubah.
--
-- TIDAK BISA MEMUNDURKAN: tiap dokumen hanya ditimpa kalau baris di database
-- belum disunting setelah stempel di bawah. Playbook yang lebih baru dari
-- berkas ini dilewati dan dilaporkan lewat RAISE NOTICE, bukan ditimpa.

DO $seed$
DECLARE
  target_company UUID;
  db_updated TIMESTAMPTZ;
  skipped INTEGER := 0;
  -- Stempel kapan isi berkas ini ditarik dari database. Diperiksa CI lewat
  -- scripts/check-playbook-stamps.js: berkas yang berubah tanpa stempelnya
  -- ikut maju akan menggagalkan build.
  seed_written_at CONSTANT TIMESTAMPTZ := '${writtenAt}'::timestamptz;
BEGIN
  SELECT id INTO target_company FROM companies WHERE slug = ${dollarQuote(slug)};
  IF target_company IS NULL THEN
    RAISE NOTICE 'Company % tidak ada — dilewati.', ${dollarQuote(slug)};
    RETURN;
  END IF;
  IF to_regclass('playbook_docs') IS NULL THEN
    RAISE NOTICE 'playbook_docs belum ada (migrasi 030 belum jalan) — dilewati.';
    RETURN;
  END IF;
`;

  const body = rows.map((row) => `
  SELECT updated_at INTO db_updated FROM playbook_docs
    WHERE company_id = target_company AND kind = ${dollarQuote(row.kind)};
  IF db_updated IS NOT NULL AND db_updated > seed_written_at THEN
    RAISE NOTICE 'playbook % lebih baru di database (% > %) — dilewati, jalankan export-playbooks.js.',
      ${dollarQuote(row.kind)}, db_updated, seed_written_at;
    skipped := skipped + 1;
  ELSE
    INSERT INTO playbook_docs (company_id, kind, content_md)
    VALUES (target_company, ${dollarQuote(row.kind)}, ${dollarQuote(row.contentMd)})
    ON CONFLICT (company_id, kind) DO UPDATE
      SET content_md = EXCLUDED.content_md,
          version    = playbook_docs.version + 1,
          updated_at = NOW()
      WHERE playbook_docs.content_md IS DISTINCT FROM EXCLUDED.content_md;
  END IF;
`).join('');

  const tail = `
  IF skipped > 0 THEN
    RAISE NOTICE '% playbook dilewati karena database lebih baru dari berkas ini.', skipped;
  END IF;
END
$seed$;
`;

  return `${head}${body}${tail}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug) {
    console.error('Pemakaian: node scripts/export-playbooks.js <slug-company> [--out berkas.sql] [--check]');
    process.exit(2);
  }
  // DATABASE_URL kalau ada; kalau tidak, biarkan pg memakai PGHOST/PGUSER/
  // PGPASSWORD/PGDATABASE seperti biasa. Container produksi memakai bentuk
  // kedua, jadi mensyaratkan DATABASE_URL membuat skrip ini tidak bisa
  // dijalankan justru di tempat yang datanya paling penting.
  const pool = new Pool(
    process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {},
  );
  try {
    const company = await pool.query('SELECT id FROM companies WHERE slug = $1', [args.slug]);
    if (!company.rows.length) {
      console.error(`Company "${args.slug}" tidak ditemukan.`);
      process.exit(1);
    }
    const result = await pool.query(`
      SELECT kind, content_md AS "contentMd"
      FROM playbook_docs
      WHERE company_id = $1 AND btrim(content_md) <> ''
    `, [company.rows[0].id]);

    // Urutan tetap mengikuti urutan baca di getPlaybookContext, bukan urutan
    // baris dari database: tanpa itu, dua ekspor dari isi yang sama bisa
    // menghasilkan berkas berbeda dan --check jadi berisik.
    const rows = KINDS
      .map((kind) => result.rows.find((row) => row.kind === kind))
      .filter(Boolean);

    if (!rows.length) {
      console.error(`Tidak ada playbook terisi untuk "${args.slug}".`);
      process.exit(1);
    }

    const outPath = path.resolve(args.out || `db/playbooks_${args.slug.replace(/[^\w-]/g, '_')}.sql`);
    const next = render(args.slug, rows);

    if (args.check) {
      const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
      // Dua baris tanggal berubah tiap ekspor; yang diperiksa isinya, bukan
      // stempelnya. Stempel sendiri dijaga scripts/check-playbook-stamps.js.
      const strip = (text) => String(text)
        .replace(/^-- Playbook .*ditarik dari database pada .*$/m, '')
        .replace(/^ *seed_written_at CONSTANT TIMESTAMPTZ := .*$/m, '');
      if (current !== null && strip(current) === strip(next)) {
        console.log(`✓ ${path.relative(process.cwd(), outPath)} sama dengan database.`);
        return;
      }
      console.error(`✗ ${path.relative(process.cwd(), outPath)} BERBEDA dari database.`);
      console.error('  Jalankan tanpa --check untuk menariknya, lalu commit.');
      process.exit(1);
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, next);
    console.log(`${rows.length} playbook → ${path.relative(process.cwd(), outPath)}`);
    for (const row of rows) console.log(`  ${row.kind.padEnd(11)} ${row.contentMd.length} char`);
  } finally {
    await pool.end();
  }
}

module.exports = { render };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
