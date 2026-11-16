'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KnowledgeBase = require('../src/knowledge-loader.js');

test('pack agnee menjawab pertanyaan harga dengan FAQ tarif paket Agnee', async () => {
  const kb = new KnowledgeBase({ clientId: 'agnee' });
  await kb.load();
  assert.ok(kb.findRelevantFaq('Buka harga brp?').length > 0, 'pack agnee seharusnya punya FAQ harga');
});

test('pack tanpa-faq tidak membawa FAQ: tarif Agnee tak bisa bocor ke company non-Agnee', async () => {
  const kb = new KnowledgeBase({ clientId: 'tanpa-faq' });
  await kb.load();
  assert.equal(kb.loaded, true);
  assert.equal(kb.faqDatabase.size, 0);
  for (const q of ['Buka harga brp?', 'berapa harga paket', 'harga semen', 'paket starter']) {
    assert.deepEqual(kb.findRelevantFaq(q), [], q);
  }
});
