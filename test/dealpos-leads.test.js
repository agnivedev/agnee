'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Customer DealPOS menjadi sumber ke-6 di Lead List dan daftar broadcast:
 * menempel ke chat lewat nomor HP, tampil sendiri kalau belum pernah chat, dan
 * satu nomor tidak pernah menghasilkan dua baris.
 */
test('customer DealPOS digabung ke Lead List dan audiens broadcast lewat nomor HP', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const stamp = Date.now();
  const companyId = (await db.pool.query(
    `INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id`, [`dealpos-leads-${stamp}`],
  )).rows[0].id;
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    await db.close();
  });

  const chatPhone = '6281200000001';   // sudah chat + customer POS ganda
  const mayarPhone = '6281200000002';  // lead Mayar + customer POS
  const posOnly = '6281200000003';     // customer POS ganda, belum chat, bukan Mayar
  const insertPos = (id, phone, name, joined) => db.pool.query(
    `INSERT INTO dealpos_customers (company_id, dealpos_customer_id, name, phone, joined_at)
     VALUES ($1, $2, $3, $4, $5)`, [companyId, id, name, phone, joined]);

  await db.recordInboundMessage(companyId, { chatId: `${chatPhone}@c.us`, provider: 'whatsapp_web', waMessageId: `m-${stamp}`, body: 'halo', timestamp: 1000 });
  await insertPos('p1', chatPhone, 'Budi Lama', '2025-01-01');
  await insertPos('p2', chatPhone, 'Budi Baru', '2026-01-01');
  await db.pool.query(
    `INSERT INTO mayar_leads (company_id, mayar_customer_id, name, phone, total_transactions, total_amount)
     VALUES ($1, 'm1', 'Rina', $2, 1, 1000)`, [companyId, mayarPhone]);
  await insertPos('p3', mayarPhone, 'Rina POS', '2026-02-01');
  await insertPos('p4', posOnly, 'Sari Lama', '2025-05-01');
  await insertPos('p5', posOnly, 'Sari Baru', '2026-05-01');
  await db.pool.query(
    `INSERT INTO dealpos_customers (company_id, dealpos_customer_id, name, phone) VALUES ($1, 'p6', 'Tanpa HP', NULL)`, [companyId]);

  const rows = await db.listContactExportRows(companyId);
  const byPhone = Object.fromEntries(rows.map((row) => [row.phone, row]));
  assert.equal(rows.length, 3, 'tiga nomor, tiga baris — nomor kembar dan tanpa HP tidak menambah');

  assert.equal(byPhone[chatPhone].source, 'whatsapp+dealpos');
  assert.equal(byPhone[chatPhone].chatId, `${chatPhone}@c.us`);
  assert.equal(byPhone[chatPhone].name, 'Budi Baru', 'customer POS terbaru jadi nama cadangan');

  assert.equal(byPhone[mayarPhone].source, 'mayar+dealpos');
  assert.equal(byPhone[posOnly].source, 'dealpos');
  assert.equal(byPhone[posOnly].chatId, null);
  assert.equal(byPhone[posOnly].name, 'Sari Baru');
  assert.equal(rows.at(-1).phone, posOnly, 'baris DealPOS saja di paling bawah');

  const audience = await db.listBroadcastAudience(companyId);
  const audienceByPhone = Object.fromEntries(audience.map((row) => [row.phone, row]));
  assert.equal(audience.length, 3);
  assert.equal(audienceByPhone[chatPhone].origin, 'chat');
  assert.equal(audienceByPhone[mayarPhone].origin, 'mayar');
  assert.equal(audienceByPhone[posOnly].origin, 'dealpos');
  assert.equal(audienceByPhone[posOnly].relation, 'unproven', 'belum pernah chat: butuh pengakuan risiko');
  assert.equal(audienceByPhone[posOnly].chatId, `${posOnly}@c.us`);
});

