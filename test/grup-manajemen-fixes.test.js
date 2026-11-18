'use strict';

/**
 * Audit grup Manajemen Bestseller / Finance ESBEJE, 16-18 Nov:
 *  - "Pesannya sudah masuk" dibaca klaim pembayaran, Finance ditanya soal transfer yang tak ada;
 *  - jawaban Finance untuk invoice lain ("900.000 yg bener") dicocokkan longgar ke pertanyaan itu;
 *  - harga barang "keranjang" (KERAMIK SALE ALL SIZE) ditawarkan untuk motif/ukuran tertentu;
 *  - pertanyaan ke Management dari pesan satu kata ("Kw1") tanpa barang.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/uncertainty-guard');
const match = require('../src/group-answer-match');
const priceMatch = require('../src/price-match-llm');

const assess = (customerText, finalText) => guard.assess({
  customerText, rawText: finalText, finalText, priceSource: '', factSource: '', toolText: '', toolOutputs: [], quantityText: customerText, departmentAsked: false,
});
const codes = (a) => a.reasons.map((r) => r.code);

test('"pesannya sudah masuk" bukan klaim pembayaran, "dana sudah masuk" tetap', () => {
  assert.deepEqual(codes(assess('Tes', 'Halo kak, saya Agnes dari ESBEJE. Pesannya sudah masuk. Lagi cari barang bangunan apa kak?')), []);
  assert.deepEqual(codes(assess('Foto', 'Fotonya sudah masuk ya kak.')), []);
  assert.ok(codes(assess('sudah transfer', 'Pembayaran kakak sudah masuk.')).includes('payment_claim'));
  assert.ok(codes(assess('sudah transfer', 'Dananya sudah masuk ya kak.')).includes('payment_claim'));
  assert.ok(codes(assess('sudah transfer', 'Tenang, sudah masuk transfernya kak.')).includes('payment_claim'));
});

test('jawaban longgar tak dicocokkan ke pertanyaan transfer bila memuat nominal/invoice', async () => {
  const tes = { id: 'a1', question: 'Customer menyebut sudah membayar ("Tes"). Mohon cek apakah dananya sudah masuk dan jumlahnya sesuai.', customerText: 'Tes' };
  const harga = { id: 'b2', question: 'Berapa harga keramik Milan 25x40?', customerText: '' };
  assert.deepEqual(match.eligibleCandidates([tes, harga], '900.000 yg bener').map((q) => q.id), ['b2']);
  assert.deepEqual(match.eligibleCandidates([tes, harga], 'Tetep aja trf nya 900dit').map((q) => q.id), ['b2']);
  assert.deepEqual(match.eligibleCandidates([tes, harga], 'INV/SBJ01-01950 lebih kecil').map((q) => q.id), ['b2']);
  // Konfirmasi polos tetap boleh.
  assert.deepEqual(match.eligibleCandidates([tes, harga], 'Ada').map((q) => q.id), ['a1', 'b2']);

  let asked = false;
  const pick = await match.matchLooseAnswer({
    candidates: [tes], text: '900.000 yg bener', ask: async () => { asked = true; return '{"nomor":1,"yakin":"tinggi"}'; },
  });
  assert.equal(pick, null);
  assert.equal(asked, false, 'LLM tak dipanggil bila tak ada kandidat layak');
});

test('barang keranjang POS tidak ditawarkan untuk motif/ukuran tertentu', async () => {
  const items = [
    { id: 1, name: 'KERAMIK SALE ALL SIZE', category: 'A/KERAMIK', unit: 'dus' },
    { id: 2, name: 'GRANIT ECER LEMBARAN', category: 'A/KERAMIK', unit: 'lbr' },
    { id: 3, name: 'VALENTINO NEW NORWAY PINE WOOD 15X60 KW1', category: 'A/KERAMIK', unit: 'dus' },
  ];
  assert.equal(priceMatch.isBucketItem(items[0]), true);
  assert.equal(priceMatch.isBucketItem(items[1]), true);
  assert.equal(priceMatch.isBucketItem(items[2]), false);
  assert.equal(priceMatch.asksForBucket('keramik motif kayu Milan 25x40'), false);
  assert.equal(priceMatch.asksForBucket('ada keramik sale ga?'), true);

  let listed = '';
  const matcher = priceMatch.createMatcher({
    ask: async (prompt, system) => {
      if (/kategori yang paling mungkin/i.test(system)) return '{"barang":"granit motif kayu","kategori":["A/KERAMIK"],"kata_kunci":["keramik","granit","kayu","sale","lembaran"]}';
      listed = prompt;
      return '{"pilih":[1,2,3]}';
    },
  });
  const out = await matcher.resolve({ scope: 'x', items, query: 'granit motif kayu Milan 25x40' });
  assert.doesNotMatch(listed, /SALE ALL SIZE|ECER LEMBARAN/);
  assert.ok(out.matches.every((m) => m.id === 3 || m.id === undefined));
});

test('pertanyaan ke departemen dari pesan pendek memuat konteks percakapan', () => {
  const history = [
    { role: 'user', content: '[Customer mengirim foto keramik PLATINUM Kennedy Grey 30x60 Matt]' },
    { role: 'assistant', content: 'Harga 130.000/dus ya kak. Kw1 atau Kw2?' },
    { role: 'user', content: 'Kw1' },
  ];
  const q = guard.departmentQuestion({ topic: 'harga', customerText: 'Kw1', assessment: { reasons: [] }, history });
  assert.match(q, /Kennedy Grey/);
  assert.match(q, /Kw1/);
  // Pesan panjang tidak perlu konteks.
  const long = guard.departmentQuestion({ topic: 'harga', customerText: 'Harga keramik Kennedy Grey 30x60 berapa per dus', assessment: { reasons: [] }, history });
  assert.doesNotMatch(long, /Konteks percakapan/);
});

test('jawaban departemen untuk barang yang sama dipakai, bukan janji baru', () => {
  const assessment = { reasons: [{ code: 'tool_no_result', sentence: 'Maaf kak, tidak ketemu.' }], topic: 'harga' };
  const text = guard.compose({
    finalText: 'Maaf kak, tidak ketemu.', customerText: 'Kw1', assessment,
    plan: { action: 'answered_before', previous: 'Harga 130.000/dus Stok berjalan 100 dus' },
  });
  assert.match(text, /130\.000\/dus/);
  assert.doesNotMatch(text, /get back/);
});
