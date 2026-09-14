'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FollowUpScheduler, decide, withinSendWindow, buildFollowUpPrompt, checkoutAlreadySent } = require('../src/follow-up');

// Jam 14.00 WIB = 07.00 UTC, aman di dalam jendela kirim default (8-21 WIB).
const MIDDAY = new Date('2026-09-15T07:00:00Z');
const base = {
  sequenceStartedAt: MIDDAY.toISOString(),
  sentPerDay: [],
  dayCaps: [5, 3, 2],
  minGapMinutes: 120,
  lastSentAt: null,
  sendFromHour: 8,
  sendToHour: 21,
};
const at = (isoOffsetHours) => new Date(MIDDAY.getTime() + isoOffsetHours * 3600_000);

test('follow-up: mengirim saat rangkaian baru dimulai di jam kerja', () => {
  const v = decide(base, MIDDAY);
  assert.equal(v.send, true);
  assert.equal(v.dayIndex, 0);
  assert.equal(v.attemptInDay, 1);
});

test('follow-up: menghormati jarak minimum antar pesan', () => {
  const state = { ...base, lastSentAt: MIDDAY.toISOString(), sentPerDay: [1] };
  assert.equal(decide(state, at(1)).skip, 'gap_not_elapsed');   // 1 jam < 120 menit
  assert.equal(decide(state, at(2.5)).send, true);              // 2,5 jam > 120 menit
});

test('follow-up: plafon harian menghentikan pengiriman, bukan menundanya ke esok', () => {
  // Hari 1 sudah 5x (plafon), masih di hari 1 → tidak boleh kirim lagi.
  const full = { ...base, sentPerDay: [5], lastSentAt: at(-3).toISOString() };
  assert.equal(decide(full, at(6)).skip, 'day_cap_reached');
  // Masuk hari 2: plafon hari 2 (3x) berlaku, hitungan hari 1 tidak terbawa.
  const day2 = decide(full, at(25));
  assert.equal(day2.send, true);
  assert.equal(day2.dayIndex, 1);
  assert.equal(day2.attemptInDay, 1);
});

test('follow-up: setiap hari punya plafon sendiri sesuai urutan 5/3/2', () => {
  const capReached = (dayIndex, sent) => decide(
    { ...base, sentPerDay: Array.from({ length: dayIndex + 1 }, (_, i) => (i === dayIndex ? sent : 0)) },
    at(dayIndex * 24),
  );
  assert.equal(capReached(0, 4).send, true);            // hari 1: 4 < 5
  assert.equal(capReached(0, 5).skip, 'day_cap_reached');
  assert.equal(capReached(1, 2).send, true);            // hari 2: 2 < 3
  assert.equal(capReached(1, 3).skip, 'day_cap_reached');
  assert.equal(capReached(2, 1).send, true);            // hari 3: 1 < 2
  assert.equal(capReached(2, 2).skip, 'day_cap_reached');
});

test('follow-up: berhenti permanen setelah hari terakhir terlewat', () => {
  assert.equal(decide(base, at(72)).stop, 'exhausted');   // awal hari ke-4
  assert.equal(decide(base, at(200)).stop, 'exhausted');
});

test('follow-up: tidak mengirim di luar jam kirim', () => {
  // 02.00 WIB = 19.00 UTC hari sebelumnya.
  const night = new Date('2026-09-15T19:00:00Z');
  assert.equal(decide({ ...base, sequenceStartedAt: night.toISOString() }, night).skip, 'outside_send_window');
});

test('follow-up: jendela kirim yang melewati tengah malam tetap benar', () => {
  const at9pmWib = new Date('2026-09-15T14:00:00Z');  // 21.00 WIB
  const at2amWib = new Date('2026-09-15T19:00:00Z');  // 02.00 WIB
  const atNoonWib = new Date('2026-09-15T05:00:00Z'); // 12.00 WIB
  assert.equal(withinSendWindow(21, 8, at9pmWib), true);
  assert.equal(withinSendWindow(21, 8, at2amWib), true);
  assert.equal(withinSendWindow(21, 8, atNoonWib), false);
});

