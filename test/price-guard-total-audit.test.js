'use strict';

/**
 * Total dan harga terikat barang (price-guard.js).
 * Audit DealPOS-Agnes (ESBEJE, 16 Nov): celah yang terbukti dari balasan AI dan kueri customer nyata.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const priceGuard = require('../src/price-guard.js');

// ---- Total yang salah hitung (5 Nov: Rp 1.508.500, seharusnya Rp 1.613.500) --------------------

const PIPA_SOURCE = [
  '- RUCIKA STD 4 D: Rp 193.500 per btg',
  '- RUCIKA STD 3/4 AW: Rp 37.000 per btg',
  '- TEKIRO KUNCI RING 25X28mm: Rp 215.500 per pcs',
].join('\n');

test('total: hitungan salah yang kebetulan 7 x harga barang lain ditolak', () => {
  const reply = 'Pipa Rucika 4 inci D harganya Rp 193.500 per batang, dan Pipa Rucika 3/4 inci AW harganya Rp 37.000 per batang.\n\nJadi, totalnya untuk 7 batang Pipa Rucika 4 inci D dan 7 batang Pipa Rucika 3/4 inci AW adalah Rp 1.508.500.';
  const hits = priceGuard.findInventedPrices(reply, PIPA_SOURCE, { quantityText: 'butuh 7 batang' });
  assert.deepEqual(hits.map((h) => h.amount), [1508500]);
  assert.equal(hits[0].total, true);
  const ok = reply.replace('1.508.500', '1.613.500');
  assert.deepEqual(priceGuard.findInventedPrices(ok, PIPA_SOURCE, { quantityText: 'butuh 7 batang' }), []);
});

test('total: satu harga x jumlah dan total yang sama dengan harga satuan tetap lolos', () => {
  const one = 'Semen Jakarta 40KG Rp 45.000 per zak. Untuk 20 zak totalnya Rp 900.000, dan Semen Jakarta 50KG Rp 57.500 per zak.';
  const src = '- SEMEN JAKARTA Type PCC 40KG: Rp 45.000 per zak\n- SEMEN JAKARTA Type PCC 50KG: Rp 57.500 per zak';
  assert.deepEqual(priceGuard.findInventedPrices(one, src, { quantityText: '20 zak' }), []);
  const same = 'MU 480 Rp 313.000 per sak. Total 1 sak Rp 313.000. Semen Rp 45.000 per zak.';
  assert.deepEqual(priceGuard.findBadTotals(same, '', { quantityText: '' }), []);
});

// ---- Nama ditulis terpisah di balasan, rapat di katalog ---------------------------------------

test('harga: "Tiga Roda 40KG" untuk barang "TIGARODA 40KG" bukan harga barang lain', () => {
  const src = [
    '- TIGARODA 40KG: Rp 68.900 per zak',
    '- TIGARODA 50KG: Rp 85.800 per zak',
    '- SEMEN PUTIH TIGA RODA 40KG: Rp 120.000 per zak',
  ].join('\n');
  const reply = 'Semen Tiga Roda 40KG harganya Rp 68.900 per zak, dan Tiga Roda 50KG harganya Rp 85.800 per zak.';
  assert.deepEqual(priceGuard.findInventedPrices(reply, src, { quantityText: '' }), []);
  // Harga barang lain tetap ditolak.
  const wrong = 'Semen Tiga Roda 40KG harganya Rp 85.800 per zak.';
  assert.equal(priceGuard.findInventedPrices(wrong, src, { quantityText: '' }).length, 1);
});

