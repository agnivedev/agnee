'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const stages = require('../src/follow-up-stage');
const { FollowUpScheduler, decide, withManualGap, buildFollowUpPrompt } = require('../src/follow-up');
const { buildSummary } = require('../src/order-summary');

// 14.00 WIB, di dalam jam kirim 08-21.
const NOW = new Date('2026-10-28T07:00:00Z');
const ago = (hours) => new Date(NOW.getTime() - hours * 3600_000).toISOString();

const RINCIAN = buildSummary({
  items: [
    { name: 'MU 420 CERAFIX 25KG', qty: 10, unitPrice: 95000, unit: 'sak' },
    { name: 'Semen Tiga Roda 40kg', qty: 20, unitPrice: 62000, unit: 'sak' },
  ],
  shipping: 150000, shippingLabel: 'Ongkir (Lalamove, Pickup)',
}).text;

const PROFORMA = {
  number: 'PF-20261028ABCDE', total: 2365000, at: ago(5),
  payload: { lines: [{ name: 'MU 420 CERAFIX 25KG', qty: 10, unit: 'sak', unitPrice: 95000 }], shipping: 150000 },
};

const base = (over = {}) => ({
  inbound: [{ body: 'semen tiga roda 40kg berapa kak? sama cerafix', messageType: 'chat', at: ago(8) }],
  outbound: [{ body: 'Semen Tiga Roda 40kg Rp 62.000 per sak kak. Butuh berapa sak?', at: ago(7.9) }],
  proforma: null, invoice: null, proof: null, pendingQuestion: null,
  paymentMarkers: { accountNumbers: ['1234567890'], paymentLink: '' },
  ...over,
});
const resolve = (facts, opts = {}) => stages.resolveStage(facts, { now: NOW, toggles: stages.normalizeStageToggles(opts.toggles), ...opts });

// ── Tahap ────────────────────────────────────────────────────────────────

test('tahap (a): tanya harga lalu diam = inquiry, 2 pesan', () => {
  const plan = resolve(base());
  assert.equal(plan.stage, 'inquiry');
  assert.deepEqual(plan.offsetsHours, [6, 48]);
  assert.match(plan.data.recentInbound[0], /semen tiga roda/);
});

test('tahap (b): rincian + grand total terkirim = summary, barang dan total dibaca dari teksnya', () => {
  const plan = resolve(base({ outbound: [...base().outbound, { body: `Baik kak, ini rinciannya:\n\n${RINCIAN}\n\nKalau sudah sesuai, saya proses ya kak`, at: ago(4) }] }));
  assert.equal(plan.stage, 'summary');
  assert.deepEqual(plan.offsetsHours, [3, 24, 48]);
  assert.equal(plan.data.grandTotal, 'Rp 2.340.000');
  assert.deepEqual(plan.data.items.map((i) => [i.name, i.qty, i.unit]), [
    ['MU 420 CERAFIX 25KG', '10', 'sak'], ['Semen Tiga Roda 40kg', '20', 'sak'],
  ]);
  assert.equal(plan.data.shippingPending, false);
});

test('tahap (c): proforma open sesudah rincian = proforma, nomor dan total dari tabel', () => {
  const plan = resolve(base({
    outbound: [{ body: RINCIAN, at: ago(6) }, { body: '*Proforma Invoice*\n...\n*GRAND TOTAL: Rp 2.365.000*', at: ago(5) }],
    proforma: PROFORMA,
  }));
  assert.equal(plan.stage, 'proforma');
  assert.equal(plan.data.documentNumber, 'PF-20261028ABCDE');
  assert.equal(plan.data.grandTotal, 'Rp 2.365.000');
});

test('tahap (d): invoice tanpa bukti transfer = payment', () => {
  const plan = resolve(base({ proforma: null, invoice: { number: 'INV-77', total: 2340000, payload: { lines: PROFORMA.payload.lines }, at: ago(4) } }));
  assert.equal(plan.stage, 'payment');
  assert.equal(plan.data.documentNumber, 'INV-77');
  assert.equal(plan.data.grandTotal, 'Rp 2.340.000');
});

