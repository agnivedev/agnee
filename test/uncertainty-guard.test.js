'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/uncertainty-guard.js');
const { styleWarnings, findClaimViolations } = require('../src/reply-style.js');

const FACTS = 'Toko bangunan ESBEJE. MU 480 Rp 313.000 per sak. Pengiriman Lalamove 1 hari kerja untuk Jabodetabek. Gratis ongkir minimal belanja Rp 1.000.000.';

const run = (over = {}) => guard.assess({
  customerText: '', rawText: '', finalText: '', priceSource: FACTS, factSource: FACTS, toolText: '', toolOutputs: [], ...over,
});
const codes = (a) => a.reasons.map((r) => r.code);

test('topik santai dan jawaban beralasan tidak dianggap tidak yakin', () => {
  for (const [customerText, finalText] of [
    ['halo kak selamat pagi', 'Selamat pagi Kak! Ada yang bisa saya bantu?'],
    ['makasih ya', 'Sama-sama Kak, senang bisa membantu.'],
    ['harga MU 480?', 'MU 480 Rp 313.000 per sak, Kak. Butuh berapa sak?'],
    ['berapa lama kirimnya?', 'Pengiriman Lalamove 1 hari kerja untuk Jabodetabek, Kak.'],
    ['ada gratis ongkir?', 'Ada, gratis ongkir minimal belanja Rp 1.000.000 ya Kak.'],
  ]) {
    const a = run({ customerText, finalText, rawText: finalText });
    assert.equal(a.unsure, false, `${customerText} -> ${codes(a)}`);
  }
});

test('harga dan rekening karangan (dari keluaran mentah) memicu, final sudah bersih', () => {
  const a = run({ customerText: 'dinding retak', rawText: 'MU 100 Rp 75.000 per sak.', finalText: 'Boleh saya tahu luas dindingnya?' });
  assert.deepEqual(codes(a), ['invented_price']);
  assert.equal(a.topic, 'harga');
  const b = run({ customerText: 'rekening?', rawText: 'Transfer ke BCA 9876543210.', finalText: '' });
  assert.deepEqual(codes(b), ['invented_account']);
  assert.equal(b.topic, 'transfer');
});

test('klaim stok hanya dipersoalkan bila customer menanyakan stok dan tak ada data stok', () => {
  const reply = 'Stok MU 480 ready Kak, silakan order.';
  assert.deepEqual(codes(run({ customerText: 'MU 480 ready gak?', finalText: reply })), ['stock_claim']);
  assert.deepEqual(codes(run({ customerText: 'cara pakai MU 480?', finalText: reply })), [], 'bukan pertanyaan stok');
  assert.deepEqual(codes(run({ customerText: 'MU 480 ready gak?', finalText: reply, toolText: '{"nama":"MU 480","stok":40}' })), [], 'hasil alat memuat stok');
  assert.deepEqual(codes(run({ customerText: 'MU 480 ready gak?', finalText: reply, factSource: `${FACTS}\nstok: 12 sak` })), []);
});

test('pembayaran diterima tanpa konfirmasi, dan pengakuan transfer tanpa bukti', () => {
  assert.deepEqual(codes(run({ customerText: 'sudah saya transfer', finalText: 'Terima kasih, pembayaran kakak sudah kami terima.' })),
    ['payment_claim', 'transfer_claim_unverified']);
  // Customer mengaku transfer, balasan hanya meminta bukti: tidak perlu tindakan tambahan.
  assert.deepEqual(codes(run({ customerText: 'sudah transfer ya kak', finalText: 'Baik Kak, boleh kirim bukti transfernya di sini?' })), []);
  // Customer mengaku transfer dan balasan basa-basi: perlu dicek.
  assert.deepEqual(codes(run({ customerText: 'udah tf ya', finalText: 'Siap Kak, terima kasih!' })), ['transfer_claim_unverified']);
  // Bukti sudah diperiksa sistem: tak dipersoalkan lagi.
  assert.deepEqual(codes(run({ customerText: 'udah tf ya\n[Pemeriksaan bukti transfer (otomatis): sesuai]', finalText: 'Terima kasih Kak.' })), []);
  // Departemen sudah ditanya model.
  assert.deepEqual(codes(run({ customerText: 'udah tf ya', finalText: 'Saya cek ke tim ya Kak.', departmentAsked: true })), []);
});

