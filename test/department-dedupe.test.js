'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ask = require('../src/department-ask');

const yoan = [
  'Customer menanyakan harga paralon 4" dan paralon 3/4" (tidak ada di daftar harga POS, dicari dengan nama tersebut). Mohon konfirmasi harga per batang/satuan untuk kedua ukuran, dan merek yang tersedia.',
  'Customer minta harga paralon Rucika 4 inch dan 3/4 inch, masing-masing 7 batang, tidak ada di daftar harga DealPOS; mohon konfirmasi harga per batang kedua ukuran tersebut. Lokasi kirim belum diketahui.',
  'Customer minta harga paralon 4 inci dan paralon 3/4 inci, masing-masing 7 batang, tetapi kedua barang tidak ditemukan di daftar harga DealPOS. Mohon berikan harga satuan per batang untuk kedua ukuran (dan merek jika ada) agar bisa dibuatkan rincian.',
];

test('sameTopic: tiga pertanyaan paralon YOAN dianggap satu topik', () => {
  assert.equal(ask.sameTopic(yoan[0], yoan[1]), true);
  assert.equal(ask.sameTopic(yoan[1], yoan[2]), true);
  assert.equal(ask.sameTopic(yoan[0], yoan[2]), true);
});

test('sameTopic: duradus dua kalimat sama topik, gypsum dan cat berbeda', () => {
  assert.equal(ask.sameTopic(
    'Customer (inbox WhatsApp) minta Duradus 10 pcs dan Kabel FO 60m yang sudah jadi dengan pigtail 2 unit, keduanya tidak ditemukan di daftar harga DealPOS.',
    'Customer tanya "duradus 10 psc", tidak ada di daftar harga POS. Bisa disediakan dan berapa harganya per pcs?'), true);
  assert.equal(ask.sameTopic('Apakah gypsum board 9mm ready?', 'Harga cat Mowilex Emulsion 5 kg berapa?'), false);
});

test('classifyGroupReply: keluhan staf bukan jawaban', () => {
  assert.equal(ask.classifyGroupReply('Udh dijawab @Hanny nanya lagi'), 'complaint');
  assert.equal(ask.classifyGroupReply('udah saya jawab tadi, kok nanya lagi'), 'complaint');
  assert.equal(ask.classifyGroupReply('Kami tidak jual'), 'answer');
  assert.equal(ask.classifyGroupReply('kosong'), 'answer');
  assert.equal(ask.classifyGroupReply('Stok Ready\nHarga Pipa Rucika 4in D 193.500 per batang'), 'answer');
});
