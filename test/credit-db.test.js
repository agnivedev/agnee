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
    assert.equal(r.crossed, 'p20');

    // Peringatan hanya sekali.
    r = await db.debitCredit(id, { amount: 50 });
    assert.equal(r.crossed, null);

    // Sisa 100 (10%): p10 sekali; sisa 5 (0,5%): p1.
    r = await db.debitCredit(id, { amount: 50 });
    assert.equal(r.total, 100);
    assert.equal(r.crossed, 'p10');
    r = await db.debitCredit(id, { amount: 5 });
    assert.equal(r.crossed, null);
    r = await db.debitCredit(id, { amount: 90 });
    assert.equal(r.total, 5);
    assert.equal(r.crossed, 'p1');

    // Melewati nol: saldo terkunci di 0, selisih tercatat, 'empty' sekali.
    r = await db.debitCredit(id, { amount: 400 });
    assert.equal(r.total, 0);
    assert.equal(r.shortfall, 395);
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
    assert.ok(ledger.some((l) => l.kind === 'usage' && l.shortfall === 395));
    assert.ok(ledger.some((l) => l.kind === 'expire'));
    assert.ok(ledger.some((l) => l.kind === 'subscription'));

    const ids = await db.notifyCredit(id, 'uji');
    assert.ok(Array.isArray(ids));
  });

test('kabar credit: supervisor DAN anggota departemen Management, tanpa duplikat',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const { rows: [co] } = await db.pool.query("INSERT INTO companies (slug, name, plan) VALUES ($1, $1, 'personal') RETURNING id", [`kabar-${stamp}`]);
    const mk = async (tag, role, wa) => {
      const { rows: [u] } = await db.pool.query("INSERT INTO users (email, display_name, password_hash, status) VALUES ($1, $1, 'x', 'active') RETURNING id", [`${tag}-${stamp}@t.test`]);
      await db.pool.query("INSERT INTO company_members (company_id, user_id, role, status, whatsapp_number) VALUES ($1, $2, $3, 'active', $4)", [co.id, u.id, role, wa]);
      return u.id;
    };
    const sup = await mk('sup', 'supervisor', '6281100000001');
    const mgmt = await mk('mgmt', 'agent', '6281100000002');
    const biasa = await mk('biasa', 'agent', '6281100000003');
    const { rows: [dep] } = await db.pool.query("INSERT INTO departments (company_id, name) VALUES ($1, 'Management') RETURNING id", [co.id]);
    await db.pool.query('INSERT INTO department_members (department_id, user_id, company_id) VALUES ($1, $2, $3), ($1, $4, $3)', [dep.id, mgmt, co.id, sup]);
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = $1', [co.id]);
      await db.pool.query('DELETE FROM users WHERE id = ANY($1)', [[sup, mgmt, biasa]]);
      await db.close();
    });

    const ids = await db.notifyCredit(co.id, 'uji');
    assert.deepEqual([...ids].sort(), [sup, mgmt].sort(), 'supervisor + Management, bukan agent biasa, tanpa dobel');
    const recipients = await db.listCreditRecipients(co.id);
    assert.deepEqual(recipients.map((r) => r.whatsappNumber).sort(), ['6281100000001', '6281100000002']);
  });

test('lifetime: credit awal sekali saja ke kantong yang tidak hangus; kuota promo dihitung dari tabel companies',
  { skip: !DB_URL && 'DATABASE_URL tidak diset' }, async (t) => {
    const db = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
    await db.connect();
    const stamp = Date.now();
    const { rows: [co] } = await db.pool.query("INSERT INTO companies (slug, name, plan) VALUES ($1, $1, 'personal') RETURNING id", [`life-${stamp}`]);
    const created = [co.id];
    t.after(async () => {
      await db.pool.query('DELETE FROM companies WHERE id = ANY($1)', [created]);
      await db.pool.query("DELETE FROM users WHERE email LIKE $1", [`promo-${stamp}-%`]);
      await db.close();
    });

    const limits = credit.limitsOfPlan('lifetime');
    const state = await db.subscribeCreditPlan(co.id, { plan: 'lifetime', monthlyCredit: 15000, limits, oneTime: true });
    assert.equal(state.plan, 'lifetime');
    assert.equal(state.planBalance, 0);
    assert.equal(state.topupBalance, 15000);
    assert.equal(state.periodEnd, null);
    await assert.rejects(
      db.subscribeCreditPlan(co.id, { plan: 'lifetime', monthlyCredit: 15000, limits, oneTime: true }),
      { code: 'ONE_TIME_ALREADY' },
    );
    // tidak hangus walau tanggal apa pun
    await db.getCompanyConfig(co.id);
    assert.equal((await db.getCreditState(co.id)).topupBalance, 15000);

    // Kuota promo: hanya pendaftaran publik yang ditandai, dan berhenti di batas.
    const before = await db.getPromoQuota({ limit: 1_000_000 });
    const limit = before.used + 2;
    const signup = (n) => db.createCompanySignup({
      companyName: `Promo ${stamp} ${n}`, plan: 'personal', displayName: 'Uji Promo',
      email: `promo-${stamp}-${n}@t.test`, password: 'password-123', promoQuota: limit,
    });
    for (const n of [1, 2, 3]) created.push((await signup(n)).companyId);
    const quota = await db.getPromoQuota({ limit });
    assert.equal(quota.used, limit, 'ketiga pendaftar masuk tetapi hanya dua yang ditandai promo');
    assert.equal(quota.remaining, 0);
    const flags = (await db.pool.query('SELECT promo_signup FROM companies WHERE id = ANY($1) ORDER BY created_at', [created.slice(1)])).rows.map((r) => r.promo_signup);
    assert.deepEqual(flags, [true, true, false]);
    // company buatan staf (bukan jalur signup) tidak ikut terhitung
    assert.equal((await db.pool.query('SELECT promo_signup FROM companies WHERE id = $1', [co.id])).rows[0].promo_signup, false);
  });
