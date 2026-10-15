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

test('parseHighlights membersihkan butir dan membatasi 5 baris', () => {
  const out = r.parseHighlights('1. Harga paket\n- Cara bayar\n• Jadwal live\nx\n4) Refund\n5. Promo\n6. Lainnya');
  assert.deepEqual(out, ['Harga paket', 'Cara bayar', 'Jadwal live', 'Refund', 'Promo']);
});

test('validateTemplate: menolak kosong, kepanjangan, dan penanda yang tidak dikenal', () => {
  assert.equal(r.validateTemplate('Halo {name}, {inbound} pesan'), null);
  assert.match(r.validateTemplate('   '), /kosong/);
  assert.match(r.validateTemplate('x'.repeat(r.MAX_TEMPLATE_LENGTH + 1)), /terlalu panjang/);
  assert.match(r.validateTemplate('Halo {nama} {Name}'), /\{nama\}, \{Name\}/);
  assert.match(r.validateTemplate('kurung kosong {} ikut ditolak'), /\{\}/);
});

const NOW = new Date('2026-10-15T03:16:00Z'); // Kamis 10.16 WIB
const st = (n, over = {}) => ({ inboundMessages: n, activeChats: Math.floor(n / 2), newChats: Math.floor(n / 4), aiReplies: Math.floor(n / 3), humanReplies: 0, handoffs: 0, hotLeads: 0, ...over });
const overviewOf = (sizes, prevSizes) => r.reportWindows(NOW, TZ).map((w, i) => ({
  key: w.key, label: w.label, versus: w.versus, stats: st(sizes[i]), prev: st(prevSizes[i]),
}));
const BUSY = overviewOf([12, 30, 157, 420], [8, 32, 137, 365]);
const QUIET = overviewOf([0, 0, 0, 0], [0, 0, 0, 0]);
const mkChat = (over = {}) => ({
  name: 'Budi', summary: 'Tanya paket 3 bulan.', stage: 'hot', handlingMode: 'human', assigneeName: 'Sari', routingStatus: 'open',
  lastInboundAt: '2026-10-15T00:00:00Z', lastOutboundAt: '2026-10-14T23:00:00Z', nextStep: 'Kirim penawaran', ...over,
});
const base = { companyName: 'X', frequency: 'daily', tz: TZ, now: NOW };

test('reportWindows: hari ini sampai sekarang, kemarin penuh, 7 dan 30 hari, masing-masing dengan pembanding', () => {
  const iso = (w) => [w.from, w.to, w.prevFrom, w.prevTo].map((d) => d.toISOString());
  const [today, yesterday, week, month] = r.reportWindows(NOW, TZ);
  assert.equal(today.label, 'Hari ini (sampai 10.16)');
  assert.deepEqual(iso(today), ['2026-10-14T17:00:00.000Z', '2026-10-15T03:16:00.000Z', '2026-10-13T17:00:00.000Z', '2026-10-14T03:16:00.000Z']);
  assert.deepEqual(iso(yesterday), ['2026-10-13T17:00:00.000Z', '2026-10-14T17:00:00.000Z', '2026-10-12T17:00:00.000Z', '2026-10-13T17:00:00.000Z']);
  assert.deepEqual(iso(week), ['2026-10-08T03:16:00.000Z', '2026-10-15T03:16:00.000Z', '2026-10-01T03:16:00.000Z', '2026-10-08T03:16:00.000Z']);
  assert.deepEqual(iso(month), ['2026-09-15T03:16:00.000Z', '2026-10-15T03:16:00.000Z', '2026-08-16T03:16:00.000Z', '2026-09-15T03:16:00.000Z']);
});

