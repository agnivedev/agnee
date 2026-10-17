'use strict';

/**
 * Kinerja agent di Postgres sungguhan: SQL waktu respons (pesan menunggu ->
 * balasan human pertama) dan penghitungan chat diambil alih menentukan angka
 * yang dibaca supervisor, jadi DB palsu tidak berguna.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

test('getAgentPerformance: hanya yang tercatat, tanpa mengarang', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const q = (sql, params) => db.pool.query(sql, params);
  const { rows: [company] } = await q("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Kinerja') RETURNING id", [`perf-${stamp}`]);
  const { rows: [other] } = await q("INSERT INTO companies (slug, name) VALUES ($1, 'Lain') RETURNING id", [`perf2-${stamp}`]);
  const mkUser = async (name, role, companyId = company.id, status = 'active') => {
    const { rows: [u] } = await q('INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id', [`${name.toLowerCase()}-${stamp}@t.test`, name]);
    await q('INSERT INTO company_members (company_id, user_id, role, status) VALUES ($1, $2, $3, $4)', [companyId, u.id, role, status]);
    return u.id;
  };
  const dewi = await mkUser('Dewi', 'agent');
  const raka = await mkUser('Raka', 'agent');
  const nihil = await mkUser('Nihil', 'agent'); // tidak melakukan apa pun
  const bos = await mkUser('Bos', 'admin'); // tidak ikut kalau tidak aktif
  const orang = await mkUser('Orang', 'agent', other.id);
  t.after(async () => {
    await q('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[company.id, other.id]]);
    await q('DELETE FROM users WHERE id = ANY($1::uuid[])', [[dewi, raka, nihil, bos, orang]]);
    await db.pool.end();
  });

  const base = Math.floor(Date.now() / 1000) - 3600; // satu jam lalu
  const at = (sec) => new Date((base + sec) * 1000);
  const inbound = (chat, sec, id) => q(
    `INSERT INTO inbound_messages (company_id, chat_id, provider, wa_message_id, body, timestamp, created_at)
     VALUES ($1, $2, 'whatsapp_web', $3, 'hi', $4, $5)`, [company.id, chat, id, base + sec, at(sec)]);
  const reply = (chat, sec, author, userId = null, companyId = company.id) => q(
    `INSERT INTO outbound_replies (company_id, chat_id, author, author_user_id, body, created_at)
     VALUES ($1, $2, $3, $4, 'jawab', $5)`, [companyId, chat, author, userId, at(sec)]);

  // Chat A: customer menunggu dari detik 0 (dan menulis lagi di 30); Dewi membalas di detik 120 -> respons 120 dtk.
  await inbound('6281@c.us', 0, 'a1'); await inbound('6281@c.us', 30, 'a2');
  await reply('6281@c.us', 120, 'human', dewi);
  // Balasan kedua langsung sesudahnya: tidak ada customer yang menunggu -> bukan pengukuran.
  await reply('6281@c.us', 150, 'human', dewi);
  // Chat B: AI menjawab dulu (detik 10), customer menulis lagi di 100, Dewi membalas di 400 -> 300 dtk dari pesan setelah balasan AI.
  await inbound('6282@c.us', 0, 'b1'); await reply('6282@c.us', 10, 'ai');
  await inbound('6282@c.us', 100, 'b2'); await reply('6282@c.us', 400, 'human', dewi);
  // Chat C: Raka memulai percakapan (tidak ada pesan masuk): balasan terhitung, respons tidak terukur.
  await reply('6283@c.us', 200, 'human', raka);
  // Chat grup: tidak dihitung.
  await inbound('1@g.us', 0, 'g1'); await reply('1@g.us', 50, 'human', raka);
  // Broadcast dan balasan human tanpa penulis (dihapus): bukan milik agent mana pun.
  await reply('6284@c.us', 60, 'broadcast');
  await reply('6285@c.us', 70, 'human', null);
  // Company lain tidak bocor.
  await reply('6286@c.us', 80, 'human', orang, other.id);

  // Handoff: Dewi mengambil alih 2 chat; Raka 1 lalu mengembalikannya ke AI.
  const handoff = (chat, from, to, fromUser, toUser, sec) => q(
    `INSERT INTO conversation_handoffs (company_id, chat_id, from_mode, to_mode, from_user_id, to_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`, [company.id, chat, from, to, fromUser, toUser, at(sec)]);
  await handoff('6281@c.us', 'ai', 'human', null, dewi, 100);
  await handoff('6282@c.us', 'ai', 'human', null, dewi, 390);
  await handoff('6283@c.us', 'ai', 'human', null, raka, 190);
  await handoff('6283@c.us', 'human', 'ai', raka, null, 900);
  // Chat yang sedang dipegang Dewi sekarang.
  await q(`INSERT INTO conversation_routing (company_id, chat_id, handling_mode, assignee_user_id, status)
           VALUES ($1, '6281@c.us', 'human', $2, 'open')`, [company.id, dewi]);

  const rows = await db.getAgentPerformance(company.id, at(-60), at(1000));
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(byName).sort(), ['Dewi', 'Nihil', 'Raka']);
  assert.equal(byName.Orang, undefined);
  assert.equal(byName.Bos, undefined);

  assert.equal(byName.Dewi.humanReplies, 3);
  assert.equal(byName.Dewi.chatsReplied, 2);
  assert.equal(byName.Dewi.responseSamples, 2); // chat A (120) dan chat B (300); balasan kedua tidak terhitung
  assert.equal(byName.Dewi.medianResponseSeconds, 210);
  assert.equal(byName.Dewi.averageResponseSeconds, 210);
  assert.equal(byName.Dewi.takeovers, 2);
  assert.equal(byName.Dewi.openAssigned, 1);

  assert.equal(byName.Raka.humanReplies, 1); // balasan di grup tidak dihitung
  assert.equal(byName.Raka.responseSamples, 0);
  assert.equal(byName.Raka.medianResponseSeconds, null);
  assert.equal(byName.Raka.takeovers, 1);
  assert.equal(byName.Raka.handBacks, 1);

  assert.deepEqual([byName.Nihil.humanReplies, byName.Nihil.takeovers, byName.Nihil.medianResponseSeconds], [0, 0, null]);
  assert.equal(rows[0].name, 'Dewi'); // paling banyak membalas di atas

  // Jendela waktu dihormati: periode kosong -> hanya agent aktif dengan nol.
  const empty = await db.getAgentPerformance(company.id, at(5000), at(6000));
  assert.ok(empty.every((r) => r.humanReplies === 0 && r.takeovers === 0));
});
