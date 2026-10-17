'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../src/database.js');
const credit = require('../src/credit-plans.js');

const DB_URL = process.env.DATABASE_URL;

/** Postgres asli: yang diuji adalah transaksi, penguncian baris, dan urutan kantong. */
test('credit: langganan, potong paket lalu top-up, ambang, habis, hangus',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const slug = `credit-${Date.now()}`;
    const { rows } = await db.pool.query("INSERT INTO companies (slug, name, plan) VALUES ($1, $1, 'personal') RETURNING id", [slug]);
    const id = rows[0].id;
    const { rows: legacy } = await db.pool.query("INSERT INTO companies (slug, name, plan) VALUES ($1, $1, 'company') RETURNING id", [`${slug}-lama`]);
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [[id, legacy[0].id]]);
      await db.close();
    });

    // Company lama (bukan mode credit) tidak tersentuh sama sekali.
    assert.equal(await db.debitCredit(legacy[0].id, { amount: 5 }), null);
    await assert.rejects(db.grantCredit(legacy[0].id, { kind: 'topup', amount: 10 }), { code: 'NOT_CREDIT_MODE' });

    const limits = credit.limitsOfPlan('starter');
    let state = await db.subscribeCreditPlan(id, { plan: 'starter', monthlyCredit: 1000, limits });
    assert.equal(state.creditMode, true);
    assert.equal(state.planBalance, 1000);
    const cfg = await db.getCompanyConfig(id);
    assert.equal(cfg.maxUsers, 1);
    assert.equal(cfg.creditTotal, 1000);

    await db.grantCredit(id, { kind: 'topup', amount: 500, note: 'uji' });

    // 600 dari kantong paket (sisa 400); belum melewati ambang 20% dari 1000.
    let r = await db.debitCredit(id, { amount: 600, purpose: 'auto_reply' });
    assert.equal(r.planBalance, 400);
    assert.equal(r.topupBalance, 500);
    assert.equal(r.crossed, null);

    // 300 habiskan paket (sisa 100) lalu top-up 400... total 600 -> 200 = tepat 20%: low.
    r = await db.debitCredit(id, { amount: 700, purpose: 'auto_reply' });
    assert.equal(r.planBalance, 0);
    assert.equal(r.topupBalance, 200);
    assert.equal(r.crossed, 'low');

    // Peringatan hanya sekali.
    r = await db.debitCredit(id, { amount: 50 });
    assert.equal(r.crossed, null);

    // Melewati nol: saldo terkunci di 0, selisih tercatat, 'empty' sekali.
    r = await db.debitCredit(id, { amount: 400 });
    assert.equal(r.total, 0);
    assert.equal(r.shortfall, 250);
    assert.equal(r.crossed, 'empty');
    r = await db.debitCredit(id, { amount: 10 });
    assert.equal(r.crossed, null);
    assert.equal((await db.getCompanyConfig(id)).creditTotal, 0);

    // Top-up menghidupkan lagi dan mengatur ulang peringatan.
    await db.grantCredit(id, { kind: 'topup', amount: 1000 });
    assert.equal((await db.getCreditState(id)).alertLevel, null);
    assert.equal((await db.getCompanyConfig(id)).creditTotal, 1000);

    // Debit serentak tidak menghilangkan potongan.
    await Promise.all(Array.from({ length: 10 }, () => db.debitCredit(id, { amount: 10 })));
    assert.equal((await db.getCreditState(id)).total, 900);

    // Hangus: periode + tenggang lewat -> kantong paket nol, top-up utuh.
    await db.subscribeCreditPlan(id, { plan: 'starter', monthlyCredit: 300, limits });
    await db.pool.query("UPDATE companies SET credit_period_end = NOW() - INTERVAL '5 days' WHERE id = $1", [id]);
    const before = await db.getCreditState(id);
    await db.getCompanyConfig(id);
    const after = await db.getCreditState(id);
    assert.equal(before.planBalance, 300);
    assert.equal(after.planBalance, 0);
    assert.equal(after.topupBalance, before.topupBalance);

    // Perpanjang tepat waktu menyambung dari akhir periode.
    await db.subscribeCreditPlan(id, { plan: 'starter', monthlyCredit: 300, limits });
    await db.subscribeCreditPlan(id, { plan: 'starter', monthlyCredit: 300, limits });
    const renewed = await db.getCreditState(id);
    assert.equal(renewed.planBalance, 300, 'sisa lama diganti, tidak menumpuk');
    assert.ok(new Date(renewed.periodEnd) > new Date(Date.now() + 40 * 86_400_000), 'periode bertambah dua bulan');

    const ledger = await db.listCreditLedger(id, 200);
    assert.ok(ledger.some((l) => l.kind === 'usage' && l.shortfall === 250));
    assert.ok(ledger.some((l) => l.kind === 'expire'));
    assert.ok(ledger.some((l) => l.kind === 'subscription'));

    const ids = await db.notifyCredit(id, 'uji');
    assert.ok(Array.isArray(ids));
  });