test('reportWindows: lewat tengah malam WIB "hari ini" sudah hari baru; zona lain dihormati', () => {
  const late = r.reportWindows(new Date('2026-10-14T18:30:00Z'), TZ)[0]; // 01.30 WIB tanggal 15
  assert.equal(late.from.toISOString(), '2026-10-14T17:00:00.000Z');
  assert.equal(late.label, 'Hari ini (sampai 01.30)');
  const wita = r.reportWindows(new Date('2026-10-15T03:16:00Z'), 'Asia/Makassar')[0];
  assert.equal(wita.from.toISOString(), '2026-10-14T16:00:00.000Z');
});

test('deltaLabel: naik, turun, dan sama', () => {
  assert.equal(r.deltaLabel(12, 8), '(+4)');
  assert.equal(r.deltaLabel(30, 32), '(-2)');
  assert.equal(r.deltaLabel(5, 5), '(sama)');
  assert.equal(r.deltaLabel(1234, 0), '(+1.234)');
});

test('laporan bawaan: semua periode dengan selisih, topik, dan waktu pembuatan', () => {
  const text = r.buildReport({ ...base, overview: BUSY, waiting: 59, highlights: ['Harga paket', '*Cara bayar*'] });
  assert.match(text, /^\*Laporan Chat — X\*\nKamis, 15 Okt 2026, 10\.16\n/);
  for (const heading of ['*Hari ini (sampai 10.16)* — dibanding kemarin sampai jam yang sama', '*Kemarin* — dibanding sehari sebelumnya',
    '*7 hari terakhir* — dibanding 7 hari sebelumnya', '*30 hari terakhir* — dibanding 30 hari sebelumnya']) {
    assert.ok(text.includes(heading), heading);
  }
  assert.match(text, /\*Hari ini[^\n]*\n• Pesan masuk dari customer: 12 \(\+4\)/);
  assert.match(text, /\*Kemarin[^\n]*\n• Pesan masuk dari customer: 30 \(-2\)/);
  assert.match(text, /\*7 hari terakhir[^\n]*\n• Pesan masuk dari customer: 157 \(\+20\)/);
  assert.match(text, /\*30 hari terakhir[^\n]*\n• Pesan masuk dari customer: 420 \(\+55\)/);
  assert.match(text, /\*Saat ini\*\n• Menunggu balasan kita: 59 chat/);
  assert.match(text, /– Cara bayar/);
});

test('laporan bawaan: periode tanpa percakapan ditulis apa adanya dan tanpa judul kosong', () => {
  const text = r.buildReport({ ...base, overview: QUIET });
  assert.equal((text.match(/Tidak ada percakapan pada periode ini\./g) || []).length, 4);
  assert.doesNotMatch(text, /Saat ini|Yang paling banyak dibahas|follow-up/);
  // Hari ini sepi tetapi kemarin ramai: bukan "kosong", karena selisihnya penting.
  const mixed = overviewOf([0, 30, 157, 420], [8, 32, 137, 365]);
  const text2 = r.buildReport({ ...base, overview: mixed });
  assert.match(text2, /\*Hari ini[^\n]*\n• Pesan masuk dari customer: 0 \(-8\)/);
});

test('contoh diberi label CONTOH; laporan asli tidak', () => {
  assert.match(r.buildReport({ ...base, overview: BUSY, sample: true }), /^\*CONTOH\* — dikirim manual/);
  assert.doesNotMatch(r.buildReport({ ...base, overview: BUSY }), /CONTOH|dikirim manual/);
});

test('template: penanda diganti, format di nilai dinetralkan, dan nilai tidak diganti dua kali', () => {
  const text = r.buildReport({
    ...base, companyName: '*{name}*', recipientName: '_Hanny_', overview: BUSY, waiting: 3, highlights: ['Harga paket'],
    template: 'Halo {name}! {inbound} pesan, {waiting} menunggu di {company}.\n\n{topics}',
  });
  assert.equal(text.split('\n')[0], 'Halo Hanny! 157 pesan, 3 menunggu di {name}.');
  assert.match(text, /– Harga paket/);
});

