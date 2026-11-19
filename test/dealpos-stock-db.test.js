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
    'INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [`stok-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`],
  )).rows[0].id;
  t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]); await db.close(); });
  return { db, companyId };
}

const mk = (id, name) => ({ externalId: id, productId: 'p', code: id, name, category: 'B', price: 1000, discountPct: 0, imageUrl: null, releasedAt: null });

test('syncPosCatalog menyimpan stok per varian: nol tersimpan nol, varian tak dipantau NULL', { skip }, async (t) => {
  const { db, companyId } = await setup(t);
  const items = [mk('v-hijau', 'KAWAT HIJAU'), mk('v-biru', 'KAWAT BIRU'), mk('v-jasa', 'JASA')];
  await db.syncPosCatalog(companyId, 'dealpos', items, { stock: new Map([['v-hijau', 0], ['v-biru', 25]]) });
  const rows = (await db.pool.query(
    'SELECT external_id, stock_available::float8 AS stock, stock_synced_at FROM catalog_items WHERE company_id = $1 ORDER BY external_id', [companyId],
  )).rows;
  const by = Object.fromEntries(rows.map((r) => [r.external_id, r]));
  assert.equal(by['v-hijau'].stock, 0);
  assert.equal(by['v-biru'].stock, 25);
  assert.equal(by['v-jasa'].stock, null);
  assert.ok(by['v-biru'].stock_synced_at);
});

test('syncPosCatalog tanpa stok (tarikan gagal) tidak menimpa stok lama', { skip }, async (t) => {
  const { db, companyId } = await setup(t);
  const items = [mk('v1', 'KAWAT')];
  await db.syncPosCatalog(companyId, 'dealpos', items, { stock: new Map([['v1', 7]]) });
  await db.syncPosCatalog(companyId, 'dealpos', items, { stock: null });
  const row = (await db.pool.query('SELECT stock_available::float8 AS stock FROM catalog_items WHERE company_id = $1', [companyId])).rows[0];
  assert.equal(row.stock, 7);
});

test('replaceDealposProducts menyimpan stok dan listDealposProducts membacanya', { skip }, async (t) => {
  const { db, companyId } = await setup(t);
  await db.pool.query(
    "INSERT INTO dealpos_connections (company_id, host, client_id, client_secret_enc, enabled) VALUES ($1, 'toko.dealpos.co.id', 'c', pgp_sym_encrypt('s', $2), true)",
    [companyId, db.credentialsEncryptionKey],
  );
  await db.replaceDealposProducts(companyId, [
    { variantId: 'a', code: 'A', name: 'A', category: null, unit: 'pcs', unitPrice: 10, stock: 0 },
    { variantId: 'b', code: 'B', name: 'B', category: null, unit: 'pcs', unitPrice: 10, stock: 5 },
    { variantId: 'c', code: 'C', name: 'C', category: null, unit: 'pcs', unitPrice: 10 },
  ]);
  const { products } = await db.listDealposProducts(companyId);
  const by = Object.fromEntries(products.map((p) => [p.variantId, p]));
  assert.equal(by.a.stock, 0);
  assert.equal(by.b.stock, 5);
  assert.equal(by.c.stock, null);
});

test('listCatalogForAi membawa stok dan waktunya', { skip }, async (t) => {
  const { db, companyId } = await setup(t);
  await db.pool.query(
    "INSERT INTO dealpos_connections (company_id, host, client_id, client_secret_enc, enabled) VALUES ($1, 'toko.dealpos.co.id', 'c', pgp_sym_encrypt('s', $2), true)",
    [companyId, db.credentialsEncryptionKey],
  );
  await db.getCatalogSettings(companyId);
  await db.pool.query('UPDATE catalog_settings SET ai_enabled = true WHERE company_id = $1', [companyId]);
  await db.syncPosCatalog(companyId, 'dealpos', [mk('v1', 'KAWAT HIJAU')], { stock: new Map([['v1', 0]]) });
  const { items } = await db.listCatalogForAi(companyId);
  assert.equal(items.length, 1);
  assert.equal(items[0].stock, 0);
  assert.ok(items[0].stockSyncedAt);
});
