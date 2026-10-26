'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const kp = require('../src/knowledge-proposals.js');

test('validateCandidate: info konkret lolos, basa-basi dan data pribadi ditolak', () => {
  const ok = kp.validateCandidate({ q: 'Apakah bisa COD ke Bekasi?', a: 'Bisa COD untuk Jabodetabek, ongkir Rp 15.000.', c: 'kak bisa cod ke bekasi?' });
  assert.equal(ok.ok, true);
  assert.equal(ok.category, 'faq');
  assert.equal(ok.customerMessage, 'kak bisa cod ke bekasi?');

  assert.equal(kp.validateCandidate({ q: 'Terima kasih ya kak', a: 'Sama-sama kak, senang bisa membantu' }).reason, 'bukan informasi');
  assert.equal(kp.validateCandidate({ q: 'Terima kasih ya kak', a: 'Sama-sama kak, senang bisa membantu' }, { manual: true }).ok, true, 'manual melewati cek informasi');
  assert.equal(kp.validateCandidate({ q: 'Nomor admin berapa?', a: 'Hubungi 081234567890 untuk pesan' }, { manual: true }).reason, 'data pribadi', 'manual tetap menolak data pribadi');
  assert.equal(kp.validateCandidate({ q: 'Nomor admin berapa?', a: 'Hubungi 081234567890 untuk pesan' }).reason, 'data pribadi');
  assert.equal(kp.validateCandidate({ q: 'Rekening transfer?', a: 'Transfer ke BCA 1234567890 atas nama toko' }).reason, 'data pribadi');
  assert.equal(kp.validateCandidate({ q: 'Kirim email ke mana?', a: 'Kirim ke halo@toko.id untuk pesanan besar' }).reason, 'data pribadi');
  assert.equal(kp.validateCandidate({ q: 'x', a: 'Harga Rp 10.000' }).reason, 'panjang pertanyaan');
  assert.equal(kp.validateCandidate({ q: 'Berapa harganya sekarang?', a: 'Halo {nama}, harganya Rp 10.000' }).reason, 'placeholder');
});

test('validateCandidate: jawaban CS yang menjanjikan hasil tidak dijadikan usulan', () => {
  const result = kp.validateCandidate({ q: 'Apakah aman untuk modal saya?', a: 'Tenang kak, pasti untung dan tanpa risiko sama sekali' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /^klaim/);
});

test('harga berpemisah titik bukan nomor panjang', () => {
  assert.equal(kp.containsPersonalData('Harga Rp 15.000.000 per bulan'), false);
  assert.equal(kp.containsPersonalData('hubungi +62 812-3456-7890'), true);
  assert.equal(kp.scrubPersonalData('wa 081234567890 / a@b.co / 1234567890123'), 'wa [nomor] / [email] / [angka]');
});

test('fingerprint tidak terpengaruh urutan dan kata sambung', () => {
  assert.equal(kp.fingerprintOf('Bisa COD ke Bekasi?'), kp.fingerprintOf('ke bekasi bisa cod ga kak'));
  assert.notEqual(kp.fingerprintOf('Bisa COD ke Bekasi?'), kp.fingerprintOf('Ongkir ke Bekasi berapa?'));
});

test('findSimilarFact: hanya Fakta yang sudah terjawab dan cukup mirip', () => {
  const facts = [
    { question: 'Apakah bisa COD ke Bekasi', answer: 'Bisa' },
    { question: 'Jam buka toko', answer: '' },
    { question: 'Alamat toko', answer: 'Jl. Mawar 1' },
  ];
  assert.equal(kp.findSimilarFact('Bisa COD ke Bekasi kak?', facts)?.answer, 'Bisa');
  assert.equal(kp.findSimilarFact('Jam buka toko berapa', facts), null, 'Fakta belum terjawab tidak dihitung');
  assert.equal(kp.findSimilarFact('Garansi berapa lama', facts), null);
});

test('parseKnowledgeField: tahan data rusak dan dipangkas', () => {
  assert.deepEqual(kp.parseKnowledgeField(undefined), []);
  assert.deepEqual(kp.parseKnowledgeField('bukan array'), []);
  const items = kp.parseKnowledgeField([{ q: 'a', a: 'b' }, null, 5, { q: 'c', a: 'd' }, { q: 'e', a: 'f' }, { q: 'g', a: 'h' }]);
  assert.equal(items.length, kp.MAX_CANDIDATES_PER_SUMMARY);
});

test('classifyOutbound: balasan AI tidak pernah dianggap CS', () => {
  const byMessageId = new Map([['m-ai', 'ai'], ['m-bc', 'broadcast'], ['m-cs', 'human']]);
  const aiBodies = new Set([kp.normalizeBody('Halo kak,  ini jawaban AI')]);
  assert.equal(kp.classifyOutbound({ id: 'm-ai', body: 'x' }, { byMessageId, aiBodies }), 'ai');
  assert.equal(kp.classifyOutbound({ id: 'm-bc', body: 'x' }, { byMessageId, aiBodies }), 'broadcast');
  assert.equal(kp.classifyOutbound({ id: 'm-cs', body: 'x' }, { byMessageId, aiBodies }), 'cs');
  // id tidak dikenal, isi sama dengan balasan AI: tetap AI.
  assert.equal(kp.classifyOutbound({ id: 'm-x', body: 'halo kak, ini jawaban ai' }, { byMessageId, aiBodies }), 'ai');
  // diketik di HP: tidak tercatat di mana pun, jadi CS.
  assert.equal(kp.classifyOutbound({ id: 'm-hp', body: 'bisa kak' }, { byMessageId, aiBodies }), 'cs');
  assert.equal(kp.speakerLabel('cs'), 'Tim (CS)');
  assert.equal(kp.speakerLabel('ai', 'en'), 'Team (AI)');
});

test('parseConflictVerdict dan parseVariants membaca JSON berpagar dan menolak sampah', () => {
  assert.deepEqual(kp.parseConflictVerdict('```json\n{"status":"conflict","note":"Harga beda"}\n```'), { status: 'conflict', note: 'Harga beda' });
  assert.deepEqual(kp.parseConflictVerdict('ngawur'), { status: 'new', note: '' });
  assert.deepEqual(kp.parseConflictVerdict('{"status":"apa saja"}'), { status: 'new', note: '' });
  assert.deepEqual(kp.parseVariants('{"variants":["bisa cod gak","hubungi 081234567890","COD bisa?"]}'), ['bisa cod gak', 'COD bisa?']);
  assert.deepEqual(kp.parseVariants('rusak'), []);
});

test('simulationQuestions: urut, tanpa duplikat, maksimal tiga', () => {
  assert.deepEqual(
    kp.simulationQuestions({ customerMessage: 'Bisa COD?', question: 'bisa cod', variants: ['COD bisa gak', 'cod ya', 'x'] }),
    ['Bisa COD?', 'COD bisa gak', 'cod ya'],
  );
});

test('buildExcerpt: enam baris terakhir dan nomor disamarkan', () => {
  const lines = Array.from({ length: 9 }, (_, i) => `baris ${i}`);
  lines[8] = 'Customer: wa saya 081234567890';
  const out = kp.buildExcerpt(lines).split('\n');
  assert.equal(out.length, 6);
  assert.equal(out[5], 'Customer: wa saya [nomor]');
});
