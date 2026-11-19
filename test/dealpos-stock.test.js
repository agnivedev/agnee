'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchInventory, availableOf, stockOf, stockText } = require('../src/dealpos-stock.js');
const { findFalseAvailability, stripFalseAvailability } = require('../src/stock-guard.js');
const priceLookup = require('../src/price-lookup.js');
const serperSearch = require('../src/serper-search.js');
const catalog = require('../src/catalog.js');
const { enforceReplyContract } = require('../src/reply-style.js');

const NOW = new Date().toISOString();
const item = (name, stock, extra = {}) => ({
  id: name, name, code: extra.code || null, price: 18400, unit: 'mtr', source: 'dealpos',
  stock, stockSyncedAt: stock === null ? null : NOW, ...extra,
});

test('availableOf memakai Available lalu Inventory lalu OnHand, tidak pernah negatif', () => {
  assert.equal(availableOf({ Inventory: 12, I: { OnHand: 12, Allocated: 4, Available: 8 } }), 8);
  assert.equal(availableOf({ Inventory: 5 }), 5);
  assert.equal(availableOf({ I: { OnHand: 3 } }), 3);
  assert.equal(availableOf({ I: { Available: -2 } }), 0);
  assert.equal(availableOf({}), null);
});

test('fetchInventory: satu baris per varian, halaman habis berhenti, varian tanpa angka dilewati', async () => {
  const paths = [];
  const get = async (path) => {
    paths.push(path);
    return { Data: [
      { VariantID: 'v1', Inventory: 12, I: { Available: 8 } },
      { VariantID: 'v2', Inventory: 0, I: { Available: 0 } },
      { VariantID: 'v3' },
    ] };
  };
  const stock = await fetchInventory(get);
  assert.deepEqual([...stock], [['v1', 8], ['v2', 0]]);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^\/Inventory\?PageNumber=1/);
});

test('stockOf: nol = habis, null/usang = tidak diketahui (bukan nol, bukan ada)', () => {
  assert.equal(stockOf(item('A', 0)).state, 'habis');
  assert.equal(stockOf(item('A', 3)).state, 'menipis');
  assert.equal(stockOf(item('A', 40)).state, 'tersedia');
  assert.equal(stockOf(item('A', null)).state, 'tidak_diketahui');
  const old = item('A', 40, { stockSyncedAt: new Date(Date.now() - 30 * 3600_000).toISOString() });
  assert.equal(stockOf(old).state, 'tidak_diketahui');
  assert.match(stockText(item('A', 0)), /HABIS/);
  assert.match(stockText(item('A', null)), /tidak diketahui/);
});

test('cek_harga membawa stok per varian dan menandai yang habis', () => {
  const items = [
    item('KAWAT AYAKAN 1/2 HIJAU', 0, { code: '1000000004' }),
    item('KAWAT AYAKAN 1/2 BIRU', 25, { code: '1000000005' }),
  ];
  const out = priceLookup.lookup(items, { barang: 'kawat ayakan 1/2' });
  assert.equal(out.status, 'ok');
  const byName = Object.fromEntries(out.hasil.map((r) => [r.nama, r]));
  assert.equal(byName['KAWAT AYAKAN 1/2 HIJAU'].status_stok, 'habis');
  assert.match(byName['KAWAT AYAKAN 1/2 HIJAU'].stok, /HABIS/);
  assert.equal(byName['KAWAT AYAKAN 1/2 BIRU'].status_stok, 'tersedia');
  assert.doesNotMatch(out.catatan, /Bukan informasi stok/);
});

test('penjaga stok: "ready" untuk varian berstok nol ditandai, varian berstok tidak', () => {
  const items = [item('KAWAT AYAKAN 1/2 HIJAU', 0), item('KAWAT AYAKAN 1/2 BIRU', 25)];
  assert.equal(findFalseAvailability('Kawat ayakan 1/2 hijau ready kak, Rp 18.400 per mtr.', items).length, 1);
  assert.equal(findFalseAvailability('Kawat ayakan 1/2 biru ready kak, Rp 18.400 per mtr.', items).length, 0);
  assert.equal(findFalseAvailability('Kawat ayakan 1/2 hijau sedang habis kak, yang biru ready.', items).length, 0);
  assert.equal(findFalseAvailability('Kawat ayakan 1/2 hijau lagi kosong ya kak.', items).length, 0);
});

test('penjaga stok: stok tidak diketahui tidak dituduh, balasan tanpa barang itu lolos', () => {
  const items = [item('SEMEN GRESIK 40KG', null), item('KAWAT AYAKAN 1/2 HIJAU', 0)];
  assert.equal(findFalseAvailability('Semen Gresik 40kg ada kak.', items).length, 0);
  assert.equal(findFalseAvailability('Ada yang bisa kami bantu kak?', items).length, 0);
});

