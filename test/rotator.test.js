'use strict';

/**
 * Pemilihan nomor untuk percakapan baru.
 *
 * Yang paling mahal kalau salah: menempelkan percakapan ke nomor yang tidak
 * bisa mengirim. Tempelan tidak pernah dipindah — memindahkannya berarti
 * customer menerima balasan dari nomor asing dan riwayatnya pecah — jadi satu
 * pilihan yang salah membuat percakapan itu tidak bisa dibalas SELAMANYA.
 *
 * Sebelum perbaikan ini penyaringnya hanya `is_active`, sementara kembaran
 * Cloud API-nya sudah menuntut `status = 'connected'`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { pilihNomorUntukPercakapanBaru } = require('../src/rotator');

const UTAMA = { id: 'utama', label: 'WhatsApp utama' };
const KEDUA = { id: 'kedua', label: 'Nomor kedua' };
const KETIGA = { id: 'ketiga', label: 'Nomor ketiga' };
const SEMUA = [UTAMA, KEDUA, KETIGA];

const siap = (...ids) => (id) => ids.includes(id);

test('memilih nomor dengan beban paling ringan di antara yang siap', () => {
  const hasil = pilihNomorUntukPercakapanBaru({
    // Urut dari beban paling ringan, seperti yang dikembalikan query.
    counts: [{ id: 'ketiga', chatCount: 0 }, { id: 'kedua', chatCount: 3 }, { id: 'utama', chatCount: 9 }],
    connections: SEMUA, primary: UTAMA, rotationEnabled: true, siapKirim: siap('utama', 'kedua', 'ketiga'),
  });
  assert.equal(hasil.nomor.id, 'ketiga');
  assert.equal(hasil.alasan, 'beban-paling-ringan');
});

test('nomor paling ringan yang BELUM siap dilewati, bukan dipakai', () => {
  // Inti perbaikannya: 'ketiga' paling ringan tapi masih menunggu QR.
  const hasil = pilihNomorUntukPercakapanBaru({
    counts: [{ id: 'ketiga', chatCount: 0 }, { id: 'kedua', chatCount: 3 }, { id: 'utama', chatCount: 9 }],
    connections: SEMUA, primary: UTAMA, rotationEnabled: true, siapKirim: siap('kedua', 'utama'),
  });
  assert.equal(hasil.nomor.id, 'kedua');
});

test('rotasi dimatikan: percakapan baru keluar dari nomor utama saja', () => {
  const hasil = pilihNomorUntukPercakapanBaru({
    counts: [{ id: 'kedua', chatCount: 0 }],
    connections: SEMUA, primary: UTAMA, rotationEnabled: false, siapKirim: siap('utama', 'kedua'),
  });
  assert.equal(hasil.nomor.id, 'utama');
  assert.equal(hasil.alasan, 'rotasi-mati');
});

test('rotasi mati dan nomor utama belum siap: tidak menempel ke mana pun', () => {
  const hasil = pilihNomorUntukPercakapanBaru({
    counts: [{ id: 'kedua', chatCount: 0 }],
    connections: SEMUA, primary: UTAMA, rotationEnabled: false, siapKirim: siap('kedua'),
  });
  assert.equal(hasil.nomor, null);
  assert.equal(hasil.alasan, 'tidak-ada-yang-siap');
});

test('tidak ada satu pun nomor siap: null, bukan asal tempel', () => {
  const hasil = pilihNomorUntukPercakapanBaru({
    counts: [{ id: 'kedua', chatCount: 0 }, { id: 'utama', chatCount: 1 }],
    connections: SEMUA, primary: UTAMA, rotationEnabled: true, siapKirim: () => false,
  });
  assert.equal(hasil.nomor, null);
  assert.equal(hasil.alasan, 'tidak-ada-yang-siap');
});

test('semua nomor rotasi mati tapi nomor utama siap: jatuh ke utama', () => {
  const hasil = pilihNomorUntukPercakapanBaru({
    counts: [{ id: 'kedua', chatCount: 0 }, { id: 'ketiga', chatCount: 1 }],
    connections: SEMUA, primary: UTAMA, rotationEnabled: true, siapKirim: siap('utama'),
  });
  assert.equal(hasil.nomor.id, 'utama');
  assert.equal(hasil.alasan, 'hanya-utama-yang-siap');
});

test('id di counts yang tidak dikenal diabaikan, bukan bikin jatuh', () => {
  const hasil = pilihNomorUntukPercakapanBaru({
    counts: [{ id: 'nomor-hantu', chatCount: 0 }, { id: 'kedua', chatCount: 2 }],
    connections: SEMUA, primary: UTAMA, rotationEnabled: true, siapKirim: siap('kedua', 'nomor-hantu'),
  });
  assert.equal(hasil.nomor.id, 'kedua');
});

test('company tanpa nomor sama sekali tidak melempar', () => {
  const hasil = pilihNomorUntukPercakapanBaru({
    counts: [], connections: [], primary: null, rotationEnabled: true, siapKirim: () => true,
  });
  assert.equal(hasil.nomor, null);
});
