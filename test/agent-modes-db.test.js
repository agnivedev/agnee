'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';

async function withCompanies(t, fn) {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const ids = [];
  for (const label of ['a', 'b']) {
    const { rows } = await db.pool.query('INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Uji mode ${label}`, `uji-mode-${label}-${stamp}`]);
    ids.push(rows[0].id);
  }
  t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [ids]); await db.close(); });
  await fn(db, ids[0], ids[1]);
}

test('nomor baru berstatus standard; mode diganti per nomor dan tidak bocor ke company lain', { skip }, async (t) => {
  await withCompanies(t, async (db, a, b) => {
    const [numA, numB] = await Promise.all([
      db.pool.query("INSERT INTO whatsapp_connections (company_id, connection_key, client_id) VALUES ($1, 'whatsapp-main', $2) RETURNING id", [a, `c-${a}`]),
      db.pool.query("INSERT INTO whatsapp_connections (company_id, connection_key, client_id) VALUES ($1, 'whatsapp-main', $2) RETURNING id", [b, `c-${b}`]),
    ]);
    const idA = numA.rows[0].id; const idB = numB.rows[0].id;
    assert.equal((await db.listWhatsappConnections(a))[0].agentMode, 'standard');
    assert.equal((await db.setWhatsappConnectionMode(a, idA, 'internal_ops')).agentMode, 'internal_ops');
    assert.equal((await db.listWhatsappConnections(a))[0].agentMode, 'internal_ops');
    assert.equal(await db.setWhatsappConnectionMode(a, idB, 'sales'), null, 'company A tidak bisa mengubah nomor company B');
    assert.equal((await db.listWhatsappConnections(b))[0].agentMode, 'standard');
    await assert.rejects(db.setWhatsappConnectionMode(a, idA, 'ngawur'), /check|violates/i);
  });
});

test('panduan mode: simpan, timpa, kosongkan; terpisah per company', { skip }, async (t) => {
  await withCompanies(t, async (db, a, b) => {
    await db.setAgentModeInstructions(a, 'sales', '  Fokus Pro  ');
    await db.setAgentModeInstructions(b, 'sales', 'Punya B');
    assert.deepEqual(await db.getAgentModeInstructions(a), { sales: 'Fokus Pro' });
    await db.setAgentModeInstructions(a, 'sales', 'Baru');
    assert.equal((await db.getAgentModeInstructions(a)).sales, 'Baru');
    await db.setAgentModeInstructions(a, 'sales', '   ');
    assert.deepEqual(await db.getAgentModeInstructions(a), {});
    assert.equal((await db.getAgentModeInstructions(b)).sales, 'Punya B');
  });
});
