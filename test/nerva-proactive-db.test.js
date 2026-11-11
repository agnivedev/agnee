'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/** Dedupe alert, batas per jam, dan audit di Postgres asli (migrasi 104). */
test('nerva_proactive_sent: klaim sekali, lepas, hitung per jam; nerva_audit tercatat',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const slug = `nerva-pro-${Date.now()}`;
    const { rows } = await db.pool.query("INSERT INTO companies (slug, name, plan) VALUES ($1, $1, 'company') RETURNING id", [slug]);
    const cid = rows[0].id;
    t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = $1', [cid]); await db.close(); });

    assert.equal(await db.claimNervaSent(cid, '6281', 'alert', 'k1'), true);
    assert.equal(await db.claimNervaSent(cid, '6281', 'alert', 'k1'), false, 'kunci sama tidak diklaim dua kali');
    assert.equal(await db.claimNervaSent(cid, '6282', 'alert', 'k1'), true, 'dedupe per chat');
    assert.equal(await db.claimNervaSent(cid, '6281', 'briefing', 'k1'), true, 'per jenis');
    assert.equal(await db.countNervaSentSince(cid, '6281', 'alert', Date.now() - 3_600_000), 1);
    await db.pool.query("UPDATE nerva_proactive_sent SET sent_at = NOW() - INTERVAL '2 hours' WHERE chat = '6281' AND kind = 'alert'");
    assert.equal(await db.countNervaSentSince(cid, '6281', 'alert', Date.now() - 3_600_000), 0);
    await db.releaseNervaSent(cid, '6281', 'alert', 'k1');
    assert.equal(await db.claimNervaSent(cid, '6281', 'alert', 'k1'), true, 'setelah dilepas bisa diklaim lagi');

    await db.recordNervaAudit(cid, { chat: '6281', role: 'toko senayan', action: 'suggestion_decide', target: 'S-12', outcome: 'berhasil' });
    const audit = await db.pool.query('SELECT chat, role, action, target, outcome FROM nerva_audit WHERE company_id = $1', [cid]);
    assert.deepEqual(audit.rows, [{ chat: '6281', role: 'toko senayan', action: 'suggestion_decide', target: 'S-12', outcome: 'berhasil' }]);
  });
