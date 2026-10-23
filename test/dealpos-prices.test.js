'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const prices = require('../src/dealpos-prices.js');
const departmentAsk = require('../src/department-ask.js');

const catalog = [
  { variantId: '1', code: 'SJ50', name: 'Semen Jakarta 50 kg', category: 'Semen', unit: 'sak', unitPrice: 68000 },
  { variantId: '2', code: 'MU301', name: 'Mortar Instan Plester 40 kg', category: 'Semen Instan', unit: 'sak', unitPrice: 95000 },
  { variantId: '3', code: 'TP1050', name: 'Toren Penguin 1050 L', category: 'Toren', unit: 'pcs', unitPrice: 2150000 },
  { variantId: '4', code: 'PVC34', name: 'Pipa PVC 3/4 inch', category: 'Pipa', unit: 'batang', unitPrice: 32000 },
  { variantId: '5', code: 'TRP9', name: 'Triplek 9 mm', category: 'Triplek', unit: 'lembar', unitPrice: 120000 },
];

test('mapVariant membaca beberapa ejaan field dan melewati varian nonaktif atau tanpa harga', () => {
  assert.deepEqual(
    prices.mapVariant({ ID: 7, Code: 'C1', Name: '5 Liter', ProductName: 'Cat Tembok Putih', Category: { Name: 'Cat' }, UnitPrice: '150000' }),
    { variantId: '7', code: 'C1', name: 'Cat Tembok Putih 5 Liter', category: 'Cat', unit: null, unitPrice: 150000 },
  );
  assert.equal(prices.mapVariant({ ID: 8, Name: 'Lama', UnitPrice: 1000, Inactive: true }), null);
  assert.equal(prices.mapVariant({ ID: 9, Name: 'Gratis', UnitPrice: 0 }), null);
  assert.equal(prices.mapVariant({ ID: 10, Name: 'Tanpa harga' }), null);
});

test('fetchVariants membaca semua halaman sampai halaman tidak penuh', async () => {
  const calls = [];
  const full = Array.from({ length: 200 }, (_, i) => ({ ID: i + 1, Name: `Barang ${i + 1}`, UnitPrice: 1000 }));
  const get = async (path) => {
    calls.push(path);
    return path.includes('PageNumber=1&') ? full : [{ ID: 999, Name: 'Terakhir', UnitPrice: 5000 }];
  };
  const rows = await prices.fetchVariants(get);
  assert.equal(rows.length, 201);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^\/Variant\?PageNumber=1&PageSize=200$/);
});

test('matchProducts memilih varian yang disebut customer, pesan terbaru di atas ringkasan', () => {
  const semen = prices.matchProducts(catalog, { text: 'semen jakarta berapa kak?' });
  assert.deepEqual(semen.map((p) => p.code), ['SJ50', 'MU301']);
  // Pesan tanpa nama barang memakai ringkasan percakapan.
  const dariRingkasan = prices.matchProducts(catalog, { text: 'harganya berapa?', context: 'Customer butuh toren Penguin untuk rumah 2 lantai.' });
  assert.deepEqual(dariRingkasan.map((p) => p.code), ['TP1050']);
  // Angka saja tidak cukup untuk mencocokkan.
  assert.deepEqual(prices.matchProducts(catalog, { text: 'yang 50 berapa' }), []);
  assert.deepEqual(prices.matchProducts(catalog, { text: 'halo kak' }), []);
});

test('priceSection menulis harga rupiah per satuan dan kosong bila tidak ada yang cocok', () => {
  const section = prices.priceSection([catalog[0]], '2026-10-23T03:00:00Z');
  assert.match(section, /DAFTAR HARGA DEALPOS/);
  assert.match(section, /Semen Jakarta 50 kg \[SJ50\]: Rp 68\.000 per sak/);
  assert.match(section, /bukan informasi stok/);
  assert.equal(prices.priceSection([], null), '');
});

test('kode pertanyaan grup: dibuat dari id dan dikenali di teks jawaban', () => {
  const code = departmentAsk.questionCode('AB12CD34-5678-90ab-cdef-000000000000');
  assert.equal(code, 'ab12cd');
  assert.equal(departmentAsk.codeInText('#AB12CD stok ada 40 sak'), 'ab12cd');
  assert.equal(departmentAsk.codeInText('stok ada 40 sak'), null);
  const notice = departmentAsk.buildQuestionNotice({ department: 'Gudang', question: 'Stok Semen Jakarta 40 sak?', customerLabel: 'Budi', code, group: true });
  assert.match(notice, /reply\* pesan ini di grup/);
  assert.match(notice, /#ab12cd/);
  const personal = departmentAsk.buildQuestionNotice({ department: 'Gudang', question: 'x', customerLabel: 'Budi' });
  assert.doesNotMatch(personal, /grup/);
});