test('follow-up: jam server tidak mempengaruhi keputusan, hanya jam WIB', () => {
  // 23.00 UTC = 06.00 WIB besoknya → di luar jendela 8-21 WIB, walau di UTC
  // ini masih "malam hari yang sama".
  const t = new Date('2026-09-15T23:00:00Z');
  assert.equal(decide({ ...base, sequenceStartedAt: t.toISOString() }, t).skip, 'outside_send_window');
});

test('follow-up: prompt melarang mengulang pesan sebelumnya dan menandai yang terakhir', () => {
  const previousSends = [{ dayIndex: 0, attemptInDay: 1, body: 'Pesan pertama' }];
  const mid = buildFollowUpPrompt({ dayIndex: 0, attemptInDay: 2, dayCaps: [5, 3, 2], previousSends, playbookMd: '' });
  assert.match(mid, /Pesan pertama/);
  assert.match(mid, /Jangan mengulang/);
  assert.doesNotMatch(mid, /FOLLOW-UP TERAKHIR/);

  // Percobaan terakhir di hari terakhir harus ditandai sebagai penutup.
  const last = buildFollowUpPrompt({ dayIndex: 2, attemptInDay: 2, dayCaps: [5, 3, 2], previousSends, playbookMd: '' });
  assert.match(last, /FOLLOW-UP TERAKHIR/);
});

// ── Scheduler ──────────────────────────────────────────────────────────────

function harness({ dueRows = [], humanHandled = false, generated = 'Pesan follow-up' } = {}) {
  const calls = { sent: [], recorded: [], stopped: [] };
  const database = {
    async listDueFollowUps() { return dueRows; },
    async stopFollowUpSequence(chatId, companyId, reason) { calls.stopped.push({ chatId, reason }); return true; },
    async listFollowUpSends() { return []; },
    async getPlaybookDoc() { return { contentMd: '# panduan' }; },
    async recordFollowUpSend(row, companyId) { calls.recorded.push({ ...row, companyId }); return {}; },
  };
  const deps = {
    async isHumanHandled() { return humanHandled; },
    async generate() { return generated; },
    async sendMessage(companyId, chatId, text) { calls.sent.push({ companyId, chatId, text }); },
  };
  return { calls, scheduler: new FollowUpScheduler({ database, logger: { info() {}, warn() {} }, deps }) };
}

const dueRow = { companyId: 'co-1', chatId: 'c@c.us', ...base };

test('scheduler: mengirim, mencatat, dan tidak mengirim dua kali', async () => {
  const { calls, scheduler } = harness({ dueRows: [dueRow] });
  const result = await scheduler.tick(MIDDAY);
  assert.equal(result.sent, 1);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].text, 'Pesan follow-up');
  assert.equal(calls.recorded[0].dayIndex, 0);
  assert.equal(calls.recorded[0].attemptInDay, 1);
});

test('scheduler: berhenti kalau agent sudah mengambil alih chat', async () => {
  const { calls, scheduler } = harness({ dueRows: [dueRow], humanHandled: true });
  const result = await scheduler.tick(MIDDAY);
  assert.equal(result.sent, 0);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.stopped[0].reason, 'human_takeover');
});

test('scheduler: generator yang menjawab SKIP tidak menghabiskan plafon', async () => {
  const { calls, scheduler } = harness({ dueRows: [dueRow], generated: 'SKIP' });
  const result = await scheduler.tick(MIDDAY);
  assert.equal(result.sent, 0);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.recorded.length, 0, 'tidak boleh tercatat sebagai terkirim');
  assert.equal(calls.stopped.length, 0, 'rangkaian tetap hidup untuk dicoba lagi nanti');
});

test('scheduler: satu chat gagal tidak menghentikan chat lain di batch yang sama', async () => {
  const rows = [
    { ...dueRow, chatId: 'gagal@c.us' },
    { ...dueRow, chatId: 'lanjut@c.us' },
  ];
  const { calls, scheduler } = harness({ dueRows: rows });
  scheduler.deps.sendMessage = async (companyId, chatId, text) => {
    if (chatId === 'gagal@c.us') throw new Error('WhatsApp down');
    calls.sent.push({ chatId, text });
  };
  const result = await scheduler.tick(MIDDAY);
  assert.equal(result.sent, 1);
  // Chat yang gagal DIHENTIKAN, bukan dilewati untuk dicoba lagi nanti.
  // Mengulang pengiriman yang gagal adalah persis mekanisme yang membuat satu
  // customer menerima pesan sama 20 kali pada 2026-09-14.
  assert.equal(result.stopped, 1);
  assert.deepEqual(calls.sent.map(s => s.chatId), ['lanjut@c.us']);
});

