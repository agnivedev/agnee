'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('../src/database.js');
const { loadPackage } = require('../src/ks-package');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';
const pkg = loadPackage(path.join(__dirname, '..', 'knowledge', 'ks', 'funneling-closing'));
const record = { code: pkg.manifest.code, version: pkg.manifest.version, kind: pkg.manifest.kind, source: 'builtin', pkg };

async function withCompanies(t, fn) {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const ids = [];
  for (const label of ['a', 'b']) {
    const { rows } = await db.pool.query(
      'INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Uji KS ${label}`, `uji-ks-${label}-${stamp}`],
    );
    ids.push(rows[0].id);
  }
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [ids]);
    await db.close();
  });
  await fn(db, ids[0], ids[1]);
}

test('paket terpasang menyimpan salinan, satu per jenis per company', { skip }, async (t) => {
  await withCompanies(t, async (db, a, b) => {
    const install = await db.createKsInstall(record, null, a);
    assert.equal(install.active, false);
    assert.deepEqual(install.specific, {});
    assert.equal(install.package.manifest.code, 'ks-funneling-closing');
    assert.equal(install.package.general.length, 3);

    await assert.rejects(db.createKsInstall(record, null, a), { code: '23505' });
    await db.createKsInstall(record, null, b);
  });
});

test('mengubah isian mematikan paket dan membuang hasil simulasi', { skip }, async (t) => {
  await withCompanies(t, async (db, companyId) => {
    const install = await db.createKsInstall(record, null, companyId);
    await db.saveKsSpecific(install.id, pkg.example, companyId);
    await db.saveKsSimulation(install.id, { passed: 6, failed: 0, specificHash: 'x' }, companyId);
    await db.setKsActive(install.id, true, companyId);
    assert.equal((await db.listActiveKs(companyId)).length, 1);

    const edited = await db.saveKsSpecific(install.id, { ...pkg.example, order: { how: 'baru' } }, companyId);
    assert.equal(edited.active, false);
    assert.equal(edited.lastSimulation, null);
    assert.equal((await db.listActiveKs(companyId)).length, 0);
  });
});

test('paket satu company tidak terbaca atau tersentuh company lain', { skip }, async (t) => {
  await withCompanies(t, async (db, a, b) => {
    const install = await db.createKsInstall(record, null, a);
    assert.equal(await db.getKsInstall(install.id, b), null);
    assert.equal(await db.saveKsSpecific(install.id, { offers: [] }, b), null);
    assert.equal(await db.setKsActive(install.id, true, b), null);
    assert.equal(await db.deleteKsInstall(install.id, b), false);
    assert.deepEqual(await db.listKsInstalls(b), []);
    assert.equal((await db.getKsInstall(install.id, a)).active, false);
  });
});

test('paket ikut terhapus bersama company-nya', { skip }, async (t) => {
  await withCompanies(t, async (db, a) => {
    const { rows } = await db.pool.query('INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', ['Uji KS hapus', `uji-ks-hapus-${Date.now()}`]);
    const temp = rows[0].id;
    await db.createKsInstall(record, null, temp);
    await db.pool.query('DELETE FROM companies WHERE id = $1', [temp]);
    const left = await db.pool.query('SELECT count(*)::int AS n FROM ks_installs WHERE company_id = $1', [temp]);
    assert.equal(left.rows[0].n, 0);
    assert.ok(a);
  });
});
