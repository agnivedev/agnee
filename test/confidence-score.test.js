'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { score } = require('../src/confidence-score.js');
const guard = require('../src/uncertainty-guard.js');

const codes = (r) => r.signals.map((s) => s.code);

test('balasan bersih dengan satu kalimat tunggu sah tidak diberi alarm', () => {
  const r = score({
    customerText: 'Kalau yang pasir, semen dan kerikil eceran ada minimal order?',
    replyText: 'Baik kak, saya pastikan dulu ya supaya informasinya akurat. Mohon ditunggu sebentar, begitu sudah jelas langsung saya kabari kakak 🙏',
  });
  assert.equal(r.score, 100);
  assert.equal(r.band, 'send');
});

test('dua paragraf tunggu = tunggu ganda', () => {
  const r = score({
    customerText: '10 batang ada',
    replyText: 'Baik kak, saya pastikan dulu ketersediaannya ya.\n\nBaik kak, saya pastikan dulu ya supaya informasinya akurat.',
  });
  assert.ok(codes(r).includes('double_holding'));
  assert.equal(r.band, 'safe');
});

test('catatan internal ke customer = skor 0, ditahan', () => {
  const r = score({
    customerText: 'Harga tersebut 1 dus berapa meter?',
    replyText: 'Harga itu tidak ada di daftar POS. Sebelum jawabannya masuk, jangan kirim angka itu ke customer sebagai harga final.',
  });
  assert.equal(r.score, 0);
  assert.equal(r.band, 'hold');
  assert.ok(codes(r).includes('leak_internal'));
});

test('menyebut tim Management ke customer melanggar aturan', () => {
  const r = score({ replyText: 'Untuk free ongkir, kami perlu konfirmasi dulu dengan tim Management ya kak.' });
  assert.ok(codes(r).includes('mentions_team'));
  assert.equal(r.band, 'hold');
});

test('"ke tim terkait" teks bawaan penjaga ditandai lunak', () => {
  const r = score({ replyText: 'Segera kami get back ke kakak ya, ini sedang kami pastikan dulu ke tim terkait.' });
  assert.ok(codes(r).includes('mentions_team_soft'));
  assert.equal(r.score, 55);
});

test('janji diskon tanpa menunggu Management', () => {
  const r = score({ replyText: 'Bisa kak. Untuk pembelian dalam jumlah banyak, penawaran harga khusus bisa disiapkan tim kami.' });
  assert.ok(codes(r).includes('discount_promise'));
  assert.equal(r.band, 'hold');
});

test('penutup terbuka dan kata terlarang playbook', () => {
  assert.ok(codes(score({ replyText: 'Baik kak. Ada kebutuhan lain yang bisa saya bantu?' })).includes('open_closer'));
  assert.ok(codes(score({ replyText: 'Untuk keramik itu stoknya sedang kosong kak.' })).includes('negative_word'));
});

test('perkenalan diulang di chat yang sama', () => {
  const r = score({
    replyText: 'Halo kak, saya Agnes dari ESBEJE. Ada yang bisa dibantu?',
    history: [{ role: 'assistant', content: 'Halo kak, saya Agnes dari ESBEJE.' }, { role: 'user', content: 'Hallo' }],
  });
  assert.ok(codes(r).includes('re_intro'));
});

test('alasan penjaga produksi ikut dihitung; klaim stok tanpa sumber = 20', () => {
  const finalText = 'Ada kak. Kami ready Semen Jakarta 40KG seharga Rp 57.500 per zak.';
  const assessment = guard.assess({ customerText: 'Ada zak semen mba', rawText: finalText, finalText });
  const r = score({ customerText: 'Ada zak semen mba', replyText: finalText, assessment });
  assert.ok(codes(r).includes('assess_stock_claim'));
  assert.equal(r.score, 20);
});

test('topik uang butuh 90 untuk dikirim langsung', () => {
  const r = score({
    replyText: 'Harga Rp 55.000 per btg kak.\n\nHarga biru per btg dan merah per pcs Rp 51.000.',
    assessment: { reasons: [], topic: 'harga' },
  });
  assert.equal(r.score, 75);
  assert.equal(r.band, 'safe');
});

test('cakupan dari pemeriksa luar: sebagian 60, tidak 30', () => {
  assert.equal(score({ replyText: 'Siap kak.', coverage: 'sebagian' }).score, 60);
  assert.equal(score({ replyText: 'Siap kak.', coverage: 'tidak' }).score, 30);
});

test('balasan beruntun kurang dari 6 detik ditandai', () => {
  assert.ok(codes(score({ replyText: 'Ada kak.', prevAiAgeSec: 2 })).includes('burst_race'));
});
