'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';

async function setup(t) {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const companyId = (await db.pool.query(
    'INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [`cat-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`],
  )).rows[0].id;
  t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]); await db.close(); });
  const add = async (item) => (await db.pool.query(`
    INSERT INTO catalog_items (company_id, source, external_id, name, price, discount_pct, sold_qty, released_at, active, missing_from_source)
    VALUES ($1, $2, $3, $4, 1000, $5, $6, $7, $8, $9) RETURNING id
  `, [companyId, item.source || 'dealpos', item.source === 'manual' ? null : item.name, item.name, item.discountPct ?? 0,
    item.soldQty ?? null, item.releasedAt ?? null, item.active ?? true, item.missing ?? false])).rows[0].id;
  const tagged = async (rule) => (await db.pool.query(`
    SELECT i.name FROM catalog_item_tags it JOIN catalog_tags t ON t.id = it.tag_id JOIN catalog_items i ON i.id = it.item_id
    WHERE it.company_id = $1 AND t.auto_rule = $2 AND it.source = 'auto' ORDER BY i.name
  `, [companyId, rule])).rows.map((r) => r.name);
  return { db, companyId, add, tagged };
}

test('kategorikan otomatis: Best Seller, Promo, Baru untuk item manual dan POS', { skip }, async (t) => {
  const { db, companyId, add, tagged } = await setup(t);
  await db.saveCatalogSettings(companyId, { bestSellerCount: 2, newDays: 30 });
  const old = new Date(Date.now() - 90 * 86_400_000);
  const recent = new Date(Date.now() - 5 * 86_400_000);
  await add({ name: 'A laris', soldQty: 500 });
  await add({ name: 'B laris', soldQty: 300, discountPct: 10 });
  await add({ name: 'C biasa', soldQty: 10 });
  await add({ name: 'D baru POS', releasedAt: recent });
  await add({ name: 'E lawas POS', releasedAt: old });
  await add({ name: 'F tanpa rilis' });
  await add({ name: 'G manual baru', source: 'manual' });
  await add({ name: 'H disembunyikan', soldQty: 9999, discountPct: 50, active: false });
  await add({ name: 'I hilang', soldQty: 9999, missing: true });

  const counts = await db.applyCatalogAutoTags(companyId);
  assert.deepEqual(counts, { best_seller: 2, promo: 1, new: 2 });
  assert.deepEqual(await tagged('best_seller'), ['A laris', 'B laris']);
  assert.deepEqual(await tagged('promo'), ['B laris']);
  assert.deepEqual(await tagged('new'), ['D baru POS', 'G manual baru']);

  // Dijalankan ulang tidak menggandakan; ribbon manual tidak disentuh.
  const manualTag = (await db.pool.query("SELECT id FROM catalog_tags WHERE company_id = $1 AND auto_rule IS NULL LIMIT 1", [companyId])).rows[0].id;
  const c = (await db.pool.query("SELECT id FROM catalog_items WHERE company_id = $1 AND name = 'C biasa'", [companyId])).rows[0].id;
  await db.pool.query("INSERT INTO catalog_item_tags (company_id, item_id, tag_id, source) VALUES ($1, $2, $3, 'manual')", [companyId, c, manualTag]);
  assert.deepEqual(await db.applyCatalogAutoTags(companyId), { best_seller: 2, promo: 1, new: 2 });
  assert.equal((await db.pool.query("SELECT COUNT(*)::int n FROM catalog_item_tags WHERE company_id = $1 AND source = 'manual'", [companyId])).rows[0].n, 1);
});

test('kategorikan otomatis: tanpa data penjualan, Best Seller lama dibiarkan', { skip }, async (t) => {
  const { db, companyId, add, tagged } = await setup(t);
  await add({ name: 'Manual baru', source: 'manual' });
  const counts = await db.applyCatalogAutoTags(companyId);
  assert.equal(counts.best_seller, null);
  assert.deepEqual(await tagged('best_seller'), []);
  assert.deepEqual(await tagged('new'), ['Manual baru']);
});
