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

test('harga jual (SellingPrice) didahulukan dari UnitPrice yang bisa berupa harga beli', () => {
  const [item] = catalog.mapDealposProduct({ Name: 'Semen MU', Variants: [{ ID: 'a', Model: '480', UnitPrice: 51000, SellingPrice: 62500 }] });
  assert.equal(item.price, 62500);
  // Tanpa SellingPrice, UnitPrice tetap dipakai.
  assert.equal(catalog.mapDealposProduct({ Name: 'Pipa', Variants: [{ ID: 'b', UnitPrice: 30000 }] })[0].price, 30000);
  // Harga jual 0: item dilewati, tidak jatuh ke harga beli.
  assert.deepEqual(catalog.mapDealposProduct({ Name: 'Sample', Variants: [{ ID: 'c', SellingPrice: 0, UnitPrice: 51000 }] }), []);
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

test('detail DealPOS hanya untuk Best Seller dan Promo, satu permintaan per produk, tanpa kembar dan dibatasi', async () => {
  const items = [
    { externalId: 'v1', productId: 'p1' }, { externalId: 'v2', productId: 'p1' },
    { externalId: 'v3', productId: 'p3' }, { externalId: 'v4', productId: 'p4' }, { externalId: 'v5', productId: null },
  ];
  const targets = catalog.detailTargets(items, { best_seller: ['v1', 'v5'], promo: ['v2', 'v3'] });
  assert.deepEqual(targets.map((t) => t.productId), ['p1', 'p3']);
  assert.equal(catalog.detailTargets(items, { best_seller: ['v1', 'v3', 'v4'], promo: [] }, 2).length, 2);
  assert.deepEqual(catalog.detailTargets(items, { best_seller: null, promo: [] }), []);
});

test('merek dan tag dari /Product/Detail dibaca; rate limit menghentikan tarikan tanpa melempar', async () => {
  const paths = [];
  const get = async (path) => {
    paths.push(path);
    if (path.includes('p3')) { const e = new Error('429'); e.rateLimited = true; throw e; }
    return { Brand: ' RUCIKA ', Tags: ['Normal', ' ', 'Promo'] };
  };
  const out = await catalog.fetchDealposDetails(get, [
    { externalId: 'v1', productId: 'p1' }, { externalId: 'v3', productId: 'p3' }, { externalId: 'v4', productId: 'p4' },
  ], { sleep: async () => {} });
  assert.deepEqual(paths, ['/Product/Detail?ID=p1', '/Product/Detail?ID=p3']);
  assert.deepEqual(out.get('v1'), { brand: 'RUCIKA', tags: ['Normal', 'Promo'] });
  assert.equal(out.has('v3'), false);
});

test('merek tampil di baris katalog untuk AI', () => {
  const section = catalog.catalogSection({
    items: [{ id: 'i1', name: 'RUCIKA BACKFLOW VALVE 3"', code: 'RB3', price: 100000, discountPct: 0, brand: 'RUCIKA', tags: [] }],
    tags: [],
  });
  assert.match(section, /RUCIKA BACKFLOW VALVE 3" \[RB3\] \(merek RUCIKA\): Rp 100\.000/);
});

test('respons /Product asli: UnitPrice adalah harga jual, productId ikut dibawa', () => {
  const items = catalog.mapDealposProduct({
    ID: 'prod-9', Name: 'UNICERA BALENCIAGA GREY 50X50 KW1', Code: 'UNCR-00042', Category: 'A/CERAMIC TILES',
    Variants: [{ ID: 'var-9', Model: 'Default', Code: 'UNCR-00042', UnitPrice: 85000, Discount: 0 }],
  });
  assert.equal(items[0].price, 85000);
  assert.equal(items[0].productId, 'prod-9');
});

test('satuan dan merek varian dibaca dari UOMName dan Brand; kosong jadi null', async () => {
  const paths = [];
  const get = async (path) => { paths.push(path); return path.includes('v2') ? { UOMName: '  ', Brand: null } : { UOMName: ' mtr ', Brand: 'SBJ' }; };
  assert.deepEqual(await catalog.fetchVariantDetail(get, 'v1'), { unit: 'mtr', brand: 'SBJ' });
  assert.deepEqual(await catalog.fetchVariantDetail(get, 'v2'), { unit: null, brand: null });
  assert.deepEqual(paths, ['/Variant/Detail?ID=v1', '/Variant/Detail?ID=v2']);
});
