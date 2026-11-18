'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

/** Tindak lanjut sekali per pertanyaan, ringkasan percakapan dari DB, dan pertanyaan lama lewat batas pengingat baru. */
test('tindak lanjut balasan customer: sekali, hanya setelah relay, per company', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const mk = async (slug) => (await db.pool.query("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Uji') RETURNING id", [`${slug}-${stamp}`])).rows[0].id;
  const a = await mk('fu-a');
  const b = await mk('fu-b');
  t.after(async () => {
    await db.pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[a, b]]);
    await db.pool.end();
  });
  const dept = (await db.pool.query("INSERT INTO departments (company_id, name, whatsapp_group_id) VALUES ($1, 'Management', '1203@g.us') RETURNING id", [a])).rows[0].id;
  const q = await db.createDepartmentQuestion({ departmentId: dept, chatId: 'c1@lid', customerText: 'Kw1', question: 'Harga KW1?', payload: { brief: { putuskan: 'Harga?' } } }, a);
  await db.rememberDepartmentQuestionGroupSerial(q.id, 'true_1203@g.us_AAA_628@c.us', a);
  await db.rememberDepartmentQuestionGroupSerial(q.id, 'true_1203@g.us_BBB_628@c.us', a);

  assert.equal(await db.claimQuestionFollowup(a, 'c1@lid', 'Oke ambil'), null, 'belum dijawab/diteruskan');
  await db.answerDepartmentQuestion(q.id, { answer: '130.000/dus', userId: null }, a);
  assert.equal(await db.claimQuestionFollowup(a, 'c1@lid', 'Oke ambil'), null, 'dijawab tapi belum diteruskan');
  await db.markDepartmentQuestionRelayed(q.id, a);
  assert.equal(await db.claimQuestionFollowup(b, 'c1@lid', 'Oke ambil'), null, 'tidak lintas company');

  const hit = await db.claimQuestionFollowup(a, 'c1@lid', 'Oke ambil 10 dus');
  assert.equal(hit.id, q.id);
  assert.equal(hit.whatsappGroupId, '1203@g.us');
  assert.equal(hit.payload.group_msg, 'true_1203@g.us_AAA_628@c.us', 'hanya pesan pertanyaan yang disimpan');
  assert.equal(hit.payload.brief.putuskan, 'Harga?', 'ringkasan tetap ada');
  assert.equal(await db.claimQuestionFollowup(a, 'c1@lid', 'Satu lagi'), null, 'maksimal satu tindak lanjut');

  await db.pool.query("INSERT INTO inbound_messages (company_id, chat_id, provider, wa_message_id, body, message_type, timestamp) VALUES ($1,'c1@lid','whatsapp_web','m1','Mau tanya keramik','chat',100),($1,'c1@lid','whatsapp_web','m2','Kw1','chat',200)", [a]);
  const conv = await db.recentConversation(a, 'c1@lid', 12);
  assert.equal(conv.first, 'Mau tanya keramik');
  assert.deepEqual(conv.turns.map((x) => x.body), ['Mau tanya keramik', 'Kw1']);
});

test('pertanyaan lama dengan 4 pengingat ditutup sebagai belum terjawab', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await db.connect();
  const stamp = Date.now();
  const a = (await db.pool.query("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Uji') RETURNING id", [`fu-old-${stamp}`])).rows[0].id;
  t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = $1', [a]); await db.pool.end(); });
  const dept = (await db.pool.query("INSERT INTO departments (company_id, name) VALUES ($1, 'Management') RETURNING id", [a])).rows[0].id;
  const q = await db.createDepartmentQuestion({ departmentId: dept, chatId: 'c2@lid', customerText: 'x', question: 'Apakah ada?' }, a);
  await db.pool.query('UPDATE department_questions SET reminder_count = 3 WHERE id = $1', [q.id]);
  await db.claimDueDepartmentReminders();
  const row = (await db.pool.query('SELECT status FROM department_questions WHERE id = $1', [q.id])).rows[0];
  assert.equal(row.status, 'unresolved');
});
