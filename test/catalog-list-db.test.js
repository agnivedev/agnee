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
    'INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [`cat-list-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`],
  )).rows[0].id;
  t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]); await db.close(); });
  const add = (item) => db.pool.query(`
    INSERT INTO catalog_items (company_id, source, external_id, kind, name, code, category, unit, price, discount_pct, sold_qty, active, missing_from_source, brand)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id
  `, [companyId, item.source || 'dealpos', item.externalId ?? null, item.kind || 'product', item.name, item.code ?? null, item.category ?? null,
    item.unit ?? null, item.price ?? null, item.discountPct ?? 0, item.soldQty ?? null, item.active ?? true, item.missing ?? false, item.brand ?? null]);
  return { db, companyId, add };
}

async function seed(add) {
  await add({ externalId: 'a', name: 'Semen Jakarta 40kg', code: 'SJ40', category: 'SEMEN', price: 62000, discountPct: 10, soldQty: 2305, brand: 'SEMEN JAKARTA' });
  await add({ externalId: 'b', name: 'Bata Ringan 10cm', code: 'BR10', category: 'BATA', price: 6325, soldQty: 6748, unit: 'pcs' });
  await add({ externalId: 'c', name: 'Cat Tembok 5kg', code: 'CT5', category: 'CAT', price: 150000, soldQty: 12 });
  await add({ source: 'manual', externalId: null, kind: 'service', name: 'Jasa Pasang Keramik', category: 'JASA', price: null, unit: 'm2' });
  await add({ externalId: 'd', name: 'Barang Lama', category: 'BATA', price: 1000, missing: true });
  await add({ externalId: 'e', name: 'Disembunyikan', category: 'CAT', price: 5000, active: false });
}

test('daftar katalog: urut, saring jenis, kategori, status, harga, dan cari merek', { skip }, async (t) => {
  const { db, companyId, add } = await setup(t);
  await seed(add);
  const names = async (opts) => (await db.listCatalogItems(companyId, opts)).items.map((i) => i.name);

  assert.deepEqual((await names({ status: 'visible', sort: 'sold', dir: 'desc' })).slice(0, 3), ['Bata Ringan 10cm', 'Semen Jakarta 40kg', 'Cat Tembok 5kg']);
  // Harga setelah diskon: Semen 62.000 diskon 10% = 55.800, lebih murah dari Cat; Jasa tanpa harga selalu di ujung.
  assert.deepEqual(await names({ status: 'visible', sort: 'finalPrice', dir: 'asc' }), ['Bata Ringan 10cm', 'Semen Jakarta 40kg', 'Cat Tembok 5kg', 'Jasa Pasang Keramik']);
  assert.deepEqual(await names({ status: 'visible', sort: 'finalPrice', dir: 'desc' }), ['Cat Tembok 5kg', 'Semen Jakarta 40kg', 'Bata Ringan 10cm', 'Jasa Pasang Keramik']);
  assert.deepEqual(await names({ status: 'visible', sort: 'discount', dir: 'desc' }).then((n) => n[0]), 'Semen Jakarta 40kg');

  assert.deepEqual(await names({ kind: 'service' }), ['Jasa Pasang Keramik']);
  assert.deepEqual(await names({ category: 'BATA', status: 'visible' }), ['Bata Ringan 10cm']);
  assert.deepEqual(await names({ status: 'hidden' }), ['Disembunyikan']);
  assert.deepEqual(await names({ status: 'missing' }), ['Barang Lama']);
  assert.deepEqual(await names({ priced: 'no' }), ['Jasa Pasang Keramik']);
  assert.equal((await db.listCatalogItems(companyId, { priced: 'yes' })).total, 5);
  assert.deepEqual(await names({ q: 'semen jakarta' }), ['Semen Jakarta 40kg'], 'cocok lewat nama dan merek');
  assert.deepEqual(await names({ q: 'SEMEN' }), ['Semen Jakarta 40kg'], 'kategori SEMEN dan nama tidak menggandakan baris');

  const unknownSort = await db.listCatalogItems(companyId, { sort: 'name; DROP TABLE catalog_items', dir: 'sideways' });
  assert.equal(unknownSort.total, 6, 'kunci urut asing jatuh ke nama, bukan dieksekusi');

  const categories = await db.listCatalogCategories(companyId);
  assert.deepEqual(categories.map((c) => [c.category, c.count]), [['BATA', 2], ['CAT', 2], ['JASA', 1], ['SEMEN', 1]]);
});

