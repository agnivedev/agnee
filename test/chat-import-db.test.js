'use strict';

/**
 * Impor chat di Postgres sungguhan. Yang diuji adalah SQL-nya: UNION di Lead
 * List menuntut jumlah kolom yang persis sama di kedua sisi, dan aturan
 * "pernah membalas" menentukan siapa yang boleh dikirimi broadcast, jadi DB
 * palsu tidak berguna di sini.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';
const NOW = Math.floor(Date.now() / 1000);

async function withCompanies(t, fn) {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const made = [];
  for (const label of ['a', 'b']) {
    const { rows } = await db.pool.query(
      'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id',
      [`Uji impor ${label}`, `uji-impor-${label}-${stamp}`],
    );
    made.push(rows[0].id);
  }
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [made]);
    await db.close();
  });
  await fn(db, made[0], made[1]);
}

const impor = (chatId, relation, extra = {}) => ({
  chatId, relation, lastMessageAt: NOW - 100, lastInboundAt: relation === 'replied' ? NOW - 100 : null, waLabels: [], ...extra,
});

test('chat hasil impor muncul di daftar broadcast dengan hubungannya', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    await db.upsertImportedContacts(companyId, [
      impor('62811@c.us', 'replied', { waLabels: ['Pelanggan baru'] }),
      impor('62812@c.us', 'unproven'),
    ]);
    const audience = await db.listBroadcastAudience(companyId);
    const per = Object.fromEntries(audience.map((row) => [row.chatId, row]));
    assert.equal(per['62811@c.us'].relation, 'replied');
    assert.deepEqual(per['62811@c.us'].waLabels, ['Pelanggan baru']);
    assert.equal(per['62812@c.us'].relation, 'unproven');
    assert.equal(per['62812@c.us'].lastInboundAt, null, 'yang belum terlihat membalas tidak punya waktu pesan masuk');
  });
});

test('chat yang Agnee sendiri catat masuk tetap "replied" walau impor melihatnya sebagai belum', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    await db.pool.query(
      "INSERT INTO inbound_messages (company_id, chat_id, provider, body, message_type, timestamp) VALUES ($1, '62813@c.us', 'whatsapp_web', 'halo', 'chat', $2)",
      [companyId, NOW - 50],
    );
    await db.upsertImportedContacts(companyId, [impor('62813@c.us', 'unproven')]);
    const row = (await db.listBroadcastAudience(companyId)).find((r) => r.chatId === '62813@c.us');
    assert.equal(row.relation, 'replied');
  });
});

test('hubungan tidak pernah turun dari "replied" saat diimpor ulang', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    await db.upsertImportedContacts(companyId, [impor('62814@c.us', 'replied', { lastMessageAt: NOW - 500 })]);
    await db.upsertImportedContacts(companyId, [impor('62814@c.us', 'unproven', { lastMessageAt: NOW - 10, waLabels: ['Baru'] })]);
    const { rows: [row] } = await db.pool.query(
      "SELECT relation, last_message_at, wa_labels FROM imported_contacts WHERE company_id = $1 AND chat_id = '62814@c.us'",
      [companyId],
    );
    assert.equal(row.relation, 'replied');
    assert.equal(Number(row.last_message_at), NOW - 10, 'waktu selalu yang paling baru');
    assert.deepEqual(row.wa_labels, ['Baru'], 'label diganti yang terbaru');
  });
});

test('Lead List memuat chat hasil impor beserta kategorinya, dan UNION dengan Mayar tetap jalan', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    await db.upsertImportedContacts(companyId, [
      impor('62815@c.us', 'replied', { waLabels: ['Sudah bayar'] }),
      impor('62816@c.us', 'unproven', { lastMessageAt: NOW - 200 * 86400 }),
    ]);
    // Baris Mayar-saja memaksa kedua sisi UNION punya kolom yang sama persis.
    await db.pool.query(
      "INSERT INTO mayar_leads (company_id, mayar_customer_id, name, phone, total_amount, products) VALUES ($1, 'm-1', 'Pembeli Mayar', '62899', 150000, 'Paket A')",
      [companyId],
    );
    const rows = await db.listContactExportRows(companyId);
    const per = Object.fromEntries(rows.filter((r) => r.chatId).map((r) => [r.chatId, r]));
    assert.equal(per['62815@c.us'].relation, 'replied');
    assert.deepEqual(per['62815@c.us'].waLabels, ['Sudah bayar']);
    assert.equal(per['62816@c.us'].relation, 'unproven');
    assert.equal(Number(per['62816@c.us'].lastActivityAt), NOW - 200 * 86400);
    const mayar = rows.find((r) => r.source === 'mayar');
    assert.ok(mayar, 'baris Mayar-saja tetap muncul');
    assert.equal(mayar.relation, null);
    assert.equal(mayar.lastActivityAt, null);
  });
});

test('chat hasil impor terurut menurut percakapan terbaru, bukan jatuh ke dasar daftar', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    await db.upsertImportedContacts(companyId, [
      impor('62821@c.us', 'unproven', { lastMessageAt: NOW - 300 }),
      impor('62822@c.us', 'unproven', { lastMessageAt: NOW - 10 }),
      impor('62823@c.us', 'unproven', { lastMessageAt: NOW - 3000 }),
    ]);
    const urut = (await db.listContactExportRows(companyId)).map((r) => r.chatId);
    assert.deepEqual(urut, ['62822@c.us', '62821@c.us', '62823@c.us']);
  });
});

test('hasil impor satu company tidak terlihat di company lain', { skip }, async (t) => {
  await withCompanies(t, async (db, a, b) => {
    await db.upsertImportedContacts(a, [impor('62831@c.us', 'replied')]);
    assert.equal((await db.listBroadcastAudience(b)).length, 0);
    assert.equal((await db.listContactExportRows(b)).length, 0);
    assert.deepEqual(await db.listImportedChatIds(b), []);
    assert.deepEqual(await db.countImportedContacts(b), { replied: 0, unproven: 0 });
    assert.deepEqual(await db.countImportedContacts(a), { replied: 1, unproven: 0 });
  });
});

test('chat yang sudah pernah diimpor dikenali, dan chat masuk dikenali dari sumber Agnee', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    await db.upsertImportedContacts(companyId, [impor('62841@c.us', 'unproven')]);
    assert.deepEqual(await db.listImportedChatIds(companyId), ['62841@c.us']);

    await db.pool.query(
      "INSERT INTO lead_states (company_id, chat_id, stage, score, title, detail) VALUES ($1, '62842@c.us', 'inbox', 10, 't', 'd')",
      [companyId],
    );
    const dikenal = await db.listChatIdsKnownToHaveChatted(companyId, ['62841@c.us', '62842@c.us', '62843@c.us']);
    assert.deepEqual(dikenal.sort(), ['62842@c.us']);
    assert.deepEqual(await db.listChatIdsKnownToHaveChatted(companyId, []), []);
  });
});

test('mengimpor daftar kosong tidak melakukan apa-apa', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    assert.equal(await db.upsertImportedContacts(companyId, []), 0);
    assert.equal(await db.upsertImportedContacts(companyId, null), 0);
  });
});
