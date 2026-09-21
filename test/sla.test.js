'use strict';

/**
 * Hitungan jam kerja untuk SLA tugas.
 *
 * Bagian ini yang paling mudah salah dan paling mahal kalau salah: ambang 15
 * menit untuk prioritas urgent berarti selisih beberapa menit sudah mengubah
 * hasilnya, dan salah hitung di sisi lain membuat seluruh papan merah setiap
 * pagi. Karena itu semuanya diuji dengan waktu yang dioper, bukan jam sistem.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { menitKerja, statusSla, sebagaiDurasi, AMBANG_MENIT } = require('../src/sla');

const JKT = 'Asia/Jakarta';
// Asia/Jakarta = UTC+7. 2026-09-21 adalah hari Senin.
const senin = (jam, menit = 0) => Date.UTC(2026, 8, 21, jam - 7, menit);
const selasa = (jam, menit = 0) => Date.UTC(2026, 8, 22, jam - 7, menit);
const sabtu = (jam, menit = 0) => Date.UTC(2026, 8, 26, jam - 7, menit);
const minggu = (jam, menit = 0) => Date.UTC(2026, 8, 27, jam - 7, menit);

test('dalam satu hari kerja, menitnya dihitung apa adanya', () => {
  assert.equal(menitKerja(senin(10), senin(12), JKT), 120);
  assert.equal(menitKerja(senin(9, 30), senin(9, 45), JKT), 15);
});

test('jam sebelum buka tidak dihitung', () => {
  // Masuk 07:00, sekarang 09:20 — yang dihitung hanya 20 menit sejak buka.
  assert.equal(menitKerja(senin(7), senin(9, 20), JKT), 20);
});

test('jam setelah tutup tidak dihitung, dan menyambung ke pagi berikutnya', () => {
  // Masuk Senin 22:00, sekarang Selasa 09:30 → 30 menit kerja, bukan 11,5 jam.
  assert.equal(menitKerja(senin(22), selasa(9, 30), JKT), 30);
});

test('satu hari kerja penuh berisi sembilan jam', () => {
  assert.equal(menitKerja(senin(0), senin(23, 59), JKT), 9 * 60);
});

test('Minggu dilewati sepenuhnya', () => {
  // Sabtu 17:30 → Minggu 17:30: yang terhitung hanya 30 menit sisa Sabtu.
  assert.equal(menitKerja(sabtu(17, 30), minggu(17, 30), JKT), 30);
  assert.equal(menitKerja(minggu(9), minggu(18), JKT), 0);
});

test('menyeberangi akhir pekan: Sabtu sore ke Senin pagi', () => {
  // Sabtu 17:00 → Senin berikutnya 09:45. Sisa Sabtu 60 menit + Senin 45 menit.
  const seninDepan = Date.UTC(2026, 8, 28, 9 - 7, 45);
  assert.equal(menitKerja(sabtu(17), seninDepan, JKT), 105);
});

test('zona waktu company diikuti, bukan zona server', () => {
  // Titik waktu yang sama, dibaca dari Asia/Jayapura (UTC+9): pukul 09:00 WIB
  // adalah pukul 11:00 di sana, jadi dua jam kerjanya sudah lewat.
  const mulai = senin(0);
  const sampai = senin(9);
  assert.equal(menitKerja(mulai, sampai, JKT), 0);
  assert.equal(menitKerja(mulai, sampai, 'Asia/Jayapura'), 120);
});

test('rentang terbalik atau nol menghasilkan nol', () => {
  assert.equal(menitKerja(senin(12), senin(10), JKT), 0);
  assert.equal(menitKerja(senin(12), senin(12), JKT), 0);
});

test('ambang per prioritas: urgent jauh lebih ketat daripada low', () => {
  assert.equal(AMBANG_MENIT.urgent, 15);
  assert.equal(AMBANG_MENIT.low, 480);

  const urgent = statusSla({ prioritas: 'urgent', menungguSejakMs: senin(10), sekarangMs: senin(10, 20), zona: JKT });
  assert.equal(urgent.peringatkanAgent, true);
  assert.equal(urgent.eskalasiKeSupervisor, false);

  const low = statusSla({ prioritas: 'low', menungguSejakMs: senin(10), sekarangMs: senin(10, 20), zona: JKT });
  assert.equal(low.peringatkanAgent, false);
});

test('lewat dua kali ambang memicu eskalasi', () => {
  const hasil = statusSla({ prioritas: 'urgent', menungguSejakMs: senin(10), sekarangMs: senin(10, 31), zona: JKT });
  assert.equal(hasil.eskalasiKeSupervisor, true);
  // Agent tetap diberi tahu kalau sebelumnya belum pernah — misalnya saat
  // penjadwalnya baru hidup lagi setelah mati.
  assert.equal(hasil.peringatkanAgent, true);
});

test('yang sudah diperingatkan tidak diperingatkan lagi', () => {
  const hasil = statusSla({
    prioritas: 'normal', menungguSejakMs: senin(9), sekarangMs: senin(14), zona: JKT,
    sudahDiperingatkan: true, sudahDieskalasi: true,
  });
  assert.equal(hasil.peringatkanAgent, false);
  assert.equal(hasil.eskalasiKeSupervisor, false);
});

test('prioritas yang tidak dikenal jatuh ke ambang normal', () => {
  const hasil = statusSla({ prioritas: 'entah', menungguSejakMs: senin(9), sekarangMs: senin(11, 1), zona: JKT });
  assert.equal(hasil.ambang, AMBANG_MENIT.normal);
  assert.equal(hasil.peringatkanAgent, true);
});

test('durasi ditulis untuk dibaca orang', () => {
  assert.equal(sebagaiDurasi(15), '15 menit');
  assert.equal(sebagaiDurasi(60), '1 jam');
  assert.equal(sebagaiDurasi(125), '2 jam 5 menit');
});
