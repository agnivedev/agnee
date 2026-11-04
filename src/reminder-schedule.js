'use strict';

/**
 * Jadwal pengingat pertanyaan departemen, dihitung dalam JAM KERJA company
 * (sla.js: 09.00–18.00 Senin–Sabtu, zona waktu company), bukan waktu dinding.
 *
 * Kasus 4–5 Nov 2026: pengingat 1/4 dan 2/4 hanya berjarak 10 menit, dan
 * pengingat terakhir masuk grup Management jam 03.38 dini hari. Aturan baru:
 *  - ambang dihitung dalam menit kerja sejak pertanyaan dibuat;
 *  - pengingat hanya dikirim saat jam kerja; yang jatuh tempo di luar jam
 *    kerja menunggu sampai jam kerja berikutnya;
 *  - jarak antar pengingat minimal MIN_GAP menit kerja, jadi pengingat yang
 *    menumpuk (server mati, tengah malam terlewati) tidak keluar beruntun.
 *
 * Murni: tak menyentuh database dan tak membaca jam sistem.
 */

const sla = require('./sla.js');

/** Menit kerja sejak pertanyaan dibuat untuk pengingat 1/4 … 4/4 (terakhir). */
const REMINDER_WORK_MINUTES = [30, 120, 360, 720];

/** Jarak minimum antar dua pengingat, menit kerja. */
const MIN_GAP_WORK_MINUTES = 30;

/** Apakah seluruh menit berikutnya jatuh di jam kerja (pengingat boleh dikirim)? */
function inWorkHours(nowMs, zone) {
  return sla.menitKerja(nowMs, nowMs + 60_000, zone) >= 1;
}

/**
 * Pengingat ke-(reminderCount+1) sudah jatuh tempo dan boleh dikirim sekarang?
 * `reminderCount` = jumlah pengingat yang sudah terkirim (0–3).
 */
function isReminderDue({ createdMs, lastRemindedMs = null, reminderCount, nowMs, zone = 'Asia/Jakarta' }) {
  const target = REMINDER_WORK_MINUTES[reminderCount];
  if (target === undefined || !Number.isFinite(createdMs)) return false;
  if (!inWorkHours(nowMs, zone)) return false;
  if (sla.menitKerja(createdMs, nowMs, zone) < target) return false;
  if (Number.isFinite(lastRemindedMs) && sla.menitKerja(lastRemindedMs, nowMs, zone) < MIN_GAP_WORK_MINUTES) return false;
  return true;
}

module.exports = { REMINDER_WORK_MINUTES, MIN_GAP_WORK_MINUTES, inWorkHours, isReminderDue };
