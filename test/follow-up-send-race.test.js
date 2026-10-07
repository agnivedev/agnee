'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Dua pengiriman follow-up ke chat yang sama pada saat bersamaan — tick
 * otomatis dan tombol kirim manual yang sama-sama lolos dari snapshot yang
 * sama — hanya boleh menghasilkan SATU pengiriman. Gerbangnya diperiksa ulang
 * di bawah kunci baris follow_up_state, jadi yang menunggu kunci melihat
 * last_sent_at dan sent_per_day milik pemenang.
 *
 * Postgres asli, karena yang diuji adalah FOR UPDATE-nya sendiri.
 */
test('dua pengiriman bersamaan: hanya satu yang lolos gerbang',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const slug = `fu-race-${Date.now()}`;
    const { rows } = await db.pool.query(
      'INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [slug],
    );
    const companyId = rows[0].id;
    const chatId = `race-${Date.now()}@c.us`;
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
      await db.close();
    });

    await db.startFollowUpSequence(chatId, companyId);
    const send = (guard) => db.recordFollowUpSend(
      { chatId, dayIndex: 0, attemptInDay: 1, body: 'halo', ...guard }, companyId,
    );
    // Slot (hari, percobaan) yang sama dijaga juga oleh UNIQUE follow_up_sends_slot_key;
    // yang diuji di sini adalah gerbang di ATAS itu, jadi percobaan berikutnya
    // memakai slot baru.
    const count = async () => (await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM follow_up_sends WHERE company_id = $1 AND chat_id = $2',
      [companyId, chatId],
    )).rows[0].n;

    await t.test('jarak minimum: yang kedua ditolak', async () => {
      const results = await Promise.all([send({ minGapMinutes: 120, dayCap: 5 }), send({ minGapMinutes: 120, dayCap: 5 })]);
      assert.equal(results.filter((r) => r.refused).length, 1, 'tepat satu yang ditolak');
      assert.equal(results.find((r) => r.refused).refused, 'gap_not_elapsed');
      assert.equal(await count(), 1, 'hanya satu baris tercatat');
    });

    await t.test('plafon harian: ditolak walau jaraknya lolos', async () => {
      // Gap dimatikan (0 menit) supaya yang menahan hanya plafon: 1 sudah terkirim.
      const refused = await send({ minGapMinutes: 0, dayCap: 1 });
      assert.equal(refused.refused, 'day_cap_reached');
      assert.equal(await count(), 1);
      const allowed = await send({ minGapMinutes: 0, dayCap: 2, attemptInDay: 2 });
      assert.ok(!allowed.refused, 'plafon lebih longgar mengizinkan');
      assert.equal(await count(), 2);
    });

    await t.test('rangkaian yang sudah berhenti tidak menerima pengiriman', async () => {
      await db.stopFollowUpSequence(chatId, companyId, 'human_takeover');
      const refused = await send({ minGapMinutes: 0, dayCap: 10 });
      assert.equal(refused.refused, 'sequence_stopped');
      assert.equal(await count(), 2);
    });
  });
