'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const promo = require('../src/promo-rules');
const deliveryQuote = require('../src/delivery-quote');

// Tabel dari Esbeje: wilayah gratis ongkir.
const AREAS = [
  ...['Ciputat', 'Setu', 'Ciputat Timur', 'Pamulang', 'Pondok Aren', 'Serpong', 'Serpong Utara']
    .map((district) => ({ province: 'Banten', city: 'Tangerang Selatan', district })),
  { province: 'Banten', city: 'Tangerang', district: 'Alam Sutera' },
  ...['Cisauk', 'Curug', 'Kelapa Dua', 'Legok', 'Pagedangan', 'Panongan']
    .map((district) => ({ province: 'Banten', city: 'Kabupaten Tangerang', district })),
  { province: 'Banten', city: 'Bogor', district: 'Gunung Sindur' },
  { province: 'Banten', city: 'Parung Panjang', district: 'Parung Panjang' },
];

const rule = (extra = {}) => ({
  id: '1', kind: 'free_shipping', name: 'Free ongkir', enabled: true, startsAt: null, endsAt: null,
  areas: AREAS, conditions: {}, maxSubsidy: null, notes: '', ...extra,
});

const dest = (address, components = {}) => ({ lat: -6.3, lng: 106.7, address, components, accuracy: 'titik' });

test('norm: awalan administratif dan huruf besar tidak membedakan', () => {
  assert.equal(promo.norm('Kecamatan Ciputat Timur'), 'ciputat timur');
  assert.equal(promo.norm('KOTA Tangerang Selatan'), 'tangerang selatan');
  assert.equal(promo.norm('Kab. Tangerang'), 'tangerang');
});

test('normalizeRule: nama wajib, angka divalidasi, wilayah kembar dibuang', () => {
  assert.match(promo.normalizeRule({ name: '  ' }).error, /nama/i);
  assert.match(promo.normalizeRule({ name: 'x', conditions: { minSubtotal: 'abc' } }).error, /Minimal belanja/);
  assert.match(promo.normalizeRule({ name: 'x', startsAt: '2026-12-02', endsAt: '2026-12-01' }).error, /berakhir/);
  const { rule: saved } = promo.normalizeRule({
    name: 'Promo', areas: [{ district: 'Ciputat', city: 'Tangerang Selatan' }, { district: 'ciputat', city: 'tangerang selatan' }, {}],
    conditions: { minSubtotal: '500000', products: ['MU 480', 'MU 480', ''] }, maxSubsidy: '',
  });
  assert.equal(saved.areas.length, 1);
  assert.deepEqual(saved.conditions, { minSubtotal: 500000, products: ['MU 480'] });
  assert.equal(saved.maxSubsidy, null);
});

test('wilayah: kecamatan dicocokkan utuh, Ciputat tidak ikut Ciputat Timur', () => {
  const only = [{ province: 'Banten', city: 'Tangerang Selatan', district: 'Ciputat' }];
  const r = rule({ areas: only });
  const inCiputat = promo.evaluate([r], dest('Ciputat, Kota Tangerang Selatan, Banten, 15411, Indonesia'));
  assert.equal(inCiputat[0].status, 'berlaku');
  const timur = promo.evaluate([r], dest('Ciputat Timur, Kota Tangerang Selatan, Banten, Indonesia'));
  assert.equal(timur[0].status, 'di_luar_wilayah');
});

test('wilayah: komponen geocode Nominatim dan teks ketikan customer sama-sama dibaca', () => {
  const byComponents = promo.evaluate([rule()], dest('Jl. Anu 1, Indonesia', { suburb: 'Pamulang Barat', city_district: 'Kecamatan Pamulang', city: 'Kota Tangerang Selatan', state: 'Banten' }));
  assert.equal(byComponents[0].status, 'berlaku');
  const typed = promo.evaluate([rule()], { ...dest(''), typed: 'Alam Sutera, Tangerang' });
  assert.equal(typed[0].status, 'berlaku');
  const outside = promo.evaluate([rule()], dest('Kebayoran Baru, Jakarta Selatan, DKI Jakarta, Indonesia'));
  assert.equal(outside[0].status, 'di_luar_wilayah');
});

test('wilayah: kecamatan sama di kota lain tidak lolos bila kota dan provinsi sama-sama tak cocok', () => {
  const r = rule({ areas: [{ province: 'Banten', city: 'Tangerang Selatan', district: 'Setu' }] });
  const bekasi = promo.evaluate([r], dest('Setu, Kabupaten Bekasi, Jawa Barat, Indonesia'));
  assert.equal(bekasi[0].status, 'di_luar_wilayah');
});

test('promo tanpa wilayah berlaku di semua tempat', () => {
  const r = rule({ areas: [] });
  assert.equal(promo.evaluate([r], dest('Medan, Sumatera Utara, Indonesia'))[0].status, 'berlaku');
});