test('template: {topics} kosong tidak meninggalkan baris kosong berlipat; {stats} = angka 7 hari', () => {
  const text = r.buildReport({ ...base, overview: QUIET, template: 'A\n\n{topics}\n\nB {stats}' });
  assert.equal(text, 'A\n\nB Tidak ada percakapan pada periode ini.');
  const busy = r.buildReport({ ...base, overview: BUSY, template: '{stats}' });
  assert.match(busy, /^• Pesan masuk dari customer: 157\n/);
});

test('template tanpa {chat_details} tidak memuat chat; {overview} bisa dipakai di template sendiri', () => {
  const own = r.buildReport({ ...base, overview: BUSY, chats: [mkChat()], template: 'Ringkas {inbound}' });
  assert.equal(own, 'Ringkas 157');
  assert.match(r.buildReport({ ...base, overview: BUSY, template: '{overview}' }), /^\*Hari ini \(sampai 10\.16\)\*/);
});

test('detail chat: isi, status, dan tindakan oleh siapa ikut di laporan bawaan, dengan jumlah total di judul', () => {
  const text = r.buildReport({ ...base, overview: BUSY, chats: [mkChat()], followUpTotal: 1 });
  assert.match(text, /\*Chat yang perlu di-follow up\* \(1\)/);
  assert.match(text, /\*1\. Budi\*\nIsi: Tanya paket 3 bulan\.\nStatus: Panas · Customer menunggu balasan 3 jam · Dipegang Sari\nTindakan: Kirim penawaran — \*Sari\*/);
  assert.equal(r.buildReportMessages({ ...base, overview: BUSY, chats: [mkChat()] }).length, 1);
});

test('detail chat: daftar yang tidak muat di satu pesan menjadi pesan berikutnya, penomoran lanjut', () => {
  const chats = Array.from({ length: 20 }, (_, i) => mkChat({ name: `Customer ${i + 1}`, summary: 'x'.repeat(300) }));
  const messages = r.buildReportMessages({ ...base, overview: BUSY, chats, followUpTotal: 20, waiting: 20 });
  assert.ok(messages.length > 1 && messages.length <= 4, `jumlah pesan ${messages.length}`);
  assert.ok(messages.every((m) => m.length <= 3800), 'tiap pesan muat di batas WhatsApp');
  // Pesan pertama = angka lengkap, tanpa daftar chat.
  assert.match(messages[0], /\*30 hari terakhir/);
  assert.doesNotMatch(messages[0], /follow-up/);
  assert.match(messages[1], /^\*Chat yang perlu di-follow up\* \(20\)/);
  assert.match(messages[2], /^\*Chat yang perlu di-follow up\* \(lanjutan\)/);
  const numbers = messages.slice(1).join('\n').match(/^\*(\d+)\. Customer/gm).map((m) => Number(m.match(/\d+/)[0]));
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1), 'nomor berurutan tanpa celah');
  assert.equal(numbers.length, 20, 'semua chat tampil');
});

test('detail chat: dibatasi tiga pesan daftar; sisanya dicatat, bukan dibuang diam-diam', () => {
  const chats = Array.from({ length: 60 }, (_, i) => mkChat({ name: `Customer ${i + 1}`, summary: 'x'.repeat(300) }));
  const messages = r.buildReportMessages({ ...base, overview: BUSY, chats, followUpTotal: 140 });
  assert.equal(messages.length, 4);
  assert.ok(messages.every((m) => m.length <= 3800));
  const shown = messages.slice(1).join('\n').match(/^\*\d+\. Customer/gm).length;
  assert.match(messages.at(-1), new RegExp(`Dan ${140 - shown} chat lain yang juga perlu tindak lanjut`));
});

test('detail chat: tanpa chat atau tanpa {chat_details} hanya satu pesan', () => {
  assert.equal(r.buildReportMessages({ ...base, overview: BUSY }).length, 1);
  assert.equal(r.buildReportMessages({ ...base, overview: BUSY, chats: [mkChat()], template: '{overview}' }).length, 1);
});
