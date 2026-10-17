'use strict';

/** Impor berkas di Postgres sungguhan: duplikat, tanpa menimpa, Lead List, dan audiens broadcast. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

test('importLeadsFromFile: masuk Lead List dan audiens broadcast sebagai belum terbukti; tidak menimpa', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const q = (sql, params) => db.pool.query(sql, params);
  const { rows: [company] } = await q("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Impor') RETURNING id", [`imp-${stamp}`]);
  const { rows: [other] } = await q("INSERT INTO companies (slug, name) VALUES ($1, 'Lain') RETURNING id", [`imp2-${stamp}`]);
  t.after(async () => {
    await q('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[company.id, other.id]]);
    await db.pool.end();
  });

  // Customer yang sudah pernah chat, dan lead Mayar: keduanya harus terdeteksi sebagai duplikat.
  await q(`INSERT INTO inbound_messages (company_id, chat_id, provider, wa_message_id, body, timestamp)
           VALUES ($1, '6281111111111@c.us', 'whatsapp_web', 'm1', 'halo', $2)`, [company.id, Math.floor(Date.now() / 1000)]);
  await q(`INSERT INTO contact_names (company_id, chat_id, name) VALUES ($1, '6281111111111@c.us', 'Nama Asli Dari Chat')`, [company.id]);
  await q(`INSERT INTO mayar_leads (company_id, mayar_customer_id, phone, name) VALUES ($1, 'cust-1', '6282222222222', 'Mayar Orang')`, [company.id]);
  const phones = new Set(await db.listLeadPhones(company.id));
  assert.ok(phones.has('6281111111111') && phones.has('6282222222222'));
  assert.equal(phones.size, 2);
  assert.deepEqual(await db.listLeadPhones(other.id), []);

  const first = await db.importLeadsFromFile(company.id, {
    filename: 'kontak.xlsx', format: 'xlsx', totalRows: 4, skipped: { alreadyExists: 1 },
    leads: [
      { chatId: '6283333333333@c.us', name: 'Ani', email: 'ani@x.co', note: 'vip' },
      { chatId: '6284444444444@c.us', name: '', email: '', note: '' },
      // Race: nomor ini sudah punya chat; tidak boleh menimpa nama atau status.
      { chatId: '6281111111111@c.us', name: 'Nama Dari Excel', email: 'x@x.co', note: '' },
    ],
  });
  assert.equal(first.imported, 2);
  assert.equal(first.raced, 1);
  const { rows: [name] } = await q("SELECT name FROM contact_names WHERE company_id = $1 AND chat_id = '6281111111111@c.us'", [company.id]);
  assert.equal(name.name, 'Nama Asli Dari Chat');
  const { rows: [log] } = await q('SELECT * FROM lead_file_imports WHERE id = $1', [first.importId]);
  assert.equal(log.imported, 2);
  assert.equal(log.total_rows, 4);

  // Lead List: baris baru muncul dengan email/catatan, hubungan "belum terlihat membalas".
  const list = await db.listContactExportRows(company.id);
  const ani = list.find((r) => r.chatId === '6283333333333@c.us');
  assert.equal(ani.name, 'Ani');
  assert.equal(ani.email, 'ani@x.co');
  assert.equal(ani.importNote, 'vip');
  assert.equal(ani.relation, 'unproven');
  assert.equal(list.find((r) => r.chatId === '6281111111111@c.us').relation, 'replied');

  // Broadcast: ikut sebagai calon penerima 'unproven' dengan asal 'file'.
  const audience = await db.listBroadcastAudience(company.id);
  const row = audience.find((r) => r.chatId === '6283333333333@c.us');
  assert.equal(row.relation, 'unproven');
  assert.equal(row.origin, 'file');
  assert.equal(row.name, 'Ani');

  // Impor ulang berkas yang sama: tidak ada baris baru.
  const again = await db.importLeadsFromFile(company.id, {
    filename: 'kontak.xlsx', format: 'xlsx', totalRows: 2, leads: [{ chatId: '6283333333333@c.us', name: 'Ani Ganti', email: '', note: '' }],
  });
  assert.equal(again.imported, 0);
  assert.equal((await db.listContactExportRows(company.id)).find((r) => r.chatId === '6283333333333@c.us').name, 'Ani');
});
