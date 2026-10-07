'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/**
 * Company dengan dua nomor: status nomor kedua tidak boleh menimpa baris nomor
 * utama. Dulu updateWhatsappStatus selalu menulis ke connection_key
 * 'whatsapp-main' dan callback di server membuang connectionId, jadi nomor
 * kedua yang putus membuat DB mencatat nomor utama sebagai putus — dan
 * memakai nomor telepon yang salah.
 *
 * Menyentuh Postgres asli karena yang diuji adalah WHERE di SQL-nya.
 */
test('status nomor kedua tidak menimpa nomor utama',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const slugs = [`wa-multi-a-${stamp}`, `wa-multi-b-${stamp}`];
    const ids = [];
    for (const slug of slugs) {
      const { rows } = await db.pool.query(
        'INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [slug],
      );
      ids.push(rows[0].id);
    }
    const [companyA, companyB] = ids;

    async function addConnection(companyId, key, label) {
      const { rows } = await db.pool.query(
        `INSERT INTO whatsapp_connections (company_id, connection_key, label, client_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [companyId, key, label, `${key}-${companyId}`],
      );
      return rows[0].id;
    }
    const mainA = await addConnection(companyA, 'whatsapp-main', 'Utama');
    const secondA = await addConnection(companyA, 'whatsapp-second', 'Kedua');
    const mainB = await addConnection(companyB, 'whatsapp-main', 'Utama B');

    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [ids]);
      await db.close();
    });

    async function row(id) {
      const { rows } = await db.pool.query(
        'SELECT status, phone_number AS "phoneNumber" FROM whatsapp_connections WHERE id = $1', [id],
      );
      return rows[0];
    }

    await db.updateWhatsappStatus(companyA, 'ready', '6281111@c.us', mainA);
    await db.updateWhatsappStatus(companyA, 'disconnected', null, secondA);

    assert.deepEqual(await row(mainA), { status: 'ready', phoneNumber: '6281111@c.us' },
      'nomor utama tetap ready dengan nomornya sendiri');
    assert.equal((await row(secondA)).status, 'disconnected');

    // company_id ikut di WHERE: id koneksi company lain tidak bisa disentuh
    // lewat company yang salah.
    await db.updateWhatsappStatus(companyB, 'error', null, secondA);
    assert.equal((await row(secondA)).status, 'disconnected', 'baris company A tidak berubah');
    assert.equal((await row(mainB)).status, 'disconnected', 'baris company B juga tidak ikut berubah');

    // Tanpa connectionId tetap jatuh ke nomor utama (company bernomor tunggal).
    await db.updateWhatsappStatus(companyB, 'ready', '6282222@c.us');
    assert.deepEqual(await row(mainB), { status: 'ready', phoneNumber: '6282222@c.us' });
  });
