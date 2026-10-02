'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Chat '@lid' membawa id samaran, bukan nomor HP. Lead Mayar dulu digabung
 * memakai digit id itu, jadi tidak pernah cocok: customer yang sama tampil dua
 * kali di Lead List — baris WhatsApp dan baris "Mayar saja".
 */
test('lead Mayar tergabung ke chat @lid lewat lid_phone_map', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const stamp = Date.now();
  const companyId = (await db.pool.query(
    `INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id`, [`lid-join-${stamp}`],
  )).rows[0].id;
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
    await db.close();
  });

  const lid = `${stamp}@lid`;
  const phone = '6281299990000';
  await db.recordInboundMessage(companyId, { chatId: lid, provider: 'whatsapp_web', waMessageId: `${lid}-1`, body: 'halo', timestamp: 1000 });
  await db.savePhoneForLid(companyId, lid, phone);
  await db.pool.query(
    `INSERT INTO mayar_leads (company_id, mayar_customer_id, name, phone, total_transactions, total_amount)
     VALUES ($1, 'cust-1', 'Rina', $2, 1, 150000)`,
    [companyId, phone],
  );

  const rows = await db.listContactExportRows(companyId);
  assert.equal(rows.length, 1, 'satu customer, satu baris');
  assert.equal(rows[0].chatId, lid);
  assert.equal(rows[0].phone, phone);
  assert.equal(rows[0].source, 'both');
});