test('satuan dari UOM: yang berribbon dan terlaris dulu, satuan tim tidak ditimpa, varian tanpa UOM tak ditarik lagi', { skip }, async (t) => {
  const { db, companyId, add } = await setup(t);
  await seed(add);
  const pending = await db.listCatalogItemsNeedingDetail(companyId, 10);
  // Hanya item DealPOS aktif yang ada di POS (manual, hilang, dan tersembunyi dilewati).
  assert.equal(pending.length, 3);
  assert.equal(await db.countCatalogItemsNeedingDetail(companyId), 3);
  assert.deepEqual(pending.map((p) => p.externalId), ['b', 'a', 'c'], 'terlaris lebih dulu');
  assert.deepEqual(await db.listCompaniesPendingCatalogDetail(), [], 'tanpa koneksi DealPOS aktif tidak dilanjutkan');

  const byExternal = Object.fromEntries(pending.map((p) => [p.externalId, p.id]));
  await db.saveCatalogItemDetail(companyId, byExternal.b, { unit: 'btg', brand: 'CITICON' });
  await db.saveCatalogItemDetail(companyId, byExternal.a, { unit: 'sak', brand: null });
  await db.saveCatalogItemDetail(companyId, byExternal.c, { unit: null, brand: null });
  const items = Object.fromEntries((await db.listCatalogItems(companyId, {})).items.map((i) => [i.code, i]));
  assert.equal(items.BR10.unit, 'pcs', 'satuan yang sudah diisi tim tidak ditimpa');
  assert.equal(items.BR10.brand, 'CITICON');
  assert.equal(items.SJ40.unit, 'sak');
  assert.equal(items.SJ40.brand, 'SEMEN JAKARTA', 'merek lama dipertahankan bila POS tak memberi');
  assert.equal(items.CT5.unit, null);
  assert.equal(await db.countCatalogItemsNeedingDetail(companyId), 0, 'varian tanpa UOM juga ditandai selesai');
});

test('outlet DealPOS pada lokasi dan merek/tag dari detail produk tersimpan', { skip }, async (t) => {
  const { db, companyId, add } = await setup(t);
  const location = await db.saveCompanyLocation(companyId, null, {
    name: 'Toko BSD', kind: 'store', address: 'Jl. A', lat: -6.3, lng: 106.65, isPickup: true,
    dealposOutletId: 'o-1', dealposOutletName: 'BSD STORE',
  });
  assert.equal(location.dealposOutletId, 'o-1');
  const edited = await db.saveCompanyLocation(companyId, location.id, { ...location, dealposOutletId: null, dealposOutletName: null });
  assert.equal(edited.dealposOutletId, null);

  await add({ externalId: 'x', name: 'Rucika 3"', price: 1000 });
  assert.equal(await db.savePosCatalogDetails(companyId, 'dealpos', new Map([['x', { brand: 'RUCIKA', tags: ['Normal', 'Promo'] }]])), 1);
  const item = (await db.listCatalogItems(companyId, {})).items[0];
  assert.equal(item.brand, 'RUCIKA');
  assert.deepEqual(item.posTags, ['Normal', 'Promo']);
});