test('tahap (d) tanpa DealPOS: rekening dikirim sesudah rincian = payment, total dari rincian', () => {
  const plan = resolve(base({
    outbound: [{ body: RINCIAN, at: ago(6) }, { body: 'Silakan transfer ke BCA 123-456-7890 a.n. ESBEJE ya kak', at: ago(5) }],
  }));
  assert.equal(plan.stage, 'payment');
  assert.equal(plan.data.grandTotal, 'Rp 2.340.000');
  assert.equal(plan.data.paymentInfoSent, true);
});

test('tahap (e): pertanyaan ke departemen belum dijawab = ditahan, customer tidak ditagih', () => {
  const plan = resolve(base({ invoice: { number: 'INV-77', total: 1, payload: {}, at: ago(6) }, pendingQuestion: { department: 'Gudang', at: ago(5) } }));
  assert.equal(plan.stage, 'waiting_internal');
  assert.equal(plan.hold, true);
  assert.equal(decide({ ...row(), plan }, NOW).skip, 'waiting_department');
});

test('berhenti: bukti transfer sesudah invoice', () => {
  const plan = resolve(base({ invoice: { number: 'INV-77', total: 1, payload: {}, at: ago(6) }, proof: { verdict: 'cocok', at: ago(2) } }));
  assert.equal(plan.stop, 'payment_sent');
  assert.equal(decide({ ...row(), plan }, NOW).stop, 'payment_sent');
});

test('berhenti: customer bilang sudah transfer, atau mengirim foto sesudah tagihan', () => {
  const invoice = { number: 'INV-77', total: 1, payload: {}, at: ago(6) };
  const claim = resolve(base({ invoice, inbound: [{ body: 'udah saya tf ya kak', messageType: 'chat', at: ago(3) }] }));
  assert.equal(claim.stop, 'payment_sent');
  const photo = resolve(base({ invoice, inbound: [{ body: '', messageType: 'image', at: ago(3) }] }));
  assert.equal(photo.stop, 'payment_sent');
  // Foto sebelum ada rincian/tagihan bukan bukti (foto barang referensi).
  const reference = resolve(base({ inbound: [{ body: '', messageType: 'image', at: ago(3) }] }));
  assert.equal(reference.stage, 'inquiry');
});

test('bukti transfer LAMA tidak menghentikan pesanan baru', () => {
  const plan = resolve(base({ proof: { verdict: 'cocok', at: ago(30) }, outbound: [{ body: RINCIAN, at: ago(4) }] }));
  assert.equal(plan.stage, 'summary');
});

test('berhenti: customer menolak; hanya pesan terakhirnya yang dibaca', () => {
  for (const text of ['gak jadi kak', 'batal aja', 'sudah beli di toko sebelah', 'tidak minat', 'STOP', 'jangan chat lagi ya']) {
    assert.equal(resolve(base({ inbound: [{ body: text, messageType: 'chat', at: ago(3) }] })).stop, 'declined', text);
  }
  const changedMind = resolve(base({ inbound: [
    { body: 'gak jadi deh', messageType: 'chat', at: ago(5) },
    { body: 'eh jadi deh kak, 10 sak', messageType: 'chat', at: ago(4) },
  ] }));
  assert.equal(changedMind.stop, undefined);
  for (const text of ['ga usah dikirim, saya ambil sendiri', 'jadi kak', 'ongkirnya gak jadi masalah']) {
    assert.equal(resolve(base({ inbound: [{ body: text, messageType: 'chat', at: ago(3) }] })).stop, undefined, text);
  }
});

test('customer menunda ("nanti saya kabari"): pengingat pertama tidak sebelum 24 jam', () => {
  const plan = resolve(base({
    inbound: [{ body: 'nanti saya kabari ya kak, diskusi dulu sama mandor', messageType: 'chat', at: ago(4) }],
    outbound: [{ body: RINCIAN, at: ago(3.9) }],
  }));
  assert.equal(plan.stage, 'summary');
  assert.equal(plan.deferred, true);
  assert.deepEqual(plan.offsetsHours, [24, 48]);
});

