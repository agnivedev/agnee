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
