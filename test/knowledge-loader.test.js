'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KnowledgeBase = require('../src/knowledge-loader');

test('loads only the selected bZone tenant knowledge', async () => {
  const kb = new KnowledgeBase({ clientId: 'bzone' });
  await kb.load();

  assert.equal(kb.clientProfile.brandName, 'bZone Alpha');
  assert.equal(kb.clientProfile.assistantName, 'Anya');
  assert.ok(kb.faqDatabase.size >= 20);
  assert.match(kb.getSystemPrompt(), /Anda adalah Anya/);
  assert.doesNotMatch(kb.getSystemPrompt(), /customer service Agnee/);
});

test('retrieves bZone product and price facts', async () => {
  const kb = new KnowledgeBase({ clientId: 'bzone' });
  await kb.load();

  const product = kb.findRelevantFaq('Apa itu Bengkel EA Gold?', 1)[0];
  const price = kb.findRelevantFaq('Berapa harga Chainsaw Lifetime?', 1)[0];

  assert.equal(product.id, 'FAQ-BZONE-001');
  assert.match(product.answer, /bZone Alpha/);
  assert.equal(price.id, 'FAQ-PRICE-002');
  assert.match(price.answer, /Rp8\.900\.000/);
});

test('does not silently fall back when a tenant does not exist', async () => {
  const kb = new KnowledgeBase({ clientId: 'missing-client' });
  await kb.load();

  assert.equal(kb.loaded, false);
  assert.equal(kb.faqDatabase.size, 0);
});

test('keeps Agnee platform knowledge separate from bZone', async () => {
  const agnee = new KnowledgeBase({ clientId: 'agnee' });
  const bzone = new KnowledgeBase({ clientId: 'bzone' });
  await agnee.load();
  await bzone.load();

  assert.equal(agnee.clientProfile.brandName, 'Agnee');
  assert.equal(bzone.clientProfile.brandName, 'bZone Alpha');
  assert.equal(agnee.findRelevantFaq('Apa itu Agnee?', 1)[0].id, 'FAQ-PRODUCT-001');
  assert.equal(bzone.findRelevantFaq('Berapa harga Chainsaw?', 1)[0].id, 'FAQ-PRICE-002');
  assert.equal(agnee.faqDatabase.has('FAQ-PRICE-002'), false);
  assert.equal(bzone.faqDatabase.has('FAQ-PRODUCT-001'), false);
});
