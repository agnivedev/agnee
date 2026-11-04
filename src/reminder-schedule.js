'use strict';

/**
 * Jadwal pengingat pertanyaan departemen, dihitung dalam JAM BUKA company
 * (Pengaturan > Lokasi: gabungan jam buka semua lokasi yang punya jadwal
 * terstruktur), bukan waktu dinding. Bila tak ada lokasi berjadwal, jatuh ke
 * jam kerja SLA (09.00–18.00 Senin–Sabtu).
 *
 * Kasus 4–5 Nov 2026: pengingat 1/4 dan 2/4 hanya berjarak 10 menit, dan
 * pengingat terakhir masuk grup Management jam 03.38 dini hari. Aturan baru:
 *  - ambang dihitung dalam menit jam-buka sejak pertanyaan dibuat;
 *  - pengingat hanya dikirim saat jam buka; yang jatuh tempo di luar jam buka
 *    menunggu sampai jam buka berikutnya;
 *  - jarak antar pengingat minimal MIN_GAP menit, jadi pengingat yang
 *    menumpuk tidak keluar beruntun; jeda ke-3 dan ke-4 sengaja lama.
 *
 * Murni: tak menyentuh database dan tak membaca jam sistem.
 */

const sla = require('./sla.js');
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Menit jam-buka sejak pertanyaan dibuat untuk pengingat 1/4 … 4/4 (terakhir). */
const REMINDER_WORK_MINUTES = [30, 120, 480, 1080];
/** Teks "N jam" untuk pengingat terakhir. */
const FINAL_HOURS = REMINDER_WORK_MINUTES[REMINDER_WORK_MINUTES.length - 1] / 60;

/** Jarak minimum antar dua pengingat, menit. */
const MIN_GAP_WORK_MINUTES = 30;

const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Jendela default: jam kerja SLA. Indeks 0 = Senin … 6 = Minggu. */
function defaultWindows() {
  return DAYS.map((_, i) => (sla.JAM_KERJA.hari.includes((i + 1) % 7)
    ? [[sla.JAM_KERJA.mulai * 60, sla.JAM_KERJA.selesai * 60]] : []));
}

/**
 * Gabungan jam buka dari jadwal-jadwal lokasi (`openingSchedule` tiap lokasi)
 * menjadi jendela per hari. Rentang lewat tengah malam dipecah ke hari
 * berikutnya. Tak ada jadwal terstruktur sama sekali -> jam kerja SLA.
 */
function windowsFromSchedules(schedules) {
  const valid = (schedules || []).filter((x) => x && x.days);
  if (!valid.length) return defaultWindows();
  const per = DAYS.map(() => []);
  for (const schedule of valid) {
    DAYS.forEach((day, i) => {
      const entry = schedule.days[day];
      if (!entry) return;
      if (entry.state === '24h') per[i].push([0, 1440]);
      else if (entry.state === 'open') {
        for (const [from, to] of entry.ranges || []) {
          const a = toMin(from); const b = toMin(to);
          if (b > a) per[i].push([a, b]);
          else { per[i].push([a, 1440]); per[(i + 1) % 7].push([0, b]); }
        }
      }
    });
  }
  return per.map((ranges) => {
    const sorted = ranges.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
    }
    return merged;
  });
}

/** Menit jam-buka yang lewat antara dua titik waktu. */
function workMinutes(startMs, endMs, zone, windows) {
  if (!(endMs > startMs)) return 0;
  let total = 0;
  let day = sla.tanggalLokal(startMs, zone);
  const last = sla.tanggalLokal(endMs, zone);
  for (let i = 0; i < 400; i += 1) {
    const idx = (sla.hariPekan(day) + 6) % 7; // 0 = Senin
    for (const [a, b] of windows[idx] || []) {
      const from = Math.max(sla.instanUntukLokal(day, Math.floor(a / 60), a % 60, zone), startMs);
      const to = Math.min(sla.instanUntukLokal(day, Math.floor(b / 60), b % 60, zone), endMs);
      if (to > from) total += (to - from) / 60_000;
    }
    if (day.tahun === last.tahun && day.bulan === last.bulan && day.tanggal === last.tanggal) break;
    day = sla.besok(day);
  }
  return Math.floor(total);
}

/** Apakah seluruh menit berikutnya jatuh di jam buka (pengingat boleh dikirim)? */
function inWorkHours(nowMs, zone, windows = defaultWindows()) {
  return workMinutes(nowMs, nowMs + 60_000, zone, windows) >= 1;
}

/**
 * Pengingat ke-(reminderCount+1) sudah jatuh tempo dan boleh dikirim sekarang?
 * `reminderCount` = jumlah pengingat yang sudah terkirim (0–3).
 */
function isReminderDue({ createdMs, lastRemindedMs = null, reminderCount, nowMs, zone = 'Asia/Jakarta', windows = defaultWindows() }) {
  const target = REMINDER_WORK_MINUTES[reminderCount];
  if (target === undefined || !Number.isFinite(createdMs)) return false;
  if (!inWorkHours(nowMs, zone, windows)) return false;
  if (workMinutes(createdMs, nowMs, zone, windows) < target) return false;
  if (Number.isFinite(lastRemindedMs) && workMinutes(lastRemindedMs, nowMs, zone, windows) < MIN_GAP_WORK_MINUTES) return false;
  return true;
}

module.exports = { REMINDER_WORK_MINUTES, FINAL_HOURS, MIN_GAP_WORK_MINUTES, defaultWindows, windowsFromSchedules, workMinutes, inWorkHours, isReminderDue };