test('janji waktu kirim dan diskon harus punya sumber', () => {
  assert.deepEqual(codes(run({ customerText: 'kapan sampai?', finalText: 'Barang dikirim besok dan sampai 2 jam kemudian.' })), ['delivery_promise']);
  assert.deepEqual(codes(run({ customerText: 'kapan sampai?', finalText: 'Estimasi 1 hari kerja ya Kak.' })), []);
  assert.deepEqual(codes(run({ customerText: 'ada diskon?', finalText: 'Ada diskon 15% untuk Kakak!' })), ['discount_claim']);
  // Kata customer sendiri bukan sumber fakta.
  assert.deepEqual(codes(run({ customerText: 'diskon 15% kan?', finalText: 'Betul, diskon 15% ya Kak.', priceSource: `${FACTS}\ndiskon 15% kan?` })), ['discount_claim']);
});

test('alat tak menemukan hasil: barang -> harga, alamat -> tanya customer', () => {
  const none = JSON.stringify({ status: 'tidak_ketemu', pesan: 'Tidak ada barang yang cocok di daftar harga.' });
  const addr = JSON.stringify({ status: 'jalan_ambigu', pesan: 'Jalan ini ada di banyak kota. Tanyakan kota atau kecamatannya.' });
  const a = run({ customerText: 'harga cat tembok', finalText: 'Cat tembok bagus Kak.', toolOutputs: [none] });
  assert.deepEqual([codes(a), a.topic, a.missingInfo], [['tool_no_result'], 'harga', false]);
  const b = run({ customerText: 'ongkir ke Jl Merdeka', finalText: 'Siap Kak.', toolOutputs: [addr] });
  assert.deepEqual([b.topic, b.missingInfo], ['ongkir', true]);
  assert.deepEqual(codes(run({ finalText: 'Siap.', toolOutputs: [JSON.stringify({ status: 'ok', hasil: [] })] })), []);
});

test('hedging di kalimat berisiko memicu; hedging santai tidak', () => {
  assert.deepEqual(codes(run({ customerText: 'harga?', finalText: 'Kira-kira harganya segitu ya Kak.' })), ['hedge']);
  assert.deepEqual(codes(run({ customerText: 'kirim?', finalText: 'Mungkin ongkirnya sekitar segitu.' })), ['hedge']);
  assert.deepEqual(codes(run({ customerText: 'halo', finalText: 'Mungkin Kakak sedang sibuk, saya tunggu kabarnya ya.' })), []);
});

test('pertanyaan ke customer bukan hedging; pencarian harga gagal tapi harga sah tetap lolos', () => {
  assert.deepEqual(codes(run({ customerText: 'Saya di ruko golden 8', finalText: 'Untuk ongkir yang lebih akurat, bisa share lokasi atau mungkin ada patokan terdekatnya kak?' })), []);
  const none = JSON.stringify({ status: 'tidak_ketemu', pesan: 'Tidak ada barang yang cocok di daftar harga.' });
  const said = `${FACTS}\nDanabrite 2290 Brilliant White 5KG Rp 125.000 per gln`;
  assert.deepEqual(codes(run({ customerText: 'itu aja kak jadi berapa?', finalText: 'Totalnya 1 gln x Rp 125.000 = Rp 125.000 ya kak.', priceSource: said, toolOutputs: [none] })), []);
});

test('pickDepartment: transfer ke Finance, sisanya Management, stok ke Gudang lebih dulu', () => {
  const names = ['Management', 'Finance', 'Gudang'];
  assert.equal(guard.pickDepartment('transfer', names), 'Finance');
  assert.equal(guard.pickDepartment('ongkir', names), 'Management');
  assert.equal(guard.pickDepartment('stok', names), 'Gudang');
  assert.equal(guard.pickDepartment('stok', ['Management']), 'Management');
  assert.equal(guard.pickDepartment('transfer', ['Management']), null, 'transfer tak dikirim ke Management');
  assert.equal(guard.pickDepartment('harga', []), null);
  assert.equal(guard.pickDepartment('ongkir', ['Management', 'Logistik']), 'Logistik');
  assert.equal(guard.pickDepartment('diskon', ['Finance', 'Management']), 'Management');
});