test('order kurir Lalamove: dibuat, dibaca per chat, status diperbarui, company lain tak terlihat', { skip }, async (t) => {
  const { db, companyId } = await setup(t);
  const other = (await db.pool.query('INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [`cat-other-${Date.now()}`])).rows[0].id;
  const order = await db.createLalamoveOrder(companyId, {
    chatId: '6281234567890@c.us', orderId: 'LM-9', environment: 'sandbox', serviceType: 'VAN', total: 85000,
    pickupName: 'Toko BSD', pickupAddress: 'Jl. A', dropoffAddress: '-6.2,106.7', recipientName: 'Bu Rina', recipientPhone: '6281234567890',
  });
  assert.equal(order.status, 'ASSIGNING_DRIVER');
  assert.equal(order.total, 85000);
  assert.equal((await db.listLalamoveOrders(companyId, '6281234567890@c.us')).length, 1);
  assert.equal((await db.listLalamoveOrders(companyId, 'chat-lain@c.us')).length, 0);
  assert.equal(await db.getLalamoveOrderRow(other, '6281234567890@c.us', order.id), null);
  const updated = await db.updateLalamoveOrderStatus(companyId, order.id, { status: 'ON_GOING', shareLink: 'https://share.test/x' });
  assert.equal(updated.status, 'ON_GOING');
  assert.equal(updated.shareLink, 'https://share.test/x');
  const kept = await db.updateLalamoveOrderStatus(companyId, order.id, { status: 'COMPLETED' });
  assert.equal(kept.shareLink, 'https://share.test/x', 'link pelacakan lama dipertahankan');
  await assert.rejects(() => db.createLalamoveOrder(companyId, { chatId: 'c', orderId: 'LM-9', environment: 'sandbox', serviceType: 'VAN', recipientName: 'x', recipientPhone: '1' }), /unique|duplicate/i);
  await db.pool.query('DELETE FROM companies WHERE id = $1', [other]);
});

test('ribbon yang mengikuti tag DealPOS: dipasang ke item bertag, manual tidak tersentuh, tag per produk', { skip }, async (t) => {
  const { db, companyId, add } = await setup(t);
  const items = {};
  for (const [ext, name, product] of [['v1', 'FRAP A', 'p-frap'], ['v2', 'FRAP B', 'p-frap'], ['v3', 'Semen', 'p-semen'], ['v4', 'Pipa', 'p-pipa']]) {
    items[ext] = (await add({ externalId: ext, name, price: 1000, soldQty: ext === 'v3' ? 50 : null })).rows[0].id;
  }
  await db.pool.query(`UPDATE catalog_items SET pos_product_id = CASE external_id WHEN 'v1' THEN 'p-frap' WHEN 'v2' THEN 'p-frap' WHEN 'v3' THEN 'p-semen' ELSE 'p-pipa' END WHERE company_id = $1`, [companyId]);

  assert.equal(await db.hasPosTagRibbons(companyId), false);
  const ribbon = await db.createCatalogTag(companyId, { name: 'Konsinyasi', color: 'violet', posTag: ' consignment ' });
  assert.equal(ribbon.posTag, 'consignment');
  await assert.rejects(() => db.createCatalogTag(companyId, { name: 'Lain', posTag: 'CONSIGNMENT' }), /unique|duplicate/i, 'satu tag POS satu ribbon');
  assert.equal(await db.hasPosTagRibbons(companyId), true);

  // Penarikan: yang terlaris dulu, satu produk = semua variannya.
  assert.equal(await db.countProductsNeedingPosTags(companyId), 3);
  assert.deepEqual(await db.listProductsNeedingPosTags(companyId, 10).then((r) => r[0]), 'p-semen');
  await db.savePosProductTags(companyId, 'p-frap', { tags: ['Consignment'], brand: 'FRAP' });
  await db.savePosProductTags(companyId, 'p-semen', { tags: ['Normal'], brand: null });
  assert.equal(await db.countProductsNeedingPosTags(companyId), 1);

  // Ribbon manual pada item lain bertahan saat ribbon otomatis dipasang ulang.
  await db.pool.query("INSERT INTO catalog_item_tags (company_id, item_id, tag_id, source) VALUES ($1, $2, $3, 'manual')", [companyId, items.v4, ribbon.id]);
  assert.equal(await db.applyPosTagRibbons(companyId), 2);
  assert.equal(await db.applyPosTagRibbons(companyId), 2, 'dipasang ulang tidak menggandakan');
  const tagged = (await db.listCatalogItems(companyId, { tagId: ribbon.id })).items.map((i) => i.name).sort();
  assert.deepEqual(tagged, ['FRAP A', 'FRAP B', 'Pipa']);
  const frap = (await db.listCatalogItems(companyId, { q: 'FRAP A' })).items[0];
  assert.equal(frap.brand, 'FRAP');
  assert.deepEqual(frap.tags.map((x) => [x.name, x.auto, x.manual]), [['Konsinyasi', true, false]]);

  assert.deepEqual((await db.listKnownPosTags(companyId)).map((x) => [x.tag, x.count]), [['Consignment', 2], ['Normal', 1]]);

  // Melepas tag POS dari ribbon: pasangan otomatis hilang, yang manual tetap.
  await db.updateCatalogTag(ribbon.id, companyId, { posTag: '' });
  await db.applyPosTagRibbons(companyId);
  assert.deepEqual((await db.listCatalogItems(companyId, { tagId: ribbon.id })).items.map((i) => i.name), ['Pipa']);
  assert.equal(await db.hasPosTagRibbons(companyId), false);
});
