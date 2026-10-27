'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const prices = require('../src/dealpos-prices.js');
const catalog = require('../src/catalog.js');
const esbeje = require('./fixtures/esbeje-catalog.js');

/*
 * Pencocokan barang yang menentukan harga mana yang sampai ke prompt AI, diuji
 * dengan nama dan harga ESBEJE asli. Tiga kasus dari simulasi 28 Okt: toren
 * 1050 liter kalah oleh fitting/varian Rp 1 (AI mengarang Rp 1.550.000),
 * perekat keramik tanpa MU 420 CERAFIX (AI mengarang Rp 47.000), dan MU 301
 * yang sudah benar.
 */

const TANKS_1050 = [
  'PENGUIN TB110 1050L BIRU TUA', 'PENGUIN TB110 1050L HITAM', 'PENGUIN TB110 1050L ORANGE',
  'PENGUIN TB110 1050L SANDSTONE', 'PENGUIN TD110 1050L GALAXY MARBLE', 'PENGUIN TD110 1050L SANDSTONE',
];

const TAGS = [
  { id: 't-bs', name: 'Best Seller', autoRule: 'best_seller', highlight: true, aiNote: '', active: true },
  { id: 't-pk', name: 'Perekat Keramik', autoRule: null, highlight: false, aiNote: 'disebut juga lem keramik', active: true },
];
const perekatKeramik = (name) => (/CERAFIX|GRANITFIX|RENOFIX/.test(name) ? [{ id: 't-pk', name: 'Perekat Keramik' }] : []);
const matchedLines = (section) => (section.split('### Cocok dengan percakapan ini\n')[1] || '').split('\n').filter((l) => l.startsWith('- '));

test('ukuran ditulis customer berbeda dengan nama barang tetap jadi satu token', () => {
  assert.deepEqual(prices.tokens('toren 1050 liter'), ['toren', '1050l']);
  assert.deepEqual(prices.tokens('PENGUIN TB110 1050L'), ['penguin', 'tb110', '1050l']);
  assert.deepEqual(prices.tokens('EXCEL 1050LTR'), ['excel', '1050l']);
  assert.deepEqual(prices.tokens('semen 40 kg'), prices.tokens('SEMEN 40KG'));
  assert.deepEqual(prices.tokens('2,5 kg'), prices.tokens('2.5KG'));
  assert.deepEqual(prices.tokens('keramik 60 x 60'), prices.tokens('KERAMIK 60X60'));
  assert.deepEqual(prices.tokens('kape 3 inch'), prices.tokens('KAPE 3"'));
  // "2 lt" di chat bangunan berarti dua lantai, bukan dua liter.
  assert.deepEqual(prices.tokens('rumah 2 lt'), ['2', 'lt']);
  // Kategori DealPOS "B/PLUMBING" terbaca dua kata; pecahan tetap utuh.
  assert.deepEqual(prices.tokens('B/PLUMBING pipa 3/4'), ['plumbing', 'pipa', '3/4']);
  // Kode huruf pendek + angka bertemu dalam dua penulisan.
  assert.ok(prices.matchTerms('kak MU 301 ada?').has('mu301'));
  assert.ok(prices.matchTerms('tb 110').has('tb110'));
  assert.ok(prices.matchTerms('1050L').has('1050'), 'ukuran juga menyumbang angkanya saja');
});

test('kasus 1 (jalur DealPOS): toren Penguin 1050 liter di atas fitting, filter, dan Plumbing Kit Rp 1', () => {
  const found = prices.matchProducts(esbeje.dealposProducts(), { text: 'toren penguin 1050 liter brp kak' });
  assert.deepEqual(found.slice(0, 6).map((p) => p.name), TANKS_1050);
  assert.equal(found[0].unitPrice, 2619000);
  // Varian Rp 1 bukan harga jual: kalau ikut, letaknya setelah semua barang berharga.
  const firstPlaceholder = found.findIndex((p) => p.unitPrice < 100);
  const lastReal = found.findLastIndex((p) => p.unitPrice >= 100);
  if (firstPlaceholder !== -1) assert.ok(firstPlaceholder > lastReal, 'varian Rp 1 di belakang');

  // Tanpa merek pun ukuran yang sama mengalahkan barang yang hanya memuat kata "toren".
  const tanpaMerek = prices.matchProducts(esbeje.dealposProducts(), { text: 'toren 1050 liter ada?' });
  assert.ok(tanpaMerek.slice(0, 8).every((p) => /1050L/.test(p.name)), tanpaMerek.slice(0, 8).map((p) => p.name).join(' | '));
});

