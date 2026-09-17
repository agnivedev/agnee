'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { render } = require('../scripts/export-playbooks.js');
const { readStamp, writesPlaybookDocs } = require('../scripts/check-playbook-stamps.js');

const DB_DIR = path.join(__dirname, '..', 'db');

function seedFilesWithPlaybooks() {
  return fs.readdirSync(DB_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => path.join(DB_DIR, name))
    .filter((file) => writesPlaybookDocs(fs.readFileSync(file, 'utf8')));
}

test('setiap seed yang menulis playbook_docs punya stempel dan pagar anti-mundur', () => {
  const files = seedFilesWithPlaybooks();
  assert.ok(files.length > 0, 'tidak ada seed playbook yang ditemukan — pemeriksaan ini jadi tidak berarti');

  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8');
    assert.match(readStamp(sql) || '', /^\d{4}-\d{2}-\d{2}$/, `${file} tidak punya seed_written_at`);
    // Pagar itu sendiri: seed harus membandingkan updated_at database dengan
    // stempelnya sebelum menimpa. Tanpa baris ini, stempelnya cuma hiasan.
    assert.match(sql, /db_updated > seed_written_at/, `${file} tidak membandingkan updated_at dengan stempelnya`);
  }
});

test('render() menghasilkan seed yang melewati dokumen yang lebih baru di database', () => {
  const sql = render('acme', [{ kind: 'persona', contentMd: '# Persona\n' }], '2026-01-02');

  assert.match(sql, /seed_written_at CONSTANT TIMESTAMPTZ := '2026-01-02'::timestamptz;/);
  assert.match(sql, /IF db_updated IS NOT NULL AND db_updated > seed_written_at THEN/);
  // Dilewati, bukan ditimpa: RAISE NOTICE harus ada di cabang itu.
  assert.match(sql, /dilewati/);
  assert.ok(writesPlaybookDocs(sql));
  assert.equal(readStamp(sql), '2026-01-02');
});

test('render() tetap membungkus isi playbook yang memuat $md$ dengan tag unik', () => {
  const sql = render('acme', [{ kind: 'qna', contentMd: 'harga $md$ aneh' }], '2026-01-02');
  assert.match(sql, /\$mdx\$harga \$md\$ aneh\$mdx\$/);
});
