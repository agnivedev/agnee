'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/price-guard.js');
const lookup = require('../src/price-lookup.js');
const { enforceReplyContract } = require('../src/reply-style.js');

const SOURCE = [
  'MU 100 BASE PLESTER PREMIUM 40KG: Rp 116.400 per sak',
  'MU 301 PLASTERPLUS 40KG: Rp 104.000 per sak',
  '{"ongkir_angka":85000,"ongkir":"Rp 85.000"}',
  'customer: budget saya 2 juta',
].join('\n');

test('angka rupiah dibaca dari berbagai tulisan', () => {
  const amounts = (t) => guard.extractAmounts(t).map((a) => a.amount);
  assert.deepEqual(amounts('Rp 75.000 per sak, Rp90.000,- dan Rp. 1.250.000'), [75000, 90000, 1250000]);
  assert.deepEqual(amounts('sekitar 120rb atau 1,5 juta, 2jt, 75 ribu').sort((x, y) => x - y), [75000, 120000, 1500000, 2000000]);
  assert.deepEqual(amounts('Rp 500 saja dan 40 sak'), [], 'di bawah seribu bukan harga barang');
  assert.deepEqual(amounts('Rp 2,5 juta'), [2500000]);
});

test('harga yang ada di sumber, kelipatannya, dan jumlahnya sah; angka lain karangan', () => {
  const invented = (reply) => guard.findInventedPrices(reply, SOURCE).map((v) => v.amount);
  assert.deepEqual(invented('MU 100 Rp 116.400 per sak, MU 301 Rp 104.000.'), []);
  assert.deepEqual(invented('10 sak MU 100 jadi Rp 1.164.000, ongkir Rp 85.000, total Rp 1.249.000.'), [], 'kelipatan dan kelipatan + ongkir');
  assert.deepEqual(invented('Budget Rp 2 juta cukup untuk 17 sak.'), []);
  // Kasus ESBEJE 28 Okt.
  assert.deepEqual(invented('MU 100 Base Plester seharga Rp 75.000 per sak, atau MU 301 Plasterplus Rp 90.000 per sak. Butuh berapa sak, kak?'), [75000]);
  assert.deepEqual(invented('Total Rp 1.249.001 ya kak'), [1249001]);
  assert.deepEqual(invented('Saya cek dulu harganya ya kak'), []);
});

test('stripInventedPrices membuang hanya kalimat yang menyebut harga karangan', () => {
  const reply = 'Untuk dinding retak cocok MU 100 Base Plester. Harganya Rp 75.000 per sak. Butuh berapa sak, kak?';
  assert.equal(guard.stripInventedPrices(reply, SOURCE), 'Untuk dinding retak cocok MU 100 Base Plester.\nButuh berapa sak, kak?');
  assert.equal(guard.stripInventedPrices('Harganya Rp 116.400 per sak.', SOURCE), 'Harganya Rp 116.400 per sak.');
});

test('kontrak balasan: harga karangan ditulis ulang, atau dibuang bila model membandel', async () => {
  const karangan = 'Cocok MU 100 Base Plester seharga Rp 75.000 per sak, kak. Mau berapa sak ya kak untuk pekerjaannya?';
  const patuh = { enabled: true, async generateReply() { return { text: 'Cocok MU 100 Base Plester, kak. Harga persisnya saya pastikan dulu ya. Mau berapa sak?' }; } };
  const fixed = await enforceReplyContract(patuh, { text: karangan, systemPrompt: '', userMessage: 'dinding retak', priceSource: SOURCE });
  assert.equal(fixed.rewritten, true);
  assert.ok(!/75\.000/.test(fixed.text));

  const membandel = { enabled: true, async generateReply() { return { text: karangan }; } };
  const stripped = await enforceReplyContract(membandel, { text: karangan, systemPrompt: '', userMessage: 'dinding retak', priceSource: SOURCE });
  assert.equal(stripped.stripped, true);
  assert.ok(!/75\.000/.test(stripped.text));
  assert.match(stripped.text, /Mau berapa sak/);

  // Hanya harga karangan dan tidak ada isi lain: tidak ada balasan otomatis (jatuh ke manusia).
  const hanyaHarga = 'Harganya Rp 75.000 per sak kak.';
  const loud = { enabled: true, async generateReply() { return { text: hanyaHarga }; } };
  assert.equal(await enforceReplyContract(loud, { text: hanyaHarga, systemPrompt: '', userMessage: 'x', priceSource: SOURCE }), null);

  // Tanpa sumber (pemanggil lama), perilaku tidak berubah.
  const lama = await enforceReplyContract(membandel, { text: karangan, systemPrompt: '', userMessage: 'x' });
  assert.equal(lama.text, karangan);
});

