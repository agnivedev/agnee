import test from 'node:test';
import assert from 'node:assert/strict';
import { customerLabel, validPhoneDigits, formatPhoneDigits } from '../web/src/lib/customer-label.ts';

const messages = {
  'customer.group': 'Grup WhatsApp',
  'customer.unnamed': 'Customer WhatsApp',
  'customer.phoneUnresolved': 'Nomor belum terbaca',
};
const t = (key) => messages[key] || key;

test('nama + nomor valid: judul nama, baris kedua nomor terformat', () => {
  const label = customerLabel({ chatId: '628179811642@c.us', name: 'Venny', phone: '628179811642' }, t);
  assert.equal(label.title, 'Venny');
  assert.equal(label.subtitle, '+62 817 9811 642');
  assert.equal(label.phone, '628179811642');
});

test('nomor diambil dari chatId @c.us bila phone kosong', () => {
  const label = customerLabel({ chatId: '628179811642@c.us', name: 'Venny' }, t);
  assert.equal(label.subtitle, '+62 817 9811 642');
});

test('tanpa nama: nomor valid jadi judul, tanpa baris kedua', () => {
  const label = customerLabel({ chatId: '628179811642@c.us', phone: '628179811642' }, t);
  assert.equal(label.title, '+62 817 9811 642');
  assert.equal(label.subtitle, null);
  assert.equal(label.hasName, false);
});

test('@lid dengan phone angka panjang: angka tidak ditampilkan', () => {
  const label = customerLabel({ chatId: '81218290919162@lid', phone: '62812182909191628319762' }, t);
  assert.equal(label.title, 'Customer WhatsApp');
  assert.equal(label.subtitle, 'Nomor belum terbaca');
  assert.equal(label.phone, null);
  assert.ok(!JSON.stringify(label).includes('8121829'));
});

test('@lid bernama: judul nama, baris kedua teks netral', () => {
  const label = customerLabel({ chatId: '81218290919162@lid', name: 'Budi' }, t);
  assert.equal(label.title, 'Budi');
  assert.equal(label.subtitle, 'Nomor belum terbaca');
});

test('@lid yang sudah ter-resolve ke nomor valid memakai nomor itu', () => {
  const label = customerLabel({ chatId: '81218290919162@lid', name: 'Budi', phone: '6281234567890' }, t);
  assert.equal(label.subtitle, '+62 812 3456 7890');
});

test('grup: penanda grup, id grup tidak tampil', () => {
  const unnamed = customerLabel({ chatId: '120363429259153783@g.us', phone: '120363429259153783' }, t);
  assert.equal(unnamed.title, 'Grup WhatsApp');
  assert.equal(unnamed.isGroup, true);
  assert.equal(unnamed.phone, null);
  const named = customerLabel({ chatId: '120363429259153783@g.us', name: 'Management' }, t);
  assert.equal(named.title, 'Management');
  assert.equal(named.subtitle, 'Grup WhatsApp');
});

test('nama yang sebenarnya id mentah dibuang', () => {
  const label = customerLabel({ chatId: '81218290919162@lid', name: '81218290919162' }, t);
  assert.equal(label.title, 'Customer WhatsApp');
  const long = customerLabel({ chatId: 'x@lid', name: '+6281218290919162831 9762' }, t);
  assert.equal(long.title, 'Customer WhatsApp');
});

test('nama yang sama dengan nomor tidak diulang di baris kedua', () => {
  const label = customerLabel({ chatId: '628179811642@c.us', name: '628179811642' }, t);
  assert.equal(label.title, '+62 817 9811 642');
  assert.equal(label.subtitle, null);
});

test('validPhoneDigits menolak terlalu pendek, terlalu panjang, dan sisa tes', () => {
  assert.equal(validPhoneDigits('0'), null);
  assert.equal(validPhoneDigits('1234567'), null);
  assert.equal(validPhoneDigits('120363429259153783'), null);
  assert.equal(validPhoneDigits('000000000000'), null);
  assert.equal(validPhoneDigits('+62 812-3456-7890'), '6281234567890');
});

test('formatPhoneDigits: 62 dikelompokkan, negara lain apa adanya', () => {
  assert.equal(formatPhoneDigits('6281234567890'), '+62 812 3456 7890');
  assert.equal(formatPhoneDigits('14155550123'), '+14155550123');
  assert.equal(formatPhoneDigits(null), '');
});
