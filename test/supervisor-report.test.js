'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/supervisor-report');

const TZ = 'Asia/Jakarta';
// Kamis 15 Okt 2026 10:00 WIB
const THURSDAY_10 = new Date('2026-10-15T03:00:00Z');

test('jadwal terbaru: harian, mingguan (Senin), bulanan (tanggal 1) pukul 08.00 WIB', () => {
  assert.equal(r.latestSlot('daily', THURSDAY_10, TZ).toISOString(), '2026-10-15T01:00:00.000Z');
  assert.equal(r.latestSlot('weekly', THURSDAY_10, TZ).toISOString(), '2026-10-12T01:00:00.000Z');
  assert.equal(r.latestSlot('monthly', THURSDAY_10, TZ).toISOString(), '2026-10-01T01:00:00.000Z');
});

test('sebelum jam 08.00 jadwal terbaru adalah yang kemarin', () => {
  const early = new Date('2026-10-15T00:30:00Z'); // 07:30 WIB
  assert.equal(r.latestSlot('daily', early, TZ).toISOString(), '2026-10-14T01:00:00.000Z');
});

test('periode = jadwal sebelumnya sampai jadwal ini', () => {
  const slot = r.latestSlot('monthly', THURSDAY_10, TZ);
  assert.equal(r.previousSlot('monthly', slot, TZ).toISOString(), '2026-09-01T01:00:00.000Z');
  const week = r.latestSlot('weekly', THURSDAY_10, TZ);
  assert.equal(r.previousSlot('weekly', week, TZ).toISOString(), '2026-10-05T01:00:00.000Z');
});

test('awal tahun: bulanan mundur ke Desember tahun lalu', () => {
  const now = new Date('2027-01-03T03:00:00Z');
  const slot = r.latestSlot('monthly', now, TZ);
  assert.equal(slot.toISOString(), '2027-01-01T01:00:00.000Z');
  assert.equal(r.previousSlot('monthly', slot, TZ).toISOString(), '2026-12-01T01:00:00.000Z');
});

test('zona waktu lain dihormati (Makassar WITA = UTC+8)', () => {
  assert.equal(r.latestSlot('daily', THURSDAY_10, 'Asia/Makassar').toISOString(), '2026-10-15T00:00:00.000Z');
});

test('dueWindow: belum dikirim -> jatuh tempo; sudah dikirim pada jadwal ini -> tidak', () => {
  const base = { frequency: 'daily', whatsappNumber: '0812', enabledAt: '2026-10-10T00:00:00Z', lastSentAt: null };
  const due = r.dueWindow(base, THURSDAY_10, TZ);
  assert.equal(due.to.toISOString(), '2026-10-15T01:00:00.000Z');
  assert.equal(due.from.toISOString(), '2026-10-14T01:00:00.000Z');
  assert.equal(r.dueWindow({ ...base, lastSentAt: '2026-10-15T01:05:00Z' }, THURSDAY_10, TZ), null);
});

test('dueWindow: jadwal sebelum laporan diaktifkan tidak dikejar', () => {
  const row = { frequency: 'daily', whatsappNumber: '0812', enabledAt: '2026-10-15T02:00:00Z', lastSentAt: null };
  assert.equal(r.dueWindow(row, THURSDAY_10, TZ), null);
});

test('dueWindow: mati, tanpa nomor, atau frekuensi asing -> tidak dikirim', () => {
  const row = { frequency: 'daily', whatsappNumber: '0812', enabledAt: '2026-10-01T00:00:00Z' };
  assert.equal(r.dueWindow({ ...row, frequency: 'off' }, THURSDAY_10, TZ), null);
  assert.equal(r.dueWindow({ ...row, whatsappNumber: null }, THURSDAY_10, TZ), null);
  assert.equal(r.dueWindow({ ...row, frequency: 'hourly' }, THURSDAY_10, TZ), null);
});

test('dueWindow: server mati melewati jam 08.00 tetap mengirim jadwal itu setelah hidup', () => {
  const row = { frequency: 'weekly', whatsappNumber: '0812', enabledAt: '2026-09-01T00:00:00Z', lastSentAt: '2026-10-05T01:10:00Z' };
  const window = r.dueWindow(row, new Date('2026-10-14T05:00:00Z'), TZ); // Rabu, Senin terlewat
  assert.equal(window.to.toISOString(), '2026-10-12T01:00:00.000Z');
});

test('buildReport: angka, topik, dan tanda format nama company dinetralkan', () => {
  const text = r.buildReport({
    companyName: '*Toko* _X_', frequency: 'weekly',
    from: new Date('2026-10-05T01:00:00Z'), to: new Date('2026-10-12T01:00:00Z'), tz: TZ,
    stats: { inboundMessages: 1234, activeChats: 56, newChats: 7, aiReplies: 900, humanReplies: 30, handoffs: 4, hotLeads: 3 },
    highlights: ['Harga paket', '*Cara bayar*'],
  });
  assert.match(text, /Laporan Mingguan — Toko X/);
  assert.match(text, /Pesan masuk dari customer: 1\.234/);
  assert.match(text, /Customer yang chat: 56 \(7 baru\)/);
  assert.match(text, /– Cara bayar/);
});

test('buildReport: periode sepi ditulis apa adanya', () => {
  const text = r.buildReport({
    companyName: 'X', frequency: 'daily', from: new Date('2026-10-14T01:00:00Z'), to: new Date('2026-10-15T01:00:00Z'), tz: TZ,
    stats: { inboundMessages: 0, activeChats: 0, newChats: 0, aiReplies: 0, humanReplies: 0, handoffs: 0, hotLeads: 0 },
  });
  assert.match(text, /Tidak ada percakapan/);
});

test('parseHighlights membersihkan butir dan membatasi 5 baris', () => {
  const out = r.parseHighlights('1. Harga paket\n- Cara bayar\n• Jadwal live\nx\n4) Refund\n5. Promo\n6. Lainnya');
  assert.deepEqual(out, ['Harga paket', 'Cara bayar', 'Jadwal live', 'Refund', 'Promo']);
});