test('rincian baru sesudah invoice lama = pesanan baru (summary), bukan tagihan lama', () => {
  const plan = resolve(base({ invoice: { number: 'INV-1', total: 1, payload: {}, at: ago(48) }, outbound: [{ body: RINCIAN, at: ago(3) }] }));
  assert.equal(plan.stage, 'summary');
});

test('data funnel lebih tua dari 7 hari diabaikan', () => {
  const plan = resolve(base({ outbound: [{ body: RINCIAN, at: ago(24 * 8) }], invoice: { number: 'INV-1', total: 1, payload: {}, at: ago(24 * 9) } }));
  assert.equal(plan.stage, 'inquiry');
});

test('saklar tahap: tahap yang dimatikan tidak dikirimi', () => {
  const plan = resolve(base({ outbound: [{ body: RINCIAN, at: ago(4) }] }), { toggles: { summary: false } });
  assert.equal(plan.disabled, true);
  assert.equal(decide({ ...row(), plan }, NOW).skip, 'stage_disabled');
  assert.deepEqual(stages.normalizeStageToggles({ summary: false, bogus: false }), { inquiry: true, summary: false, proforma: true, payment: true });
});

// ── Jadwal (decide + plan) ───────────────────────────────────────────────

function row(over = {}) {
  return {
    chatId: '6281@c.us', companyId: 'esbeje', sequenceStartedAt: ago(4), sentPerDay: [], sentTotal: 0,
    dayCaps: [1, 1, 1], minGapMinutes: 120, lastSentAt: null, sendFromHour: 8, sendToHour: 21, timezone: 'Asia/Jakarta',
    ...over,
  };
}

test('jadwal: pesan ke-n tidak keluar sebelum offset tahapnya; retryAt = waktu jatuh tempo', () => {
  const plan = { stage: 'inquiry', offsetsHours: [6, 48], data: {} };
  const early = decide({ ...row(), plan }, NOW); // baru 4 jam
  assert.equal(early.skip, 'not_yet');
  assert.equal(early.retryAt.toISOString(), new Date(NOW.getTime() + 2 * 3600_000).toISOString());
  const due = decide({ ...row({ sequenceStartedAt: ago(6) }), plan }, NOW);
  assert.equal(due.send, true);
  assert.deepEqual([due.step, due.totalSteps], [1, 2]);
});

test('jadwal: langkah berikutnya mengikuti offset berikutnya, lalu habis', () => {
  const plan = { stage: 'summary', offsetsHours: [3, 24, 48], data: {} };
  const afterFirst = row({ sequenceStartedAt: ago(20), sentTotal: 1, sentPerDay: [1], lastSentAt: ago(17) });
  assert.equal(decide({ ...afterFirst, plan }, NOW).skip, 'not_yet');
  const second = decide({ ...afterFirst, sequenceStartedAt: ago(25), plan }, NOW);
  assert.equal(second.send, true);
  assert.equal(second.step, 2);
  const done = row({ sequenceStartedAt: ago(60), sentTotal: 3, sentPerDay: [1, 1, 1], lastSentAt: ago(12) });
  assert.equal(decide({ ...done, plan }, NOW).stop, 'exhausted');
});

test('jadwal: plafon harian 1,1,1 tetap jadi batas atas', () => {
  const plan = { stage: 'summary', offsetsHours: [3, 4, 48], data: {} };
  const state = row({ sequenceStartedAt: ago(5), sentTotal: 1, sentPerDay: [1], lastSentAt: ago(3) });
  assert.equal(decide({ ...state, plan }, NOW).skip, 'day_cap_reached');
});

test('jadwal: jam kirim company tetap berlaku', () => {
  const night = new Date('2026-10-28T16:00:00Z'); // 23.00 WIB
  const plan = { stage: 'summary', offsetsHours: [3, 24, 48], data: {} };
  assert.equal(decide({ ...row({ sequenceStartedAt: new Date(night.getTime() - 4 * 3600_000).toISOString() }), plan }, night).skip, 'outside_send_window');
});

