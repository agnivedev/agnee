'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fuzzyScore, fuzzyFilter, suggest } = require('../src/fuzzy');

test('salah ketik, transposisi, dan aksen tetap cocok', () => {
  assert.ok(fuzzyScore('jhon', 'John Smith') > 0);
  assert.ok(fuzzyScore('budy', 'Budi Santoso') > 0);
  assert.ok(fuzzyScore('rene', 'René') > 0);
  assert.ok(fuzzyScore('santso', 'Budi Santoso') > 0);
});

test('awalan dan urutan kata bebas, semua kata wajib ada', () => {
  assert.ok(fuzzyScore('bud san', 'Budi Santoso') > 0);
  assert.ok(fuzzyScore('santoso budi', 'Budi Santoso') > 0);
  assert.equal(fuzzyScore('budi wijaya', 'Budi Santoso'), 0);
});

test('kata pendek tidak ditebak-tebak', () => {
  assert.equal(fuzzyScore('abx', 'abc'), 0);
});

test('nomor telepon cocok lintas format 08/62', () => {
  assert.ok(fuzzyScore('0812345', '+62 812-3456-789') > 0);
  assert.ok(fuzzyScore('812345', '0812 3456 789') > 0);
});

test('yang cocok persis diurutkan lebih dulu, kueri kosong mengembalikan semua', () => {
  const rows = ['Jonas', 'John', 'Jon'];
  assert.deepEqual(fuzzyFilter(rows, 'john', (r) => r)[0], 'John');
  assert.equal(fuzzyFilter(rows, '  ', (r) => r), rows);
});

test('suggest membuang duplikat dan membatasi jumlah', () => {
  const pool = ['Budi', 'budi', 'Budiman', 'Bu Dewi', 'Andi'];
  const out = suggest(pool, 'bud', 2);
  assert.equal(out.length, 2);
  assert.equal(new Set(out.map((x) => x.toLowerCase())).size, 2);
});
