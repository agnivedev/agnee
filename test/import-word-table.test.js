'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tablesToPipeRows } = require('../src/playbook-import.js');

const text = (value) => ({ type: 'paragraph', children: [{ type: 'run', children: [{ type: 'text', value }] }] });
const cell = (value) => ({ type: 'tableCell', children: [text(value)] });
const row = (...values) => ({ type: 'tableRow', children: values.map(cell) });

test('tabel Word jadi baris Markdown berpagar dengan garis pemisah di bawah baris judul', () => {
  const doc = { type: 'document', children: [
    text('Merek unggulan:'),
    { type: 'table', children: [row('Barang', 'Merek'), row('Toren', 'Penguin | Mpoin')] },
    text('Selesai'),
  ] };
  const out = tablesToPipeRows(doc);
  const lines = out.children.map((p) => p.children[0].children[0].value);
  assert.deepEqual(lines, [
    'Merek unggulan:',
    '| Barang | Merek |',
    '| --- | --- |',
    '| Toren | Penguin / Mpoin |',
    'Selesai',
  ]);
});

test('dokumen tanpa tabel tidak berubah', () => {
  const doc = { type: 'document', children: [text('a'), text('b')] };
  assert.deepEqual(tablesToPipeRows(doc), doc);
});