test('kirim manual: jadwal tahap tidak menahan, tapi berhenti/tahan tetap berlaku', () => {
  const plan = { stage: 'inquiry', offsetsHours: [6, 48], data: {} };
  assert.equal(decide({ ...withManualGap(row()), plan }, NOW).send, true);
  assert.equal(decide({ ...withManualGap(row()), plan: { stage: 'paid', stop: 'payment_sent' } }, NOW).stop, 'payment_sent');
  assert.equal(decide({ ...withManualGap(row()), plan: { stage: 'waiting_internal', hold: true } }, NOW).skip, 'waiting_department');
});

// ── Isi pesan ────────────────────────────────────────────────────────────

test('prompt per tahap memuat data persis dan satu tujuan', () => {
  const plan = resolve(base({ outbound: [{ body: RINCIAN, at: ago(4) }] }));
  const prompt = buildFollowUpPrompt({ dayIndex: 0, attemptInDay: 1, dayCaps: [1, 1, 1], previousSends: [], playbookMd: '', plan, step: 1, totalSteps: 3 });
  assert.match(prompt, /POSISI CUSTOMER: rincian \+ grand total terkirim/);
  assert.match(prompt, /MU 420 CERAFIX 25KG \(10 sak\)/);
  assert.match(prompt, /Grand total: Rp 2\.340\.000/);
  assert.match(prompt, /langkah 1 dari 3/);
  assert.match(prompt, /jangan dihitung ulang/);
  assert.doesNotMatch(prompt, /TERAKHIR/);
  const last = buildFollowUpPrompt({ dayIndex: 2, attemptInDay: 1, dayCaps: [1, 1, 1], previousSends: [], playbookMd: '', plan, step: 3, totalSteps: 3 });
  assert.match(last, /FOLLOW-UP TERAKHIR/);
});

test('angka dan nomor dokumen hanya dari data; ditulis beda format tetap dikenali', () => {
  const plan = { stage: 'proforma', data: { grandTotal: 'Rp 2.340.000', documentNumber: 'PF-20261028ABCDE' } };
  const allowed = stages.allowedFigures(plan, [{ body: 'Semen Rp 62.000 per sak' }]);
  assert.equal(stages.checkFigures('Proforma PF-20261028ABCDE total Rp2.340.000 sudah oke kak?', allowed), null);
  assert.equal(stages.checkFigures('Semen tetap Rp 62.000 ya kak', allowed), null);
  assert.match(stages.checkFigures('Totalnya jadi Rp 2.300.000 kak', allowed), /tidak ada di data/);
  assert.match(stages.checkFigures('Proforma PF-20261028XXXXX kak', allowed), /nomor dokumen/);
});

test('kalimat yang hampir sama dengan follow-up sebelumnya terdeteksi', () => {
  const prev = [{ body: 'Kak, rincian pesanan semen kemarin sudah sesuai belum? Kalau oke saya proses ya kak' }];
  assert.equal(stages.repeatsPrevious('Kak, rincian pesanan semen kemarin sudah sesuai belum? Kalau oke saya proses ya', prev), true);
  assert.equal(stages.repeatsPrevious('Kak, kalau mau ambil sendiri di toko juga bisa, ongkirnya jadi nol. Mau saya ubah?', prev), false);
});

// ── Alur scheduler dengan LLM tiruan ────────────────────────────────────

