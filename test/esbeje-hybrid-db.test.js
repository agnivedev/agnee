'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;

async function freshCompany(t, db, label) {
  const companyId = (await db.pool.query(
    'INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [`${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`],
  )).rows[0].id;
  t.after(() => db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]));
  return companyId;
}

test('grup departemen: disimpan, dilepas, dan jawaban dari grup dikenali lewat reply atau kode', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const companyId = await freshCompany(t, db, 'dept-group');
  const otherCompany = await freshCompany(t, db, 'dept-group-other');
  t.after(() => db.close());

  const group = '120363000000000001@g.us';
  const dept = await db.createDepartment({ name: 'Gudang', description: 'Stok', whatsappGroupId: group, whatsappGroupName: 'Gudang SBJ' }, companyId);
  assert.equal(dept.whatsappGroupId, group);
  const listed = (await db.listDepartments(companyId)).find((d) => d.id === dept.id);
  assert.equal(listed.whatsappGroupName, 'Gudang SBJ');

  // Rename saja tidak menyentuh grup; null melepasnya.
  assert.equal((await db.updateDepartment(dept.id, { name: 'Gudang Utama' }, companyId)).whatsappGroupId, group);

  const q = await db.createDepartmentQuestion({ departmentId: dept.id, chatId: '6281200000009@c.us', customerText: 'stok semen?', question: 'Stok Semen Jakarta 40 sak?' }, companyId);
  assert.equal(q.whatsappGroupId, group);
  await db.addDepartmentQuestionGroupMessage(q.id, '3EB0AAA111', companyId);

  const byReply = await db.findGroupDepartmentQuestion(companyId, group, { stanzaId: '3EB0AAA111' });
  assert.equal(byReply?.id, q.id);
  const byCode = await db.findGroupDepartmentQuestion(companyId, group, { code: q.id.replace(/-/g, '').slice(0, 6).toUpperCase() });
  assert.equal(byCode?.id, q.id);
  assert.equal(await db.findGroupDepartmentQuestion(companyId, '120363999999999999@g.us', { stanzaId: '3EB0AAA111' }), null, 'grup lain tidak menjawab');
  assert.equal(await db.findGroupDepartmentQuestion(otherCompany, group, { stanzaId: '3EB0AAA111' }), null, 'company lain tidak menjawab');

  await db.answerDepartmentQuestion(q.id, { answer: 'ada 40 sak', userId: null }, companyId);
  assert.equal(await db.findGroupDepartmentQuestion(companyId, group, { stanzaId: '3EB0AAA111' }), null, 'sudah dijawab tidak dicari lagi');

  assert.equal((await db.updateDepartment(dept.id, { whatsappGroupId: null }, companyId)).whatsappGroupId, null);
});

test('pipeline otomatis: AI memindahkan kartu, koreksi manusia bertahan sampai ada pesan baru', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const companyId = await freshCompany(t, db, 'pipeline-auto');
  t.after(() => db.close());
  const chatId = '6281200000010@c.us';
  await db.setPipelineStage(chatId, 'cold', 'website-lead', companyId);

  const moved = await db.autoPipelineStage(chatId, 'hot', 'Customer minta total 40 sak', 1000, companyId);
  assert.equal(moved.pipelineStage, 'hot');
  assert.equal(moved.pipelineStageUpdatedBy, 'ai');
  assert.equal(moved.pipelineStageReason, 'Customer minta total 40 sak');
  assert.equal(await db.autoPipelineStage(chatId, 'hot', 'sama', 1000, companyId), null, 'tahap sama tidak ditulis ulang');

  // Orang mengoreksi ke warm SETELAH pesan terakhir: analisis atas pesan yang sama tidak menimpa.
  const userId = '00000000-0000-0000-0000-000000000001';
  await db.setPipelineStage(chatId, 'warm', userId, companyId);
  const lastMessageTs = Math.floor(Date.now() / 1000) - 60;
  assert.equal(await db.autoPipelineStage(chatId, 'hot', 'ulang', lastMessageTs, companyId), null);
  // Pesan baru sesudah koreksi: AI boleh memindahkan lagi.
  const later = Math.floor(Date.now() / 1000) + 60;
  assert.equal((await db.autoPipelineStage(chatId, 'closing', 'Customer kirim bukti transfer', later, companyId)).pipelineStage, 'closing');

  const lead = await db.getLeadState(chatId, companyId);
  assert.equal(lead.pipelineStageReason, 'Customer kirim bukti transfer');
  const board = (await db.listPipelineLeads(companyId)).find((row) => row.chatId === chatId);
  assert.equal(board.pipelineStageUpdatedBy, 'ai');
});

test('harga DealPOS: diganti seluruhnya per tarikan dan hanya terbaca saat koneksi menyala', { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const companyId = await freshCompany(t, db, 'dealpos-prices');
  t.after(() => db.close());
  await db.upsertDealposConnection(companyId, { host: 'toko.dealpos.co.id', clientId: 'client-id-1', clientSecret: 'secret-12345' });

  assert.deepEqual(await db.listDealposProductsDue(6).then((ids) => ids.includes(companyId)), true, 'belum pernah ditarik = jatuh tempo');
  await db.replaceDealposProducts(companyId, [
    { variantId: '1', code: 'SJ50', name: 'Semen Jakarta 50 kg', category: 'Semen', unit: 'sak', unitPrice: 68000 },
    { variantId: '2', code: 'OLD', name: 'Barang lama', category: null, unit: null, unitPrice: 1000 },
  ]);
  await db.replaceDealposProducts(companyId, [
    { variantId: '1', code: 'SJ50', name: 'Semen Jakarta 50 kg', category: 'Semen', unit: 'sak', unitPrice: 69500 },
  ]);
  const { products, syncedAt } = await db.listDealposProducts(companyId);
  assert.equal(products.length, 1, 'varian yang hilang dari DealPOS ikut hilang');
  assert.equal(products[0].unitPrice, 69500);
  assert.ok(syncedAt);
  assert.equal(await db.listDealposProductsDue(6).then((ids) => ids.includes(companyId)), false);
  assert.equal(await db.countDealposProducts(companyId), 1);

  await db.setDealposEnabled(companyId, false);
  assert.equal((await db.listDealposProducts(companyId)).products.length, 0, 'koneksi dimatikan: AI tidak membaca harga');
});
