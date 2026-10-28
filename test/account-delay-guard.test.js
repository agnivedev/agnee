'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const account = require('../src/account-guard.js');
const { enforceReplyContract, delayWarnings, conversationRules } = require('../src/reply-style.js');

const SOURCE = [
  'Transfer ke BCA 1234567890 a.n. PT ESBEJE',
  'Hubungi 0812-3456-7890 untuk komplain',
  '{"invoice":"INV2610280001","grand_total":"Rp 1.250.000.000"}',
  'customer: nomor saya 081299998888',
].join('\n');

test('nomor yang ada di sumber sah, termasuk format dan awalan berbeda', () => {
  const bad = (reply) => account.findInventedAccounts(reply, SOURCE).map((v) => v.number);
  assert.deepEqual(bad('Transfer ke BCA 1234567890 ya kak.'), []);
  assert.deepEqual(bad('BCA 123-456-7890 a.n. PT ESBEJE'), []);
  assert.deepEqual(bad('Telepon +62 812 3456 7890'), []);
  assert.deepEqual(bad('Nomor kakak 081299998888 sudah kami catat.'), []);
});

test('nomor panjang tanpa sumber dianggap karangan; uang dan tanggal tidak', () => {
  const bad = (reply) => account.findInventedAccounts(reply, SOURCE).map((v) => v.number);
  assert.deepEqual(bad('Transfer ke BCA 9876543210 ya kak.'), ['9876543210']);
  assert.deepEqual(bad('Mandiri 1230 0099 8877 ya.'), ['123000998877']);
  assert.deepEqual(bad('Total Rp 1.250.000.000 dan Rp 2500000000, tanggal 2026-10-28, 40 sak.'), []);
});

test('stripInventedAccounts membuang hanya kalimat bernomor karangan', () => {
  const reply = 'Pesanan kakak sudah masuk. Transfer ke BCA 9876543210. Setelah itu kirim bukti ya kak.';
  assert.equal(account.stripInventedAccounts(reply, SOURCE), 'Pesanan kakak sudah masuk.\nSetelah itu kirim bukti ya kak.');
});

test('enforceReplyContract menulis ulang lalu membuang rekening karangan', async () => {
  const llm = { enabled: true, generateReply: async () => ({ text: 'Silakan transfer ke BCA 9876543210 a.n. PT ESBEJE ya kak, lalu kirim buktinya.' }) };
  const out = await enforceReplyContract(llm, {
    text: 'Silakan transfer ke BCA 9876543210 a.n. PT ESBEJE ya kak. Setelah itu kirim bukti transfernya ke sini ya kak.',
    systemPrompt: 'x', userMessage: 'rekeningnya?', priceSource: SOURCE,
  });
  assert.equal(out.stripped, true);
  assert.doesNotMatch(out.text, /9876543210/);
  assert.match(out.text, /kirim bukti/);
});

test('rekening yang benar lolos tanpa diubah', async () => {
  const text = 'Silakan transfer ke BCA 1234567890 a.n. PT ESBEJE ya kak.';
  const out = await enforceReplyContract({ enabled: false }, { text, systemPrompt: 'x', userMessage: 'rekening?', priceSource: SOURCE });
  assert.equal(out.text, text);
  assert.equal(out.rewritten, false);
});

test('kalimat menunda diperingatkan hanya bila noEmptyDelay', () => {
  const kalimat = 'Harganya saya pastikan dulu ya kak. Butuh berapa sak?';
  assert.equal(delayWarnings(kalimat, { noEmptyDelay: true }).length, 1);
  assert.equal(delayWarnings('Mohon ditunggu ya kak.', { noEmptyDelay: true }).length, 1);
  assert.equal(delayWarnings('Nanti saya infokan lagi ya kak.', { noEmptyDelay: true }).length, 1);
  assert.deepEqual(delayWarnings(kalimat, {}), [], 'tanpa alat departemen menunda adalah jawaban jujur');
  assert.deepEqual(delayWarnings('MU 480 Rp 313.000 per sak. Butuh berapa sak kak?', { noEmptyDelay: true }), []);
});

test('enforceReplyContract menulis ulang kalimat menunda, tidak membuangnya', async () => {
  let dipanggil = 0;
  const llm = { enabled: true, generateReply: async () => { dipanggil += 1; return { text: 'MU 480 Rp 313.000 per sak. Butuh berapa sak kak?' }; } };
  const out = await enforceReplyContract(llm, {
    text: 'Saya pastikan dulu harganya ya kak.', systemPrompt: 'x', userMessage: 'harga MU 480?',
    expectations: { noEmptyDelay: true },
  });
  assert.equal(dipanggil, 1);
  assert.equal(out.rewritten, true);
  assert.equal(out.stripped, false);
  assert.match(out.text, /313\.000/);
});

test('aturan bawaan: butir 5 tak lagi menyuruh diam, butir 11 memuat persetujuan, 18-19 ada', () => {
  const rules = conversationRules();
  assert.doesNotMatch(rules, /Diam lebih baik/);
  assert.match(rules, /ask_department/);
  assert.match(rules, /PERSETUJUAN/);
  assert.match(rules, /\n18\. Jawab dulu/);
  assert.match(rules, /\n19\. Nomor rekening/);
});