function fakeDb(state, facts) {
  const calls = { stopped: [], snoozed: [], recorded: [] };
  return {
    calls,
    async getFollowUpFunnelFacts() { return facts; },
    async stopFollowUpSequence(chatId, companyId, reason) { calls.stopped.push(reason); state.stoppedAt = NOW; return true; },
    async snoozeFollowUp(chatId, companyId, until) { calls.snoozed.push(new Date(until).toISOString()); return true; },
    async countFollowUpSends() { return calls.recorded.length; },
    async listFollowUpSends() { return calls.recorded.map((r) => ({ body: r.body, dayIndex: r.dayIndex, stage: r.stage })); },
    async getPlaybookDoc() { return { contentMd: 'Agnes menyapa dengan "kak", sopan, tidak memaksa.' }; },
    async listOutboundRepliesForChat() { return facts.outbound; },
    async getCompanyConfig() { return { paymentLink: '' }; },
    async recordFollowUpSend(entry) {
      calls.recorded.push(entry);
      state.sentTotal = (state.sentTotal || 0) + 1;
      state.sentPerDay = [...(state.sentPerDay || [])];
      state.sentPerDay[entry.dayIndex] = (state.sentPerDay[entry.dayIndex] || 0) + 1;
      state.lastSentAt = NOW.toISOString();
      return { sentTotal: state.sentTotal };
    },
  };
}

function scheduler(database, replies) {
  const prompts = [];
  const sent = [];
  const s = new FollowUpScheduler({
    database,
    logger: { info() {}, warn() {}, error() {} },
    deps: {
      isHumanHandled: async () => false,
      generate: async (companyId, chatId, prompt) => { prompts.push(prompt); return replies.shift() ?? null; },
      sendMessage: async (companyId, chatId, text) => { sent.push(text); },
    },
  });
  return { s, prompts, sent };
}

test('alur ESBEJE: rincian belum dijawab -> follow-up menyebut barang dan grand total, tercatat tahap summary', async () => {
  const facts = base({ outbound: [...base().outbound, { body: RINCIAN, at: ago(4) }] });
  const state = row({ sequenceStartedAt: ago(4) });
  const database = fakeDb(state, facts);
  const { s, prompts, sent } = scheduler(database, ['Kak, rincian CERAFIX 10 sak dan Semen Tiga Roda 20 sak dengan grand total Rp 2.340.000 sudah sesuai? Kalau oke saya proses sekarang ya kak.']);
  const outcome = await s.processOne(state, NOW);
  assert.equal(outcome.sent, true);
  assert.equal(outcome.stage, 'summary');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Grand total: Rp 2\.340\.000/);
  assert.match(prompts[0], /Agnes menyapa/); // playbook follow-up company ikut
  assert.equal(database.calls.recorded[0].stage, 'summary');
  assert.match(sent[0], /Rp 2\.340\.000/);
});

test('alur: model mengarang angka -> ditulis ulang sekali dengan peringatan', async () => {
  const facts = base({ outbound: [{ body: RINCIAN, at: ago(4) }] });
  const state = row();
  const database = fakeDb(state, facts);
  const { s, prompts, sent } = scheduler(database, [
    'Kak, totalnya jadi Rp 2.200.000 saja kalau jadi hari ini.',
    'Kak, rincian dengan grand total Rp 2.340.000 sudah sesuai? Saya siap proses.',
  ]);
  const outcome = await s.processOne(state, NOW);
  assert.equal(outcome.sent, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /PERHATIAN: draf sebelumnya ditolak karena angka Rp 2\.200\.000/);
  assert.doesNotMatch(sent[0], /2\.200\.000/);
});

test('alur: dua draf sama-sama salah -> tidak ada yang terkirim, ditunda 2 jam', async () => {
  const facts = base({ outbound: [{ body: RINCIAN, at: ago(4) }] });
  const state = row();
  const database = fakeDb(state, facts);
  const { s, sent } = scheduler(database, ['Totalnya Rp 1.000.000 kak', 'Totalnya Rp 999.000 kak']);
  const outcome = await s.processOne(state, NOW);
  assert.equal(outcome.skipped, 'nothing_worth_sending');
  assert.equal(sent.length, 0);
  assert.equal(database.calls.recorded.length, 0);
  assert.equal(database.calls.snoozed[0], new Date(NOW.getTime() + 2 * 3600_000).toISOString());
});

