'use strict';

/**
 * Pencarian cek_harga: normalisasi kata, kandidat global, aturan merek/kode.
 * Audit DealPOS-Agnes (ESBEJE, 16 Nov): celah yang terbukti dari balasan AI dan kueri customer nyata.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const prices = require('../src/dealpos-prices.js');
const { createMatcher, globalCandidates, PICK_SYSTEM } = require('../src/price-match-llm.js');

// ---- Normalisasi kata/ukuran di pencarian kata --------------------------------------------------

test('pencarian kata: ejaan lain, "*" sebagai pemisah ukuran', () => {
  const items = [
    { id: 1, name: 'VALENTINO NEW MAHOGANY COFFEE 15X90 KW1 (1.08M2)', category: 'A/GRANITE', unit: 'dus', price: 302000 },
    { id: 2, name: 'DEMIX C2 Perekat Granit 25Kg', category: 'C/CEMENT & MORTAR', unit: 'zak', price: 90000 },
    { id: 3, name: 'ALINDO CLOSET JONGKOK PUTIH', category: 'B/SANITARY', unit: 'pcs', price: 150000 },
    { id: 4, name: 'TRIPLEK 18MM 4X8 MC NS', category: 'F/LUMBER', unit: 'lbr', price: 228000 },
    { id: 5, name: 'JAYABOARD GYPSUM WET- AREA 9MM', category: 'F/BUILDING BOARD', unit: 'lbr', price: 147500 },
  ];
  assert.equal(prices.matchProducts(items, { text: 'granit lantai yg size 15*90' })[0].id, 1);
  assert.equal(prices.matchProducts(items, { text: 'wc jongkok' })[0].id, 3);
  assert.equal(prices.matchProducts(items, { text: 'kloset jongkok' })[0].id, 3);
  assert.equal(prices.matchProducts(items, { text: 'triplex 18' })[0].id, 4);
  assert.equal(prices.matchProducts(items, { text: 'gysum anti air' })[0].id, 5);
});

// ---- Pencocok LLM: kategori tebakan salah, merek/kode spesifik ----------------------------------

const CATALOG = [
  { id: 1, name: 'DEXTONE LEM PIPA PVC 400GR', category: 'C/PAINT ACCESSORIES', unit: 'klg', price: 61000 },
  { id: 2, name: 'PLAFON PVC TYPE 2090 4 MTR', category: 'F/ROOFING', unit: 'lbr', price: 61300 },
  { id: 3, name: 'LIST PLAFON K22 P03 X 3Mtr TEAK', category: 'F/BUILDING BOARD', unit: 'btg', price: 37800 },
  { id: 4, name: 'RUCIKA STD 4 D', category: 'B/PLUMBING', unit: 'btg', price: 193500 },
  { id: 5, name: 'VALENTINO TINSEL GLAZED 60X120 KW1', category: 'A/GRANITE', unit: 'dus', price: 400000 },
  ...Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, name: `KABEL NYM ${i + 1}X1.5 ETERNA`, category: 'E/ELECTRICAL', unit: 'roll', price: 500000 + i })),
];

test('kandidat global: barang di kategori yang salah ditebak tetap ditawarkan', () => {
  const got = globalCandidates(CATALOG, ['plafon', 'pvc', '4m']).map((i) => i.name);
  assert.ok(got.includes('PLAFON PVC TYPE 2090 4 MTR'));
  const glue = globalCandidates(CATALOG, ['lem', 'pvc', 'pipa', 'dextone']).map((i) => i.name);
  assert.equal(glue[0], 'DEXTONE LEM PIPA PVC 400GR');
  assert.deepEqual(globalCandidates(CATALOG, ['4', '10']), [], 'angka saja tidak cukup');
});

test('kategori tebakan model meleset: barangnya tetap sampai ke langkah memilih', async () => {
  const shown = [];
  const ask = async (prompt, system) => {
    if (system.includes('"kata_kunci"')) return '{"barang":"plafon PVC","kategori":["F/BUILDING BOARD"],"kata_kunci":["plafon","pvc"]}';
    shown.push(prompt);
    const line = prompt.split('\n').find((l) => /PLAFON PVC/.test(l));
    return JSON.stringify({ pilih: line ? [Number.parseInt(line, 10)] : [] });
  };
  const got = await createMatcher({ ask }).resolve({ scope: 'co', items: CATALOG, query: 'plafon pvc 4 meter' });
  assert.deepEqual(got.matches.map((i) => i.name), ['PLAFON PVC TYPE 2090 4 MTR']);
});

test('pemilih tidak boleh mengganti merek/kode/motif yang disebut customer', () => {
  assert.match(PICK_SYSTEM, /MEREK, kode model, seri, atau motif/);
  assert.match(PICK_SYSTEM, /jangan menggantinya dengan merek, motif, atau kode lain/);
});

test('daftar 8 barang: semuanya dipastikan LLM, tidak berhenti di barang ke-6', async () => {
  const priceLookup = require('../src/price-lookup.js');
  const items = [{ id: 1, name: 'SEAL TAPE HACHI', category: 'B/PLUMBING', unit: 'pcs', price: 3000 }];
  const asked = [];
  const resolve = async (query) => {
    asked.push(query);
    return query === 'siltip' ? { matches: items, barang: 'seal tape' } : { matches: [], undecided: true };
  };
  const daftar = ['sdl 3/4', 'sdd 3/4', 'dop 4"', 'keni 3/4', 'lem paralon', 'tali tambang', 'siltip', 'kuas'];
  const out = await priceLookup.lookupAsync(items, { daftar }, { resolve });
  assert.equal(asked.length, 8);
  assert.equal(out.per_barang.find((p) => p.dicari === 'siltip').status, 'ok');
});
