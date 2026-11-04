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

test('label customer: chat @lid tidak pernah menampilkan id lid sebagai nomor', () => {
  const { describeCustomer } = require('../src/handoff-notice');
  // lid + nomor hasil peta + nama
  assert.equal(describeCustomer({ chatId: '214915969200380@lid', name: 'Yohanes', phone: '6281234567890' }), 'Yohanes (+6281234567890)');
  assert.equal(describeCustomer({ chatId: '214915969200380@lid', phone: '6281234567890' }), '+6281234567890');
  // lid tanpa peta: nama saja, tanpa angka lid
  const nameOnly = describeCustomer({ chatId: '214915969200380@lid', name: 'Yohanes' });
  assert.doesNotMatch(nameOnly, /214915969200380/);
  assert.match(nameOnly, /Yohanes/);
  const none = describeCustomer({ chatId: '214915969200380@lid' });
  assert.doesNotMatch(none, /2149/);
  // nama yang sama dengan id lid dianggap tidak ada
  assert.doesNotMatch(describeCustomer({ chatId: '214915969200380@lid', name: '214915969200380' }), /2149/);
  // chat biasa tetap seperti semula
  assert.equal(describeCustomer({ chatId: '6281234567890@c.us', name: 'Budi' }), 'Budi (+6281234567890)');
  assert.equal(describeCustomer({ chatId: '6281234567890@c.us' }), '+6281234567890');
});

test('buildNotice memakai nomor hasil peta untuk chat @lid', () => {
  const text = buildNotice({ chatId: '99999999999999@lid', phone: '6285550001111', name: 'Sari', customerText: 'a', aiText: 'b' });
  assert.match(text, /Customer: Sari \(\+6285550001111\)\n/);
  assert.doesNotMatch(text, /99999999999999/);
});
