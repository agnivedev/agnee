'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KnowledgeBase = require('../src/knowledge-loader.js');

async function load(clientId) {
  const kb = new KnowledgeBase({ clientId });
  await kb.load();
  return kb;
}

test('pack agnee menjawab pertanyaan harga dengan FAQ tarif paket Agnee', async () => {
  const kb = await load('agnee');
  const answers = kb.findRelevantFaq('Buka harga brp?').map((f) => f.answer).join('\n');
  assert.match(answers, /Rp\s?99\.000/);
});

test('agnee-umum: FAQ umum tetap ada, tarif/promo/trial tidak', async () => {
  const base = await load('agnee');
  const umum = await load('agnee-umum');
  assert.equal(umum.loaded, true);
  assert.ok(umum.faqDatabase.size > 0, 'FAQ umum harus tetap ada');
  assert.ok(umum.faqDatabase.size < base.faqDatabase.size, 'berkas tarif harus dikecualikan');
  for (const q of ['Buka harga brp?', 'berapa harga paket', 'paket starter', 'ada promo', 'trial gratis']) {
    const text = JSON.stringify(umum.findRelevantFaq(q));
    assert.doesNotMatch(text, /Rp\s?\d|\d\s?(?:juta|ribu)\b|per bulan|7 hari/i, q);
  }
  // Tidak ada FAQ bernominal di seluruh isi pack turunan.
  for (const faq of umum.faqDatabase.values()) {
    assert.doesNotMatch(`${faq.answer}`, /Rp\s?\d|\b\d{1,3}(?:\.\d{3})+\b/, faq.id);
  }
});

test('agnee-umum: FAQ yang masih ada tetap bisa ditemukan', async () => {
  const umum = await load('agnee-umum');
  const first = [...umum.faqDatabase.values()][0];
  const hit = umum.findRelevantFaq(first.intent[0]);
  assert.ok(hit.length > 0);
});
