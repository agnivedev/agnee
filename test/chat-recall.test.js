'use strict';

/**
 * Ingatan percakapan dari DB: AI hanya menerima 5-14 pesan terakhir, sehingga
 * hal yang sudah dijawab customer di awal (lokasi, luas, barang) hilang dan
 * ditanyakan ulang. Blok ingatan membawa bagian lama dari DB.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mem = require('../src/chat-recall');

const seri = (n) => Array.from({ length: n }, (_, i) => (
  i % 2 === 0
    ? { from: 'customer', body: `pesan customer ${i}` }
    : { from: 'ai', body: `balasan ai ${i}` }
));

test('percakapan pendek: tidak ada blok ingatan (semua sudah ada di riwayat)', () => {
  assert.equal(mem.buildMemoryBlock(seri(10), { skipLast: 10 }), '');
});

test('bagian lama dimuat, bagian yang sudah di riwayat tidak diulang', () => {
  const turns = seri(40);
  const blok = mem.buildMemoryBlock(turns, { skipLast: 14 });
  assert.match(blok, /pesan customer 0\b/);
  assert.match(blok, /balasan ai 25\b/);
  assert.doesNotMatch(blok, /pesan customer 26\b/, 'giliran 26 ke atas sudah di riwayat');
  assert.match(blok, /jangan (menanyakan|bertanya) ulang/i);
});

test('label penutur: Customer, Anda (AI), Staf', () => {
  const turns = [
    { from: 'customer', body: 'butuh semen 60 m2' },
    { from: 'ai', body: 'lokasinya di mana kak?' },
    { from: 'staf', body: 'stok ready kak' },
    ...seri(4),
  ];
  const blok = mem.buildMemoryBlock(turns, { skipLast: 4 });
  assert.match(blok, /Customer: butuh semen 60 m2/);
  assert.match(blok, /Anda: lokasinya di mana kak\?/);
  assert.match(blok, /Staf: stok ready kak/);
});

test('anggaran karakter: pesan pertama selalu ikut, yang paling baru diutamakan', () => {
  const turns = Array.from({ length: 200 }, (_, i) => ({ from: i % 2 ? 'ai' : 'customer', body: `isi ${i} ` + 'x'.repeat(200) }));
  const blok = mem.buildMemoryBlock(turns, { skipLast: 14, maxChars: 3000 });
  assert.ok(blok.length <= 3600, `blok ${blok.length} melebihi anggaran`);
  assert.match(blok, /isi 0 /, 'pesan pertama customer ikut');
  assert.match(blok, /isi 185 /, 'yang paling baru di luar jendela ikut');
  assert.doesNotMatch(blok, /isi 100 /, 'bagian tengah dilewati');
  assert.match(blok, /dilewati/);
});

test('baris panjang dipotong', () => {
  const turns = [{ from: 'customer', body: 'a'.repeat(2000) }, ...seri(3)];
  const blok = mem.buildMemoryBlock(turns, { skipLast: 3, lineMax: 100 });
  assert.ok(!blok.includes('a'.repeat(150)));
});

test('dropCurrent membuang pesan customer terakhir yang sama dengan pesan yang sedang dibalas', () => {
  const turns = [...seri(3), { from: 'customer', body: 'Berapa harganya?' }];
  assert.equal(mem.dropCurrent(turns, ' Berapa harganya? ').length, 3);
  assert.equal(mem.dropCurrent(seri(3), 'lain').length, 3);
});

test('historyFromTurns: dasar riwayat bila WhatsApp kosong; staf diberi penanda', () => {
  const turns = [
    { from: 'customer', body: 'halo' },
    { from: 'staf', body: 'siap kak' },
    { from: 'ai', body: 'ada yang bisa dibantu?' },
  ];
  const h = mem.historyFromTurns(turns, 2);
  assert.equal(h.length, 2);
  assert.equal(h[0].role, 'assistant');
  assert.match(h[0].content, /siap kak/);
  assert.notEqual(h[0].content, 'siap kak', 'balasan staf berpenanda');
  assert.deepEqual(h[1], { role: 'assistant', content: 'ada yang bisa dibantu?' });
});