test('scheduler: tick yang tumpang tindih tidak dijalankan dua kali', async () => {
  const { scheduler } = harness({ dueRows: [dueRow] });
  scheduler.running = true;
  assert.equal((await scheduler.tick(MIDDAY)).skipped, 'already_running');
});

// ── Konteks percakapan untuk follow-up ──────────────────────────────────────

test('link checkout yang sudah dikirim terdeteksi', () => {
  const link = 'https://tradersmastermind.myr.id/pl/trading-recovery-plan-checkout';
  assert.equal(checkoutAlreadySent([{ body: `Link checkout: ${link}` }], link), true);
  assert.equal(checkoutAlreadySent([{ body: 'Silakan bayar di https://contoh.id/x' }], ''), true);
  assert.equal(checkoutAlreadySent([{ body: 'Halo kak, ada yang bisa dibantu?' }], link), false);
  // Menyebut "checkout" tanpa link bukan berarti linknya sudah dikirim.
  assert.equal(checkoutAlreadySent([{ body: 'Nanti aku kirim link checkoutnya ya' }], link), false);
});

test('prompt follow-up menyuruh tanya checkout kalau linknya sudah dikirim', () => {
  const prompt = buildFollowUpPrompt({
    dayIndex: 0, attemptInDay: 1, dayCaps: [2, 1], previousSends: [],
    playbookMd: '', recentOutbound: [{ body: 'Checkout di https://contoh.id/x' }],
    checkoutSent: true,
  });
  assert.match(prompt, /Link checkout SUDAH dikirim/);
  assert.match(prompt, /sudah sempat checkout/);
  assert.match(prompt, /JANGAN mengirim ulang link/);
  assert.match(prompt, /Checkout di https:\/\/contoh\.id\/x/, 'isi pesan terakhir ikut dibawa');
});

test('tanpa checkout tertunda, aturan anti-nagging tetap berlaku', () => {
  const prompt = buildFollowUpPrompt({
    dayIndex: 0, attemptInDay: 1, dayCaps: [2], previousSends: [],
    playbookMd: '', recentOutbound: [{ body: 'Halo kak' }], checkoutSent: false,
  });
  assert.ok(!prompt.includes('Link checkout SUDAH dikirim'));
  assert.match(prompt, /masih di sana/, 'larangan basa-basi kosong tetap ada');
});

// ── Percobaan dicatat sebelum dikirim ───────────────────────────────────────

/**
 * Database palsu yang meniru perilaku nyata: recordFollowUpSend menaikkan
 * sentPerDay dan lastSentAt, persis seperti transaksi aslinya.
 */
function fakeFollowUpDb(state) {
  return {
    recorded: [],
    async listFollowUpSends() { return []; },
    async getPlaybookDoc() { return null; },
    async listOutboundRepliesForChat() { return []; },
    async getCompanyConfig() { return null; },
    async stopFollowUpSequence(chatId, companyId, reason) { state.stopReason = reason; },
    async recordFollowUpSend({ dayIndex, attemptInDay, body }) {
      this.recorded.push({ dayIndex, attemptInDay, body });
      state.sentPerDay[dayIndex] = (state.sentPerDay[dayIndex] || 0) + 1;
      state.lastSentAt = new Date();
    },
  };
}