test('kasus 1 (jalur katalog): baris pertama yang cocok adalah toren 1050L dengan harga aslinya', () => {
  const section = catalog.catalogSection({ items: esbeje.catalogItems(), tags: TAGS }, { text: 'toren penguin 1050 liter brp kak' });
  const lines = matchedLines(section);
  assert.match(lines[0], /^- PENGUIN TB110 1050L BIRU TUA \[1000015169\] \(merek PENGUIN\): Rp 2\.619\.000 per pcs$/);
  assert.ok(lines.slice(0, 6).every((l) => /1050L/.test(l)));
});

test('kasus 2: ribbon toko menjadi sinonim, MU 420 CERAFIX masuk untuk "perekat keramik"', () => {
  const text = 'perekat keramik yg bagus apa ya kak';
  const withRibbon = catalog.catalogSection({ items: esbeje.catalogItems(perekatKeramik), tags: TAGS }, { text });
  const lines = matchedLines(withRibbon);
  const cerafix = lines.findIndex((l) => l.startsWith('- MU 420 CERAFIX 25KG [1000005368] (merek MORTAR UTAMA): Rp 118.000 per zak'));
  assert.ok(cerafix !== -1, lines.join('\n'));
  // Setara dengan barang yang namanya memuat "perekat keramik", di atas perekat bata ringan.
  const bataRingan = lines.findIndex((l) => l.includes('JKT-M25 PEREKAT BATA RINGAN'));
  assert.ok(bataRingan === -1 || cerafix < bataRingan);
  // "bagus" kata obrolan, bukan nama barang.
  assert.doesNotMatch(withRibbon, /GOLOK BAGUS|BAGUS FRESH/);
  // Catatan AI ribbon juga sinonim.
  const lem = matchedLines(catalog.catalogSection({ items: esbeje.catalogItems(perekatKeramik), tags: TAGS }, { text: 'lem keramik yg kuat apa ya' }));
  assert.match(lem[0], /MU (400|420|480) /);

  // Tanpa ribbon, nama "MU 420 CERAFIX" memang tidak bisa ditebak; sinonimnya datang dari toko.
  const without = catalog.catalogSection({ items: esbeje.catalogItems(), tags: TAGS }, { text });
  assert.doesNotMatch(without, /MU 420 CERAFIX/);
});

test('kasus 3: "kak MU 301 ada?" tetap MU 301 di urutan pertama di kedua jalur', () => {
  const found = prices.matchProducts(esbeje.dealposProducts(), { text: 'kak MU 301 ada?' });
  assert.equal(found[0].name, 'MU 301 PLASTERPLUS 40KG');
  assert.ok(found.every((p) => p.name.startsWith('MU ')));
  const lines = matchedLines(catalog.catalogSection({ items: esbeje.catalogItems(), tags: TAGS }, { text: 'kak MU 301 ada?' }));
  assert.match(lines[0], /^- MU 301 PLASTERPLUS 40KG \[1000011476\] \(merek MORTAR UTAMA\): Rp 104\.000 per zak$/);
  // Ditulis rapat pun sama.
  assert.equal(prices.matchProducts(esbeje.dealposProducts(), { text: 'mu301 ready?' })[0].name, 'MU 301 PLASTERPLUS 40KG');
});

test('ukuran yang diminta mendahulukan varian ukuran itu tanpa membuang merek lain', () => {
  const found = prices.matchProducts(esbeje.dealposProducts(), { text: 'semen jakarta 40 kg berapa' });
  assert.equal(found[0].name, 'SEMEN JAKARTA Type PCC 40KG');
  // Ukuran lain dari merek yang disebut dan merek lain berukuran sama tetap tersedia untuk AI.
  assert.ok(found.some((p) => p.name === 'SEMEN JAKARTA Type PCC 50KG'));
  assert.ok(found.some((p) => p.name === 'SEMEN PADANG 40KG'));
  // Angka tanpa satuan dan tanpa nama barang tetap tidak cukup.
  assert.deepEqual(prices.matchProducts(esbeje.dealposProducts(), { text: 'yang 40 berapa' }), []);
});
