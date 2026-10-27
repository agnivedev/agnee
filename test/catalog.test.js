'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/catalog');

const PRODUCT = {
  ID: 'p1', Name: 'Semen Jakarta', Category: 'Semen', Released: '2026-10-20T00:00:00',
  ImageUrl: 'https://cdn.dealpos.test/semen.jpg', Discontinued: false,
  Variants: [
    { ID: 'v1', Model: '40 kg', Code: 'SJ40', UnitPrice: 62000, Discount: 0 },
    { ID: 'v2', Model: '50 kg', Code: 'SJ50', UnitPrice: 75000, Discount: 10, ImageURL: 'javascript:alert(1)' },
    { ID: 'v3', Model: 'Sample', Code: 'SJS', UnitPrice: 0 },
    { ID: 'v4', Model: 'Lama', Code: 'SJL', UnitPrice: 50000, Discontinued: true },
  ],
};

test('produk DealPOS dipecah per varian; tanpa harga, discontinued, dan URL berbahaya dibuang', () => {
  const items = catalog.mapDealposProduct(PRODUCT);
  assert.deepEqual(items.map((i) => i.name), ['Semen Jakarta 40 kg', 'Semen Jakarta 50 kg']);
  assert.equal(items[1].discountPct, 10);
  // Gambar varian "javascript:" ditolak, jatuh ke gambar produk.
  assert.equal(items[1].imageUrl, 'https://cdn.dealpos.test/semen.jpg');
  assert.equal(items[0].category, 'Semen');
  assert.ok(items[0].releasedAt instanceof Date);

  const single = catalog.mapDealposProduct({ Name: 'Pipa Rucika', Variants: [{ ID: 'x', Model: 'Default', UnitPrice: 30000 }] });
  assert.equal(single[0].name, 'Pipa Rucika');
  assert.deepEqual(catalog.mapDealposProduct({ ...PRODUCT, Discontinued: true }), []);
});

test('tarikan katalog: halaman produk + laporan terjual; laporan ditolak tidak menggagalkan katalog', async () => {
  const paths = [];
  const get = async (path) => {
    paths.push(path);
    if (path.startsWith('/Product')) return { DataArray: [PRODUCT], RecordsCount: 1 };
    if (path.startsWith('/Report/ProductSold')) return [{ Code: 'SJ50', Quantity: 40 }, { Code: 'sj40', Quantity: 12 }];
    throw new Error(`tak dikenal ${path}`);
  };
  const now = new Date('2026-10-27T05:00:00Z');
  const out = await catalog.fetchDealposCatalog(get, { now, bestSellerDays: 30, sleep: async () => {} });
  assert.equal(out.items.length, 2);
  assert.equal(out.sold.get('sj50'), 40);
  assert.ok(paths.some((p) => p === '/Report/ProductSold?From=2026-09-27&To=2026-10-27&Scope=Variant'));

  const denied = await catalog.fetchDealposCatalog(async (path) => {
    if (path.startsWith('/Report')) throw new Error('Forbidden: Report VIEW');
    return { DataArray: [PRODUCT] };
  }, { now, sleep: async () => {} });
  assert.equal(denied.sold, null);
  assert.match(denied.soldError, /Forbidden/);
  assert.equal(denied.items.length, 2);

  // Batas laju tetap dilempar: pekerjaan harus menunggu, bukan menganggap laporan kosong.
  const limited = Object.assign(new Error('429'), { rateLimited: true });
  await assert.rejects(catalog.fetchDealposCatalog(async (path) => {
    if (path.startsWith('/Report')) throw limited;
    return { DataArray: [PRODUCT] };
  }, { now, sleep: async () => {} }), /429/);
});

test('ribbon otomatis: best seller per jumlah terjual, promo dari diskon, baru dari tanggal rilis', () => {
  const now = new Date('2026-10-27T05:00:00Z');
  const items = [
    { externalId: 'a', code: 'A', discountPct: 0, releasedAt: new Date('2026-10-25') },
    { externalId: 'b', code: 'B', discountPct: 15, releasedAt: new Date('2025-01-01') },
    { externalId: 'c', code: 'C', discountPct: 0, releasedAt: null },
    { externalId: 'd', code: null, discountPct: 0, releasedAt: null },
  ];
  const sold = new Map([['a', 5], ['b', 50], ['c', 20]]);
  const out = catalog.autoAssignments(items, sold, { bestSellerCount: 2, newDays: 30, now });
  assert.deepEqual(out.best_seller, ['b', 'c']);
  assert.deepEqual(out.promo, ['b']);
  assert.deepEqual(out.new, ['a']);
  // Laporan tidak terbaca: best seller null = pasangan lama dibiarkan.
  assert.equal(catalog.autoAssignments(items, null, { now }).best_seller, null);
});

const TAGS = [
  { id: 't-ung', name: 'Unggulan', autoRule: null, highlight: true, aiNote: '', active: true },
  { id: 't-bs', name: 'Best Seller', autoRule: 'best_seller', highlight: true, aiNote: '', active: true },
  { id: 't-promo', name: 'Promo', autoRule: 'promo', highlight: false, aiNote: 'stok promo terbatas', active: true },
];

test('bagian prompt: katalog kecil dikirim utuh dengan harga diskon, ribbon, dan jasa tanpa harga', () => {
  const items = [
    { id: '1', kind: 'product', name: 'Cat Jotun 2.5L', code: 'JT25', price: 200000, discountPct: 10, unit: 'kaleng', description: 'Tahan cuaca', tags: [{ id: 't-promo', name: 'Promo' }] },
    { id: '2', kind: 'service', name: 'Jasa Pasang Keramik', price: null, priceNote: 'tergantung luas', description: '', tags: [{ id: 't-ung', name: 'Unggulan' }] },
  ];
  const section = catalog.catalogSection({ items, tags: TAGS }, { text: 'halo' });
  assert.match(section, /## KATALOG PRODUK & JASA/);
  assert.match(section, /Cat Jotun 2\.5L \[JT25\]: Rp 200\.000 per kaleng → diskon 10% jadi Rp 180\.000/);
  assert.match(section, /Jasa Pasang Keramik \(jasa\): harga tidak dicantumkan \(tergantung luas\) · ribbon: Unggulan/);
  assert.match(section, /- Promo: stok promo terbatas/);
  // Ribbon yang tidak dipakai item mana pun tidak dijelaskan.
  assert.doesNotMatch(section, /- Best Seller/);
  assert.equal(catalog.catalogSection({ items: [], tags: TAGS }, {}), '');
});

test('bagian prompt: katalog besar hanya memuat yang diutamakan + yang cocok dengan pesan', () => {
  const items = Array.from({ length: 300 }, (_, i) => ({
    id: String(i), kind: 'product', name: `Keramik Motif ${i}`, price: 50000 + i, discountPct: 0, description: '', tags: [],
  }));
  items.push({ id: 'semen', kind: 'product', name: 'Semen Jakarta 40 kg', price: 62000, discountPct: 0, description: '', tags: [] });
  items.push({ id: 'toren', kind: 'product', name: 'Toren Penguin 1000L', price: 1500000, discountPct: 0, description: '', tags: [{ id: 't-bs', name: 'Best Seller' }] });
  const section = catalog.catalogSection({ items, tags: TAGS }, { text: 'harga semen jakarta berapa kak' });
  assert.match(section, /### Diutamakan[^]*Toren Penguin 1000L/);
  assert.match(section, /### Cocok dengan percakapan ini\n- Semen Jakarta 40 kg: Rp 62\.000/);
  assert.doesNotMatch(section, /Keramik Motif/);
});
