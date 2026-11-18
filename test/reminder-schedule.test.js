'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rs = require('../src/reminder-schedule');
const departmentAsk = require('../src/department-ask');

// WIB = UTC+7. Rabu 4 Nov 2026.
const wib = (day, hh, mm = 0) => Date.UTC(2026, 10, day, hh - 7, mm);
const Z = 'Asia/Jakarta';

test('jadwal pengingat: dua kali saja, 2 jam dan 8 jam jam-buka', () => {
  assert.deepEqual(rs.REMINDER_WORK_MINUTES, [120, 480]);
  assert.equal(rs.FINAL_HOURS, 8);
  assert.deepEqual(departmentAsk.REMINDER_MINUTES, rs.REMINDER_WORK_MINUTES);
});

test('pengingat 1/2 baru jatuh tempo 2 jam kerja setelah pertanyaan', () => {
  const createdMs = wib(4, 10, 0);
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(4, 10, 30), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(4, 11, 59), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(4, 12, 0), zone: Z }), true);
});

test('pengingat 2/2 (terakhir) jatuh tempo 8 jam kerja sejak pertanyaan', () => {
  const createdMs = wib(4, 9, 0);
  const last = wib(4, 11, 0);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 1, nowMs: wib(4, 16, 59), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 1, nowMs: wib(4, 17, 0), zone: Z }), true);
});

test('kasus gypsum: pertanyaan 18.42 (lewat jam kerja) -> pengingat pertama 11.00 esok hari, tidak malam hari', () => {
  const createdMs = wib(4, 18, 42);
  for (const [h, m] of [[18, 48], [20, 43], [23, 0], [3, 38], [8, 59], [10, 59]]) {
    const day = h < 9 ? 5 : (h < 18 ? 5 : 4);
    assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(day, h, m), zone: Z }), false, `${h}:${m} bukan waktunya`);
  }
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(5, 11, 0), zone: Z }), true);
});

test('pengingat terakhir tidak pernah keluar dini hari atau di luar jam kerja', () => {
  const createdMs = wib(3, 10, 0);
  assert.equal(rs.REMINDER_WORK_MINUTES[1], 480);
  for (const h of [0, 3, 5, 8, 18, 19, 23]) {
    assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: wib(3, 12), reminderCount: 1, nowMs: wib(9, h, 38), zone: Z }), false, `jam ${h}`);
  }
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: wib(3, 12), reminderCount: 1, nowMs: wib(9, 10, 0), zone: Z }), true);
});

test('Minggu libur: tidak ada pengingat hari Minggu', () => {
  const createdMs = wib(7, 16, 0); // Sabtu 7 Nov
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(8, 12, 0), zone: Z }), false);
  // Sabtu 16.00-18.00 baru 120 menit kerja tepat 18.00 (tutup): pengingat pertama menunggu Senin pagi.
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(9, 11, 0), zone: Z }), true);
});

test('pengingat tertumpuk tidak keluar beruntun: jarak minimal 30 menit kerja', () => {
  const createdMs = wib(3, 10, 0);
  const last = wib(5, 9, 0);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 1, nowMs: wib(5, 9, 10), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 1, nowMs: wib(5, 17, 0), zone: Z }), true);
});

test('hitungan ke-3 tak ada (reminderCount 2) dan tanggal rusak tak dianggap jatuh tempo', () => {
  assert.equal(rs.isReminderDue({ createdMs: wib(3, 10), reminderCount: 2, nowMs: wib(9, 10), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs: NaN, reminderCount: 0, nowMs: wib(9, 10), zone: Z }), false);
});

