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

test('buildReport: contoh diberi label CONTOH dan penjelasan periode; laporan asli tidak', () => {
  const base = {
    companyName: 'X', frequency: 'daily', from: new Date('2026-10-08T01:00:00Z'), to: new Date('2026-10-15T01:00:00Z'), tz: TZ,
    stats: { inboundMessages: 3, activeChats: 2, newChats: 1, aiReplies: 2, humanReplies: 0, handoffs: 0, hotLeads: 0 },
  };
  const sample = r.buildReport({ ...base, sample: true });
  assert.match(sample, /^\*CONTOH\* — dikirim manual/);
  assert.match(sample, /\*Laporan Harian — X\*/);
  assert.doesNotMatch(r.buildReport(base), /CONTOH|dikirim manual/);
});

test('template: penanda diganti, format di nilai dinetralkan, dan nilai tidak diganti dua kali', () => {
  const base = {
    companyName: '*{name}*', frequency: 'weekly', from: new Date('2026-10-05T01:00:00Z'), to: new Date('2026-10-12T01:00:00Z'), tz: TZ,
    stats: { inboundMessages: 1234, activeChats: 56, newChats: 7, aiReplies: 900, humanReplies: 30, handoffs: 4, hotLeads: 3 },
    highlights: ['Harga paket'],
  };
  const text = r.buildReport({ ...base, recipientName: '_Hanny_', template: 'Halo {name}! {inbound} pesan, {hot_leads} lead panas di {company}.\n\n{topics}' });
  assert.equal(text.split('\n')[0], 'Halo Hanny! 1.234 pesan, 3 lead panas di {name}.');
  assert.match(text, /– Harga paket/);
});

test('template: {topics} kosong tidak meninggalkan baris kosong berlipat, dan periode sepi memakai pesan kosong', () => {
  const quiet = { inboundMessages: 0, activeChats: 0, newChats: 0, aiReplies: 0, humanReplies: 0, handoffs: 0, hotLeads: 0 };
  const text = r.buildReport({
    companyName: 'X', frequency: 'daily', from: new Date('2026-10-14T01:00:00Z'), to: new Date('2026-10-15T01:00:00Z'), tz: TZ,
    stats: quiet, template: 'A\n\n{topics}\n\nB {stats}',
  });
  assert.equal(text, 'A\n\nB Tidak ada percakapan pada periode ini.');
});

test('template bawaan menghasilkan laporan yang sama seperti sebelum template ada', () => {
  const text = r.buildReport({
    companyName: 'X', frequency: 'daily', from: new Date('2026-10-14T01:00:00Z'), to: new Date('2026-10-15T01:00:00Z'), tz: TZ,
    stats: { inboundMessages: 1, activeChats: 1, newChats: 0, aiReplies: 1, humanReplies: 0, handoffs: 0, hotLeads: 0 }, highlights: ['Harga'],
  });
  assert.equal(text, '*Laporan Harian — X*\n14 Okt 2026 – 15 Okt 2026\n\n• Pesan masuk dari customer: 1\n• Customer yang chat: 1 (0 baru)\n• Dibalas AI: 1\n• Dibalas tim: 0\n• Diambil alih tim: 0\n• Lead panas/closing: 0\n\n*Yang paling banyak dibahas*\n– Harga');
});

test('validateTemplate: menolak kosong, kepanjangan, dan penanda yang tidak dikenal', () => {
  assert.equal(r.validateTemplate('Halo {name}, {inbound} pesan'), null);
  assert.match(r.validateTemplate('   '), /kosong/);
  assert.match(r.validateTemplate('x'.repeat(r.MAX_TEMPLATE_LENGTH + 1)), /terlalu panjang/);
  assert.match(r.validateTemplate('Halo {nama} {Name}'), /\{nama\}, \{Name\}/);
  assert.match(r.validateTemplate('kurung kosong {} ikut ditolak'), /\{\}/);
});

