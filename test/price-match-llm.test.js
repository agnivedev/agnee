'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMatcher, candidatesFor } = require('../src/price-match-llm');
const priceLookup = require('../src/price-lookup');

// Nama, kategori, satuan, dan harga dari katalog DealPOS ESBEJE (9 Nov).
const ITEMS = [
  { id: 1, name: 'RUCIKA STD 4 D', category: 'B/PLUMBING', unit: 'btg', price: 193500 },
  { id: 2, name: 'RUCIKA STD 4 AW', category: 'B/PLUMBING', unit: 'btg', price: 376000 },
  { id: 3, name: 'RUCIKA STD 3/4 AW', category: 'B/PLUMBING', unit: 'btg', price: 37000 },
  { id: 4, name: 'RUCIKA STD 1 1/4 AW', category: 'B/PLUMBING', unit: 'btg', price: 75500 },
  { id: 5, name: 'RUCIKA BACKFLOW VALVE 4"', category: 'B/PLUMBING', unit: 'pcs', price: 54000 },
  { id: 6, name: 'SEAL TAPE HACHI', category: 'B/PLUMBING', unit: 'pcs', price: 3000 },
  { id: 7, name: 'SEAL TAPE RRT 12MM', category: 'B/SANITARY', unit: 'pcs', price: 4000 },
  { id: 8, name: 'JAYABOARD GYPSUM WET- AREA 9MM', category: 'F/BUILDING BOARD', unit: 'lbr', price: 147500 },
  { id: 9, name: 'JAYABOARD GYPSUM 9MM', category: 'F/BUILDING BOARD', unit: 'lbr', price: 68000 },
  { id: 10, name: 'SEMEN JAKARTA Type PCC 40KG', category: 'F/CEMENT AND MORTAR', unit: 'zak', price: 45000 },
  { id: 11, name: 'HOLO GALV POLOS 2X4X4M (0,3MM)TALI PUTIH', category: 'F/STEEL AND ALUMINIUMS', unit: 'btg', price: 17400 },
  { id: 12, name: 'TAMBANG 12MM / KG', category: 'D/HARDWARE', unit: 'kg', price: 85000 },
  { id: 13, name: 'MU 480 RENOFIX 25KG', code: '1090500027', category: 'F/CEMENT AND MORTAR', unit: 'zak', price: 313000 },
];

/** Model palsu: menjawab langkah "pahami" dan "pilih" dari tabel. */
function fakeAsk(table) {
  const calls = [];
  const ask = async (prompt, system) => {
    calls.push({ prompt, system });
    const query = /Permintaan customer: "([^"]+)"/.exec(prompt)?.[1];
    const entry = table[query] || {};
    if (system.includes('"kata_kunci"')) return JSON.stringify(entry.understand || { barang: '', kategori: [], kata_kunci: [] });
    const lines = prompt.split('\n').filter((l) => /^\d+\. /.test(l));
    const picks = (entry.pick || []).map((name) => lines.findIndex((l) => l.includes(`. ${name} |`)) + 1).filter((n) => n > 0);
    return `Berikut pilihannya: ${JSON.stringify({ pilih: picks })}`;
  };
  return { ask, calls };
}

const TABLE = {
  'paralon 4 inch': {
    understand: { barang: 'pipa PVC 4 inci', kategori: ['B/PLUMBING'], kata_kunci: ['rucika', 'pvc', '4'] },
    pick: ['RUCIKA STD 4 D', 'RUCIKA STD 4 AW'],
  },
  siltip: {
    understand: { barang: 'seal tape', kategori: ['B/PLUMBING', 'B/SANITARY'], kata_kunci: ['seal', 'tape'] },
    pick: ['SEAL TAPE HACHI', 'SEAL TAPE RRT 12MM'],
  },
  'gypsum anti air': {
    understand: { barang: 'gypsum wet area', kategori: ['F/BUILDING BOARD'], kata_kunci: ['gypsum', 'wet', 'area'] },
    pick: ['JAYABOARD GYPSUM WET- AREA 9MM'],
  },
  'tali tambang': {
    understand: { barang: 'tali tambang', kategori: ['D/HARDWARE'], kata_kunci: ['tali', 'tambang'] },
    pick: ['TAMBANG 12MM / KG'],
  },
  'tali rafia biru': {
    understand: { barang: 'tali rafia', kategori: ['D/HARDWARE'], kata_kunci: ['tali', 'rafia'] },
    pick: [],
  },
};

test('kandidat dibatasi ke kategori terpilih dan diurutkan kata kunci', () => {
  const got = candidatesFor(ITEMS, { categories: ['B/PLUMBING'], keywords: ['rucika', '4'] });
  assert.ok(got.length >= 3);
  assert.ok(got.every((i) => i.category === 'B/PLUMBING'));
  assert.match(got[0].name, /RUCIKA STD 4|BACKFLOW VALVE 4/);
  // Kategori karangan model diabaikan, katalog utuh tetap disaring kata kunci.
  const loose = candidatesFor(ITEMS, { categories: ['PIPA PVC'], keywords: ['seal'] });
  assert.deepEqual(loose.map((i) => i.id).sort(), [6, 7]);
});