test('stripFalseAvailability membuang hanya kalimat yang salah', () => {
  const items = [item('KAWAT AYAKAN 1/2 HIJAU', 0)];
  const text = 'Halo kak.\nKawat ayakan 1/2 hijau ready kak.\nMau berapa meter?';
  assert.equal(stripFalseAvailability(text, items), 'Halo kak.\nMau berapa meter?');
});

test('enforceReplyContract menulis ulang lalu memangkas balasan yang bilang ada padahal habis', async () => {
  const items = [item('KAWAT AYAKAN 1/2 HIJAU', 0)];
  const llm = { enabled: true, generateReply: async () => ({ text: 'Kawat ayakan 1/2 hijau tersedia kak, mau berapa meter ya?' }) };
  const out = await enforceReplyContract(llm, {
    text: 'Kawat ayakan 1/2 hijau ready kak, mau berapa meter?', systemPrompt: '', userMessage: 'kawat ayakan hijau ada?', stockItems: items,
  });
  assert.ok(out === null || !/hijau\s+(ready|tersedia)/i.test(out.text));
  const fixing = { enabled: true, generateReply: async () => ({ text: 'Kawat ayakan 1/2 hijau sedang habis kak, yang biru ada. Mau yang biru?' }) };
  const ok = await enforceReplyContract(fixing, {
    text: 'Kawat ayakan 1/2 hijau ready kak.', systemPrompt: '', userMessage: 'kawat hijau ada?', stockItems: items,
  });
  assert.match(ok.text, /habis/);
  assert.equal(ok.rewritten, true);
});

test('catalog.fetchDealposCatalog menarik stok; gagal tidak membatalkan katalog', async () => {
  const product = { ID: 'p1', Name: 'KAWAT', Category: 'B', Variants: [{ ID: 'v1', Code: 'K1', UnitPrice: 1000 }] };
  const base = (path) => {
    if (path.startsWith('/Product?')) return { DataArray: [product] };
    if (path.startsWith('/Report/ProductSold')) return [];
    return null;
  };
  const ok = await catalog.fetchDealposCatalog(async (path) => (path.startsWith('/Inventory') ? [{ VariantID: 'v1', Inventory: 0 }] : base(path)), { sleep: async () => {} });
  assert.equal(ok.items.length, 1);
  assert.equal(ok.stock.get('v1'), 0);
  const failing = await catalog.fetchDealposCatalog(async (path) => {
    if (path.startsWith('/Inventory')) throw new Error('HTTP 403');
    return base(path);
  }, { sleep: async () => {} });
  assert.equal(failing.items.length, 1);
  assert.equal(failing.stock, null);
  assert.match(failing.stockError, /403/);
});

test('serper-search: tanpa kunci mati, dengan kunci hanya judul dan ringkasan (tanpa link)', async () => {
  serperSearch.clearCache();
  assert.equal(serperSearch.enabled({ apiKey: '' }), false);
  assert.equal(await serperSearch.searchWeb('kawat ayakan', { apiKey: '' }), null);
  let body = null;
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ organic: [{ title: 'Kawat Ayakan 1/2 inch', snippet: 'Kawat anyaman', link: 'https://x.test' }] }) };
  };
  const res = await serperSearch.searchWeb('kawat ayakan', { apiKey: 'k', fetchImpl });
  assert.deepEqual(res, [{ judul: 'Kawat Ayakan 1/2 inch', ringkasan: 'Kawat anyaman' }]);
  assert.equal(body.gl, 'id');
  const denied = await serperSearch.searchWeb('barang lain', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: 'no' }) }) });
  assert.equal(denied, null);
  serperSearch.clearCache();
});

test('cek_harga: barang tidak ketemu di POS mendapat referensi Google; yang ketemu tidak memanggil Google', async () => {
  serperSearch.clearCache();
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ organic: [{ title: 'Paku beton 4 inch', snippet: 'Paku baja' }] }) };
  };
  try {
    const tool = priceLookup.toolSpec({ items: [item('KAWAT AYAKAN 1/2 BIRU', 25)], serper: { apiKey: 'k' } });
    const found = await tool.run({ barang: 'kawat ayakan biru' });
    assert.equal(found.status, 'ok');
    assert.equal(found.referensi_google, undefined);
    assert.equal(calls, 0);
    const missing = await tool.run({ barang: 'paku beton 4 inch' });
    assert.equal(missing.status, 'tidak_ketemu');
    assert.equal(missing.referensi_google[0].judul, 'Paku beton 4 inch');
    assert.equal(calls, 1);
    const off = priceLookup.toolSpec({ items: [item('KAWAT AYAKAN 1/2 BIRU', 25)], serper: { apiKey: '' } });
    assert.equal((await off.run({ barang: 'paku beton' })).referensi_google, undefined);
  } finally {
    globalThis.fetch = realFetch;
    serperSearch.clearCache();
  }
});
