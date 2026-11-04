'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const departmentAsk = require('../src/department-ask');

test('pertanyaan majemuk bernomor (contoh nyata PT Rajawali) ditolak', () => {
  const q = 'Pembeli kantor PT Rajawali pesan keramik 5 dus. Mohon konfirmasi: (1) ketersediaan stok tiap item; (2) bisa DP 30% dengan pelunasan setelah barang dikirim; (3) harga diskon/nett pembelian kantor; (4) bisa terbitkan Faktur Pajak; (5) gratis ongkir dan estimasi kirim.';
  assert.match(departmentAsk.compoundProblem(q), /SATU keputusan/);
});

test('daftar bernomor gaya "1." juga terdeteksi, pertanyaan terlalu panjang ditolak', () => {
  assert.ok(departmentAsk.compoundProblem('Mohon: 1. stok ada? 2. bisa DP? 3. diskon berapa?'));
  assert.ok(departmentAsk.compoundProblem('a'.repeat(450)));
});

test('pertanyaan ringkas satu keputusan lolos (contoh semen)', () => {
  assert.equal(departmentAsk.compoundProblem('Semen Jakarta PCC 50kg, 20 zak @Rp57.500 untuk pondasi di Meruya. Boleh diberi potongan? Berapa?'), null);
  assert.equal(departmentAsk.compoundProblem('Harga 1.5 juta untuk 2 unit, boleh nett?'), null);
});

test('panduan menyuruh cek data sendiri dulu dan satu keputusan per pertanyaan', () => {
  const g = departmentAsk.guide([{ name: 'Management', description: '' }]);
  assert.match(g, /SATU pertanyaan = SATU keputusan/);
  assert.match(g, /Cek data sendiri DULU/);
});