test('chooseAction mengikuti konteks dan mode', () => {
  const base = { topic: 'ongkir', departmentNames: ['Management'], canAsk: true, mode: 'on' };
  assert.equal(guard.chooseAction(base).action, 'ask_department');
  assert.equal(guard.chooseAction({ ...base, missingInfo: true }).action, 'ask_customer');
  assert.equal(guard.chooseAction({ ...base, canAsk: false }).action, 'notify_staff');
  assert.equal(guard.chooseAction({ ...base, canAsk: false, mode: 'handoff' }).action, 'handoff');
  assert.equal(guard.chooseAction({ topic: 'transfer', departmentNames: ['Management'], canAsk: true, mode: 'on', proofCheck: true }).action, 'ask_customer');
  assert.equal(guard.chooseAction({ topic: 'transfer', departmentNames: ['Management'], canAsk: true, mode: 'on' }).action, 'notify_staff');
});

test('compose: pengakuan wajar, tanpa teks internal, kalimat tebakan dan menunda dibuang', () => {
  const customerText = 'MU 480 ready gak? sekalian ongkir ke BSD';
  const finalText = 'Halo Kak! Stok MU 480 ready ya. Ongkirnya saya pastikan dulu.';
  const assessment = run({ customerText, finalText });
  const plan = guard.chooseAction({ topic: assessment.topic, departmentNames: ['Management'], canAsk: true });
  const out = guard.compose({ finalText, customerText, assessment, plan });
  assert.match(out, /^Halo Kak!/);
  assert.doesNotMatch(out, /ready ya/);
  assert.doesNotMatch(out, /saya pastikan dulu/);
  assert.match(out, /belum bisa memastikan/);
  assert.match(out, /get back ke kakak/);
  assert.doesNotMatch(out, /Management|ask_department|cek_|belum diisi|tidak ada di (?:prompt|katalog)/i);
  // Tidak memicu penjaga gaya/kebocoran yang ada.
  assert.deepEqual(findClaimViolations(out), []);
  assert.deepEqual(styleWarnings(out, {}).filter((w) => /bocor|internal|klaim/i.test(w)), []);
});