const quietStats = { inboundMessages: 0, activeChats: 0, newChats: 0, aiReplies: 0, humanReplies: 0, handoffs: 0, hotLeads: 0 };
const busyStats = { inboundMessages: 40, activeChats: 9, newChats: 3, aiReplies: 30, humanReplies: 5, handoffs: 1, hotLeads: 2, waiting: 4 };
const NOW = new Date('2026-10-15T10:00:00Z');
const mkChat = (over = {}) => ({
  name: 'Budi', summary: 'Tanya paket 3 bulan.', stage: 'hot', handlingMode: 'human', assigneeName: 'Sari', routingStatus: 'open',
  lastInboundAt: '2026-10-15T06:00:00Z', lastOutboundAt: '2026-10-15T05:00:00Z', nextStep: 'Kirim penawaran', ...over,
});

test('periodWindow: hari ini, kemarin (hari kalender penuh), 7 dan 30 hari di zona company', () => {
  const now = new Date('2026-10-15T10:00:00Z'); // 17.00 WIB
  const day = (w) => [w.from.toISOString(), w.to.toISOString()];
  assert.deepEqual(day(r.periodWindow('today', now, TZ)), ['2026-10-14T17:00:00.000Z', '2026-10-15T10:00:00.000Z']);
  assert.deepEqual(day(r.periodWindow('yesterday', now, TZ)), ['2026-10-13T17:00:00.000Z', '2026-10-14T17:00:00.000Z']);
  assert.deepEqual(day(r.periodWindow('7d', now, TZ)), ['2026-10-08T10:00:00.000Z', '2026-10-15T10:00:00.000Z']);
  assert.deepEqual(day(r.periodWindow('30d', now, TZ)), ['2026-09-15T10:00:00.000Z', '2026-10-15T10:00:00.000Z']);
  assert.deepEqual(r.PERIODS, ['today', 'yesterday', '7d', '30d']);
});

test('periodWindow: lewat tengah malam WIB "hari ini" sudah hari baru', () => {
  const w = r.periodWindow('today', new Date('2026-10-14T18:30:00Z'), TZ); // 01.30 WIB tanggal 15
  assert.equal(w.from.toISOString(), '2026-10-14T17:00:00.000Z');
});

test('laporan bawaan memuat detail chat: isi, status, dan tindakan oleh siapa', () => {
  const text = r.buildReport({
    companyName: 'X', frequency: 'daily', periodName: 'Kemarin', from: new Date('2026-10-13T17:00:00Z'), to: new Date('2026-10-14T17:00:00Z'),
    tz: TZ, stats: busyStats, chats: [mkChat()], now: NOW,
  });
  assert.match(text, /^\*Laporan Kemarin — X\*/);
  assert.match(text, /• Menunggu balasan kita: 4/);
  assert.match(text, /\*Chat yang perlu diperhatikan\*/);
  assert.match(text, /\*1\. Budi\*\nIsi: Tanya paket 3 bulan\.\nStatus: Panas · Customer menunggu balasan 4 jam · Dipegang Sari\nTindakan: Kirim penawaran — \*Sari\*/);
});

test('detail chat: periode sepi tidak menampilkan judul kosong, dan template tanpa {chat_details} tidak memuatnya', () => {
  const quiet = r.buildReport({ companyName: 'X', frequency: 'daily', from: new Date('2026-10-13T17:00:00Z'), to: new Date('2026-10-14T17:00:00Z'), tz: TZ, stats: quietStats, now: NOW });
  assert.doesNotMatch(quiet, /perlu diperhatikan/);
  const own = r.buildReport({ companyName: 'X', frequency: 'daily', from: new Date('2026-10-13T17:00:00Z'), to: new Date('2026-10-14T17:00:00Z'), tz: TZ, stats: busyStats, chats: [mkChat()], now: NOW, template: 'Ringkas {inbound}' });
  assert.equal(own, 'Ringkas 40');
});

test('detail chat: dipotong dari yang paling tidak penting sampai muat di batas pesan WhatsApp', () => {
  const chats = Array.from({ length: 20 }, (_, i) => mkChat({ name: `Customer ${i + 1}`, summary: 'x'.repeat(300) }));
  const text = r.buildReport({
    companyName: 'X', frequency: 'daily', from: new Date('2026-10-13T17:00:00Z'), to: new Date('2026-10-14T17:00:00Z'),
    tz: TZ, stats: busyStats, chats, now: NOW,
  });
  assert.ok(text.length <= 3800, `panjang ${text.length}`);
  assert.match(text, /\*1\. Customer 1\*/);
  assert.doesNotMatch(text, /Customer 20\*/);
});