test('syarat: minimal belanja, jumlah, produk; info yang belum ada diminta, bukan ditebak', () => {
  const r = rule({ conditions: { minSubtotal: 500000, minQty: 10, products: ['MU 480'] } });
  const here = dest('Ciputat, Kota Tangerang Selatan, Banten, Indonesia');

  const unknown = promo.evaluate([r], here)[0];
  assert.equal(unknown.status, 'syarat_belum_diketahui');
  assert.equal(unknown.perlu_info.length, 3);

  const low = promo.evaluate([r], here, { subtotal: 300000, qty: 10, products: ['MU 480 Renofix 25kg'] })[0];
  assert.equal(low.status, 'syarat_belum_terpenuhi');
  assert.match(low.kurang[0], /500\.000/);

  const wrongProduct = promo.evaluate([r], here, { subtotal: 900000, qty: 12, products: ['Semen Tiga Roda'] })[0];
  assert.equal(wrongProduct.status, 'syarat_belum_terpenuhi');

  const ok = promo.evaluate([r], here, { subtotal: 900000, qty: 12, products: ['MU 480 Renofix 25kg'] })[0];
  assert.equal(ok.status, 'berlaku');
});

test('periode dan saklar: promo mati, belum mulai, atau berakhir tidak dinilai', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assert.equal(promo.isActive(rule({ enabled: false }), now), false);
  assert.equal(promo.isActive(rule({ startsAt: '2026-11-11T00:00:00Z' }), now), false);
  assert.equal(promo.isActive(rule({ endsAt: '2026-11-09T00:00:00Z' }), now), false);
  assert.equal(promo.isActive(rule({ startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' }), now), true);
  assert.deepEqual(promo.evaluate([rule({ enabled: false })], dest('Ciputat, Banten'), {}, now), []);
});

test('subsidi: batas subsidi dipotong dari ongkir, promo penuh = nol', () => {
  const here = dest('Ciputat, Kota Tangerang Selatan, Banten, Indonesia');
  assert.equal(promo.customerPays(80000, promo.evaluate([rule()], here)), 0);
  assert.equal(promo.customerPays(80000, promo.evaluate([rule({ maxSubsidy: 50000 })], here)), 30000);
  assert.equal(promo.customerPays(30000, promo.evaluate([rule({ maxSubsidy: 50000 })], here)), 0);
  assert.equal(promo.customerPays(80000, promo.evaluate([rule()], dest('Medan, Indonesia'))), null);
});

test('section: kosong tanpa promo aktif; memuat wilayah dan syarat', () => {
  assert.equal(promo.section([rule({ enabled: false })]), '');
  const text = promo.section([rule({ conditions: { minQty: 10 }, maxSubsidy: 50000 })]);
  assert.match(text, /PROMO GRATIS ONGKIR/);
  assert.match(text, /Ciputat/);
  assert.match(text, /minimal 10 barang/);
  assert.match(text, /maksimal Rp 50\.000/);
});

test('alat cek_ongkir: promo berdiri sendiri tanpa Lalamove', async () => {
  const promos = [rule()];
  assert.equal(deliveryQuote.isUsable(null, { realChat: true, promos }), true);
  assert.equal(deliveryQuote.isUsable(null, { realChat: true, promos: [] }), false);

  const fetchImpl = async (url) => ({
    ok: true,
    async json() {
      return String(url).includes('reverse')
        ? { display_name: 'Ciputat, Kota Tangerang Selatan, Banten, Indonesia', address: { city_district: 'Ciputat' } }
        : [];
    },
  });
  const spec = deliveryQuote.toolSpec({ conn: null, promos, lalamoveReady: false, run: () => {} });
  assert.ok(spec.parameters.properties.total_belanja);
  assert.equal(spec.parameters.properties.kendaraan, undefined);

  const out = await deliveryQuote.quote(null, { tujuan: '-6.3012,106.7523' }, { promos, lalamoveReady: false, fetchImpl });
  assert.equal(out.status, 'ok');
  assert.equal(out.promo_gratis_ongkir.status, 'berlaku');
  assert.equal(out.ongkir, undefined);
});

test('alat cek_ongkir: dengan Lalamove, ongkir normal tetap tampil dan bagian customer dihitung', async () => {
  const conn = {
    enabled: true, aiQuotesEnabled: true, environment: 'production', pickupLat: -6.2, pickupLng: 106.8,
    defaultService: 'MOTORCYCLE', cities: [{ services: [{ key: 'MOTORCYCLE', description: 'Motor' }] }],
  };
  const fetchImpl = async () => ({
    ok: true,
    async json() { return { display_name: 'Pamulang, Kota Tangerang Selatan, Banten, Indonesia', address: {} }; },
  });
  const getQuotation = async () => ({ total: 80000, currency: 'IDR', distanceMeters: 15000 });
  const run = (extra, args) => deliveryQuote.quote(conn, { tujuan: '-6.34,106.74', ...args }, { promos: [rule(extra)], fetchImpl, getQuotation });

  const free = await run({}, {});
  assert.equal(free.ongkir, 'Rp 80.000');
  assert.equal(free.ongkir_dibayar_customer, 'GRATIS');

  const capped = await run({ maxSubsidy: 50000 }, {});
  assert.equal(capped.ongkir_dibayar_customer, 'Rp 30.000');

  const needInfo = await run({ conditions: { minQty: 10 } }, {});
  assert.equal(needInfo.promo_gratis_ongkir.status, 'syarat_belum_diketahui');
  assert.equal(needInfo.ongkir_dibayar_customer, undefined);

  const met = await run({ conditions: { minQty: 10 } }, { jumlah_barang: 10 });
  assert.equal(met.ongkir_dibayar_customer, 'GRATIS');
});