test('alur: invoice sudah ada bukti transfer -> rangkaian berhenti tanpa memanggil model', async () => {
  const facts = base({ invoice: { number: 'INV-77', total: 2340000, payload: {}, at: ago(6) }, proof: { verdict: 'perlu_dicek', at: ago(1) } });
  const state = row({ sequenceStartedAt: ago(5) });
  const database = fakeDb(state, facts);
  const { s, prompts, sent } = scheduler(database, ['tidak boleh terpakai']);
  const outcome = await s.processOne(state, NOW);
  assert.equal(outcome.stopped, 'payment_sent');
  assert.deepEqual(database.calls.stopped, ['payment_sent']);
  assert.equal(prompts.length, 0);
  assert.equal(sent.length, 0);
});

test('alur: menunggu jawaban departemen -> tidak menagih, dicek lagi 30 menit kemudian', async () => {
  const facts = base({ pendingQuestion: { department: 'Gudang', at: ago(4) } });
  const state = row({ sequenceStartedAt: ago(10) });
  const database = fakeDb(state, facts);
  const { s, prompts } = scheduler(database, ['tidak boleh terpakai']);
  const outcome = await s.processOne(state, NOW);
  assert.equal(outcome.skipped, 'waiting_department');
  assert.equal(prompts.length, 0);
  assert.equal(database.calls.snoozed[0], new Date(NOW.getTime() + 30 * 60_000).toISOString());
  assert.deepEqual(database.calls.stopped, []);
});

test('alur: belum waktunya -> ditunda sampai jatuh tempo tahap, model tidak dipanggil', async () => {
  const state = row({ sequenceStartedAt: ago(1) });
  const database = fakeDb(state, base());
  const { s, prompts } = scheduler(database, ['x']);
  const outcome = await s.processOne(state, NOW);
  assert.equal(outcome.skipped, 'not_yet');
  assert.equal(prompts.length, 0);
  assert.equal(database.calls.snoozed[0], new Date(NOW.getTime() + 5 * 3600_000).toISOString());
});

test('alur: customer menolak -> berhenti dengan alasan declined', async () => {
  const state = row();
  const database = fakeDb(state, base({ inbound: [{ body: 'gak jadi kak, makasih', messageType: 'chat', at: ago(4.1) }] }));
  const { s, prompts } = scheduler(database, ['x']);
  const outcome = await s.processOne(state, NOW);
  assert.equal(outcome.stopped, 'declined');
  assert.equal(prompts.length, 0);
});

test('alur tiga hari: summary mengirim 3 pesan berbeda lalu habis', async () => {
  const facts = base({ outbound: [{ body: RINCIAN, at: ago(4) }] });
  const start = new Date(NOW.getTime() - 4 * 3600_000);
  const state = row({ sequenceStartedAt: start.toISOString() });
  const database = fakeDb(state, facts);
  const { s, sent } = scheduler(database, [
    'Kak, rincian dengan grand total Rp 2.340.000 sudah sesuai? Saya siap proses.',
    'Kalau mau ambil sendiri di toko juga bisa kak, nanti ongkirnya hilang dari rincian. Mau saya ubah?',
    'Baik kak, rinciannya saya simpan dulu ya. Kalau sudah siap, chat saja kapan pun, saya bantu proses.',
  ]);
  const at = (hours) => new Date(start.getTime() + hours * 3600_000);
  // Jam yang jatuh di malam hari diganti ke pagi (jam kirim 08-21 WIB).
  for (const h of [4, 25, 49]) {
    const outcome = await s.processOne(state, at(h));
    assert.equal(outcome.sent, true, `jam ke-${h}: ${JSON.stringify(outcome)}`);
  }
  assert.equal(new Set(sent).size, 3);
  // Sisa hari ke-3: plafon harian menahan; lewat hari ke-3 rangkaian habis.
  assert.equal((await s.processOne(state, at(57))).skipped, 'day_cap_reached');
  assert.equal((await s.processOne(state, at(74))).stopped, 'exhausted');
  assert.equal(sent.length, 3);
});
