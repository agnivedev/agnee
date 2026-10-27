'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * SQL aturan otomasi di Postgres asli: jeda ulang atomik, isolasi antar
 * company, hitung pesan, dan uji pada pesan lama. Dilewati tanpa DATABASE_URL.
 */
test('aturan otomasi di Postgres', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const companies = (await db.pool.query('SELECT id FROM companies ORDER BY created_at LIMIT 2')).rows.map((r) => r.id);
  const [mine, other] = companies;
  const tag = `uji-otomasi-${Date.now()}`;
  const chatId = `${tag}@c.us`;

  t.after(async () => {
    await db.pool.query('DELETE FROM automation_rules WHERE name LIKE $1', [`${tag}%`]);
    await db.pool.query('DELETE FROM inbound_messages WHERE chat_id = $1', [chatId]);
    await db.close();
  });

  const rule = await db.createAutomationRule(mine, {
    name: `${tag} grosir`, trigger: { type: 'keyword', words: ['grosir'] },
    actions: [{ type: 'notify_team', message: 'halo tim' }], cooldownHours: 24, enabled: true,
  });
  assert.ok(rule.id);

  await t.test('daftar per company: company lain tidak melihatnya', async () => {
    assert.ok((await db.listAutomationRules(mine)).some((r) => r.id === rule.id));
    if (other && other !== mine) assert.equal((await db.listAutomationRules(other)).some((r) => r.id === rule.id), false);
  });

  await t.test('jeda ulang atomik: dua klaim bersamaan, hanya satu lolos', async () => {
    const claims = await Promise.all([1, 2, 3, 4].map(() => db.claimAutomationRun(rule.id, mine, chatId, 24)));
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await db.claimAutomationRun(rule.id, mine, chatId, 24), null, 'masih dalam masa jeda');
    assert.ok(await db.claimAutomationRun(rule.id, mine, `lain-${chatId}`, 24), 'chat lain tetap boleh');
    assert.ok(await db.claimAutomationRun(rule.id, mine, chatId, 0), 'jeda 0 jam = tiap pesan');
  });

  await t.test('hitung pesan, uji 7 hari terakhir, dan catatan hasil', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.recordInboundMessage(mine, { chatId, provider: 'whatsapp_web', waMessageId: `${tag}-1`, body: 'harga grosir?', timestamp: now });
    assert.equal(await db.countInboundMessages(mine, chatId), 1);
    await db.recordInboundMessage(mine, { chatId, provider: 'whatsapp_web', waMessageId: `${tag}-2`, body: 'lama sekali', timestamp: now - 30 * 86400 });
    const rows = await db.previewKeywordMatches(mine, ['grosir'], 7);
    assert.ok(rows.some((r) => r.chatId === chatId && /grosir/.test(r.body)));
    assert.equal(rows.some((r) => r.body === 'lama sekali'), false, 'di luar 7 hari tidak ikut');
    const claim = await db.claimAutomationRun(rule.id, mine, `hasil-${chatId}`, 24);
    await db.finishAutomationRun(claim.id, [{ type: 'notify_team', ok: true }]);
    const listed = (await db.listAutomationRules(mine)).find((r) => r.id === rule.id);
    assert.ok(listed.runCount >= 1 && listed.lastRunAt);
  });

  await t.test('ubah dan hapus hanya berlaku di company pemilik', async () => {
    if (other && other !== mine) {
      assert.equal(await db.updateAutomationRule(other, rule.id, { enabled: false }), null);
      assert.equal(await db.deleteAutomationRule(other, rule.id), false);
    }
    assert.equal((await db.updateAutomationRule(mine, rule.id, { enabled: false })).enabled, false);
    assert.equal(await db.deleteAutomationRule(mine, rule.id), true);
    assert.equal((await db.listAutomationRules(mine)).some((r) => r.id === rule.id), false);
  });
});
