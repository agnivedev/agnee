'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rs = require('../src/reminder-schedule');
const departmentAsk = require('../src/department-ask');

// WIB = UTC+7. Rabu 4 Nov 2026.
const wib = (day, hh, mm = 0) => Date.UTC(2026, 10, day, hh - 7, mm);
const Z = 'Asia/Jakarta';

test('jadwal pengingat: 30 mnt, 2 jam, 6 jam, 12 jam kerja', () => {
  assert.deepEqual(rs.REMINDER_WORK_MINUTES, [30, 120, 360, 720]);
  assert.deepEqual(departmentAsk.REMINDER_MINUTES, rs.REMINDER_WORK_MINUTES);
});

test('pengingat 1/4 baru jatuh tempo 30 menit kerja setelah pertanyaan, bukan 5 menit', () => {
  const createdMs = wib(4, 10, 0);
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(4, 10, 10), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(4, 10, 30), zone: Z }), true);
});

test('jarak 1/4 -> 2/4 bertingkat: 2/4 menunggu 2 jam kerja sejak pertanyaan', () => {
  const createdMs = wib(4, 10, 0);
  const last = wib(4, 10, 30);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 1, nowMs: wib(4, 10, 40), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 1, nowMs: wib(4, 11, 59), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 1, nowMs: wib(4, 12, 0), zone: Z }), true);
});

test('kasus gypsum: pertanyaan 18.42 (lewat jam kerja) -> pengingat pertama 09.30 esok hari, tidak malam hari', () => {
  const createdMs = wib(4, 18, 42);
  for (const [h, m] of [[18, 48], [20, 43], [23, 0], [3, 38], [8, 59], [9, 29]]) {
    const day = h < 9 ? 5 : (h < 18 ? 5 : 4);
    assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(day, h, m), zone: Z }), false, `${h}:${m} bukan waktunya`);
  }
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(5, 9, 30), zone: Z }), true);
});

test('pengingat terakhir tidak pernah keluar dini hari atau di luar jam kerja', () => {
  const createdMs = wib(3, 10, 0);
  // 720 menit kerja = 8 Nov? Senin-Sabtu 9 jam sehari: tercapai Jumat 5 Nov 10.00 (9 jam Rabu... sejak Selasa 3 Nov)
  const target = rs.REMINDER_WORK_MINUTES[3];
  assert.equal(target, 720);
  for (const h of [0, 3, 5, 8, 18, 19, 23]) {
    assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: wib(3, 12), reminderCount: 3, nowMs: wib(7, h, 38), zone: Z }), false, `jam ${h}`);
  }
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: wib(3, 12), reminderCount: 3, nowMs: wib(7, 10, 0), zone: Z }), true);
});

test('Minggu libur: tidak ada pengingat hari Minggu', () => {
  const createdMs = wib(7, 16, 0); // Sabtu 7 Nov
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(8, 12, 0), zone: Z }), false);
  // Sabtu 16.00-18.00 sudah 120 menit kerja: pengingat pertama menunggu Senin pagi.
  assert.equal(rs.isReminderDue({ createdMs, reminderCount: 0, nowMs: wib(9, 9, 0), zone: Z }), true);
});

test('pengingat tertumpuk tidak keluar beruntun: jarak minimal 30 menit kerja', () => {
  const createdMs = wib(3, 10, 0);
  const last = wib(5, 9, 0);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 2, nowMs: wib(5, 9, 10), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs, lastRemindedMs: last, reminderCount: 2, nowMs: wib(5, 9, 30), zone: Z }), true);
});

test('hitungan ke-5 tak ada (reminderCount 4) dan tanggal rusak tak dianggap jatuh tempo', () => {
  assert.equal(rs.isReminderDue({ createdMs: wib(3, 10), reminderCount: 4, nowMs: wib(9, 10), zone: Z }), false);
  assert.equal(rs.isReminderDue({ createdMs: NaN, reminderCount: 0, nowMs: wib(9, 10), zone: Z }), false);
});

test('pengingat ringkas: kode, nama customer, satu cuplikan; bukan seluruh pertanyaan', () => {
  const question = 'Customer pesan 4 lembar gypsum anti air untuk dikirim ke Griya Serpong Asri. '.repeat(6);
  const text = departmentAsk.buildReminderNotice({ department: 'Management', question, customerLabel: 'Suyato (+6281318140229)', reminderCount: 2, final: false, code: '99669a', group: true });
  assert.match(text, /Pengingat 2\/4/);
  assert.match(text, /Suyato \(\+6281318140229\) · #99669a/);
  assert.ok(text.length < 330, `terlalu panjang: ${text.length}`);
  assert.ok(!text.includes('Griya Serpong Asri. Customer pesan 4 lembar gypsum anti air untuk dikirim ke Griya Serpong Asri. Customer'), 'tidak mengulang pertanyaan penuh');
  assert.match(text, /…"/);
  assert.equal(text.split('\n').length, 4);
});

test('pengingat terakhir menyebut 12 jam kerja', () => {
  const text = departmentAsk.buildReminderNotice({ department: 'Management', question: 'q', customerLabel: '+62', reminderCount: 4, final: true, code: 'abc123', dm: true });
  assert.match(text, /12 jam kerja/);
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
      if (/UPDATE department_questions/.test(sql)) {
        updates.push(params);
        return { rows: [{ id: params[0], companyId: 'c', departmentId: null, thirdPartyId: null, chatId: 'x', question: 'q', reminderCount: params[1] + 1, final: false }] };
      }
      return { rows: [] };
    },
  };
  const fake = { enabled: true, pool };
  // Tidak ada anggota/departemen: jalur anggota akan memanggil query lain (rows kosong) tanpa error.
  const rows = await Database.prototype.claimDueDepartmentReminders.call(fake, wib(5, 9, 35));
  assert.deepEqual(updates, [['a', 0]], 'hanya pertanyaan 35 menit kerja yang diklaim, dengan hitungan lama sebagai pagar');
  assert.equal(rows.length, 1);
  const none = await Database.prototype.claimDueDepartmentReminders.call(fake, wib(5, 3, 38));
  assert.equal(none.length, 0, 'dini hari tak ada pengingat');
});
