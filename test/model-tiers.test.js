'use strict';

/**
 * Id model asli tidak boleh sampai ke browser pelanggan. Lihat src/model-tiers.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const tiers = require('../src/model-tiers');

test('id dikenal menjadi kunci tingkatan, id asing menjadi custom', () => {
  assert.deepEqual(
    tiers.chainToKeys(['google/gemini-2.5-flash', 'anthropic/claude-sonnet-5', 'vendor/model-lama']),
    ['mid-d', 'top', 'custom'],
  );
});

test('kunci kembali ke id asli, dan custom memulihkan id lama sesuai urutan', () => {
  const chain = tiers.keysToChain(['custom', 'high', 'custom'], {
    storedChain: ['vendor/lama-1', 'google/gemini-2.5-flash', 'vendor/lama-2'],
    defaultModel: 'google/gemini-2.5-flash',
  });
  assert.deepEqual(chain, ['vendor/lama-1', 'anthropic/claude-haiku-4.5', 'vendor/lama-2']);
});

test('custom tanpa yang bisa dipulihkan dibuang, bukan ditulis sebagai kata "custom"', () => {
  assert.deepEqual(tiers.keysToChain(['custom', 'low-a'], { storedChain: [], defaultModel: 'google/gemini-2.5-flash' }), ['mistralai/mistral-nemo']);
});

test('field model di JSON diganti label tingkatan, isi teks percakapan tidak tersentuh', () => {
  const body = JSON.stringify({
    model: 'anthropic/claude-haiku-4.5',
    reply: 'tulis "model":"google/gemini-2.5-flash" persis',
    nested: { model: 'vendor/tak-dikenal' },
  });
  const out = JSON.parse(tiers.maskModelFields(body));
  assert.equal(out.model, 'High-end AI model');
  assert.equal(out.nested.model, 'AI model');
  assert.equal(out.reply, 'tulis "model":"google/gemini-2.5-flash" persis');
});
