'use strict';

/**
 * Serah-terima terstruktur di Postgres sungguhan: alasan, kartu, batasan AI,
 * tenggat tugas, dan idempotensi migrasi 066.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

test('migrasi 066 aman dijalankan ulang', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  t.after(() => db.pool.end());
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '066_handoff_structured.sql'), 'utf8');
  await db.pool.query(sql);
  await db.pool.query(sql);
});

test('alasan, kartu, batasan AI, dan tenggat tugas', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const q = (sql, params) => db.pool.query(sql, params);
  const stamp = Date.now();
  const { rows: [co] } = await q("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Serah') RETURNING id", [`serah-${stamp}`]);
  const { rows: [other] } = await q("INSERT INTO companies (slug, name) VALUES ($1, 'Lain') RETURNING id", [`serah2-${stamp}`]);
  const { rows: [user] } = await q('INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id', [`serah-${stamp}@t.test`, 'Dewi']);
  await q("INSERT INTO company_members (company_id, user_id, role, status) VALUES ($1, $2, 'agent', 'active')", [co.id, user.id]);
  t.after(async () => {
    await q('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[co.id, other.id]]);
    await q('DELETE FROM users WHERE id = $1', [user.id]);
    await db.pool.end();
  });
  const chat = '628111@c.us';

  // 1. alasan tersimpan dan tampil di riwayat; catatan bebas tetap ada
  await db.saveConversationRouting({ chatId: chat, mode: 'human', assigneeUserId: user.id, actorUserId: null, note: 'Minta diskon', reason: 'price_decision', priority: 'high' }, co.id);
  let history = await db.listConversationHandoffs(chat, 20, co.id);
  assert.equal(history[0].reason, 'price_decision');
  assert.equal(history[0].note, 'Minta diskon');
  assert.equal(history[0].card, null);

  // alasan di luar daftar ditolak database
  await assert.rejects(
    q("INSERT INTO conversation_handoffs (company_id, chat_id, to_mode, reason) VALUES ($1, $2, 'human', 'ngawur')", [co.id, chat]),
    /conversation_handoffs_reason_check/,
  );

  // 2. kartu menempel ke baris ke-manusia terakhir, sekali saja
  const card = { summary: ['a', 'b', 'c'], promises: ['dikabari'], collected: { nama: 'Budi' }, suggestedReply: 'Halo' };
  assert.ok(await db.setLatestHandoffCard(chat, { card, reason: 'out_of_playbook' }, co.id));
  assert.equal(await db.setLatestHandoffCard(chat, { card: { summary: ['x'] }, reason: null }, co.id), null);
  history = await db.listConversationHandoffs(chat, 20, co.id);
  assert.deepEqual(history[0].card, card);
  assert.equal(history[0].reason, 'price_decision', 'alasan yang sudah diisi manusia tidak ditimpa');
  // company lain tidak melihat/menyentuh
  assert.equal(await db.setLatestHandoffCard(chat, { card }, other.id), null);
  assert.deepEqual(await db.listConversationHandoffs(chat, 20, other.id), []);

  // 3. batasan untuk AI: hanya berlaku bila serah-terima terakhir = kembali ke AI
  assert.equal(await db.getAiConstraints(chat, co.id), null);
  await db.saveConversationRouting({ chatId: chat, mode: 'ai', actorUserId: user.id, note: null, aiConstraints: '  Jangan beri diskon.  ' }, co.id);
  assert.equal(await db.getAiConstraints(chat, co.id), 'Jangan beri diskon.');
  assert.equal(await db.getAiConstraints(chat, other.id), null);
  history = await db.listConversationHandoffs(chat, 20, co.id);
  assert.equal(history[0].aiConstraints, 'Jangan beri diskon.');
  // diambil manusia lagi lalu dikembalikan TANPA batasan: batasan lama tidak diwarisi
  await db.saveConversationRouting({ chatId: chat, mode: 'human', assigneeUserId: user.id, actorUserId: user.id }, co.id);
  assert.equal(await db.getAiConstraints(chat, co.id), null);
  await db.saveConversationRouting({ chatId: chat, mode: 'ai', actorUserId: user.id }, co.id);
  assert.equal(await db.getAiConstraints(chat, co.id), null);
  // batasan hanya disimpan untuk arah ke AI
  await db.saveConversationRouting({ chatId: chat, mode: 'human', assigneeUserId: user.id, actorUserId: user.id, aiConstraints: 'salah tempat' }, co.id);
  history = await db.listConversationHandoffs(chat, 20, co.id);
  assert.equal(history[0].aiConstraints, null);

  // 4. tenggat tugas: bertahan saat prioritas berubah, hilang saat kembali ke AI
  const { rows: [note] } = await q("INSERT INTO conversation_notes (company_id, chat_id, author_user_id, body) VALUES ($1, $2, $3, 'telepon besok') RETURNING id", [co.id, chat, user.id]);
  const due = new Date(Date.now() + 86_400_000).toISOString();
  let routing = await db.saveConversationRouting({ chatId: chat, mode: 'human', assigneeUserId: user.id, actorUserId: user.id, priority: 'urgent', dueAt: due, taskNoteId: note.id }, co.id);
  assert.equal(new Date(routing.dueAt).toISOString(), due);
  assert.equal(String(routing.taskNoteId), String(note.id));
  routing = await db.saveConversationRouting({ chatId: chat, mode: 'human', assigneeUserId: user.id, actorUserId: user.id, priority: 'high' }, co.id);
  assert.equal(new Date(routing.dueAt).toISOString(), due, 'ubah prioritas tidak menghapus tenggat');
  const tasks = await db.listAssignedChats(co.id, { assigneeUserId: user.id });
  assert.equal(new Date(tasks[0].dueAt).toISOString(), due);
  // tugas baru dari catatan lain TANPA tenggat tidak mewarisi tenggat tugas lama
  const { rows: [note2] } = await q("INSERT INTO conversation_notes (company_id, chat_id, author_user_id, body) VALUES ($1, $2, $3, 'kirim brosur') RETURNING id", [co.id, chat, user.id]);
  routing = await db.saveConversationRouting({ chatId: chat, mode: 'human', assigneeUserId: user.id, actorUserId: user.id, priority: 'normal', taskNoteId: note2.id }, co.id);
  assert.equal(routing.dueAt, null, 'tugas baru tanpa tenggat tidak mewarisi tenggat lama');
  assert.equal(String(routing.taskNoteId), String(note2.id));
  routing = await db.saveConversationRouting({ chatId: chat, mode: 'ai', actorUserId: user.id }, co.id);
  assert.equal(routing.dueAt, null);
  assert.equal(routing.taskNoteId, null);

  // 5. catatan hanya terbaca di chat dan company-nya
  assert.equal((await db.getConversationNote(note.id, chat, co.id)).body, 'telepon besok');
  assert.equal(await db.getConversationNote(note.id, chat, other.id), null);
  assert.equal(await db.getConversationNote(note.id, 'lain@c.us', co.id), null);

  // 6. pertukaran pesan untuk kartu: tertua dulu, dua arah, per company
  await q("INSERT INTO inbound_messages (company_id, chat_id, provider, body, timestamp, wa_message_id) VALUES ($1, $2, 'whatsapp_web', 'diskon dong', $3, 'm1')", [co.id, chat, Math.floor(Date.now() / 1000)]);
  await q("INSERT INTO outbound_replies (company_id, chat_id, author, body, created_at) VALUES ($1, $2, 'ai', 'saya cek ya', NOW() + INTERVAL '1 second')", [co.id, chat]);
  const exchange = await db.listRecentExchange(chat, co.id, 10);
  assert.deepEqual(exchange.map((m) => m.who), ['Customer', 'AI']);
  assert.deepEqual(await db.listRecentExchange(chat, other.id, 10), []);
});
