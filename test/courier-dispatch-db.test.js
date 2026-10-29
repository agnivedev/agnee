'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

test('kurir invoice: menunggu pembayaran, klaim atomik sekali, status tercatat di payload', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const cleanup = [];
  t.after(async () => { for (const id of cleanup) await db.pool.query('DELETE FROM companies WHERE id = $1', [id]); await db.close(); });
  const slug = `courier-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const companyId = (await db.pool.query('INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [slug])).rows[0].id;
  cleanup.push(companyId);

  const chatId = '6281234@c.us';
  const courier = { state: 'awaiting_payment', serviceType: 'MOTORCYCLE', lalamoveTotal: 45000, destination: { lat: -6.3, lng: 106.6, address: 'BSD' }, recipientName: 'Dedi', recipientPhone: '0812' };
  assert.equal(await db.latestCourierInvoice(companyId, chatId), null);

  // Invoice tanpa kurir (ambil di toko) tidak pernah ikut.
  await db.createAiSalesDocument(companyId, { kind: 'invoice', chatId, number: 'INV-PICKUP', total: 1000, payload: { lines: [] } });
  assert.equal(await db.latestCourierInvoice(companyId, chatId), null);

  const doc = await db.createAiSalesDocument(companyId, { kind: 'invoice', chatId, number: 'INV-1', total: 500000, payload: { lines: [], courier } });
  const found = await db.latestCourierInvoice(companyId, chatId);
  assert.equal(found.number, 'INV-1');
  assert.equal(found.payload.courier.recipientName, 'Dedi');
  assert.equal(await db.latestCourierInvoice(companyId, 'chat-lain@c.us'), null);

  // Dua pemicu bersamaan: tepat satu yang menang.
  const claims = await Promise.all([db.claimCourierDispatch(companyId, doc.id), db.claimCourierDispatch(companyId, doc.id)]);
  assert.deepEqual(claims.sort(), [false, true]);
  assert.equal(await db.latestCourierInvoice(companyId, chatId), null); // sedang dipesan

  // Gagal: bisa diulang, alasan tersimpan, data kurir lain utuh.
  await db.setCourierState(companyId, doc.id, 'failed', { reason: 'ongkir naik' });
  const failed = await db.latestCourierInvoice(companyId, chatId);
  assert.equal(failed.payload.courier.state, 'failed');
  assert.equal(failed.payload.courier.reason, 'ongkir naik');
  assert.equal(failed.payload.courier.lalamoveTotal, 45000);
  assert.equal(await db.claimCourierDispatch(companyId, doc.id), true);

  await db.setCourierState(companyId, doc.id, 'ordered', { orderId: 'o1' });
  assert.equal(await db.latestCourierInvoice(companyId, chatId), null);
  assert.equal(await db.claimCourierDispatch(companyId, doc.id), false);

  // Company lain tidak bisa mengklaim.
  const other = (await db.pool.query('INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [`${slug}-x`])).rows[0].id;
  cleanup.push(other);
  await db.setCourierState(companyId, doc.id, 'awaiting_payment');
  assert.equal(await db.claimCourierDispatch(other, doc.id), false);
});
