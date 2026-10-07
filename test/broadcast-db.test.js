'use strict';

/**
 * Broadcast di Postgres sungguhan: klaim yang tidak pernah mengirim dua kali,
 * STOP yang berlaku di tengah jalan, dan isolasi antar company. Yang diuji
 * adalah SQL-nya, jadi DB palsu tidak berguna di sini.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';

async function withCompanies(t, fn) {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const made = [];
  for (const label of ['a', 'b']) {
    const { rows } = await db.pool.query(
      'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id',
      [`Uji broadcast ${label}`, `uji-broadcast-${label}-${stamp}`],
    );
    made.push(rows[0].id);
  }
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [made]);
    await db.close();
  });
  await fn(db, made[0], made[1]);
}

const recipients = (n) => Array.from({ length: n }, (_, i) => ({
  chatId: `6281${i}@c.us`, name: `Orang ${i}`, phone: `6281${i}`,
}));

test('penerima diklaim satu per satu, berurutan, dan tidak pernah dua kali', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const b = await db.createBroadcast({ name: 'Uji', body: 'Halo {nama}', aiVariation: true, recipients: recipients(3) }, companyId);
    assert.equal(b.status, 'sending');
    assert.equal(b.aiVariation, true);
    assert.equal(b.total, 3);

    const first = await db.claimNextBroadcastRecipient(companyId);
    assert.equal(first.chatId, '62810@c.us');
    assert.equal(first.body, 'Halo {nama}');
    assert.equal(first.aiVariation, true);
    const second = await db.claimNextBroadcastRecipient(companyId);
    assert.notEqual(second.chatId, first.chatId);

    await db.markBroadcastRecipient(first.id, companyId, { status: 'sent', messageId: 'wa-1', sentBody: 'Halo Orang 0' });
    assert.equal((await db.listBroadcastRecipients(b.id, companyId))[0].sentBody, 'Halo Orang 0');
    // Klaim yang tidak pernah selesai jadi `unknown`, bukan kembali ke antrean.
    await db.pool.query("UPDATE broadcast_recipients SET claimed_at = NOW() - INTERVAL '10 minutes' WHERE id = $1", [second.id]);
    const stale = await db.markStaleBroadcastClaims(5);
    assert.ok(stale.some((row) => row.broadcastId === b.id));

    const third = await db.claimNextBroadcastRecipient(companyId);
    await db.markBroadcastRecipient(third.id, companyId, { status: 'sent' });
    assert.equal(await db.claimNextBroadcastRecipient(companyId), null);
    assert.deepEqual((await db.finishDrainedBroadcasts(companyId)).map((r) => r.broadcastId), [b.id]);

    const done = await db.getBroadcast(b.id, companyId);
    assert.equal(done.status, 'done');
    assert.equal(done.sent, 2);
    assert.equal(done.unknown, 1);
    // Plafon harian menghitung setiap percobaan, termasuk yang hasilnya tidak
    // pasti: ketiganya sudah menyentuh WhatsApp.
    assert.equal(await db.countBroadcastSentSince(companyId, new Date(Date.now() - 3600_000)), 3);
  });
});

test('STOP di tengah jalan melewati penerima itu', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const b = await db.createBroadcast({ name: 'Uji', body: 'Promo', recipients: recipients(2) }, companyId);
    assert.equal(await db.recordBroadcastOptOut(companyId, '62810@c.us', 'STOP'), true);
    assert.equal(await db.recordBroadcastOptOut(companyId, '62810@c.us', 'stop'), false, 'STOP kedua bukan opt-out baru');

    await db.skipOptedOutBroadcastRecipients(companyId);
    const next = await db.claimNextBroadcastRecipient(companyId);
    assert.equal(next.chatId, '62811@c.us');
    // STOP hanya dicegat di chat yang pernah benar-benar menerima broadcast.
    assert.equal(await db.hasReceivedBroadcast(companyId, '62811@c.us'), false);
    await db.markBroadcastRecipient(next.id, companyId, { status: 'sent' });
    assert.equal(await db.hasReceivedBroadcast(companyId, '62811@c.us'), true);

    const rows = await db.listBroadcastRecipients(b.id, companyId);
    assert.equal(rows.find((r) => r.chatId === '62810@c.us').status, 'skipped');
    assert.equal((await db.listBroadcastOptOuts(companyId)).length, 1);
    assert.equal(await db.deleteBroadcastOptOut(companyId, '62810@c.us'), true);
  });
});

test('jeda menghentikan klaim, batal melewati sisanya, yang selesai tidak bisa dihidupkan', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const b = await db.createBroadcast({ name: 'Uji', body: 'Promo', recipients: recipients(3) }, companyId);
    assert.equal((await db.setBroadcastStatus(b.id, companyId, 'pause')).status, 'paused');
    assert.equal(await db.claimNextBroadcastRecipient(companyId), null);
    assert.equal((await db.setBroadcastStatus(b.id, companyId, 'resume')).status, 'sending');

    const cancelled = await db.setBroadcastStatus(b.id, companyId, 'cancel');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.skipped, 3);
    assert.equal(await db.setBroadcastStatus(b.id, companyId, 'resume'), null);
  });
});

test('broadcast terjadwal menunggu waktunya', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const later = new Date(Date.now() + 3600_000).toISOString();
    const b = await db.createBroadcast({ name: 'Uji', body: 'Promo', scheduledAt: later, recipients: recipients(1) }, companyId);
    assert.equal(b.status, 'scheduled');
    assert.equal(await db.claimNextBroadcastRecipient(companyId), null);

    await db.pool.query("UPDATE broadcasts SET scheduled_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [b.id]);
    assert.ok((await db.activateDueBroadcasts()).some((row) => row.broadcastId === b.id));
    assert.ok(await db.claimNextBroadcastRecipient(companyId));
  });
});

test('broadcast satu company tidak terlihat atau tersentuh company lain', { skip }, async (t) => {
  await withCompanies(t, async (db, companyA, companyB) => {
    const b = await db.createBroadcast({ name: 'Rahasia A', body: 'Promo', recipients: recipients(1) }, companyA);
    assert.equal(await db.getBroadcast(b.id, companyB), null);
    assert.deepEqual(await db.listBroadcastRecipients(b.id, companyB), []);
    assert.equal(await db.setBroadcastStatus(b.id, companyB, 'cancel'), null);
    assert.equal(await db.claimNextBroadcastRecipient(companyB), null);
    assert.equal((await db.getBroadcast(b.id, companyA)).status, 'sending');
  });
});

test('pesan broadcast tercatat dengan penulisnya sendiri', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    await db.recordOutboundReply({ chatId: '62810@c.us', author: 'broadcast', body: 'Promo' }, companyId);
    // Bukan antrean nilai balasan manusia di Coach.
    const reviewQueue = await db.listOutboundReplies(companyId);
    assert.equal(reviewQueue.length, 0);
  });
});

test('calon penerima: hanya yang pernah chat, tanpa grup, STOP ditandai', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const now = Math.floor(Date.now() / 1000);
    for (const chatId of ['62811@c.us', '62812@c.us', '1203@g.us']) {
      await db.recordInboundMessage(companyId, { chatId, provider: 'whatsapp_web', waMessageId: `${chatId}-1`, body: 'halo', timestamp: now });
    }
    // Hanya pernah kita kirimi: bukan calon penerima.
    await db.recordOutboundReply({ chatId: '62819@c.us', author: 'human', body: 'halo' }, companyId);
    await db.recordBroadcastOptOut(companyId, '62812@c.us', 'STOP');

    const audience = await db.listBroadcastAudience(companyId);
    assert.deepEqual(audience.map((r) => r.chatId).sort(), ['62811@c.us', '62812@c.us']);
    assert.equal(audience.find((r) => r.chatId === '62812@c.us').optedOut, true);
    assert.equal(audience.find((r) => r.chatId === '62811@c.us').lastInboundAt, now);
  });
});
