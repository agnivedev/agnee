'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const os = require('node:os');

const { render } = require('../scripts/export-playbooks.js');
const {
  check, fix, readStamp, readSha, writesPlaybookDocs, fingerprint, restamp,
} = require('../scripts/check-playbook-stamps.js');

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

// ── Pemeriksaan stempel: apa yang boleh dan tidak boleh memerahkan CI ───────
//
// Aturan lama membandingkan stempel dengan tanggal commit terakhir, dan itu
// memerahkan deploy karena hal-hal yang tidak ada hubungannya dengan playbook:
// kloning dangkal di CI membuat SETIAP berkas terlihat disentuh HEAD, dan
// tanggal yang dibandingkan per hari membuat commit lewat tengah malam selalu
// "lebih baru dari stempel". Tes di bawah mengunci perilaku penggantinya.

function seedFixture(dir, { stamp = '2020-01-01', body = 'isi awal' } = {}) {
  const file = path.join(dir, 'seed_acme.sql');
  fs.writeFileSync(file, [
    '-- Playbook acme',
    'DO $seed$',
    'DECLARE',
    `  seed_written_at CONSTANT TIMESTAMPTZ := '${stamp}'::timestamptz;`,
    'BEGIN',
    `  INSERT INTO playbook_docs (content_md) VALUES ($md$${body}$md$);`,
    'END $seed$;',
    '',
  ].join('\n'));
  return file;
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnee-stamp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('stempel tua tapi isi tidak berubah: LOLOS — umur stempel bukan urusannya', (t) => {
  const dir = tempDir(t);
  seedFixture(dir, { stamp: '2020-01-01' });
  fix(dir);

  // Inilah regresi yang dulu menahan deploy: stempelnya bertahun-tahun lalu,
  // tapi tidak ada satu pun isi yang berubah sejak distempel.
  assert.deepEqual(check(dir), []);
});

test('isi berubah tanpa distempel ulang: GAGAL', (t) => {
  const dir = tempDir(t);
  const file = seedFixture(dir);
  fix(dir);
  assert.deepEqual(check(dir), []);

  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('isi awal', 'isi baru'));
  const problems = check(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /isinya berubah tapi stempelnya tidak/);

  // Dan satu perintah mengembalikannya ke hijau.
  assert.equal(fix(dir).length, 1);
  assert.deepEqual(check(dir), []);
});

test('menstempel ulang bersifat idempoten — jalan kedua tidak mengubah apa pun', (t) => {
  const dir = tempDir(t);
  const file = seedFixture(dir);
  fix(dir);
  const after = fs.readFileSync(file, 'utf8');
  assert.deepEqual(fix(dir), []);
  assert.equal(fs.readFileSync(file, 'utf8'), after);
});

test('sidik jari tidak bergantung pada stempel maupun barisnya sendiri', (t) => {
  const dir = tempDir(t);
  const bare = fs.readFileSync(seedFixture(dir, { stamp: '2020-01-01' }), 'utf8');

  // Berkas tanpa baris sha dan berkas yang sudah distempel harus punya sidik
  // jari yang sama — kalau tidak, memasangnya sendiri yang menggagalkan CI.
  assert.equal(fingerprint(bare), fingerprint(restamp(bare)));
  assert.equal(fingerprint(bare), fingerprint(restamp(bare, '2031-12-31')));
  assert.match(readSha(restamp(bare)) || '', /^[0-9a-f]{64}$/);
});

test('stempel di masa depan: GAGAL — seed itu akan menimpa playbook produksi yang lebih baru', (t) => {
  const dir = tempDir(t);
  // Sengaja tanpa fix(): menstempel ulang justru akan menurunkannya ke hari
  // ini, dan yang diuji di sini adalah berkas yang stempelnya sudah telanjur
  // ditulis tangan ke masa depan.
  seedFixture(dir, { stamp: '2099-01-01' });
  const problems = check(dir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ada di masa depan/);
});

test('seed tanpa stempel sama sekali: GAGAL', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'seed_tanpa_stempel.sql');
  fs.writeFileSync(file, 'INSERT INTO playbook_docs (content_md) VALUES ($md$x$md$);\n');
  assert.match(check(dir)[0], /tidak punya seed_written_at/);
});

test('berkas hasil render() sudah membawa sidik jarinya sendiri', () => {
  // Alur normal — ekspor lalu commit — tidak boleh pernah menghasilkan berkas
  // yang gagal di CI. Kalau ini putus, setiap ekspor jadi satu deploy merah.
  const stamped = restamp(render('acme', [{ kind: 'persona', contentMd: '# Persona\n' }], '2026-01-02'));
  assert.match(readSha(stamped) || '', /^[0-9a-f]{64}$/);
  assert.equal(readSha(stamped), fingerprint(stamped));
});
