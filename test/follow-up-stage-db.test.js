'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');
const { resolveStage, normalizeStageToggles } = require('../src/follow-up-stage');
const { buildSummary } = require('../src/order-summary');

const DB_URL = process.env.DATABASE_URL;

/**
 * Menyentuh Postgres asli: query fakta funnel (lima tabel), penundaan di
 * listDueFollowUps, saklar tahap, dan alasan berhenti baru di CHECK
 * constraint. Tiruan hanya akan menguji tiruannya sendiri.
 */
test('fakta funnel dari Postgres menghasilkan tahap yang benar, dan penundaan/alasan berhenti tersimpan',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const companyId = await db.resolveCompanyId('tradersmastermind');
    const chatId = `fu-stage-${Date.now()}@c.us`;
    const before = await db.getFollowUpSettings(companyId);

    t.after(async () => {
      for (const table of ['follow_up_state', 'follow_up_sends', 'inbound_messages', 'outbound_replies', 'ai_sales_documents', 'payment_proofs', 'department_questions']) {
        await db.pool.query(`DELETE FROM ${table} WHERE company_id = $1 AND chat_id = $2`, [companyId, chatId]);
      }
      await db.pool.query("DELETE FROM departments WHERE company_id = $1 AND name = 'Gudang uji tahap'", [companyId]);
      await db.pool.query("DELETE FROM payment_accounts WHERE company_id = $1 AND account_number = '8877665544'", [companyId]);
      await db.pool.query(`UPDATE follow_up_settings SET enabled = $2, stage_toggles = $3::jsonb, day_caps = $4 WHERE company_id = $1`,
        [companyId, before.enabled, JSON.stringify(before.stages || {}), before.dayCaps]);
      await db.close();
    });

    const facts = () => db.getFollowUpFunnelFacts(chatId, companyId, { sinceDays: 7 });
    const stageNow = async () => resolveStage(await facts(), { toggles: normalizeStageToggles({}), now: new Date() });

    // (a) tanya harga
    await db.recordInboundMessage(companyId, { chatId, provider: 'whatsapp_web', waMessageId: `${chatId}-1`, body: 'cerafix 10 sak berapa?', messageType: 'chat', timestamp: Math.floor(Date.now() / 1000) });
    await db.recordOutboundReply({ chatId, author: 'ai', body: 'CERAFIX Rp 95.000 per sak kak.' }, companyId);
    assert.equal((await stageNow()).stage, 'inquiry');

    // (b) rincian
    const rincian = buildSummary({ items: [{ name: 'MU 420 CERAFIX 25KG', qty: 10, unitPrice: 95000, unit: 'sak' }], shipping: 0 }).text;
    await db.recordOutboundReply({ chatId, author: 'ai', body: rincian }, companyId);
    const summary = await stageNow();
    assert.equal(summary.stage, 'summary');
    assert.equal(summary.data.grandTotal, 'Rp 950.000');

    // (c) proforma
    await db.createAiSalesDocument(companyId, { kind: 'proforma', chatId, number: 'PF-UJI1', total: 950000, payload: { lines: [{ name: 'MU 420 CERAFIX 25KG', qty: 10, unit: 'sak' }] } });
    const proforma = await stageNow();
    assert.equal(proforma.stage, 'proforma');
    assert.equal(proforma.data.documentNumber, 'PF-UJI1');

    // (d) rekening dikirim sesudahnya -> menunggu pembayaran, total dari proforma
    await db.pool.query("INSERT INTO payment_accounts (company_id, bank_name, account_number) VALUES ($1, 'BCA', '8877665544')", [companyId]);
    await db.recordOutboundReply({ chatId, author: 'ai', body: 'Silakan transfer ke BCA 8877 665 544 ya kak.' }, companyId);
    const payment = await stageNow();
    assert.equal(payment.stage, 'payment');
    assert.equal(payment.data.grandTotal, 'Rp 950.000');
    assert.equal(payment.data.documentNumber, 'PF-UJI1');

    // (e) pertanyaan ke departemen belum dijawab -> ditahan
    const dept = await db.pool.query("INSERT INTO departments (company_id, name) VALUES ($1, 'Gudang uji tahap') RETURNING id", [companyId]);
    await db.pool.query('INSERT INTO department_questions (company_id, department_id, chat_id, question) VALUES ($1, $2, $3, $4)', [companyId, dept.rows[0].id, chatId, 'stok cerafix?']);
    assert.equal((await stageNow()).stage, 'waiting_internal');
    await db.pool.query("UPDATE department_questions SET status = 'answered' WHERE company_id = $1 AND chat_id = $2", [companyId, chatId]);

    // Bukti transfer -> berhenti; bukti yang ditolak staf tidak dihitung.
    await db.recordPaymentProof(companyId, { chatId, waMessageId: `${chatId}-proof`, verdict: 'cocok', expectedAmount: 950000 });
    assert.equal((await stageNow()).stop, 'payment_sent');
    await db.pool.query("UPDATE payment_proofs SET review_status = 'rejected' WHERE company_id = $1 AND chat_id = $2", [companyId, chatId]);
    assert.equal((await stageNow()).stage, 'payment');

    // Saklar tahap + plafon bawaan tersimpan.
    const saved = await db.saveFollowUpSettings({ enabled: true, stages: { inquiry: false } }, null, companyId);
    assert.deepEqual(saved.stages, { inquiry: false, summary: true, proforma: true, payment: true });
    const merged = await db.saveFollowUpSettings({ stages: { payment: false } }, null, companyId);
    assert.deepEqual(merged.stages, { inquiry: false, summary: true, proforma: true, payment: false });

    // Rangkaian yang ditunda tidak muncul di daftar jatuh tempo sampai waktunya.
    await db.startFollowUpSequence(chatId, companyId);
    const due = async () => (await db.listDueFollowUps(500)).some((row) => row.chatId === chatId);
    assert.equal(await due(), true);
    await db.snoozeFollowUp(chatId, companyId, new Date(Date.now() + 3600_000));
    assert.equal(await due(), false);
    const state = await db.getFollowUpState(chatId, companyId);
    assert.deepEqual(state.stages, { inquiry: false, payment: false, summary: true, proforma: true });
    // Dipasang ulang (kita membalas lagi) = penundaan hilang.
    await db.startFollowUpSequence(chatId, companyId);
    assert.equal(await due(), true);

    // Tahap tercatat per kiriman; alasan berhenti baru diterima constraint.
    await db.recordFollowUpSend({ chatId, dayIndex: 0, attemptInDay: 1, body: 'uji', stage: 'payment' }, companyId);
    assert.equal((await db.listFollowUpSends(chatId, companyId))[0].stage, 'payment');
    assert.equal(await db.stopFollowUpSequence(chatId, companyId, 'payment_sent'), true);
    await db.startFollowUpSequence(chatId, companyId);
    assert.equal(await db.stopFollowUpSequence(chatId, companyId, 'declined'), true);
  });
