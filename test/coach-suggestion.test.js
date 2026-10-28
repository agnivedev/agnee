'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cs = require('../src/coach-suggestion');

const BASE = { customerMessage: 'kak bisa COD ke Bekasi?', suggestedReply: 'Bisa COD Jabodetabek kak, ongkir Rp 15.000.' };

test('placeholder angka kosong dan titik-titik terdeteksi', () => {
  for (const text of ['harga Rp ... per sak', 'mulai dari Rp … per unit', 'cek dulu...', 'isi [nama toko] ya']) {
    assert.equal(cs.findPlaceholder(text), true, text);
  }
  assert.equal(cs.findPlaceholder('Harga Rp 15.000 per sak.'), false);
});

test('parseDistill: fakta valid dari model', () => {
  const out = cs.parseDistill(JSON.stringify({
    decision: 'fact', reason: 'Kebijakan COD.', question: 'Apakah bisa COD ke Bekasi?',
    answer: 'Bisa COD untuk Jabodetabek, ongkir Rp 15.000.', category: 'faq',
  }), { mode: 'auto', ...BASE });
  assert.equal(out.decision, 'fact');
  assert.deepEqual(out.problems, []);
  assert.equal(out.needsEdit, false);
  assert.equal(out.draft.category, 'faq');
});

test('parseDistill: mode auto menghormati discard, mode accept tetap memberi draf apa adanya', () => {
  const discard = JSON.stringify({ decision: 'discard', reason: 'Hanya soal gaya bicara.' });
  const auto = cs.parseDistill(discard, { mode: 'auto', ...BASE });
  assert.equal(auto.decision, 'discard');
  assert.equal(auto.draft, null);
  assert.match(auto.reason, /gaya/);

  const accept = cs.parseDistill(discard, { mode: 'accept', ...BASE });
  assert.equal(accept.decision, 'fact');
  assert.equal(accept.needsEdit, true);
  assert.equal(accept.draft.answer, BASE.suggestedReply);
  assert.match(accept.reason, /sunting/);
});

test('parseDistill: keluaran model rusak tidak melempar', () => {
  assert.equal(cs.parseDistill('bukan json', { mode: 'auto', ...BASE }).decision, 'discard');
  assert.equal(cs.parseDistill('', { mode: 'accept', ...BASE }).needsEdit, true);
});

test('draf dengan "Rp ..." diberi masalah dan tidak lolos checkDraft', () => {
  const draft = { question: 'Berapa harga semen?', answer: 'Semen Jakarta mulai dari Rp ... per sak.', category: 'pricing' };
  assert.equal(cs.draftProblems(draft).length, 1);
  const checked = cs.checkDraft(draft);
  assert.equal(checked.ok, false);
  assert.match(checked.problems[0], /kosong|titik/);
});

test('draf dengan data pribadi ditolak, draf wajar lolos dan dinormalkan', () => {
  assert.equal(cs.checkDraft({ question: 'Siapa yang bisa dihubungi?', answer: 'Hubungi 081234567890 ya kak.' }).ok, false);
  const ok = cs.checkDraft({ question: '  Apakah bisa COD ke Bekasi? ', answer: 'Bisa COD Jabodetabek, ongkir Rp 15.000.', customerMessage: 'bisa cod?' });
  assert.equal(ok.ok, true);
  assert.equal(ok.question, 'Apakah bisa COD ke Bekasi?');
  assert.equal(ok.category, 'faq');
});

test('kunci simulasi sama untuk teks yang sama (abaikan huruf/spasi) dan beda antar company', () => {
  const a = cs.simulationKey('c1', { question: 'Bisa COD?', answer: 'Bisa  COD kak' });
  assert.equal(a, cs.simulationKey('c1', { question: 'Bisa COD?', answer: 'bisa cod kak' }));
  assert.notEqual(a, cs.simulationKey('c2', { question: 'Bisa COD?', answer: 'Bisa COD kak' }));
  assert.notEqual(a, cs.simulationKey('c1', { question: 'Bisa COD?', answer: 'Tidak bisa COD' }));
});

test('evaluateSimulation: memblokir baris tanpa balasan dan pelanggaran gaya, judge hanya peringatan', () => {
  const good = { before: 'a', after: 'b', rules: { passed: true, warnings: [] }, judge: { verdict: 'pass' } };
  assert.equal(cs.evaluateSimulation([good]).blocked, false);
  assert.equal(cs.evaluateSimulation([]).blocked, true);
  assert.equal(cs.evaluateSimulation([{ ...good, after: null }]).blocked, true);
  assert.equal(cs.evaluateSimulation([{ ...good, rules: { passed: false, warnings: ['x'] } }]).blocked, true);
  const warned = cs.evaluateSimulation([{ ...good, judge: { verdict: 'revise' } }]);
  assert.equal(warned.blocked, false);
  assert.equal(warned.judgeWarnings, 1);
});