test('detail customer DealPOS (alamat, kota, telp lain) tampil di Lead List dan antre sampai ditarik', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const companyId = (await db.pool.query(
    `INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id`, [`dealpos-detail-${Date.now()}`],
  )).rows[0].id;
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    await db.close();
  });

  await db.upsertDealposCustomers(companyId, [
    { dealposCustomerId: 'a', code: 'A', name: 'Ani', email: null, phone: '6281200000011', phoneExtra: null, joinedAt: null },
    { dealposCustomerId: 'b', code: 'B', name: 'Tanpa HP', email: null, phone: null, phoneExtra: '021-5551234', joinedAt: null },
  ]);
  // Yang punya nomor WhatsApp ditarik lebih dulu.
  assert.deepEqual(await db.listDealposPendingDetail(companyId), ['a', 'b']);

  await db.saveDealposDetail(companyId, 'a', {
    address: 'Jl. Mawar 1 RT 02/03', city: 'Tangerang', phoneAlt: '021-7770000', gender: 'Female',
    birthDate: '1990-05-17', memberGroup: 'Gold', loyaltyPoints: 5,
  });
  assert.deepEqual(await db.listDealposPendingDetail(companyId), ['b']);
  assert.deepEqual(await db.countDealposCustomers(companyId), { total: 2, withPhone: 1, detailDone: 1 });

  // Sinkron ulang daftar tidak menghapus detail yang sudah ditarik.
  await db.upsertDealposCustomers(companyId, [
    { dealposCustomerId: 'a', code: 'A', name: 'Ani Baru', email: null, phone: '6281200000011', phoneExtra: null, joinedAt: null },
  ]);
  const rows = await db.listContactExportRows(companyId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ani Baru');
  assert.equal(rows[0].address, 'Jl. Mawar 1 RT 02/03');
  assert.equal(rows[0].city, 'Tangerang');
  assert.equal(rows[0].otherPhone, '021-7770000');
  assert.equal(rows[0].gender, 'Female');
  assert.equal(rows[0].birthDate, '1990-05-17');
  assert.equal(rows[0].memberGroup, 'Gold');
});

test('matikan & sembunyikan: customer DealPOS hilang dari Lead List dan broadcast, chat tetap, muncul lagi saat dinyalakan', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  db.credentialsEncryptionKey = 'kunci-uji';
  const companyId = (await db.pool.query(
    `INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id`, [`dealpos-hide-${Date.now()}`],
  )).rows[0].id;
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    await db.close();
  });
  const chatPhone = '6281200000021';
  const posOnly = '6281200000022';
  await db.upsertDealposConnection(companyId, { host: 'toko.dealpos.co.id', clientId: 'client-id-1', clientSecret: 'client-secret-1' });
  await db.recordInboundMessage(companyId, { chatId: `${chatPhone}@c.us`, provider: 'whatsapp_web', waMessageId: `h-${Date.now()}`, body: 'halo', timestamp: 1000 });
  await db.upsertDealposCustomers(companyId, [
    { dealposCustomerId: 'a', code: 'A', name: 'Sudah Chat', email: null, phone: chatPhone, phoneExtra: null, joinedAt: null },
    { dealposCustomerId: 'b', code: 'B', name: 'Belum Chat', email: null, phone: posOnly, phoneExtra: null, joinedAt: null },
  ]);
  await db.saveDealposDetail(companyId, 'a', { address: 'Jl. Mawar 1', city: null, phoneAlt: null, gender: null, birthDate: null, memberGroup: null, loyaltyPoints: null });
  assert.equal((await db.listContactExportRows(companyId)).length, 2);
  assert.equal((await db.listBroadcastAudience(companyId)).length, 2);

  assert.equal(await db.setDealposEnabled(companyId, false).then((r) => r.enabled), false);
  await db.setDealposDataHidden(companyId, true);

  const rows = await db.listContactExportRows(companyId);
  assert.equal(rows.length, 1, 'yang hanya ada di DealPOS hilang');
  assert.equal(rows[0].phone, chatPhone, 'chat WhatsApp tetap ada');
  assert.equal(rows[0].source, 'whatsapp', 'tanpa penanda dan alamat DealPOS');
  assert.equal(rows[0].address, null);
  assert.equal((await db.listBroadcastAudience(companyId)).length, 1);
  assert.equal((await db.countDealposCustomers(companyId)).total, 2, 'datanya tidak dihapus');
  assert.equal((await db.getDealposConnection(companyId)).dataHidden, true);

  await db.setDealposEnabled(companyId, true);
  assert.equal((await db.getDealposConnection(companyId)).dataHidden, false, 'menyalakan lagi memunculkan datanya');
  const back = await db.listContactExportRows(companyId);
  assert.equal(back.length, 2);
  assert.equal(back.find((row) => row.phone === chatPhone).address, 'Jl. Mawar 1');
});
