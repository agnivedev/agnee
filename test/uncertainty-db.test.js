'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/** Migrasi 102 di Postgres asli: mode per company (bawaan 'on') dan jejak keputusan. */
test('AI tidak menebak: mode per company dan jejak keputusan', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const mk = async (slug) => (await db.pool.query("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Uji') RETURNING id", [`${slug}-${stamp}`])).rows[0].id;
  const a = await mk('unsure-a');
  const b = await mk('unsure-b');
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[a, b]]);
    await db.pool.end();
  });

  assert.equal(await db.getUncertaintyGuard(a), 'on', 'bawaan aman: nyala');
  assert.equal(await db.setUncertaintyGuard(a, 'handoff'), 'handoff');
  assert.equal(await db.getUncertaintyGuard(a), 'handoff');
  assert.equal(await db.getUncertaintyGuard(b), 'on', 'per company');
  await assert.rejects(() => db.setUncertaintyGuard(a, 'sembarang'), /check/i);

  await db.recordUncertaintyEvent({
    chatId: '628@c.us', topic: 'stok', reasons: [{ code: 'stock_claim', sentence: 'Stok ready.' }], action: 'ask_department',
    department: 'Management', customerText: 'ready gak?', modelText: 'Stok ready.', replyText: 'Saya tanyakan dulu.',
  }, a);
  const mine = await db.listUncertaintyEvents(a);
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].topic, mine[0].action, mine[0].department], ['stok', 'ask_department', 'Management']);
  assert.equal(mine[0].reasons[0].code, 'stock_claim');
  assert.deepEqual(await db.listUncertaintyEvents(b), [], 'tidak bocor lintas company');
});
