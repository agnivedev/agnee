'use strict';

/**
 * Aturan flow Agnes (29 Okt): pencocokan barang longgar dijaga harga, satuan
 * dari DealPOS, varian/warna ambigu dikembalikan ke customer, rincian menolak
 * harga karangan dan ongkir 0 tanpa bukti, alamat ketikan untuk proforma.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLine } = require('../src/item-match.js');
const orderSummary = require('../src/order-summary.js');
const orders = require('../src/dealpos-orders.js');
const priceLookup = require('../src/price-lookup.js');
const vehicles = require('../src/lalamove-vehicles.js');
const paymentProof = require('../src/payment-proof.js');

const ITEMS = [
  { code: '1000011476', name: 'MU 301 PLASTERPLUS 40KG', unit: 'zak', price: 104000, unitPrice: 104000 },
  { code: '1000003302', name: 'MU 200 SKIMWALL 40KG', unit: 'zak', price: 134000, unitPrice: 134000 },
  { code: '1000015169', name: 'PENGUIN TB110 1050L BIRU TUA', unit: 'pcs', price: 2619000, unitPrice: 2619000 },
  { code: '1057808067', name: 'PENGUIN TB110 1050L HITAM', unit: 'pcs', price: 2619000, unitPrice: 2619000 },
  { code: '1000015170', name: 'PENGUIN TB110 1050L ORANGE', unit: 'pcs', price: 2745000, unitPrice: 2745000 },
  { code: '1085500003', name: 'SEMEN JAKARTA Type PCC 40KG', unit: 'zak', price: 45000, unitPrice: 45000 },
  { code: 'X1', name: 'ITEM TANPA SATUAN', unit: null, price: 5000, unitPrice: 5000 },
];

test('item-match: kode persis, nama longgar dengan harga cocok, nama berbeda dari daftar', () => {
  assert.equal(resolveLine(ITEMS, { kode: '1000011476' }).item.name, 'MU 301 PLASTERPLUS 40KG');
  assert.equal(resolveLine(ITEMS, { kode: 'MU-301', harga: 104000 }).item.code, '1000011476');
  assert.equal(resolveLine(ITEMS, { kode: 'Semen Jakarta 40KG', harga: 45000 }).item.code, '1085500003');
  assert.equal(resolveLine(ITEMS, { kode: 'MU-301', harga: 90000 }).status, 'harga_beda');
  assert.equal(resolveLine(ITEMS, { kode: 'genteng metal pasir', harga: 1000 }).status, 'tidak_dikenal');
});

test('item-match: beberapa warna berharga sama = varian_ambigu, harga orange memilih orange', () => {
  const amb = resolveLine(ITEMS, { kode: 'Toren Penguin 1050L', harga: 2619000 });
  assert.equal(amb.status, 'varian_ambigu');
  assert.equal(amb.candidates.length, 2);
  assert.equal(resolveLine(ITEMS, { kode: 'Toren Penguin 1050L', harga: 2745000 }).item.code, '1000015170');
});

test('rincian: harga karangan ditolak, satuan memakai UOM DealPOS bukan tebakan model', () => {
  const spec = orderSummary.toolSpec({ items: ITEMS });
  const bad = spec.run({ barang: [{ nama: 'Toren Penguin 1050L', jumlah: 1, harga_satuan: 1750000 }], grand_total_hitunganmu: 1750000 });
  assert.equal(bad.status, 'harga_atau_varian_tidak_cocok');
  assert.equal(bad.barang[0].masalah, 'harga_beda');
  const ok = spec.run({ barang: [{ nama: 'MU 301 Plasterplus 40KG', jumlah: 12, harga_satuan: 104000, satuan: 'sak' }], grand_total_hitunganmu: 1248000 });
  assert.equal(ok.status, 'ok');
  assert.match(ok.teks, /12 zak x Rp 104\.000/);
  assert.doesNotMatch(ok.teks, /sak x/);
});

test('rincian: varian ambigu dikembalikan, barang tanpa kecocokan lolos (harga dari playbook)', () => {
  const spec = orderSummary.toolSpec({ items: ITEMS });
  const amb = spec.run({ barang: [{ nama: 'Toren Penguin 1050L', jumlah: 1, harga_satuan: 2619000 }], grand_total_hitunganmu: 2619000 });
  assert.equal(amb.status, 'harga_atau_varian_tidak_cocok');
  assert.equal(amb.barang[0].masalah, 'varian_ambigu');
  const pass = spec.run({ barang: [{ nama: 'Jasa pasang', jumlah: 1, harga_satuan: 50000 }], grand_total_hitunganmu: 50000 });
  assert.equal(pass.status, 'ok');
});

test('rincian: ongkir 0 hanya bila cek_ongkir menyatakan GRATIS atau ambil di toko', () => {
  const barang = [{ nama: 'MU 301 Plasterplus 40KG', jumlah: 1, harga_satuan: 104000 }];
  const noProof = orderSummary.toolSpec({ items: ITEMS, shippingProof: () => ({ called: false, freeConfirmed: false }) });
  assert.equal(noProof.run({ barang, ongkir: 0, grand_total_hitunganmu: 104000 }).status, 'ongkir_tak_terbukti');
  const pickup = noProof.run({ barang, ongkir: 0, ambil_di_toko: true, grand_total_hitunganmu: 104000 });
  assert.equal(pickup.status, 'ok');
  assert.match(pickup.teks, /Ambil di toko: GRATIS/);
  const free = orderSummary.toolSpec({ items: ITEMS, shippingProof: () => ({ called: true, freeConfirmed: true }) });
  assert.equal(free.run({ barang, ongkir: 0, grand_total_hitunganmu: 104000 }).status, 'ok');
});

test('proforma: nama bebas dicocokkan dengan harga, satuan dari katalog, varian ambigu ditanyakan', () => {
  const products = ITEMS.map((i, n) => ({ variantId: `v${n}`, code: i.code, name: i.name, unit: null, unitPrice: i.unitPrice }));
  const loose = orders.resolveItems(products, [{ kode: 'MU-301', jumlah: 12, harga_satuan: 104000 }], ITEMS);
  assert.equal(loose.lines[0].code, '1000011476');
  assert.equal(loose.lines[0].unit, 'zak');
  const amb = orders.resolveItems(products, [{ kode: 'Toren Penguin 1050L', jumlah: 1, harga_satuan: 2619000 }], ITEMS);
  assert.equal(amb.lines.length, 0);
  assert.equal(amb.ambiguous[0].pilihan.length, 2);
  assert.match(amb.ambiguous[0].pilihan[0], /per pcs/);
});

test('cek_harga: baris hasil memuat satuan DealPOS dan "tidak dicantumkan" bila kosong', () => {
  const out = priceLookup.lookup(ITEMS, { barang: 'MU 301' });
  assert.equal(out.hasil[0].satuan, 'zak');
  assert.equal(priceLookup.lookup(ITEMS, { barang: 'ITEM TANPA SATUAN' }).hasil[0].satuan, 'tidak dicantumkan');
  assert.match(priceLookup.GUIDE, /satuan \(UOM\)/);
});

test('kendaraan: jawaban Management dengan kendaraan yang ditolak membaca yang dipilih', () => {
  assert.equal(vehicles.parseAnswer('motor ga muat, pakai pick up').key, 'PICK_UP_TRUCK');
  assert.equal(vehicles.parseAnswer('bukan motor, pickup aja').key, 'PICK_UP_TRUCK');
  assert.equal(vehicles.parseAnswer('2 motor').count, 2);
});

test('bukti transfer: tagihan ditebak dari GRAND TOTAL, bukan Total produk', () => {
  const body = '*Rincian Pesanan*\nTotal produk: Rp 1.784.000\nOngkir: Rp 94.700\n*GRAND TOTAL: Rp 1.878.700*';
  assert.equal(paymentProof.guessExpectedAmount([{ fromMe: true, body }]), 1878700);
  assert.equal(paymentProof.guessExpectedAmount([{ fromMe: true, body: 'Total produk: Rp 1.784.000' }]), null);
});

const deliveryQuote = require('../src/delivery-quote.js');

const LALA = {
  environment: 'production', enabled: true, aiQuotesEnabled: true, pickupLat: -6.34, pickupLng: 106.63, defaultService: 'MOTORCYCLE',
  cities: [{ locode: 'ID JKT', name: 'Jakarta', services: ['MOTORCYCLE', 'MPV', 'VAN', 'PICK_UP_TRUCK', 'ENGKELBAK', 'CDDBAK'].map((key) => ({ key })) }],
};

test('ongkir: kendaraan dipilih kode dari berat nama barang, bukan truk besar untuk 10 zak semen', async () => {
  const tried = [];
  const getQuotation = async (conn, { serviceType }) => { tried.push(serviceType); return { total: 100000, currency: 'IDR', quotationId: 'q' }; };
  const out = await deliveryQuote.quote(LALA, {
    tujuan: '-6.19,106.74', kendaraan: 'CDDBAK', barang: [{ nama: 'SEMEN JAKARTA Type PCC 40KG', jumlah: 10 }],
  }, { getQuotation });
  assert.equal(out.status, 'ok');
  assert.equal(tried[0], 'VAN'); // 400 kg -> kendaraan terkecil yang muat
  assert.equal(out.kendaraan, 'VAN');
});

test('ongkir: tanpa berat di nama barang, pilihan model dibatasi pick-up; area tak dilayani mencoba kendaraan lebih besar', async () => {
  const tried = [];
  const getQuotation = async (conn, { serviceType }) => {
    tried.push(serviceType);
    if (serviceType === 'PICK_UP_TRUCK') { const e = new Error('Given latitude/longitude is out of service area.'); e.code = 'ERR_OUT_OF_SERVICE_AREA'; throw e; }
    return { total: 250000, currency: 'IDR', quotationId: 'q' };
  };
  const out = await deliveryQuote.quote(LALA, { tujuan: '-6.19,106.74', kendaraan: 'CDDBAK', barang: [{ nama: 'PENGUIN TB110 1050L SANDSTONE', jumlah: 1 }] }, { getQuotation });
  assert.deepEqual(tried, ['PICK_UP_TRUCK', 'ENGKELBAK']);
  assert.equal(out.status, 'ok');
  assert.equal(out.layanan, 'ENGKELBAK');
});

test('alamat format WhatsApp: baris Kabupaten/Kota kembar dan isian "-" dirapikan', () => {
  const addressCheck = require('../src/address-check.js');
  assert.equal(
    addressCheck.normalizeFormatted('Alamat lengkap: Jl. Kisamaun No. 20\nKelurahan: Sukasari\nKabupaten: Tangerang\nKota: Tangerang\nProvinsi: Banten'),
    'Jl. Kisamaun No. 20, Sukasari, Tangerang, Banten',
  );
  assert.equal(
    addressCheck.normalizeFormatted('Alamat lengkap: Jl. Kembangan Raya No. 10\nKelurahan: Kembangan Selatan\nKabupaten: -\nKota: Jakarta Barat\nProvinsi: DKI Jakarta'),
    'Jl. Kembangan Raya No. 10, Kembangan Selatan, Jakarta Barat, DKI Jakarta',
  );
});

test('chat-memory: hasil cek_ongkir dan barang yang ditunjukkan diingat per chat', () => {
  const memory = require('../src/chat-memory.js');
  memory.remember(memory.quotes, 'co', 'chat-a', { status: 'ok', ongkir_dibayar_angka: 94700 });
  assert.equal(memory.list(memory.quotes, 'co', 'chat-a')[0].ongkir_dibayar_angka, 94700);
  assert.deepEqual(memory.list(memory.quotes, 'co', 'chat-b'), []);
  const spec = orderSummary.toolSpec({ items: ITEMS, shippingProof: () => ({ called: true, freeConfirmed: false, amounts: [94700] }) });
  const barang = [{ nama: 'MU 301 Plasterplus 40KG', jumlah: 1, harga_satuan: 104000 }];
  assert.equal(spec.run({ barang, ongkir: 200000, grand_total_hitunganmu: 304000 }).status, 'ongkir_tak_terbukti');
  assert.equal(spec.run({ barang, ongkir: 94700, grand_total_hitunganmu: 198700 }).status, 'ok');
});

test('rincian: label ongkir Lalamove tanpa kode kendaraan; toren 1050L tidak naik motor', () => {
  const out = orderSummary.run({ barang: [{ nama: 'A', jumlah: 1, harga_satuan: 1000 }], ongkir: 5000, keterangan_ongkir: 'Ongkir (Lalamove, TRUCK175)' });
  assert.match(out.teks, /Ongkir \(Lalamove\): Rp 5\.000/);
  assert.doesNotMatch(out.teks, /TRUCK175/);
  const conn = { cities: [{ services: ['MOTORCYCLE', 'VAN', 'PICK_UP_TRUCK'].map((key) => ({ key })) }] };
  assert.equal(deliveryQuote.vehiclePlan(conn, 'MOTORCYCLE', [{ nama: 'PENGUIN TB110 1050L SANDSTONE', jumlah: 1 }])[0], 'PICK_UP_TRUCK');
});
