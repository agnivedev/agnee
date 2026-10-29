'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dq = require('../src/delivery-quote.js');
const mapsLink = require('../src/maps-link.js');

const CITIES = [{ locode: 'ID JKT', name: 'Jakarta', services: [{ key: 'MOTORCYCLE', description: 'Motor' }, { key: 'VAN', description: 'Van' }] },
  { locode: 'ID BDG', name: 'Bandung', services: [{ key: 'VAN', description: 'Van' }, { key: 'TRUCK175', description: 'Truk' }] }];
const CONN = {
  enabled: true, aiQuotesEnabled: true, environment: 'production', cities: CITIES,
  pickupLat: -6.2, pickupLng: 106.7, pickupAddress: 'Toko ESBEJE', defaultService: 'VAN',
};

test.beforeEach(() => mapsLink.clearCache());

test('isUsable: chat sungguhan hanya production; simulator boleh sandbox; butuh saklar dan titik jemput', () => {
  assert.equal(dq.isUsable(CONN, { realChat: true }), true);
  assert.equal(dq.isUsable({ ...CONN, environment: 'sandbox' }, { realChat: true }), false);
  assert.equal(dq.isUsable({ ...CONN, environment: 'sandbox' }, { realChat: false }), true);
  assert.equal(dq.isUsable({ ...CONN, aiQuotesEnabled: false }, { realChat: true }), false);
  assert.equal(dq.isUsable({ ...CONN, enabled: false }, { realChat: true }), false);
  assert.equal(dq.isUsable({ ...CONN, pickupLat: null }, { realChat: true }), false);
  assert.equal(dq.isUsable(null, { realChat: false }), false);
});

test('toolSpec: kendaraan dari semua kota tanpa kembar', () => {
  const spec = dq.toolSpec({ conn: CONN, run: () => null });
  assert.equal(spec.name, 'cek_ongkir');
  assert.deepEqual(spec.parameters.properties.kendaraan.enum, ['MOTORCYCLE', 'VAN', 'TRUCK175']);
});

test('quote: koordinat dari pin customer, kendaraan bawaan toko, hasil berbentuk rupiah', async () => {
  const calls = [];
  const getQuotation = async (conn, payload) => {
    calls.push(payload);
    return { total: 85000, currency: 'IDR', distanceMeters: 12345 };
  };
  const out = await dq.quote(CONN, { tujuan: '-6.301234,106.652345' }, { getQuotation });
  assert.equal(out.status, 'ok');
  assert.equal(out.ongkir, 'Rp 85.000');
  assert.equal(out.kendaraan, 'VAN');
  assert.equal(out.jarak_km, 12.3);
  assert.equal(out.ketepatan, 'titik');
  assert.equal(calls[0].serviceType, 'VAN');
  assert.deepEqual(calls[0].stops[0], { lat: -6.2, lng: 106.7, address: 'Toko ESBEJE' });
  assert.equal(calls[0].stops[1].lat, -6.301234);

  // Kendaraan pilihan AI dipakai kalau tersedia; yang tidak ada diganti bawaan.
  await dq.quote(CONN, { tujuan: '-6.3,106.6', kendaraan: 'TRUCK175' }, { getQuotation });
  assert.equal(calls[1].serviceType, 'TRUCK175');
  await dq.quote(CONN, { tujuan: '-6.3,106.6', kendaraan: 'HELIKOPTER' }, { getQuotation });
  assert.equal(calls[2].serviceType, 'VAN');
});

test('quote: nama tempat jadi perkiraan area lewat Nominatim, sandbox ditandai', async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /nominatim\.openstreetmap\.org\/search\?.*countrycodes=id.*q=Foresta%20BSD/);
    return { ok: true, status: 200, json: async () => [{ lat: '-6.2899', lon: '106.6295', display_name: 'Foresta, BSD City, Tangerang' }] };
  };
  const out = await dq.quote({ ...CONN, environment: 'sandbox' }, { tujuan: 'Foresta BSD' }, {
    fetchImpl, getQuotation: async () => ({ total: 120000, currency: 'IDR', distanceMeters: 30000 }),
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.ketepatan, 'perkiraan_area');
  assert.equal(out.tujuan, 'Foresta, BSD City, Tangerang');
  assert.match(out.catatan, /SANDBOX/);
});

test('quote: lokasi tak terbaca dan Lalamove gagal tidak pernah melempar atau mengarang angka', async () => {
  const notFound = async () => ({ ok: true, status: 200, json: async () => [] });
  const lost = await dq.quote(CONN, { tujuan: 'antah berantah xyz' }, { fetchImpl: notFound, getQuotation: async () => { throw new Error('tidak dipanggil'); } });
  assert.equal(lost.status, 'lokasi_tidak_terbaca');
  assert.equal(lost.ongkir, undefined);

  const outside = await dq.quote(CONN, { tujuan: '-6.3,106.6' }, {
    getQuotation: async () => { throw Object.assign(new Error('Lalamove menolak permintaan: x'), { code: 'ERR_OUT_OF_SERVICE_AREA' }); },
  });
  assert.equal(outside.status, 'gagal');
  assert.match(outside.pesan, /luar area/);
  assert.equal(outside.ongkir, undefined);

  assert.equal((await dq.quote(CONN, { tujuan: '0,0' }, { getQuotation: async () => ({}) })).status, 'lokasi_tidak_terbaca');
});
