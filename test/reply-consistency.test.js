'use strict';

/**
 * Konsistensi balasan terhadap riwayat sendiri, dan kebocoran bahasa internal
 * ("salah peran"). Kalimat-kalimatnya diambil dari chat ESBEJE 6 dan 9 Nov
 * (nomor dan nama customer tidak dipakai).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixDeniedOwnPrice, fixVerbatimRepeat } = require('../src/reply-consistency');
const { enforceReplyContract, findClaimViolations } = require('../src/reply-style');

const DAFTAR_3MM = 'Untuk triplek 3mm, kami ada:\n*TRIPLEK 3MM 3X7 UK.PINTU* Rp75.600 per lbr\n*TRIPLEK 3MM 4X8 MC/UT* Rp62.000 per lbr\n\nKakak butuh berapa lembar?';
const RIWAYAT = [
  { role: 'user', content: 'Yg 3mm' },
  { role: 'assistant', content: DAFTAR_3MM },
  { role: 'user', content: 'Yg ini kak' },
  { role: 'assistant', content: 'Baik, Kak. Teakwood 3mm ukuran 4x8 (122x244 cm) harganya Rp 113.300 per lembar.' },
];

test('menyangkal harga yang AI sebut sendiri diganti penjelasan dari riwayat', () => {
  const bad = 'Kak, harga triplek Teakwood 3mm ukuran 4x8 (122x244 cm) adalah Rp 113.300 per lembar. Tidak ada yang Rp 62.000.\nMungkin Kakak melihat harga untuk produk yang lain?';
  const fixed = fixDeniedOwnPrice(bad, { userMessage: 'Ini 62rb yg mana kak', history: RIWAYAT });
  assert.equal(fixed.changed, true);
  assert.match(fixed.text, /^Rp62\.000 per lbr itu harga TRIPLEK 3MM 4X8 MC\/UT, Kak\./);
  assert.doesNotMatch(fixed.text, /Tidak ada yang/i);
  assert.doesNotMatch(fixed.text, /Mungkin Kakak melihat/);
});

test('menyangkal angka yang TIDAK pernah disebut tetap utuh', () => {
  const text = 'Tidak ada yang Rp 99.000 di daftar kami, Kak.';
  assert.deepEqual(fixDeniedOwnPrice(text, { history: RIWAYAT }), { text, changed: false });
  assert.deepEqual(fixDeniedOwnPrice('Harganya Rp62.000 per lbr, Kak.', { history: RIWAYAT }).changed, false);
});

test('balasan yang identik dengan balasan AI sebelumnya dipangkas ke pertanyaannya', () => {
  const sebelumnya = 'Baik, Kak. Jadi butuh 1 lembar triplek 3mm 4x8 MC/UT seharga Rp 62.000.\n\nBisa dibantu info lokasi kirimnya, Kak? Boleh share location atau nama kecamatan dan kotanya.';
  const history = [{ role: 'user', content: '1 lembar' }, { role: 'assistant', content: sebelumnya }, { role: 'user', content: 'Ok baik' }];
  const repeat = fixVerbatimRepeat(sebelumnya, { history });
  assert.equal(repeat.changed, true);
  assert.match(repeat.text, /^Baik, Kak\. Supaya bisa saya lanjutkan: Bisa dibantu info lokasi kirimnya, Kak\?$/);
  assert.equal(fixVerbatimRepeat('Siap kak, saya catat ya.', { history }).changed, false);
  // Tanpa pertanyaan: dibiarkan (diam lebih buruk daripada mengulang).
  const noQuestion = 'Baik kak, pesanan sudah kami catat dan akan segera diproses ya.';
  assert.equal(fixVerbatimRepeat(noQuestion, { history: [{ role: 'assistant', content: noQuestion }] }).changed, false);
});

test('enforceReplyContract menjalankan kedua perbaikan itu tanpa memanggil model', async () => {
  const llm = { enabled: false };
  const out = await enforceReplyContract(llm, {
    text: 'Harga Teakwood Rp 113.300 per lembar. Tidak ada yang Rp 62.000.',
    systemPrompt: '', userMessage: 'Ini 62rb yg mana kak', history: RIWAYAT,
  });
  assert.match(out.text, /^Rp62\.000 per lbr itu harga TRIPLEK 3MM 4X8 MC\/UT/);
});

const SALAH_PERAN = [
  'Oke, saya lewati alur otomatisnya.',
  'Kalau mau saya kirim ke customer, ini draft singkatnya:',
  'Saya belum mengirimnya.',
  'Pesanan triplek 3mm 4x8 MC/UT 1 lembar (Rp 62.000) dan alamat yang sudah diberikan customer tidak saya proses lebih lanjut di sini.',
];

test('bahasa salah peran (menganggap customer sebagai operator) terdeteksi per kalimat', () => {
  for (const sentence of SALAH_PERAN) {
    assert.ok(findClaimViolations(sentence).length > 0, `harus terdeteksi: ${sentence}`);
  }
  // Kalimat bisnis biasa lolos.
  for (const ok of ['Siap kak, pesanan 1 lembar kami catat ya.', 'Untuk proforma dan pengirimannya, tim kami yang akan melanjutkan langsung dengan kakak.', 'Draft desain bisa kami kirim besok, kak.']) {
    assert.equal(findClaimViolations(ok).length, 0, `harus lolos: ${ok}`);
  }
});

test('balasan salah peran utuh dari chat 9 Nov hanya menyisakan kalimat untuk customer', async () => {
  const mentah = [...SALAH_PERAN, 'Untuk proforma dan pengirimannya, tim kami yang akan melanjutkan langsung dengan kakak.'].join('\n');
  const out = await enforceReplyContract({ enabled: false }, { text: mentah, systemPrompt: '', userMessage: 'Ok skip ya', history: [] });
  assert.ok(out, 'masih ada isi yang bisa dikirim');
  assert.doesNotMatch(out.text, /draft|alur otomatis|ke customer|belum mengirim/i);
  assert.match(out.text, /tim kami yang akan melanjutkan/);
});
