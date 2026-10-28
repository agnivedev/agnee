'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const oh = require('../src/opening-hours.js');

const day = (state, ...ranges) => ({ state, ranges });
const week = (overrides = {}) => ({
  days: {
    mon: day('open', ['08:00', '17:00']), tue: day('open', ['08:00', '17:00']), wed: day('open', ['08:00', '17:00']),
    thu: day('open', ['08:00', '17:00']), fri: day('open', ['08:00', '17:00']), sat: day('open', ['08:00', '12:00']),
    sun: day('closed'), ...overrides,
  },
});
// Senin 2026-10-26 sampai Minggu 2026-11-01; Jakarta = UTC+7.
const jakarta = (isoLocal) => new Date(`${isoLocal}+07:00`);

test('ringkasan: hari berurutan yang sama digabung, tutup disebut', () => {
  assert.equal(oh.summarize(week()), 'Senin–Jumat 08.00–17.00; Sabtu 08.00–12.00; Minggu tutup');
  assert.equal(oh.summarize(week({ sat: day('24h') })), 'Senin–Jumat 08.00–17.00; Sabtu 24 jam; Minggu tutup');
  assert.equal(oh.summarize(week({ mon: day('open', ['08:00', '12:00'], ['13:00', '17:00']) })),
    'Senin 08.00–12.00 dan 13.00–17.00; Selasa–Jumat 08.00–17.00; Sabtu 08.00–12.00; Minggu tutup');
});

test('ringkasan: sepanjang pekan sama', () => {
  const all = (d) => ({ days: Object.fromEntries(oh.DAYS.map((k) => [k, d])) });
  assert.equal(oh.summarize(all(day('24h'))), 'Buka 24 jam setiap hari');
  assert.equal(oh.summarize(all(day('open', ['09:00', '21:00']))), 'Setiap hari 09.00–21.00');
  assert.equal(oh.summarize(all(day('closed'))), 'Tutup setiap hari');
});

test('compose: ringkasan lalu catatan, atau catatan saja bila tanpa jadwal', () => {
  assert.equal(oh.compose(week(), 'Tutup tanggal merah'), 'Senin–Jumat 08.00–17.00; Sabtu 08.00–12.00; Minggu tutup. Tutup tanggal merah');
  assert.equal(oh.compose(null, 'Sen–Sab 08.00–17.00'), 'Sen–Sab 08.00–17.00');
  assert.equal(oh.compose(null, ''), '');
});

test('normalizeSchedule: bentuk benar diterima dan dirapikan, yang salah ditolak dengan alasan', () => {
  const ok = oh.normalizeSchedule({ days: { ...week().days, mon: { state: 'closed', ranges: [['01:00', '02:00']] }, tue: { state: 'open', ranges: [['13:00', '17:00'], ['08:00', '12:00']] } } });
  assert.deepEqual(ok.schedule.days.mon, { state: 'closed', ranges: [] }, 'tutup membuang rentang');
  assert.deepEqual(ok.schedule.days.tue.ranges, [['08:00', '12:00'], ['13:00', '17:00']], 'rentang diurutkan');

  const bad = (days, pattern) => assert.match(oh.normalizeSchedule({ days }).error, pattern);
  assert.match(oh.normalizeSchedule(null).error, /tidak valid/);
  const { sun, ...tanpaMinggu } = week().days;
  bad(tanpaMinggu, /Minggu belum lengkap/);
  bad({ ...week().days, mon: { state: 'libur' } }, /Senin tidak dikenal/);
  bad({ ...week().days, mon: { state: 'open', ranges: [] } }, /satu atau dua rentang/);
  bad({ ...week().days, mon: { state: 'open', ranges: [['8:00', '17:00']] } }, /berformat/);
  bad({ ...week().days, mon: { state: 'open', ranges: [['25:00', '17:00']] } }, /berformat/);
  bad({ ...week().days, mon: { state: 'open', ranges: [['08:00', '08:00']] } }, /tidak boleh sama/);
  bad({ ...week().days, mon: { state: 'open', ranges: [['08:00', '12:00'], ['11:00', '17:00']] } }, /tumpang tindih/);
  bad({ ...week().days, mon: { state: 'open', ranges: [['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00']] } }, /satu atau dua rentang/);
});

test('status sekarang memakai zona waktu company', () => {
  const s = week();
  assert.equal(oh.statusLine(s, jakarta('2026-10-26T10:00:00'), 'Asia/Jakarta'), 'buka, tutup pukul 17.00');
  assert.equal(oh.statusLine(s, jakarta('2026-10-26T17:00:00'), 'Asia/Jakarta'), 'tutup, buka lagi Selasa pukul 08.00');
  assert.equal(oh.statusLine(s, jakarta('2026-10-26T06:00:00'), 'Asia/Jakarta'), 'tutup, buka lagi hari ini pukul 08.00');
  // Jumat malam -> Sabtu; Sabtu sore -> Minggu tutup -> Senin.
  assert.equal(oh.statusLine(s, jakarta('2026-10-30T20:00:00'), 'Asia/Jakarta'), 'tutup, buka lagi Sabtu pukul 08.00');
  assert.equal(oh.statusLine(s, jakarta('2026-10-31T13:00:00'), 'Asia/Jakarta'), 'tutup, buka lagi Senin pukul 08.00');
  assert.equal(oh.statusLine(s, jakarta('2026-11-01T10:00:00'), 'Asia/Jakarta'), 'tutup, buka lagi Senin pukul 08.00');
  // Instan yang sama, zona lain: 10.00 WIB = 11.00 WITA, tetap buka; 17.30 WIB = 18.30 WITA tutup.
  assert.equal(oh.statusLine(s, jakarta('2026-10-26T16:30:00'), 'Asia/Makassar'), 'tutup, buka lagi Selasa pukul 08.00');
  assert.equal(oh.statusLine(s, jakarta('2026-10-26T16:30:00'), 'Asia/Jakarta'), 'buka, tutup pukul 17.00');
});

test('status: 24 jam, dan rentang lewat tengah malam ikut hari sebelumnya', () => {
  const cafe = week({ fri: day('open', ['18:00', '02:00']), sat: day('open', ['18:00', '02:00']), sun: day('24h') });
  assert.equal(oh.statusLine(cafe, jakarta('2026-10-30T23:00:00'), 'Asia/Jakarta'), 'buka, tutup pukul 02.00');
  assert.equal(oh.statusLine(cafe, jakarta('2026-10-31T01:00:00'), 'Asia/Jakarta'), 'buka, tutup pukul 02.00', 'Sabtu 01.00 masih rentang Jumat');
  assert.equal(oh.statusLine(cafe, jakarta('2026-10-31T10:00:00'), 'Asia/Jakarta'), 'tutup, buka lagi hari ini pukul 18.00');
  assert.equal(oh.statusLine(cafe, jakarta('2026-11-01T12:00:00'), 'Asia/Jakarta'), 'buka 24 jam');
  // Minggu 24 jam berakhir tepat 00.00: Senin 01.00 belum buka (Senin mulai 08.00).
  assert.equal(oh.statusLine(cafe, jakarta('2026-10-26T01:00:00'), 'Asia/Jakarta'), 'tutup, buka lagi hari ini pukul 08.00');
});
