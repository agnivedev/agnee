'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const credit = require('../src/credit-plans.js');

const base = { usdIdrRate: 16_500, markup: 3, creditPriceIdr: 1 };

test('biaya AI menjadi credit: kurs x markup, diskon mengurangi', () => {
  assert.equal(credit.creditCostOf(0.0016, base), 79.2);
  assert.equal(credit.creditCostOf(0.0016, { ...base, discountPct: 60 }), 31.68);
  // diskon di atas batas (60) dipotong ke 60
  assert.equal(credit.creditCostOf(0.0016, { ...base, discountPct: 150 }), 31.68);
});

test('biaya tidak dilaporkan atau rusak tidak memotong apa pun', () => {
  for (const bad of [0, -1, null, undefined, NaN, 'x']) assert.equal(credit.creditCostOf(bad, base), 0);
});

test('top-up Rp menjadi credit sesuai harga credit', () => {
  assert.equal(credit.creditsForTopup(100_000), 1_000);
  assert.equal(credit.creditsForTopup(100_000, { creditPriceIdr: 1 }), 100_000);
  assert.equal(credit.creditsForTopup(100_000, { creditPriceIdr: 2 }), 50_000);
  assert.equal(credit.creditsForTopup(-5), 0);
});

test('konfigurasi dari env: nilai rusak jatuh ke bawaan', () => {
  assert.equal(credit.loadCreditConfig({}).markup, 3.85);
  assert.equal(credit.loadCreditConfig({ CREDIT_MARKUP: '2.5' }).markup, 2.5);
  assert.equal(credit.loadCreditConfig({ CREDIT_MARKUP: 'abc' }).markup, 3.85);
  assert.equal(credit.loadCreditConfig({ CREDIT_GRACE_DAYS: '0' }).graceDays, 0);
  assert.equal(credit.loadCreditConfig({}).graceDays, 3);
});

test('diskon dibatasi 60 dan top-up lifetime lebih mahal dari paket bulanan', () => {
  assert.equal(credit.creditCostOf(0.0016, { ...base, discountPct: 90 }), credit.creditCostOf(0.0016, { ...base, discountPct: 60 }));
  assert.equal(credit.creditCostOf(0.0016, { ...base, discountPct: 60 }), 31.68);
  const cfg = credit.loadCreditConfig({});
  // harga efektif per credit paket bulanan: Rp 177-198
  const efektif = ['starter', 'growth', 'pro'].map((k) => credit.CREDIT_PLANS[k].priceIdr / credit.CREDIT_PLANS[k].monthlyCredit);
  assert.ok(Math.max(...efektif) < credit.topupPriceFor('lifetime', cfg));
  assert.ok(Math.max(...efektif) < credit.topupPriceFor('starter', cfg));
  assert.equal(credit.CREDIT_PLANS.lifetime.priceIdr, 8_900_000);
  assert.equal(credit.CREDIT_PLANS.lifetime.monthlyCredit, 0);
  assert.equal(credit.CREDIT_PLANS.lifetime.maxUsers, credit.CREDIT_PLANS.starter.maxUsers);
});

test('rantai model dibatasi tingkatan paket', () => {
  const chain = ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash', 'mistralai/mistral-nemo'];
  assert.deepEqual(credit.filterChainForPlan(chain, 'starter'), ['google/gemini-2.5-flash', 'mistralai/mistral-nemo']);
  assert.deepEqual(credit.filterChainForPlan(chain, 'growth'), chain.slice(1));
  assert.deepEqual(credit.filterChainForPlan(chain, 'pro'), chain);
  assert.deepEqual(credit.filterChainForPlan(chain, 'company'), chain);
});

test('batas dan fitur paket', () => {
  assert.deepEqual(credit.limitsOfPlan('starter'), { maxUsers: 1, maxWhatsapp: 1, maxPlaybooks: 1 });
  assert.equal(credit.planAllows('starter', 'broadcast'), false);
  assert.equal(credit.planAllows('growth', 'broadcast'), true);
  assert.equal(credit.planAllows('company', 'broadcast'), true);
  assert.equal(credit.limitsOfPlan('company'), null);
});
