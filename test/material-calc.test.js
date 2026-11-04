'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate, toolSpec, GUIDE } = require('../src/material-calc');

test('luas bangunan 60 m2 pasang bata: angka keluar dan minta konfirmasi luas', () => {
  const r = calculate({ pekerjaan: 'pasang_bata', luas_m2: 60 });
  assert.equal(r.status, 'ok');
  assert.equal(r.luas_dinding_m2, 150);
  assert.equal(r.semen_kg, 1812);
  assert.equal(r.zak_50kg, 37);
  assert.equal(r.zak_40kg, 46);
  assert.equal(r.bata_buah, 11025);
  assert.ok(r.perlu_ditanyakan);
  assert.equal(r.waste_persen, 5);
  assert.ok(r.zak_40kg && r.zak_50kg, 'dua kemasan sekaligus');
});

test('luas dinding dipakai apa adanya', () => {
  const r = calculate({ pekerjaan: 'acian', luas_m2: 100, jenis_luas: 'dinding' });
  assert.equal(r.zak_50kg, 7);
  assert.match(r.perlu_ditanyakan, /tebal spesi/);
});

test('input tidak valid ditolak', () => {
  assert.equal(calculate({ pekerjaan: 'x', luas_m2: 5 }).status, 'gagal');
  assert.equal(calculate({ pekerjaan: 'plester', luas_m2: -1 }).status, 'gagal');
});

test('panduan melarang menunda hitungan dan mewajibkan tetap bertanya', () => {
  assert.match(GUIDE, /JANGAN memanggil ask_department/);
  assert.match(GUIDE, /tanyakan data yang menentukan/i);
  assert.equal(toolSpec().name, 'hitung_kebutuhan');
});

const { isCalculable, REFUSE_ASK } = require('../src/material-calc');

test('pertanyaan kasus Pak Rian dikenali sebagai hitungan, bukan keputusan departemen', () => {
  assert.ok(isCalculable('Berapa zak semen Gresik untuk luas 60m2?', 'Saya lg pasang bata merah untuk bangun rumah luas 60m2. Butuh berapa zak yah?'));
  assert.ok(isCalculable('butuh berapa sak semen', 'luas 45 m² pasang bata'));
  assert.match(REFUSE_ASK, /hitung_kebutuhan/);
});

test('pertanyaan harga/stok/verifikasi tidak dikira hitungan', () => {
  assert.ok(!isCalculable('Semen Gresik 50kg 20 zak boleh diskon berapa?', 'ada diskon ga kalau ambil 20 zak?'));
  assert.ok(!isCalculable('Ada kode verifikasi Facebook?', 'tolong kirim kode verifikasi facebook saya'));
  assert.ok(!isCalculable('stok semen ada berapa zak?', 'stok semen gresik ada berapa zak?'));
});

test('panduan mewajibkan dua kemasan, waste, dan tanya tebal spesi/ukuran bata/luas bersih', () => {
  assert.match(GUIDE, /KEDUA kemasan/);
  assert.match(GUIDE, /waste 5%/);
  assert.match(GUIDE, /tebal spesi/);
});