test('istilah lapangan dicocokkan ke barang katalog sungguhan', async () => {
  const { ask } = fakeAsk(TABLE);
  const matcher = createMatcher({ ask });
  const paralon = await matcher.resolve({ scope: 'co', items: ITEMS, query: 'paralon 4 inch' });
  assert.deepEqual(paralon.matches.map((i) => i.name).sort(), ['RUCIKA STD 4 AW', 'RUCIKA STD 4 D']);
  const seal = await matcher.resolve({ scope: 'co', items: ITEMS, query: 'siltip' });
  assert.equal(seal.matches.length, 2);
  const gypsum = await matcher.resolve({ scope: 'co', items: ITEMS, query: 'gypsum anti air' });
  assert.deepEqual(gypsum.matches.map((i) => i.price), [147500]);
});

test('nomor di luar daftar dan barang yang tak sesuai tidak pernah lolos', async () => {
  const matcher = createMatcher({
    ask: async (prompt, system) => (system.includes('"kata_kunci"')
      ? '{"barang":"tali tambang","kategori":["F/STEEL AND ALUMINIUMS"],"kata_kunci":["holo","putih"]}'
      : '{"pilih":[99, 0, -1, "x"]}'),
  });
  const got = await matcher.resolve({ scope: 'co', items: ITEMS, query: 'tali tambang putih' });
  assert.deepEqual(got.matches, []);
  const none = await createMatcher(fakeAsk(TABLE)).resolve({ scope: 'co', items: ITEMS, query: 'tali rafia biru' });
  assert.deepEqual(none.matches, []);
  assert.equal(none.undecided, undefined, 'model sudah memilih: kosong adalah keputusan');
});

test('hasil disimpan sementara per company: istilah yang sama tak dibayar dua kali', async () => {
  const { ask, calls } = fakeAsk(TABLE);
  const matcher = createMatcher({ ask });
  await matcher.resolve({ scope: 'co', items: ITEMS, query: 'paralon 4 inch' });
  const second = await matcher.resolve({ scope: 'co', items: ITEMS, query: 'Paralon  4 inch' });
  assert.equal(calls.length, 2);
  assert.equal(second.cached, true);
  assert.equal(second.matches.length, 2);
  await matcher.resolve({ scope: 'co-lain', items: ITEMS, query: 'paralon 4 inch' });
  assert.equal(calls.length, 4, 'company lain tidak memakai cache company ini');
});

test('cek_harga: LLM memastikan barang, hasil kata yang salah jenis dibuang', async () => {
  const { ask, calls } = fakeAsk(TABLE);
  const matcher = createMatcher({ ask });
  const tool = priceLookup.toolSpec({
    items: ITEMS,
    resolve: (query, seed) => matcher.resolve({ scope: 'co', items: ITEMS, query, seed }),
  });
  // Pencarian kata saja menawarkan besi hollow "TALI PUTIH" untuk tali tambang.
  assert.match(priceLookup.lookup(ITEMS, { barang: 'tali tambang' }).hasil[0].nama, /HOLO/);
  const tali = await tool.run({ barang: 'tali tambang' });
  assert.deepEqual(tali.hasil.map((r) => r.nama), ['TAMBANG 12MM / KG']);

  const single = await tool.run({ barang: 'paralon 4 inch' });
  assert.equal(single.status, 'ok');
  assert.deepEqual(single.hasil.map((r) => r.harga).sort(), ['Rp 193.500 per btg', 'Rp 376.000 per btg'].sort());
  assert.equal(single.hasil[0].dicocokkan_dari, 'paralon 4 inch');
  assert.match(single.pencocokan, /paralon 4 inch/);

  calls.length = 0;
  const multi = await tool.run({ daftar: ['Semen Jakarta 40KG', 'siltip', 'tali rafia biru', 'kode 1090500027'] });
  assert.equal(multi.status, 'sebagian');
  // Model tidak mengenali "Semen Jakarta 40KG" (tak ada di tabel tiruan): hasil kata dipakai.
  assert.equal(multi.per_barang[0].hasil[0].harga, 'Rp 45.000 per zak');
  assert.equal(multi.per_barang[0].hasil[0].dicocokkan_dari, undefined);
  assert.equal(multi.per_barang[1].status, 'ok');
  assert.equal(multi.per_barang[2].status, 'tidak_ketemu');
  assert.equal(multi.per_barang[3].hasil[0].nama, 'MU 480 RENOFIX 25KG');
  assert.ok(calls.every((c) => !c.prompt.includes('1090500027')), 'kode yang cocok persis tidak dikirim ke LLM');
});

test('cek_harga: LLM gagal atau melempar, barang tetap tidak_ketemu', async () => {
  const tool = priceLookup.toolSpec({ items: ITEMS, resolve: async () => { throw new Error('timeout'); } });
  const out = await tool.run({ barang: 'paralon 4 inch' });
  assert.equal(out.status, 'tidak_ketemu');
});