test('pengingat ringkas: kode, nama customer, satu cuplikan; bukan seluruh pertanyaan', () => {
  const question = 'Customer pesan 4 lembar gypsum anti air untuk dikirim ke Griya Serpong Asri. '.repeat(6);
  const text = departmentAsk.buildReminderNotice({ department: 'Management', question, customerLabel: 'Suyato (+6281318140229)', reminderCount: 1, final: false, code: '99669a', group: true });
  assert.match(text, /Pengingat 1\/2/);
  assert.match(text, /Suyato \(\+6281318140229\) · #99669a/);
  assert.ok(text.length < 330, `terlalu panjang: ${text.length}`);
  assert.ok(!text.includes('Griya Serpong Asri. Customer pesan 4 lembar gypsum anti air untuk dikirim ke Griya Serpong Asri. Customer'), 'tidak mengulang pertanyaan penuh');
  assert.match(text, /…"/);
  assert.equal(text.split('\n').length, 4);
});

test('pengingat terakhir menyebut 8 jam buka', () => {
  const text = departmentAsk.buildReminderNotice({ department: 'Management', question: 'q', customerLabel: '+62', reminderCount: 2, final: true, code: 'abc123', dm: true });
  assert.match(text, /8 jam buka/);
  assert.match(text, /#abc123/);
});

test('pertanyaan berbeda di chat yang sama tidak dianggap sama; pengulangan model dianggap sama', () => {
  const gypsum = 'Customer pesan 4 lembar gypsum anti air untuk dikirim ke Griya Serpong Asri. Mohon konfirmasi ketersediaan dan harga per lembar.';
  assert.equal(departmentAsk.sameQuestion(gypsum, 'Mohon konfirmasi ketersediaan dan harga per lembar gypsum anti air 4 lembar untuk Griya Serpong Asri.'), true);
  assert.equal(departmentAsk.sameQuestion(gypsum, 'Customer menanyakan apakah toko menjual cat Mowilex dan berapa harganya.'), false);
});

test('claimDueDepartmentReminders: hanya yang jatuh tempo menurut jam kerja yang diklaim, dengan klaim atomik', async () => {
  const Database = require('../src/database');
  const updates = [];
  const pool = {
    async query(sql, params) {
      if (/FROM department_questions q JOIN companies/.test(sql)) {
        return { rows: [
          { id: 'a', reminderCount: 0, createdAt: new Date(wib(5, 9, 0)), lastRemindedAt: null, timezone: Z },
          { id: 'b', reminderCount: 0, createdAt: new Date(wib(5, 9, 40)), lastRemindedAt: null, timezone: Z },
        ] };
      }
      if (/UPDATE department_questions q/.test(sql)) {
        updates.push(params);
        return { rows: [{ id: params[0], companyId: 'c', departmentId: null, thirdPartyId: null, chatId: 'x', question: 'q', reminderCount: params[1] + 1, final: false }] };
      }
      return { rows: [] };
    },
  };
  const fake = { enabled: true, pool };
  // Tidak ada anggota/departemen: jalur anggota akan memanggil query lain (rows kosong) tanpa error.
  const rows = await Database.prototype.claimDueDepartmentReminders.call(fake, wib(5, 11, 5));
  assert.deepEqual(updates, [['a', 0, 2]], 'hanya pertanyaan 125 menit kerja yang diklaim, dengan hitungan lama sebagai pagar');
  assert.equal(rows.length, 1);
  const none = await Database.prototype.claimDueDepartmentReminders.call(fake, wib(5, 3, 38));
  assert.equal(none.length, 0, 'dini hari tak ada pengingat');
});

test('jam buka lokasi dipakai: toko buka 08-20 tidak mengirim pengingat setelah tutup', () => {
  const schedule = { days: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { state: 'open', ranges: [['08:00', '20:00']] }]).concat([['sun', { state: 'closed', ranges: [] }]])) };
  const windows = rs.windowsFromSchedules([schedule, null]);
  const createdMs = wib(4, 18, 42);
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(4, 19, 59), zone: Z, windows }), false);
  // 78 menit buka tersisa malam itu (18.42-20.00); sisa 42 menit jatuh pukul 08.42 esok hari.
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(4, 20, 30), zone: Z, windows }), false);
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(5, 8, 30), zone: Z, windows }), false);
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(5, 8, 45), zone: Z, windows }), true);
  assert.equal(rs.inWorkHours(wib(4, 7, 59), Z, windows), false);
  assert.equal(rs.inWorkHours(wib(4, 8, 0), Z, windows), true);
  assert.equal(rs.inWorkHours(wib(8, 12, 0), Z, windows), false, 'Minggu tutup');
});

test('jadwal lokasi digabung: dua lokasi, rentang lewat tengah malam, dan tanpa jadwal -> jam kerja SLA', () => {
  const night = { days: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { state: 'open', ranges: [['18:00', '02:00']] }])) };
  const w = rs.windowsFromSchedules([night]);
  assert.equal(rs.inWorkHours(wib(4, 1, 0), Z, w), true);
  assert.equal(rs.inWorkHours(wib(4, 12, 0), Z, w), false);
  assert.equal(rs.inWorkHours(wib(4, 12, 0), Z, rs.windowsFromSchedules([])), true);
  assert.equal(rs.inWorkHours(wib(4, 20, 0), Z, rs.windowsFromSchedules([])), false);
});

test('nomor HP tak terbaca: label memuat nomor yang ditulis customer (berlabel), tanpa id lid dan tanpa mengarang', () => {
  const handoff = require('../src/handoff-notice');
  const texts = ['Siap', 'Nama : Suyato Kenzie Jundi\nAlamat kirim : Perumahan Griya\nHp : 0813 1814 0229'];
  const chatNumber = handoff.phoneInTexts(texts);
  assert.equal(chatNumber, '0813 1814 0229');
  const label = handoff.describeCustomer({ chatId: '56702326050881@lid', name: 'Suyato', phone: null, chatNumber });
  assert.equal(label, 'Suyato (nomor HP belum terbaca · nomor di chat: 0813 1814 0229)');
  assert.equal(handoff.describeCustomer({ chatId: '56702326050881@lid', name: 'Suyato', phone: null }), 'Suyato (nomor HP belum terbaca)');
  assert.equal(handoff.describeCustomer({ chatId: '56702326050881@lid', name: 'Suyato', phone: '6281318140229' }), 'Suyato (+6281318140229)');
  assert.equal(handoff.phoneInTexts(['harga 147.500 untuk 4 lembar', 'tanggal 20261104']), null);
});
