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
    const { rows } = await db.pool.query('INSERT INTO companies (name, slug) VALUES ($1, $2) RETURNING id', [`Uji riwayat ${label}`, `uji-riwayat-${label}-${stamp}`]);
    ids.push(rows[0].id);
  }
  t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [ids]); await db.close(); });
  await fn(db, ids[0], ids[1]);
}

const masuk = (db, c, chat, body, ts, type = 'chat') => db.pool.query(
  "INSERT INTO inbound_messages (company_id, chat_id, provider, timestamp, body, message_type) VALUES ($1,$2,'whatsapp_web',$3,$4,$5)",
  [c, chat, ts, body, type]);
const keluar = (db, c, chat, author, body, ts) => db.pool.query(
  'INSERT INTO outbound_replies (company_id, chat_id, author, body, created_at) VALUES ($1,$2,$3,$4,to_timestamp($5))', [c, chat, author, body, ts]);
const hp = (db, c, chat, body, ts, id) => db.pool.query(
  'INSERT INTO phone_replies (company_id, chat_id, message_id, body, created_at) VALUES ($1,$2,$3,$4,to_timestamp($5))', [c, chat, id, body, ts]);

test('fullConversation: customer + AI + staf + balasan HP urut waktu, tanpa bocor antar company/chat', { skip }, async (t) => {
  await withCompanies(t, async (db, a, b) => {
    const chat = '628111@c.us';
    const t0 = Math.floor(Date.now() / 1000) - 1000;
    await masuk(db, a, chat, 'butuh semen 60 m2 di Bekasi', t0);
    await keluar(db, a, chat, 'ai', 'siap kak, kapan dibutuhkan?', t0 + 1);
    await masuk(db, a, chat, 'minggu depan', t0 + 2);
    await keluar(db, a, chat, 'human', 'stok ready kak', t0 + 3);
    await hp(db, a, chat, 'dikirim Senin ya', t0 + 4, 'm1');
    await masuk(db, a, chat, '', t0 + 5, 'image');                  // foto tanpa caption: ikut, tipe dibawa
    await masuk(db, a, chat, 'ini fotonya, yang abu-abu', t0 + 6, 'image'); // foto bercaption: ikut
    await masuk(db, a, chat, '   ', t0 + 6);                        // teks kosong: tidak masuk
    await masuk(db, a, chat, 'notif', t0 + 6, 'e2e_notification');   // notifikasi sistem: tidak masuk
    await masuk(db, a, '628222@c.us', 'chat lain', t0 + 7);
    await masuk(db, b, chat, 'company lain', t0 + 8);

    const turns = await db.fullConversation(a, chat);
    assert.deepEqual(turns.map((x) => `${x.from}:${x.type || ''}:${x.body}`), [
      'customer:chat:butuh semen 60 m2 di Bekasi',
      'ai::siap kak, kapan dibutuhkan?',
      'customer:chat:minggu depan',
      'staf::stok ready kak',
      'staf::dikirim Senin ya',
      'customer:image:',
      'customer:image:ini fotonya, yang abu-abu',
    ]);
  });
});

test('fullConversation: limit mengambil giliran TERBARU, tetap lama ke baru', { skip }, async (t) => {
  await withCompanies(t, async (db, a) => {
    const chat = '628333@c.us';
    const t0 = Math.floor(Date.now() / 1000) - 1000;
    for (let i = 0; i < 20; i += 1) await masuk(db, a, chat, `p${i}`, t0 + i);
    const turns = await db.fullConversation(a, chat, 5);
    assert.deepEqual(turns.map((x) => x.body), ['p15', 'p16', 'p17', 'p18', 'p19']);
  });
});
