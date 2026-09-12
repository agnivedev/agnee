'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Test ini menyentuh Postgres asli karena yang diuji adalah perilaku SQL-nya:
 * idempotensi lewat UNIQUE dan DISTINCT ON. Menirunya dengan DB palsu hanya
 * akan menguji tiruan itu sendiri. Dilewati kalau DATABASE_URL tidak ada.
 */
test('catatan pesan masuk', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const companyId = await db.resolveCompanyId('tradersmastermind');
  const chatId = `test-inbound-${Date.now()}@c.us`;

  t.after(async () => {
    await db.pool.query('DELETE FROM inbound_messages WHERE chat_id = $1', [chatId]);
    await db.close();
  });

  await t.test('pesan tercatat dan terbaca kembali', async () => {
    const written = await db.recordInboundMessage(companyId, {
      chatId, provider: 'whatsapp_web', waMessageId: `${chatId}-1`,
      body: 'halo', timestamp: 1000,
    });
    assert.equal(written, true);
    const last = await db.getLastInboundMessage(companyId, chatId);
    assert.equal(last.body, 'halo');
    assert.equal(last.provider, 'whatsapp_web');
  });

  await t.test('pesan yang sama tidak tercatat dua kali', async () => {
    // whatsapp-web.js menembakkan ulang event setelah reconnect; Meta mengirim
    // ulang webhook yang belum di-ACK.
    const again = await db.recordInboundMessage(companyId, {
      chatId, provider: 'whatsapp_web', waMessageId: `${chatId}-1`,
      body: 'halo', timestamp: 1000,
    });
    assert.equal(again, false, 'duplikat harus ditolak diam-diam');
  });

  await t.test('pesan terakhir mengikuti timestamp terbesar', async () => {
    await db.recordInboundMessage(companyId, {
      chatId, provider: 'whatsapp_web', waMessageId: `${chatId}-2`,
      body: 'pesan kedua', timestamp: 2000,
    });
    const last = await db.getLastInboundMessage(companyId, chatId);
    assert.equal(last.body, 'pesan kedua');
  });

  await t.test('satu baris per percakapan untuk export', async () => {
    const rows = await db.listLastInboundPerChat(companyId);
    const mine = rows.filter((row) => row.chatId === chatId);
    assert.equal(mine.length, 1, 'DISTINCT ON harus memberi satu baris per chat');
    assert.equal(mine[0].body, 'pesan kedua');
  });
});