test('compose berbahasa Inggris untuk customer berbahasa Inggris, dan tanya balik per topik', () => {
  const en = guard.compose({ finalText: '', customerText: 'How much is the shipping, please?', assessment: { topic: 'ongkir', reasons: [] }, plan: { action: 'ask_customer' } });
  assert.match(en, /can't confirm the shipping cost/);
  assert.match(en, /delivery location/);
  const id = guard.compose({ finalText: '', customerText: 'ongkir ke Merdeka', assessment: { topic: 'ongkir', reasons: [] }, plan: { action: 'ask_customer' } });
  assert.match(id, /lokasi atau alamat lengkap/);
  const proof = guard.compose({ finalText: '', customerText: 'sudah transfer', assessment: { topic: 'transfer', reasons: [] }, plan: { action: 'ask_customer' } });
  assert.match(proof, /foto bukti transfer/);
});

test('departmentQuestion menyebut apa yang perlu dipastikan, tanpa memuat nama alat', () => {
  const q = guard.departmentQuestion({ topic: 'transfer', customerText: 'udah tf 1,5jt ya', assessment: { reasons: [{ code: 'transfer_claim_unverified' }] } });
  assert.match(q, /sudah membayar/);
  assert.match(q, /udah tf 1,5jt/);
  assert.doesNotMatch(q, /ask_department/);
});

// ── Simulasi ESBEJE 4 Nov: janji kosong, bukti palsu, pesanan "sudah diproses" ──

test('"saya cek ketersediaannya dulu" tanpa bertanya ke siapa pun dihitung janji kosong', () => {
  const a = run({ customerText: 'semen gresiknya ada stok gak?', finalText: 'Saya cek ketersediaannya dulu ya kak.', rawText: 'Saya cek ketersediaannya dulu ya kak.' });
  assert.ok(codes(a).includes('empty_promise'), codes(a).join());
  assert.equal(a.topic, 'stok');
  // Sudah bertanya ke departemen (atau alat menunggu jawaban): janjinya nyata.
  assert.equal(run({ customerText: 'ada stok?', finalText: 'Saya cek dulu ya kak.', departmentAsked: true }).unsure, false);
  assert.equal(run({ customerText: 'ongkir ke BSD?', finalText: 'Ongkirnya sedang saya pastikan dulu ya kak.', toolText: '{"status":"menunggu_management"}' }).unsure, false);
});

test('pertanyaan balik dan sapaan tidak dianggap janji kosong', () => {
  assert.equal(run({ customerText: 'ada stok?', finalText: 'Boleh saya cek dulu, butuh berapa sak ya kak?' }).unsure, false);
  assert.equal(run({ customerText: 'halo', finalText: 'Halo kak, ada yang bisa dibantu?' }).unsure, false);
});

test('"saya cek dulu bukti transfernya" bukan permintaan bukti', () => {
  const a = run({ customerText: 'sudah saya transfer ya kak', finalText: 'Terima kasih kak. Saya cek dulu bukti transfernya.' });
  assert.ok(codes(a).includes('transfer_claim_unverified'));
  const asks = run({ customerText: 'sudah saya transfer ya kak', finalText: 'Terima kasih kak. Boleh dikirim foto bukti transfernya?' });
  assert.ok(!codes(asks).includes('transfer_claim_unverified'));
});

test('"ini buktinya" tanpa berkas: minta kirim ulang, jangan pura-pura melihat', () => {
  const a = run({ customerText: 'udah saya transfer kak, ini buktinya ya', finalText: 'Terima kasih kak Siti.' });
  assert.ok(codes(a).includes('proof_not_attached'));
  const plan = guard.chooseAction({ topic: a.topic, departmentNames: ['Finance'], canAsk: true, proofMissing: true });
  assert.equal(plan.action, 'ask_customer');
  const text = guard.compose({ finalText: 'Terima kasih kak Siti.', customerText: 'ini buktinya ya', assessment: a, plan });
  assert.match(text, /belum terlihat masuk/);
  assert.doesNotMatch(text, /belum bisa memastikan sudah masuk/);
  // Berkas ada: tak ada alasan.
  const ok = run({ customerText: 'udah saya transfer kak, ini buktinya ya\n[Customer mengirim foto]', finalText: 'Terima kasih kak, saya periksa.', departmentAsked: true });
  assert.ok(!codes(ok).includes('proof_not_attached'));
});

test('"pesanan sudah saya proses" tanpa pesanan yang dibuat adalah klaim kosong', () => {
  const a = run({ customerText: 'ok saya ambil besok', finalText: 'Baik kak Siti, pesanan sudah saya proses ya.' });
  assert.ok(codes(a).includes('order_claim'));
  assert.equal(run({ customerText: 'ok', finalText: 'Pesanan sudah diproses, nomor pesanan SO-12.', toolText: '{"proforma":"SO-12"}' }).unsure, false);
  assert.equal(run({ customerText: 'ok', finalText: 'Baik kak, saya proses ya setelah transfer masuk.' }).unsure, false);
});

test('penanda berkas customer yang bocor ke balasan ditangkap kontrak keluaran', () => {
  const found = findClaimViolations('[Customer mengirim foto]\nTerima kasih kak.');
  assert.equal(found.length, 1);
  assert.equal(found[0].sentence, '[Customer mengirim foto]');
  assert.equal(findClaimViolations('Terima kasih kak, fotonya sudah kami terima.').length, 0);
});

test('"berapa" saja bukan topik harga: jam buka yang dipastikan dulu tidak dihitung janji kosong harga', () => {
  const a = run({ customerText: 'Tutup jam berapa', finalText: 'Saya pastikan dulu ya jam bukanya.' });
  assert.equal(a.unsure, false, codes(a).join());
});
