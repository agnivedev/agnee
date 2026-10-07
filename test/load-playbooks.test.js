'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('../src/database.js');
const { parsePlaybookFile, loadPlaybooks } = require('../scripts/load-playbooks.js');

const DB_URL = process.env.DATABASE_URL;

function tempFolder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-playbooks-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test('judul yang tidak dikenali menggagalkan pemuatan, tidak ditebak', () => {
  const dir = tempFolder({ 'a.md': '# Judul\n\n## Persona dan gaya bicara\n\nisi\n\n## Catatan penyusun\n\nisi lain\n' });
  assert.throws(() => parsePlaybookFile(path.join(dir, 'a.md')), /judul tidak dikenali: Catatan penyusun/);
});

test('bagian dipetakan ke jenis dari judulnya', () => {
  const dir = tempFolder({ 'a.md': '# Judul\n\n## Persona dan gaya bicara\n\nhalo\n\n## Larangan (patuhi)\n\njangan\n' });
  const docs = parsePlaybookFile(path.join(dir, 'a.md'));
  assert.deepEqual([...docs.keys()], ['persona', 'compliance']);
});

test('simulasi tidak menulis, apply menulis, dan jalan kedua tidak mengubah apa pun', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const slug = `uji-muat-${Date.now()}`;
  const { rows } = await db.pool.query('INSERT INTO companies (name, slug) VALUES ($1, $1) RETURNING id', [slug]);
  const companyId = rows[0].id;
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    await db.close();
  });

  const dir = tempFolder({
    'produk.json': JSON.stringify({
      company: slug, umum: 'umum.md',
      produk: [{ name: 'Layanan A', file: 'a.md', description: 'Deskripsi A' }],
    }),
    'umum.md': '# Umum\n\n## Persona dan gaya bicara\n\numum\n\n## Larangan (patuhi)\n\njangan\n',
    'a.md': '# A\n\n## Persona dan gaya bicara\n\nkhusus A\n\n## Follow-up\n\nsatu kali\n',
  });
  const hitung = async () => (await db.pool.query('SELECT count(*)::int AS n FROM playbook_docs WHERE company_id = $1', [companyId])).rows[0].n;

  const simulasi = await loadPlaybooks(db, dir);
  assert.equal(await hitung(), 0);
  assert.equal(simulasi.report.filter((r) => r.status === 'baru' && r.kind !== 'produk').length, 4);
  assert.equal((await db.listPlaybookProducts(companyId)).length, 0);

  await loadPlaybooks(db, dir, { apply: true });
  assert.equal(await hitung(), 4);
  const produk = (await db.listPlaybookProducts(companyId))[0];
  assert.equal(produk.description, 'Deskripsi A');

  const ulang = await loadPlaybooks(db, dir, { apply: true });
  assert.equal(ulang.report.filter((r) => r.status === 'baru' || r.status === 'berubah').length, 0);
  assert.equal(await hitung(), 4);
});
