'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FollowUpScheduler, decide, withinSendWindow, buildFollowUpPrompt } = require('../src/follow-up');

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
  assert.equal(result.skipped, 1);
  assert.deepEqual(calls.sent.map(s => s.chatId), ['lanjut@c.us']);
});

test('scheduler: tick yang tumpang tindih tidak dijalankan dua kali', async () => {
  const { scheduler } = harness({ dueRows: [dueRow] });
  scheduler.running = true;
  assert.equal((await scheduler.tick(MIDDAY)).skipped, 'already_running');
});
