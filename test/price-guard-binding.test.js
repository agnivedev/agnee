'use strict';

/**
 * Harga terikat barang (price-guard.js, findMismatchedPrices).
 * ESBEJE 29 Okt: "MU 301 Plasterplus Rp 62.000" lolos karena 62.000 ada di
 * prompt sebagai harga barang lain; harga MU 301 di DealPOS Rp 104.000.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/price-guard.js');
const { enforceReplyContract } = require('../src/reply-style.js');

// Bentuk baris daftar harga DealPOS/katalog di prompt.
const PROMPT = [
  'Daftar harga (DealPOS):',
  '- MU 100 BASE PLESTER PREMIUM 40KG [1000003303]: Rp 116.400 per sak',
  '- MU 301 PLASTERPLUS 40KG: Rp 104.000 per sak → diskon 10% jadi Rp 93.600',
  '- MU 200 ACIAN PUTIH 40KG: Rp 134.000 per sak',
  '- SEMEN JAKARTA TYPE PCC 50KG: Rp 57.500 per sak',
  '- SEMEN GRESIK 40KG: Rp 61.500 per zak',
  '- SEMEN GRESIK 50KG: Rp 79.000 per zak',
  '- DANABRITE 2290 BRILLIANT WHITE 5KG: Rp 125.000 per gln',
  '- DANABRITE 0001 WHITE 25KG: Rp 570.000 per pail',
  '- TOREN PENGUIN TB110 1050L BIRU TUA: Rp 2.619.000 per pcs',
  '- TOREN PENGUIN TB110 1050L ORANGE: Rp 2.745.000 per pcs',
  'Promo: semen instan JKT-M25 hanya Rp 62.000 per sak minggu ini.',
].join('\n');

const bad = (reply, opts) => guard.findInventedPrices(reply, PROMPT, opts);

test('angka milik barang lain ditolak walau angkanya ada di sumber', () => {
  const hits = bad('Untuk plester, MU 301 Plasterplus Rp 62.000 per sak kak.');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].amount, 62000);
  assert.deepEqual(hits[0].seharusnya, [93600, 104000]);
  assert.match(hits[0].barang, /MU 301 Plasterplus/);

  // Varian yang salah: harga 40KG disebut untuk 50KG.
  assert.equal(bad('Semen Gresik 50KG Rp 61.500 per zak.').length, 1);
  // Harga MU 100 dipakai untuk MU 200.
  assert.equal(bad('Acian MU 200 seharga Rp 116.400 ya kak.').length, 1);
});

test('harga yang benar, varian, diskon, dan kelipatan tetap lolos', () => {
  assert.deepEqual(bad('MU 301 Plasterplus Rp 104.000 per sak, lagi diskon jadi Rp 93.600 kak.'), []);
  assert.deepEqual(bad('Semen Gresik 40KG Rp 61.500 dan Semen Gresik 50KG Rp 79.000 per zak.'), []);
  assert.deepEqual(bad('Danabrite 2290 Brilliant White 5KG seharga Rp 125.000 per gln dan Danabrite 0001 White 25KG seharga Rp 570.000 per pail.'), []);
  assert.deepEqual(bad('Toren Penguin 1050L biru tua Rp 2.619.000, orange Rp 2.745.000 per pcs.'), []);
  assert.deepEqual(bad('Semen instan JKT-M25 lagi promo Rp 62.000 per sak.'), []);
  // Kelipatan dengan jumlah yang disebut customer.
  assert.deepEqual(bad('10 sak MU 301 jadi Rp 1.040.000 kak.', { quantityText: 'mau 10 sak' }), []);
});

test('total, ongkir, dan kalimat tanpa nama barang tidak diikat', () => {
  assert.deepEqual(bad('MU 301 Rp 104.000 + MU 200 Rp 134.000, total MU 301 dan MU 200 Rp 238.000.'), []);
  assert.deepEqual(bad('Harganya Rp 104.000 per sak kak.'), []);
  // Kalimat harga tanpa nama merujuk barang di kalimat sebelumnya.
  assert.equal(bad('Cocok pakai MU 301 Plasterplus. Harganya Rp 62.000 per sak.').length, 1);
  assert.deepEqual(bad('Cocok pakai MU 301 Plasterplus. Harganya Rp 104.000 per sak.'), []);
  assert.deepEqual(bad('Bisa MU 100 atau MU 301. Harganya Rp 104.000 per sak.'), [], 'dua barang disebut: salah satunya cukup');
  // Kata khas cuma satu ("semen"): tak cukup untuk menunjuk satu barang.
  assert.deepEqual(bad('Semen mulai Rp 57.500 per sak.'), []);
});

test('hasil alat cek_harga (JSON) ikut mengikat nama ke harga', () => {
  const tool = JSON.stringify({ status: 'ok', hasil: [
    { nama: 'MU 480 RENOFIX 25KG', harga: 'Rp 313.000 per zak', satuan: 'zak' },
    { nama: 'RUCIKA STD 4 D', harga: 'Rp 193.500 per btg', satuan: 'btg' },
  ] });
  const src = `${PROMPT}\n${tool}`;
  assert.deepEqual(guard.findInventedPrices('MU 480 Renofix Rp 313.000 per zak kak.', src), []);
  assert.equal(guard.findInventedPrices('Paralon Rucika 4 D Rp 313.000 per batang.', src).length, 1);
});

test('kontrak balasan: model diminta memakai harga dari daftar, dibuang bila membandel', async () => {
  const salah = 'Untuk plester dinding cocok MU 301 Plasterplus Rp 62.000 per sak kak. Butuh berapa sak untuk dindingnya kak?';
  let prompt = '';
  const patuh = { enabled: true, async generateReply(p) { prompt = p; return { text: 'Untuk plester dinding cocok MU 301 Plasterplus Rp 104.000 per sak kak. Butuh berapa sak untuk dindingnya kak?' }; } };
  const fixed = await enforceReplyContract(patuh, { text: salah, systemPrompt: '', userMessage: 'plester dinding', priceSource: PROMPT });
  assert.equal(fixed.rewritten, true);
  assert.match(prompt, /padahal harga barang itu di daftar Rp 93\.600 \/ Rp 104\.000/);
  assert.match(fixed.text, /104\.000/);

  const membandel = { enabled: true, async generateReply() { return { text: salah }; } };
  const stripped = await enforceReplyContract(membandel, { text: salah, systemPrompt: '', userMessage: 'plester dinding', priceSource: PROMPT });
  assert.equal(stripped.stripped, true);
  assert.ok(!/62\.000/.test(stripped.text));
});
