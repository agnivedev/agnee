'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const KnowledgeBase = require('../src/knowledge-loader.js');

test('pack netral kosong: tarif/FAQ brand mana pun tak bisa bocor ke company tanpa pack sendiri', async () => {
  const kb = new KnowledgeBase({ clientId: 'netral' });
  await kb.load();
  assert.equal(kb.loaded, true);
  assert.equal(kb.faqDatabase.size, 0);
  for (const q of ['Buka harga brp?', 'berapa harga paket', 'paket starter', 'fitur apa saja', 'integrasi whatsapp']) {
    assert.deepEqual(kb.findRelevantFaq(q), [], q);
  }
});

test('pack agnee tetap ada untuk company yang menjual Agnee (dipilih eksplisit)', async () => {
  const kb = new KnowledgeBase({ clientId: 'agnee' });
  await kb.load();
  assert.match(kb.findRelevantFaq('Buka harga brp?').map((f) => f.answer).join('\n'), /Rp\s?99\.000/);
});

test('company baru dan fallback galat memakai pack netral, bukan agnee', () => {
  const root = path.join(__dirname, '..', 'src');
  const database = fs.readFileSync(path.join(root, 'database.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(database, /VALUES \(\$1, \$2, \$3, 'trial', 'netral'/);
  assert.match(server, /const NEUTRAL_KNOWLEDGE_CLIENT = 'netral'/);
});
