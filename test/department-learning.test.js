'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dl = require('../src/department-learning');

const ROW = {
  chatId: '628111@c.us', customerText: 'kak gratis ongkir gak?', question: 'Apakah ada gratis ongkir untuk order besar?',
  answer: 'Gratis ongkir untuk order di atas Rp 500.000 area Jabodetabek.', department: 'Management',
};
const GENERAL = {
  scope: 'general', reusable: true, question: 'Apakah ada gratis ongkir untuk order besar?',
  answer: 'Gratis ongkir untuk order di atas Rp 500.000 area Jabodetabek.', category: 'pricing', reason: 'aturan promo',
};

test('isLearnableQuestion: kolom kind opsional, awalan Lalamove, pihak ketiga, jawaban pendek', () => {
  assert.equal(dl.isLearnableQuestion(ROW).ok, true);
  assert.equal(dl.isLearnableQuestion({ ...ROW, kind: null }).ok, true, 'kind NULL = umum');
  assert.equal(dl.isLearnableQuestion({ ...ROW, kind: 'general' }).ok, true);
  assert.deepEqual(dl.isLearnableQuestion({ ...ROW, kind: 'lalamove_vehicle' }), { ok: false, reason: 'jenis lalamove_vehicle' });
  assert.equal(dl.isLearnableQuestion({ ...ROW, question: 'Kendaraan Lalamove apa untuk 40 sak semen?' }).ok, false, 'tanpa kolom kind, awalan teks dipakai');
  assert.equal(dl.isLearnableQuestion({ ...ROW, thirdPartyId: 'x' }).ok, false);
  assert.equal(dl.isLearnableQuestion({ ...ROW, answer: 'ok kak' }).ok, false);
  assert.equal(dl.isLearnableQuestion({ ...ROW, answer: 'Sudah kak.' }).ok, false);
  assert.equal(dl.isLearnableQuestion({ ...ROW, answer: 'ya' }).ok, false);
  assert.equal(dl.isLearnableQuestion(null).ok, false);
});

test('parseAssessment: JSON rapi, berpagar kode, rusak, dan scope tak dikenal dianggap transaksi', () => {
  assert.equal(dl.parseAssessment(JSON.stringify(GENERAL)).scope, 'general');
  assert.equal(dl.parseAssessment('```json\n' + JSON.stringify(GENERAL) + '\n```').reusable, true);
  assert.equal(dl.parseAssessment('bukan json'), null);
  assert.equal(dl.parseAssessment('{"scope":"mungkin","reusable":true}').scope, 'transaction');
  assert.equal(dl.parseAssessment('{"scope":"general","reusable":"true"}').reusable, false, 'harus boolean sungguhan');
  assert.equal(dl.parseAssessment('{"scope":"general","reusable":true,"category":"ngawur"}').category, 'faq');
});

test('decideCandidate: aturan umum lolos', () => {
  const out = dl.decideCandidate({ assessment: GENERAL, row: ROW });
  assert.equal(out.ok, true);
  assert.equal(out.category, 'pricing');
  assert.ok(out.fingerprint);
  assert.equal(out.customerMessage, 'kak gratis ongkir gak?');
});

test('decideCandidate: urusan satu transaksi, penilai gagal, atau ragu ditolak', () => {
  assert.equal(dl.decideCandidate({ assessment: null, row: ROW }).ok, false);
  assert.equal(dl.decideCandidate({ assessment: { ...GENERAL, scope: 'transaction' }, row: ROW }).ok, false);
  assert.equal(dl.decideCandidate({ assessment: { ...GENERAL, reusable: false }, row: ROW }).ok, false);
});

test('decideCandidate: saringan data pribadi dan klaim hasil tetap berlaku di kode', () => {
  const pribadi = dl.decideCandidate({
    assessment: { ...GENERAL, answer: 'Transfer ke rekening 1234567890123 atas nama toko, ongkir Rp 15.000.' }, row: ROW,
  });
  assert.deepEqual(pribadi, { ok: false, reason: 'data pribadi' });
  const telepon = dl.decideCandidate({ assessment: { ...GENERAL, answer: 'Hubungi 081234567890 untuk diskon Rp 5.000.' }, row: ROW });
  assert.equal(telepon.ok, false);
  const klaim = dl.decideCandidate({ assessment: { ...GENERAL, answer: 'Dijamin 100% gratis ongkir, pasti sampai besok.' }, row: ROW });
  assert.equal(klaim.ok, false);
  const placeholder = dl.decideCandidate({ assessment: { ...GENERAL, answer: 'Gratis ongkir di atas {nominal} rupiah.' }, row: ROW });
  assert.equal(placeholder.reason, 'placeholder');
});

test('decideCandidate: cek transfer lolos hanya bila rumusannya aturan umum', () => {
  const financeRow = {
    chatId: 'c', customerText: 'sudah transfer kak, tolong dicek', question: 'Apakah transfer customer ini sudah masuk?',
    answer: 'Sudah masuk jam 10.15 Rp 1.250.000', department: 'Finance',
  };
  // Model keliru menilai "general" untuk fakta per transaksi: kode menahannya.
  const bocor = dl.decideCandidate({
    assessment: { ...GENERAL, question: 'Apakah transfer customer sudah masuk?', answer: 'Transfer sudah masuk dengan nominal Rp 1.250.000.' }, row: financeRow,
  });
  assert.deepEqual(bocor, { ok: false, reason: 'cek transfer per transaksi' });
  // Aturan umum tentang jam pengecekan lolos.
  const aturan = dl.decideCandidate({
    assessment: { ...GENERAL, question: 'Kapan transfer dicek oleh Finance?', answer: 'Transfer di atas jam 21.00 dicek keesokan harinya, jam kerja.' },
    row: { ...financeRow, answer: 'Kalau transfer lewat jam 9 malam kami cek besok pagi ya.' },
  });
  assert.equal(aturan.ok, true, aturan.reason);
});

test('findSimilarPending menggabung pertanyaan kembar, membiarkan yang beda', () => {
  const pending = [{ question: 'Apakah ada gratis ongkir untuk order besar?' }, { question: 'Berapa jam kerja toko hari Minggu?' }];
  assert.ok(dl.findSimilarPending('Gratis ongkir untuk order besar ada tidak?', pending));
  assert.equal(dl.findSimilarPending('Bagaimana syarat retur keramik?', pending), null);
  assert.equal(dl.findSimilarPending('apa saja', []), null);
});

test('caseExcerpt membersihkan nomor dan email dari kasus', () => {
  const text = dl.caseExcerpt({
    customerText: 'wa saya 081234567890', askedQuestion: 'q ke a@b.com', department: 'Finance', answer: 'jawab', answeredByName: 'Rina',
  });
  assert.doesNotMatch(text, /081234567890|a@b\.com/);
  assert.match(text, /Rina: jawab/);
  assert.match(text, /\[nomor\]/);
});

test('prompt penilai memuat ketiga bagian kasus dan menyebut aturan transfer', () => {
  const prompt = dl.assessUserPrompt({ customerText: 'halo', askedQuestion: 'q?', department: 'Finance', answer: 'a' });
  assert.match(prompt, /PESAN CUSTOMER: halo/);
  assert.match(prompt, /PERTANYAAN AI KE FINANCE: q\?/);
  assert.match(prompt, /JAWABAN STAF: a/);
  assert.match(dl.ASSESS_SYSTEM_PROMPT, /transfer/i);
});
