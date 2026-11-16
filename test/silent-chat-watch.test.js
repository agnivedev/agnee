'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSilentChatWatch, buildMessage, withinOpenWindow, DEFAULTS } = require('../src/silent-chat-watch.js');
const Database = require('../src/database.js');

const DAY = new Date('2026-11-16T03:00:00Z'); // 10.00 WIB
const NIGHT = new Date('2026-11-16T16:00:00Z'); // 23.00 WIB
const row = { companyId: 'c1', name: 'ESBEJE', timezone: 'Asia/Jakarta', chats: 6, oldestAt: new Date('2026-11-15T03:00:00Z') };

function watch({ rows = [row], ai = { enabled: false, reason: 'suspended' }, now = DAY, sent = [] } = {}) {
  let clock = now;
  const w = createSilentChatWatch({
    listUnanswered: async () => rows,
    getCompanyAi: async () => ai,
    notify: async (companyId, text) => { sent.push({ companyId, text }); },
    log: { warn() {} },
    now: () => clock,
  });
  return { w, sent, setNow: (d) => { clock = d; } };
}

test('paket berhenti: staf diberi tahu dengan penyebab yang benar', async () => {
  const { w, sent } = watch();
  const out = await w.tick();
  assert.equal(out.length, 1);
  assert.match(sent[0].text, /6 chat customer belum dibalas/);
  assert.match(sent[0].text, /paket company ini berstatus berhenti/);
});

test('credit habis dan AI menyala-tapi-diam dibedakan', async () => {
  assert.match(buildMessage({ reason: 'credit', chats: 1, oldestAt: DAY, now: DAY }), /credit AI habis/);
  assert.match(buildMessage({ reason: null, chats: 1, oldestAt: DAY, now: DAY }), /AI menyala tetapi tidak membalas/);
});

test('AI sengaja dimatikan: tidak dikabari', async () => {
  const { w, sent } = watch({ ai: { enabled: false, reason: 'off' } });
  assert.deepEqual(await w.tick(), []);
  assert.equal(sent.length, 0);
});

test('di luar jam 08–20 waktu company: tidak dikirim', async () => {
  const { w, sent } = watch({ now: NIGHT });
  assert.deepEqual(await w.tick(), []);
  assert.equal(sent.length, 0);
  assert.equal(withinOpenWindow(DAY, 'Asia/Jakarta', DEFAULTS), true);
  assert.equal(withinOpenWindow(DAY, 'Asia/Jayapura', DEFAULTS), true);
  assert.equal(withinOpenWindow(NIGHT, 'Asia/Jakarta', DEFAULTS), false);
});

test('satu kabar per company per 6 jam, lalu diulang', async () => {
  const { w, sent, setNow } = watch();
  await w.tick();
  await w.tick();
  assert.equal(sent.length, 1);
  setNow(new Date(DAY.getTime() + 7 * 3600_000 - 3600_000 * 0)); // 17.00 WIB, 7 jam kemudian
  await w.tick();
  assert.equal(sent.length, 2);
});

test('gagal mengirim tidak menyalakan pembatas: dicoba lagi putaran berikutnya', async () => {
  let fail = true;
  const sent = [];
  const w = createSilentChatWatch({
    listUnanswered: async () => [row],
    getCompanyAi: async () => ({ enabled: true, reason: null }),
    notify: async (c, t) => { if (fail) throw new Error('WA mati'); sent.push(t); },
    log: { warn() {} },
    now: () => DAY,
  });
  assert.deepEqual(await w.tick(), []);
  fail = false;
  assert.equal((await w.tick()).length, 1);
});

const DB_URL = process.env.DATABASE_URL;
test('query: chat tanpa balasan terdeteksi; yang dibalas, dipegang manusia, atau grup tidak', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const { rows: [co] } = await db.pool.query("INSERT INTO companies (name, slug) VALUES ('Uji diam', $1) RETURNING id", [`uji-diam-${Date.now()}`]);
  t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = $1', [co.id]); await db.close(); });
  const ago = (h) => new Date(Date.now() - h * 3600_000);
  const inbound = (chat, at, type = 'chat') => db.pool.query(
    `INSERT INTO inbound_messages (company_id, chat_id, provider, wa_message_id, body, message_type, timestamp, created_at)
     VALUES ($1, $2, 'whatsapp_web', $3, 'halo', $4, 0, $5)`, [co.id, chat, `${chat}-${at.getTime()}-${type}`, type, at]);
  await inbound('1@lid', ago(5)); // diam
  await inbound('2@lid', ago(5)); // dibalas
  await db.pool.query("INSERT INTO outbound_replies (company_id, chat_id, author, body) VALUES ($1, '2@lid', 'ai', 'ok')", [co.id]);
  await inbound('3@lid', ago(5)); // dipegang manusia
  const { rows: [u] } = await db.pool.query("INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'u') RETURNING id", [`diam-${Date.now()}@x.test`]).catch(() => ({ rows: [{}] }));
  if (u.id) {
    t.after(() => db.pool.query('DELETE FROM users WHERE id = $1', [u.id]));
    await db.pool.query("INSERT INTO conversation_routing (company_id, chat_id, handling_mode, assignee_user_id) VALUES ($1, '3@lid', 'human', $2)", [co.id, u.id]);
  }
  await inbound('4@g.us', ago(5)); // grup
  await inbound('5@lid', ago(1)); // belum cukup lama
  await inbound('6@lid', ago(5), 'e2e_notification'); // bukan pesan customer
  const rows = await db.listUnansweredCustomerChats({ minAgeMinutes: 180, maxAgeHours: 48 });
  const mine = rows.find((r) => r.companyId === co.id);
  assert.equal(mine.chats, u.id ? 1 : 2);
});
