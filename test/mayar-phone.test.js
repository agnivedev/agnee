'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('../src/mayar-sync');

test('nomor lokal Indonesia jadi berkode 62', () => {
  assert.equal(normalizePhone('0851-2345-6789'), '6285123456789');
  assert.equal(normalizePhone('85123456789'), '6285123456789');
  assert.equal(normalizePhone('+62 851 2345 6789'), '6285123456789');
  assert.equal(normalizePhone('6285123456789'), '6285123456789');
});

test('nomor luar negeri tidak diberi 62 di depannya', () => {
  // Dulu menjadi "626591234567" — nomor yang tidak ada.
  assert.equal(normalizePhone('+65 9123 4567'), '6591234567');
  assert.equal(normalizePhone('+1 (415) 555-0100'), '14155550100');
});

test('isi kosong tetap null', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone('—'), null);
});
