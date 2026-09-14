'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Menyentuh Postgres asli: yang diuji adalah UPDATE massal dan transisi
 * enabled false→true di dalam saveFollowUpSettings. Menirunya dengan DB palsu
 * hanya akan menguji tiruan itu sendiri.
 */
test('menyalakan kembali tindak lanjut menutup rangkaian lama',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const companyId = await db.resolveCompanyId('tradersmastermind');
    const chatIds = [`reenable-a-${Date.now()}@c.us`, `reenable-b-${Date.now()}@c.us`];
    const before = await db.getFollowUpSettings(companyId);

    t.after(async () => {
      await db.pool.query('DELETE FROM follow_up_state WHERE chat_id = ANY($1)', [chatIds]);
      if (before) {
        await db.saveFollowUpSettings(
          { ...before, enabled: false }, null, companyId,
        );
        await db.pool.query('UPDATE follow_up_settings SET enabled = $2 WHERE company_id = $1',
          [companyId, before.enabled]);
      }
      await db.close();
    });

    await db.saveFollowUpSettings({ enabled: false }, null, companyId);
    for (const chatId of chatIds) await db.startFollowUpSequence(chatId, companyId);

    const armed = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM follow_up_state WHERE chat_id = ANY($1) AND stopped_at IS NULL',
      [chatIds],
    );
    assert.equal(armed.rows[0].n, 2, 'dua rangkaian terpasang sebelum fitur dinyalakan');

    await db.saveFollowUpSettings({ enabled: true }, null, companyId);

    const after = await db.pool.query(
      'SELECT stop_reason FROM follow_up_state WHERE chat_id = ANY($1) AND stopped_at IS NOT NULL',
      [chatIds],
    );
    assert.equal(after.rowCount, 2, 'keduanya ditutup, bukan dilepas ke customer');
    assert.deepEqual([...new Set(after.rows.map((r) => r.stop_reason))], ['feature_reenabled']);

    // Menyimpan lagi saat sudah menyala tidak boleh menutup apa pun: hanya
    // transisi mati→menyala yang membersihkan.
    await db.startFollowUpSequence(chatIds[0], companyId);
    await db.saveFollowUpSettings({ minGapMinutes: 180 }, null, companyId);
    const stillArmed = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM follow_up_state WHERE chat_id = $1 AND stopped_at IS NULL',
      [chatIds[0]],
    );
    assert.equal(stillArmed.rows[0].n, 1, 'penyimpanan biasa tidak boleh menutup rangkaian hidup');
  });