test('cek_harga: mencari dari nama playbook, kode dua huruf, dan menolak yang tak ada', () => {
  const items = [
    { name: 'MU 100 BASE PLESTER PREMIUM 40KG', code: '1000003303', price: 116400, unit: 'sak', tags: [] },
    { name: 'MU 301 PLASTERPLUS 40KG', price: 104000, unit: 'sak', discountPct: 10, tags: [{ id: 't', name: 'Promo' }] },
    { name: 'SEMEN JAKARTA TYPE PCC 40KG', price: 45000, unit: 'sak', tags: [] },
  ];
  const hit = lookup.lookup(items, { barang: 'MU 100 Base Plester' });
  assert.equal(hit.status, 'ok');
  assert.equal(hit.hasil[0].nama, 'MU 100 BASE PLESTER PREMIUM 40KG');
  assert.equal(hit.hasil[0].harga, 'Rp 116.400 per sak');

  const promo = lookup.lookup(items, { barang: 'plasterplus' }).hasil[0];
  assert.equal(promo.diskon, '10%');
  assert.equal(promo.harga_setelah_diskon, 'Rp 93.600 per sak');

  assert.equal(lookup.lookup(items, { barang: 'genteng metal' }).status, 'tidak_ketemu');
  assert.equal(lookup.lookup(items, { barang: '' }).status, 'kueri_kosong');
  // Angka di hasil alat sah disebut ke customer.
  assert.deepEqual(guard.findInventedPrices('MU 301 diskon jadi Rp 93.600 per sak', JSON.stringify(promo)), []);
});

test('kelipatan hanya sah bila jumlahnya disebut; total hanya sah bila jumlah angka lain di balasan', () => {
  // Prompt dasar memuat satu angka kecil ("Rp 4.000"); dulu 12 x 4.000 meloloskan "Rp 48.000" karangan.
  const kecil = 'Promo ongkos Rp 4.000 per item.\nMU 301 PLASTERPLUS 40KG: Rp 104.000 per sak';
  const invented = (reply, said = '') => guard.findInventedPrices(reply, kecil, { quantityText: said }).map((v) => v.amount);
  assert.deepEqual(invented('MU 301 Plasterplus harganya Rp 48.000 per sak kak.'), [48000]);
  assert.deepEqual(invented('MU 301 Plasterplus harganya Rp 56.000 per sak kak.'), [56000]);
  // Jumlah disebut customer: 3 sak x 104.000 sah.
  assert.deepEqual(invented('3 sak jadi Rp 312.000 ya kak.', 'saya butuh 3 sak'), []);
  assert.deepEqual(invented('Untuk 3 sak, Rp 312.000.'), [], 'jumlah di balasan itu sendiri juga dihitung');
  // Pengali yang tidak disebut di mana pun: karangan.
  assert.deepEqual(invented('Totalnya Rp 312.000 ya kak.'), [312000]);
  // Total = jumlah angka lain di balasan yang sah (harga satuan + ongkir).
  assert.deepEqual(guard.findInventedPrices('Harga Rp 104.000, ongkir Rp 85.000, total Rp 189.000.', 'Rp 104.000\nRp 85.000'), []);
  assert.deepEqual(guard.findInventedPrices('Harga Rp 104.000, ongkir Rp 85.000, total Rp 190.000.', 'Rp 104.000\nRp 85.000').map((v) => v.amount), [190000]);
});
