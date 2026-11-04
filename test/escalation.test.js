'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const esc = require('../src/escalation.js');
const guard = require('../src/uncertainty-guard.js');

const FACTS = 'Toko ESBEJE. MU 480 Rp 313.000 per sak. Pengiriman Lalamove 1 hari kerja untuk Jabodetabek.';
const assess = (over) => guard.assess({ priceSource: FACTS, factSource: FACTS, toolText: '', toolOutputs: [], ...over });

test('jawaban bersih tidak dieskalasi', () => {
  const a = assess({ customerText: 'harga MU 480?', rawText: 'MU 480 Rp 313.000 per sak, Kak.', finalText: 'MU 480 Rp 313.000 per sak, Kak.' });
  assert.deepEqual(esc.shouldEscalate({ assessment: a, enforced: { rewritten: false, stripped: false } }), { escalate: false, why: [] });
});

test('harga karangan memicu eskalasi', () => {
  const a = assess({ customerText: 'harga MU 100?', rawText: 'MU 100 Rp 75.000 per sak.', finalText: 'Saya pastikan dulu ya Kak.' });
  const v = esc.shouldEscalate({ assessment: a });
  assert.equal(v.escalate, true);
  assert.ok(v.why.includes('invented_price'));
});

test('kontrak yang menulis ulang atau membuang kalimat memicu eskalasi', () => {
  assert.equal(esc.shouldEscalate({ assessment: { reasons: [] }, enforced: { rewritten: true } }).escalate, true);
  assert.equal(esc.shouldEscalate({ assessment: { reasons: [] }, enforced: { stripped: true } }).escalate, true);
});

test('alat tak menemukan data tidak dieskalasi: model kuat pun tak punya datanya', () => {
  const v = esc.shouldEscalate({ assessment: { reasons: [{ code: 'tool_no_result' }] } });
  assert.deepEqual(v, { escalate: false, why: [] });
});

test('empty_promise saja tidak dieskalasi (penjaga yang menanganinya)', () => {
  assert.equal(esc.shouldEscalate({ assessment: { reasons: [{ code: 'empty_promise' }] } }).escalate, false);
});

test('panggilan alat bocor sebagai teks: dibuang dan memicu eskalasi', () => {
  const leaked = esc.stripToolLeak('{"tool":"functions.cek_alamat","parameters":{"alamat":"x"}}\nTim akan verifikasi ya Kak.');
  assert.equal(leaked.leaked, true);
  assert.equal(leaked.text, 'Tim akan verifikasi ya Kak.');
  assert.equal(esc.stripToolLeak('Harga Rp 79.000 per zak Kak.').leaked, false);
  assert.deepEqual(esc.shouldEscalate({ assessment: { reasons: [] }, leaked: true }), { escalate: true, why: ['tool_leak'] });
});

test('klaim uang masuk memicu eskalasi', () => {
  const a = assess({ customerText: 'sudah transfer ya', rawText: 'Dana sudah masuk Kak, pesanan diproses.', finalText: 'Dana sudah masuk Kak, pesanan diproses.' });
  assert.equal(esc.shouldEscalate({ assessment: a }).escalate, true);
});

test('rantai eskalasi: parse, buang model yang sama dengan yang sudah dipakai, kosong = mati', () => {
  assert.deepEqual(esc.parseChain(' a/b , c/d ,a/b'), ['a/b', 'c/d']);
  assert.deepEqual(esc.parseChain(['x/y', '']), ['x/y']);
  assert.deepEqual(esc.pickEscalationChain('a/b,c/d', 'a/b'), ['c/d']);
  assert.deepEqual(esc.pickEscalationChain('a/b', 'a/b'), []);
  assert.deepEqual(esc.pickEscalationChain('', 'a/b'), []);
});

test('hasil eskalasi dipakai hanya bila ada teks dan masalahnya tidak lebih banyak', () => {
  const first = { why: ['invented_price', 'hedge'] };
  assert.equal(esc.chooseOutcome({ first, second: null }), 'first');
  assert.equal(esc.chooseOutcome({ first, second: { text: '', why: [] } }), 'first');
  assert.equal(esc.chooseOutcome({ first, second: { text: 'ok', why: [] } }), 'second');
  assert.equal(esc.chooseOutcome({ first, second: { text: 'ok', why: ['invented_price'] } }), 'second');
  assert.equal(esc.chooseOutcome({ first: { why: ['hedge'] }, second: { text: 'ok', why: ['hedge', 'invented_price'] } }), 'first');
});

test('AI_ESCALATION_CHAIN: tidak diset = bawaan (hidup), off = mati, selain itu apa adanya', () => {
  assert.equal(esc.chainFromEnv(undefined), esc.DEFAULT_ESCALATION_CHAIN);
  assert.ok(esc.DEFAULT_ESCALATION_CHAIN.length > 0);
  for (const off of ['off', 'OFF', 'none', 'false', '0', '', '  ']) assert.equal(esc.chainFromEnv(off), '', off);
  assert.equal(esc.chainFromEnv(' a/b,c/d '), 'a/b,c/d');
});
