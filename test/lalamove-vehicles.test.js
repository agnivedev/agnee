'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/lalamove-vehicles.js');

// Bentuk asli GET /v3/cities (Jakarta): key, load.value (kg), dimensions; ada varian antar-kota.
const svc = (key, load) => ({ key, description: 'x', load: load ? { value: String(load), unit: 'kg' } : undefined });
const CONN = { cities: [
  { locode: 'ID JKT', name: 'Jakarta', services: [svc('MOTORCYCLE', 20), svc('MPV', 200), svc('VAN', 600), svc('PICK_UP_TRUCK', 800), svc('ENGKELBOX', 2000), svc('ENGKELBAK', 2500), svc('CDDBOX', 5000), svc('FUSO_BOX', 8000), svc('CDDBAK_INTERCITY', 5000), svc('ASING', 10)] },
  { locode: 'ID BDO', name: 'Bandung', services: [svc('MOTORCYCLE', 20), svc('SEDAN')] },
] };
const AVAILABLE = ['MOTORCYCLE', 'MPV', 'VAN', 'PICK_UP_TRUCK', 'ENGKELBOX', 'ENGKELBAK', 'CDDBOX', 'FUSO_BOX'];

test('optionsOf: gabungan semua kota, tanpa antar-kota dan jenis asing, urut dari muatan terkecil', () => {
  const options = v.optionsOf(CONN);
  assert.deepEqual(options.map((o) => o.key), ['MOTORCYCLE', 'SEDAN', 'MPV', 'VAN', 'PICK_UP_TRUCK', 'ENGKELBOX', 'ENGKELBAK', 'CDDBOX', 'FUSO_BOX']);
  assert.equal(options.find((o) => o.key === 'SEDAN').loadKg, 100, 'tanpa muatan dari API memakai tabel cadangan');
  assert.match(v.optionsText(options), /Motor \(20 kg\), Sedan \(100 kg\), Mobil MPV \(200 kg\)/);
  assert.match(v.optionsText(options), /Engkel box \(2 ton\)/);
  assert.deepEqual(v.optionsOf(null), []);
});

test('buildQuestion: memuat tujuan, barang, dan pilihan, dalam batas 600 karakter', () => {
  const options = v.optionsOf(CONN);
  const q = v.buildQuestion({ barang: '10 sak MU 301 Plasterplus 40KG', address: 'Jalan Topaz Timur 5, Summarecon Serpong, Kelapa Dua', approximate: true, options });
  assert.match(q, /^Ongkir Lalamove\. Kirim ke: Jalan Topaz Timur 5.*\(perkiraan area\)\. Barang: 10 sak MU 301/);
  assert.match(q, /Pakai kendaraan apa\?/);
  assert.match(q, /Engkel box/);
  assert.ok(q.length <= 600, `panjang ${q.length}`);
  const long = v.buildQuestion({ barang: 'x'.repeat(500), address: 'y'.repeat(500), approximate: false, options });
  assert.ok(long.length <= 600, `panjang ${long.length}`);
  assert.ok(long.endsWith('.'));
});

test('parseAnswer: nama kendaraan sehari-hari menjadi kode Lalamove', () => {
  const key = (text) => v.parseAnswer(text, AVAILABLE).key;
  assert.equal(key('motor aja'), 'MOTORCYCLE');
  assert.equal(key('Pakai engkel box ya'), 'ENGKELBOX');
  assert.equal(key('engkel'), 'ENGKELBOX', 'engkel saja = box');
  assert.equal(key('engkel bak'), 'ENGKELBAK');
  assert.equal(key('engkel terbuka'), 'ENGKELBAK');
  assert.equal(key('CDD'), 'CDDBOX');
  assert.equal(key('cdd box'), 'CDDBOX');
  assert.equal(key('fuso box'), 'FUSO_BOX');
  assert.equal(key('pick up'), 'PICK_UP_TRUCK');
  assert.equal(key('Pickup'), 'PICK_UP_TRUCK');
  assert.equal(key('pick-up'), 'PICK_UP_TRUCK');
  assert.equal(key('mobil'), 'MPV');
  assert.equal(key('van'), 'VAN');
  assert.equal(key('#a1b2c3 Engkel box, nanti dibantu 2 orang'), 'ENGKELBOX', 'kode pertanyaan dan kalimat tambahan tak mengganggu');
  assert.equal(v.parseAnswer('#a1b2c3 engkel box ya', AVAILABLE).count, 1, 'angka di kode pertanyaan bukan jumlah');
  assert.equal(v.parseAnswer('a1b2c3 engkel box', AVAILABLE).count, 1, 'angka yang menempel pada huruf bukan jumlah');
});

test('parseAnswer: jumlah kendaraan, dibatasi 1 sampai 10', () => {
  assert.deepEqual(v.parseAnswer('2 motor', AVAILABLE), { key: 'MOTORCYCLE', count: 2, label: 'Motor' });
  assert.equal(v.parseAnswer('motor 3', AVAILABLE).count, 3);
  assert.equal(v.parseAnswer('3 unit engkel box', AVAILABLE).count, 3);
  assert.equal(v.parseAnswer('50 motor', AVAILABLE).count, 10);
  assert.equal(v.parseAnswer('motor', AVAILABLE).count, 1);
  assert.equal(v.parseAnswer('engkel box, muat 20 sak', AVAILABLE).count, 1, 'angka lain bukan jumlah kendaraan');
});

test('parseAnswer: yang ambigu, tidak ada, atau tidak tersedia ditolak dengan alasan', () => {
  assert.equal(v.parseAnswer('', AVAILABLE).error, 'kosong');
  assert.equal(v.parseAnswer('container 20 feet', AVAILABLE).error, 'tidak_tersedia');
  assert.equal(v.parseAnswer('terserah', AVAILABLE).error, 'tidak_dikenali');
  assert.equal(v.parseAnswer('truk', AVAILABLE).error, 'tidak_dikenali');
  assert.equal(v.parseAnswer('motor atau engkel box', AVAILABLE).error, 'lebih_dari_satu');
  const unavailable = v.parseAnswer('lalanow', AVAILABLE);
  assert.equal(unavailable.error, 'tidak_tersedia');
  // Tanpa daftar tersedia, semua jenis yang dikenal dianggap boleh.
  assert.equal(v.parseAnswer('lalanow').key, 'LALANOW');
});
