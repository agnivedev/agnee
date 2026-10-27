'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const accounts = require('../src/payment-accounts');
const proof = require('../src/payment-proof');

const BCA = { bankName: 'BCA', accountNumber: '172 172 6989', accountHolder: 'PT Karya Warna Kemenangan', status: 'active' };
const OLD = { bankName: 'Mandiri', accountNumber: '1230009876543', accountHolder: 'PT Karya Warna Kemenangan', status: 'retired' };
const NOW = new Date('2026-10-27T10:00:00+07:00');
const reading = (over = {}) => ({
  isTransferProof: true, status: 'success', amount: 1_500_000, date: '2026-10-27', time: '09:30',
  recipientName: 'PT KARYA WARNA KEMENANGAN', recipientBank: 'BCA', recipientAccount: '1721726989',
  senderName: 'BUDI', referenceNo: 'R1', looksEdited: false, notes: '', ...over,
});

test('rekening: normalisasi menolak nomor bukan angka dan bank kosong', () => {
  assert.match(accounts.normalizeAccount({ bankName: '', accountNumber: '12345' }).error, /bank/i);
  assert.match(accounts.normalizeAccount({ bankName: 'BCA', accountNumber: 'abcde' }).error, /angka/i);
  const ok = accounts.normalizeAccount({ bankName: ' BCA ', accountNumber: '172 172 6989', accountHolder: 'PT X' });
  assert.equal(ok.account.status, 'active');
  assert.equal(ok.account.bankName, 'BCA');
});

test('rekening: kolom bank lama jadi cadangan hanya bila belum ada baris', () => {
  const legacy = { bankName: 'BCA', bankAccount: '111222333', bankHolder: 'Toko' };
  assert.equal(accounts.effectiveAccounts([], legacy)[0].accountNumber, '111222333');
  assert.equal(accounts.effectiveAccounts([BCA], legacy).length, 1);
  assert.deepEqual(accounts.effectiveAccounts([], {}), []);
});

test('rekening: bagian prompt mewajibkan rekening saat closing dan menyembunyikan rekening lama', () => {
  const text = accounts.section([BCA, OLD], { proofCheck: true });
  assert.match(text, /Bank: BCA\nNo\. Rekening: 172 172 6989\nAtas nama: PT Karya Warna Kemenangan/);
  assert.match(text, /WAJIB sebutkan rekening/);
  assert.match(text, /berakhiran 6543/);
  assert.doesNotMatch(text, /1230009876543/);
  assert.match(text, /Jangan pernah menyatakan pembayaran SUDAH DITERIMA/);
  assert.equal(accounts.section([OLD]), '');
});

test('rekening: pencocokan nomor penuh, tersamar, dan rekening lama', () => {
  assert.equal(accounts.matchAccount('172-172-6989', [BCA, OLD]).exact, true);
  const masked = accounts.matchAccount('****6989', [BCA, OLD]);
  assert.equal(masked.account.bankName, 'BCA');
  assert.equal(masked.exact, false);
  assert.equal(accounts.matchAccount('1230009876543', [BCA, OLD]).retired, true);
  assert.equal(accounts.matchAccount('999999999', [BCA, OLD]).account, null);
});

test('bukti: parse tahan fence kode dan sampah', () => {
  assert.equal(proof.parseReading('bukan json'), null);
  const r = proof.parseReading('```json\n{"isTransferProof":true,"amount":"1500000","date":"2026-10-27","status":"success"}\n```');
  assert.equal(r.amount, 1500000);
  assert.equal(r.isTransferProof, true);
  assert.equal(proof.parseReading('{"isTransferProof":"yes"}').isTransferProof, false);
});

test('bukti: transfer lengkap ke rekening benar dan nominal pas = cocok', () => {
  const r = proof.evaluate(reading(), { accounts: [BCA, OLD], expectedAmount: 1_500_000, now: NOW });
  assert.equal(r.verdict, 'cocok');
  assert.deepEqual(r.flags, []);
});

test('bukti: rekening lama, rekening asing, nominal kurang = tidak cocok', () => {
  const ctx = { accounts: [BCA, OLD], expectedAmount: 1_500_000, now: NOW };
  assert.deepEqual(proof.evaluate(reading({ recipientAccount: '1230009876543' }), ctx).flags, ['rekening_lama']);
  assert.equal(proof.evaluate(reading({ recipientAccount: '555566667777' }), ctx).verdict, 'tidak_cocok');
  const kurang = proof.evaluate(reading({ amount: 1_000_000 }), ctx);
  assert.equal(kurang.verdict, 'tidak_cocok');
  assert.ok(kurang.flags.includes('nominal_kurang'));
});

test('bukti: total tak diketahui, tanggal lama, diedit, pending = perlu dicek', () => {
  const ctx = { accounts: [BCA], expectedAmount: null, now: NOW };
  assert.deepEqual(proof.evaluate(reading(), ctx).flags, ['total_tak_diketahui']);
  assert.equal(proof.evaluate(reading(), ctx).verdict, 'perlu_dicek');
  const old = proof.evaluate(reading({ date: '2026-10-01' }), { ...ctx, expectedAmount: 1_500_000 });
  assert.deepEqual(old.flags, ['tanggal_lama']);
  assert.ok(proof.evaluate(reading({ looksEdited: true }), { ...ctx, expectedAmount: 1_500_000 }).flags.includes('tampak_diedit'));
  assert.ok(proof.evaluate(reading({ status: 'pending' }), { ...ctx, expectedAmount: 1_500_000 }).flags.includes('transaksi_pending'));
});

test('bukti: foto yang sama dipakai ulang = tidak cocok; bukan bukti = bukan_bukti', () => {
  const dup = proof.evaluate(reading(), { accounts: [BCA], expectedAmount: 1_500_000, now: NOW, duplicateOf: { id: '1' } });
  assert.equal(dup.verdict, 'tidak_cocok');
  assert.equal(proof.evaluate(reading({ isTransferProof: false }), { accounts: [BCA] }).verdict, 'bukan_bukti');
  assert.equal(proof.evaluate(null, { accounts: [BCA] }).verdict, 'bukan_bukti');
});

test('bukti: nominal lebih dan rekening tersamar saja tetap cocok', () => {
  const r = proof.evaluate(reading({ amount: 1_600_000, recipientAccount: '***6989' }), { accounts: [BCA], expectedAmount: 1_500_000, now: NOW });
  assert.equal(r.verdict, 'cocok');
});

test('bukti: total diharapkan diambil dari pesan toko terbaru, bukan pesan customer', () => {
  const msgs = [
    { fromMe: false, body: 'total saya Rp 9.000.000 ya' },
    { fromMe: true, body: 'Total belanja Kakak Rp 1.250.000 (sudah termasuk ongkir)' },
    { fromMe: false, body: 'oke' },
  ];
  assert.equal(proof.guessExpectedAmount(msgs), 1_250_000);
  assert.equal(proof.guessExpectedAmount([{ fromMe: true, body: 'halo' }]), null);
});

test('bukti: ringkasan untuk AI memuat peringatan tetapi bukan kata lunas', () => {
  const result = proof.evaluate(reading({ recipientAccount: '1230009876543' }), { accounts: [BCA, OLD], expectedAmount: 1_500_000, now: NOW });
  const marker = proof.aiMarker({ ...result, extracted: reading(), expectedAmount: 1_500_000 });
  assert.match(marker, /TIDAK COCOK/);
  assert.match(marker, /REKENING LAMA/);
  assert.doesNotMatch(marker, /lunas|diterima/i);
});
