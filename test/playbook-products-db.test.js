'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';

async function withCompanies(t, fn) {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const made = [];
  for (const label of ['a', 'b']) {
    const { rows } = await db.pool.query(
      'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id',
      [`Uji produk ${label}`, `uji-produk-${label}-${stamp}`],
    );
    made.push(rows[0].id);
  }
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [made]);
    await db.close();
  });
  await fn(db, made[0], made[1]);
}

test('follow-up memakai playbook produk percakapan itu, lalu jatuh ke playbook umum', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const produkA = await db.createPlaybookProduct({ name: 'Layanan A' }, null, companyId);
    const produkB = await db.createPlaybookProduct({ name: 'Layanan B' }, null, companyId);
    await db.savePlaybookDoc({ kind: 'followup', contentMd: 'umum' }, null, companyId);
    await db.savePlaybookDoc({ kind: 'followup', contentMd: 'khusus A', productId: produkA.id }, null, companyId);
    await db.savePlaybookDoc({ kind: 'followup', contentMd: 'khusus B', productId: produkB.id }, null, companyId);

    await db.setChatProduct({ chatId: 'chat-a', productId: produkA.id, source: 'auto' }, null, companyId);
    await db.setChatProduct({ chatId: 'chat-b', productId: produkB.id, source: 'auto' }, null, companyId);

    assert.equal((await db.getPlaybookDocForChat('followup', 'chat-a', companyId)).contentMd, 'khusus A');
    assert.equal((await db.getPlaybookDocForChat('followup', 'chat-b', companyId)).contentMd, 'khusus B');
    assert.equal((await db.getPlaybookDocForChat('followup', 'chat-baru', companyId)).contentMd, 'umum');

    await db.updatePlaybookProduct(produkB.id, { active: false }, companyId);
    assert.equal((await db.getPlaybookDocForChat('followup', 'chat-b', companyId)).contentMd, 'umum');
    assert.equal(await db.getChatProduct('chat-b', companyId), null);
  });
});

test('produk tanpa dokumen untuk jenis itu memakai playbook umum', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const produk = await db.createPlaybookProduct({ name: 'Layanan C' }, null, companyId);
    await db.savePlaybookDoc({ kind: 'followup', contentMd: 'umum' }, null, companyId);
    await db.setChatProduct({ chatId: 'chat-c', productId: produk.id, source: 'auto' }, null, companyId);
    assert.equal((await db.getPlaybookDocForChat('followup', 'chat-c', companyId)).contentMd, 'umum');
  });
});

test('tebakan otomatis tidak menimpa pilihan manual, sebaliknya boleh', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const a = await db.createPlaybookProduct({ name: 'Layanan A' }, null, companyId);
    const b = await db.createPlaybookProduct({ name: 'Layanan B' }, null, companyId);

    await db.setChatProduct({ chatId: 'c1', productId: a.id, source: 'manual' }, null, companyId);
    await db.setChatProduct({ chatId: 'c1', productId: b.id, source: 'auto' }, null, companyId);
    assert.equal((await db.getChatProduct('c1', companyId)).productId, a.id);

    await db.setChatProduct({ chatId: 'c1', productId: b.id, source: 'manual' }, null, companyId);
    assert.equal((await db.getChatProduct('c1', companyId)).productId, b.id);

    await db.setChatProduct({ chatId: 'c1', productId: null, source: 'manual' }, null, companyId);
    assert.equal(await db.getChatProduct('c1', companyId), null);
  });
});

test('menyimpan playbook umum dua kali tidak menggandakan baris', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    await db.savePlaybookDoc({ kind: 'persona', contentMd: 'satu' }, null, companyId);
    await db.savePlaybookDoc({ kind: 'persona', contentMd: 'dua' }, null, companyId);
    const { rows } = await db.pool.query(
      "SELECT content_md, version FROM playbook_docs WHERE company_id = $1 AND kind = 'persona'", [companyId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].content_md, 'dua');
    assert.equal(rows[0].version, 2);
  });
});

test('produk satu company tidak bisa dipakai company lain', { skip }, async (t) => {
  await withCompanies(t, async (db, companyA, companyB) => {
    const produk = await db.createPlaybookProduct({ name: 'Layanan A' }, null, companyA);
    assert.equal(await db.getPlaybookProduct(produk.id, companyB), null);
    await assert.rejects(
      db.setChatProduct({ chatId: 'chat-x', productId: produk.id, source: 'manual' }, null, companyB),
    );
    await assert.rejects(
      db.savePlaybookDoc({ kind: 'followup', contentMd: 'x', productId: produk.id }, null, companyB),
    );
  });
});

test('nama produk sama dalam satu company ditolak, antar company boleh', { skip }, async (t) => {
  await withCompanies(t, async (db, companyA, companyB) => {
    await db.createPlaybookProduct({ name: 'Layanan A' }, null, companyA);
    await assert.rejects(db.createPlaybookProduct({ name: '  layanan a ' }, null, companyA), { code: '23505' });
    await db.createPlaybookProduct({ name: 'Layanan A' }, null, companyB);
  });
});