test('percobaan tercatat walau pengiriman melempar SETELAH pesan terkirim', async () => {
  // Ini kegagalan yang benar-benar terjadi di produksi: WhatsApp menerima
  // pesannya, lalu serialisasi hasil di dalam pupPage.evaluate melempar.
  const state = {
    chatId: 'c1@c.us',
    companyId: 'co1',
    sequenceStartedAt: MIDDAY,
    sentPerDay: [],
    dayCaps: [1, 1, 1],
    minGapMinutes: 180,
    sendFromHour: 8,
    sendToHour: 21,
    lastSentAt: null,
  };
  const database = fakeFollowUpDb(state);
  let sendAttempts = 0;

  const scheduler = new FollowUpScheduler({
    database,
    logger: { info() {}, warn() {}, error() {} },
    deps: {
      isHumanHandled: async () => false,
      generate: async () => 'Halo kak, ada yang bisa dibantu?',
      sendMessage: async () => {
        sendAttempts += 1;
        throw new Error('Evaluation failed: r');
      },
    },
  });

  const outcome = await scheduler.processOne(state, MIDDAY);
  assert.equal(outcome.stopped, 'undeliverable', 'rangkaian dihentikan, tidak dijadwalkan ulang');

  assert.equal(sendAttempts, 1, 'pesan dikirim sekali');
  assert.equal(database.recorded.length, 1, 'percobaannya tetap tercatat');
  assert.equal(state.sentPerDay[0], 1, 'plafon hari itu ikut terpakai');

  // Tick berikutnya harus menolak: inilah yang dulu gagal dan membuat pesan
  // yang sama terkirim berulang setiap lima menit.
  const verdict = decide(state, MIDDAY);
  assert.equal(verdict.send, false, 'tick berikutnya tidak boleh mengirim lagi');
  // Alasannya boleh plafon harian atau jarak minimum — keduanya sama-sama
  // menahan. Yang diuji di sini adalah bahwa ada yang menahan sama sekali.
  assert.ok(['day_cap_reached', 'gap_not_elapsed'].includes(verdict.skip), verdict.skip);
});

test('urutan: catat dulu, baru kirim', async () => {
  const order = [];
  const state = {
    chatId: 'c1@c.us', companyId: 'co1', sequenceStartedAt: MIDDAY,
    sentPerDay: [], dayCaps: [1], minGapMinutes: 120,
    sendFromHour: 8, sendToHour: 21, lastSentAt: null,
  };
  const database = fakeFollowUpDb(state);
  const realRecord = database.recordFollowUpSend.bind(database);
  database.recordFollowUpSend = async (...args) => { order.push('catat'); return realRecord(...args); };

  const scheduler = new FollowUpScheduler({
    database,
    logger: { info() {}, warn() {}, error() {} },
    deps: {
      isHumanHandled: async () => false,
      generate: async () => 'pesan',
      sendMessage: async () => { order.push('kirim'); },
    },
  });

  await scheduler.processOne(state, MIDDAY);
  assert.deepEqual(order, ['catat', 'kirim']);
});

test('plafon absolut dihitung dari baris terkirim, bukan dari penghitung state', async () => {
  // Pengaman terhadap kerusakan yang sama terulang: kalau sent_per_day rusak
  // dan kembali kosong, jumlah baris di follow_up_sends tetap benar.
  const state = {
    chatId: 'c1@c.us', companyId: 'co1', sequenceStartedAt: MIDDAY,
    sentPerDay: [], dayCaps: [1, 1, 1], minGapMinutes: 120,
    sendFromHour: 8, sendToHour: 21, lastSentAt: null,
  };
  let stopped = null;
  let generated = 0;
  const scheduler = new FollowUpScheduler({
    database: {
      async countFollowUpSends() { return 3; }, // sudah 3 = total plafon
      async listFollowUpSends() { return []; },
      async getPlaybookDoc() { return null; },
      async listOutboundRepliesForChat() { return []; },
      async getCompanyConfig() { return null; },
      async recordFollowUpSend() { throw new Error('tidak boleh dipanggil'); },
      async stopFollowUpSequence(chatId, companyId, reason) { stopped = reason; },
    },
    logger: { info() {}, warn() {}, error() {} },
    deps: {
      isHumanHandled: async () => false,
      generate: async () => { generated += 1; return 'pesan'; },
      sendMessage: async () => { throw new Error('tidak boleh dipanggil'); },
    },
  });

  const outcome = await scheduler.processOne(state, MIDDAY);
  assert.equal(outcome.stopped, 'exhausted');
  assert.equal(generated, 0, 'tidak perlu memanggil AI kalau sudah mentok plafon');
  assert.equal(stopped, 'exhausted');
});
