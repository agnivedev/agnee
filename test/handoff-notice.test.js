'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { claimsForward, buildNotice, createCooldown } = require('../src/handoff-notice');

test('janji meneruskan ke orang terdeteksi', () => {
  for (const text of [
    'Akan aku sampaikan ke Bang Al ya kak.',
    'Soal deposit aku belum punya infonya kak, aku teruskan ke tim ya.',
    'Baik, saya teruskan percakapan ini ke tim kami.',
    'Permintaan kakak ini aku teruskan ke mereka.',
    'Sudah aku kabari tim ya kak',
  ]) assert.equal(claimsForward(text), true, text);
});

test('kalimat biasa tidak dianggap janji meneruskan', () => {
  for (const text of [
    'Gabungnya lewat link ini kak: https://example.com',
    'Aku sampaikan harga nanti',
    'Tolong teruskan ke link tadi',
    '',
    null,
  ]) assert.equal(claimsForward(text), false, String(text));
});

test('pesan pemberitahuan memuat customer, pertanyaan, dan balasan, dipangkas', () => {
  const text = buildNotice({
    chatId: '6281234567890@c.us', name: 'Budi',
    customerText: 'Bang Al kemana?', aiText: 'Akan aku sampaikan ke Bang Al ya kak.',
  });
  assert.match(text, /Budi \(\+6281234567890\)/);
  assert.match(text, /Bang Al kemana\?/);
  assert.match(text, /Akan aku sampaikan/);
  const long = buildNotice({ chatId: '62811@c.us', customerText: 'x'.repeat(2000), aiText: 'y' });
  assert.ok(long.length < 900);
  assert.match(buildNotice({ chatId: '62811@c.us', customerText: 'a', aiText: 'b' }), /Customer: \+62811\n/);
});

test('pembatas: satu per jendela, bisa dilepas, jendela habis boleh lagi', () => {
  let now = 0;
  const cd = createCooldown({ windowMs: 1000, now: () => now });
  assert.equal(cd.take('a'), true);
  assert.equal(cd.take('a'), false);
  assert.equal(cd.take('b'), true);
  cd.release('a');
  assert.equal(cd.take('a'), true);
  now = 1500;
  assert.equal(cd.take('a'), true);
});
