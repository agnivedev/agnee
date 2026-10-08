'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Query biaya 30 hari yang dipakai pemantau, dan penandaan "sudah dikabari".
 * Postgres asli: yang diuji adalah JOIN, jendela 30 hari, dan ANY($1::uuid[]).
 */
test('kandidat alert: jumlah biaya jendela 30 hari, dan penandaan terkabari',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const slugs = [`cost-a-${stamp}`, `cost-b-${stamp}`, `cost-kosong-${stamp}`];
    const ids = [];
    for (const slug of slugs) {
      const { rows } = await db.pool.query(
        "INSERT INTO companies (slug, name, plan) VALUES ($1, $1, 'company') RETURNING id", [slug],
      );
      ids.push(rows[0].id);
    }
    const [a, b, kosong] = ids;
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [ids]);
      await db.close();
    });

    const usage = (companyId, costUsd, interval) => db.pool.query(
      `INSERT INTO ai_usage_logs (company_id, purpose, model, cost_usd, created_at)
       VALUES ($1, 'auto_reply', 'm', $2, NOW() - $3::interval)`,
      [companyId, costUsd, interval],
    );
    await usage(a, 1.5, '1 day');
    await usage(a, 2.0, '10 days');
    await usage(a, 9.0, '40 days');          // di luar jendela: tidak boleh ikut
    await usage(b, 0.25, '2 hours');

    const mine = async () => Object.fromEntries(
      (await db.listCostAlertCandidates()).filter((r) => ids.includes(r.id)).map((r) => [r.id, r]),
    );

    let rows = await mine();
    assert.equal(rows[a].costUsd30d, 3.5, '1,5 + 2,0; 9,0 di luar 30 hari');
    assert.equal(rows[a].calls30d, 2);
    assert.equal(rows[b].costUsd30d, 0.25);
    assert.equal(rows[kosong].costUsd30d, 0, 'tenant tanpa pemakaian tetap muncul (LEFT JOIN)');
    assert.equal(rows[kosong].calls30d, 0);
    assert.equal(rows[a].plan, 'company');
    assert.equal(rows[a].notifiedAt, null);

    await db.markCostAlertNotified([a, b]);
    rows = await mine();
    assert.ok(rows[a].notifiedAt && rows[b].notifiedAt, 'keduanya ditandai');
    assert.equal(rows[kosong].notifiedAt, null, 'yang lain tidak tersentuh');

    await db.clearCostAlerts([a]);
    rows = await mine();
    assert.equal(rows[a].notifiedAt, null);
    assert.ok(rows[b].notifiedAt, 'hanya yang disebut yang direset');

    // Daftar kosong bukan perintah untuk menyentuh semuanya.
    await db.markCostAlertNotified([]);
    await db.clearCostAlerts([]);
    assert.ok((await mine())[b].notifiedAt);
  });
