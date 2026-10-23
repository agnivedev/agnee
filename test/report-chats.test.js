'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/report-chats');

const NOW = new Date('2026-10-15T10:00:00Z');
const base = { stage: 'warm', handlingMode: 'ai', assigneeName: null, routingStatus: 'open', nextStep: null };

test('customer menunggu dan AI yang memegang: AI yang bergerak, kecuali sudah lama diam', () => {
  const fresh = c.describeChat({ ...base, lastInboundAt: '2026-10-15T09:30:00Z' }, NOW);
  assert.equal(fresh.owner, 'AI');
  assert.equal(fresh.waitingOnUs, true);
  assert.match(fresh.status, /Customer menunggu balasan kurang dari 1 jam · Dipegang AI/);
  const stuck = c.describeChat({ ...base, lastInboundAt: '2026-10-15T06:00:00Z' }, NOW);
  assert.equal(stuck.owner, 'Tim (AI belum membalas)');
});

test('chat yang dipegang agent: tindakan dan penanggung jawabnya agent itu', () => {
  const info = c.describeChat({ ...base, handlingMode: 'human', assigneeName: 'Sari', lastInboundAt: '2026-10-15T09:00:00Z' }, NOW);
  assert.equal(info.owner, 'Sari');
  assert.equal(info.action, 'Balas customer dan tanyakan kebutuhannya');
});

test('giliran customer: tidak ada yang harus membalas; lead panas dialihkan ke tim', () => {
  const warm = c.describeChat({ ...base, lastInboundAt: '2026-10-14T01:00:00Z', lastOutboundAt: '2026-10-14T02:00:00Z' }, NOW);
  assert.equal(warm.waitingOnUs, false);
  assert.match(warm.status, /Menunggu balasan customer/);
  assert.match(warm.action, /^Tunggu balasan/);
  const hot = c.describeChat({ ...base, stage: 'closing', lastInboundAt: '2026-10-14T01:00:00Z', lastOutboundAt: '2026-10-14T02:00:00Z' }, NOW);
  assert.equal(hot.owner, 'Tim (lead panas)');
  assert.equal(hot.action, 'Follow-up untuk closing');
});

test('chat yang sudah selesai tidak butuh tindakan; langkah dari model dipakai bila ada', () => {
  const closed = c.describeChat({ ...base, routingStatus: 'closed', lastInboundAt: '2026-10-15T09:00:00Z' }, NOW);
  assert.equal(closed.action, 'Tidak ada tindakan');
  const withStep = c.describeChat({ ...base, nextStep: 'Kirim katalog', lastInboundAt: '2026-10-15T09:00:00Z' }, NOW);
  assert.equal(withStep.action, 'Kirim katalog');
});

test('formatChat menetralkan tanda format WhatsApp dan memotong ringkasan panjang', () => {
  const text = c.formatChat({ ...base, name: '*Budi_*', summary: `*tebal* ${'a'.repeat(400)}`, lastInboundAt: '2026-10-15T09:00:00Z' }, 0, NOW);
  assert.match(text, /^\*1\. Budi\*\n/);
  assert.doesNotMatch(text.split('\n')[1], /\*/);
  assert.ok(text.split('\n')[1].length <= 'Isi: '.length + 220);
});

test('parseChatDigest: array JSON di dalam pagar kode atau teks lain; sampah menghasilkan peta kosong', () => {
  const ok = c.parseChatDigest('Ini hasilnya:\n```json\n[{"id":1,"summary":"Minta diskon","nextStep":"Kirim penawaran"},{"id":"x"}]\n```');
  assert.deepEqual([...ok.entries()], [[1, { summary: 'Minta diskon', nextStep: 'Kirim penawaran', needsFollowUp: true }]]);
  // Hanya false yang tegas menyembunyikan chat.
  const flagged = c.parseChatDigest('[{"id":1,"summary":"Jasa SEO","nextStep":"-","needsFollowUp":false},{"id":2,"summary":"a","needsFollowUp":"tidak"}]');
  assert.equal(flagged.get(1).needsFollowUp, false);
  assert.equal(flagged.get(2).needsFollowUp, true);
  assert.equal(c.parseChatDigest('bukan json').size, 0);
  assert.equal(c.parseChatDigest('[{rusak').size, 0);
});

test('displayName: nama kontak, kalau tidak ada nomornya', () => {
  assert.equal(c.displayName({ contactName: 'Budi', chatId: '6281@c.us' }), 'Budi');
  assert.equal(c.displayName({ chatId: '6281234@c.us' }), '+6281234');
  assert.equal(c.displayName({ phone: '62899', chatId: '123@lid' }), '+62899');
  assert.equal(c.displayName({ chatId: '148268311020@lid' }), 'Customer WhatsApp (nama & nomor belum terbaca)');
  assert.equal(c.displayName({}), 'Customer');
});

test('displayName: judul lead dipakai bila tak ada nama dan nomor', () => {
  assert.equal(c.displayName({ chatId: '1@lid', leadTitle: 'ALFIAN · Valetax' }), 'ALFIAN · Valetax');
});

test('fallbackSummary: teks, detail lead, lalu jenis media; tak pernah kosong', () => {
  assert.equal(c.fallbackSummary({ messages: [{ fromMe: false, body: 'Halo' }] }), 'Halo');
  assert.equal(c.fallbackSummary({ messages: [], leadDetail: 'Tanya rebate' }), 'Tanya rebate');
  assert.match(c.fallbackSummary({ messages: [], lastInboundType: 'video' }), /video/);
  assert.ok(c.fallbackSummary({ messages: [] }).length > 10);
});

test('AI company mati: chat milik tim sejak awal, bukan "Dipegang AI" / "AI belum membalas"', () => {
  const info = c.describeChat({ ...base, aiEnabled: false, lastInboundAt: '2026-10-12T09:00:00Z' }, NOW);
  assert.equal(info.owner, 'Tim');
  assert.match(info.status, /Dipegang Tim$/);
  assert.equal(c.needsAction({ ...base, stage: 'cold', aiEnabled: false, lastInboundAt: '2026-10-15T09:55:00Z' }, NOW), true);
  // AI hidup dan baru 5 menit: belum urusan tim.
  assert.equal(c.needsAction({ ...base, stage: 'cold', lastInboundAt: '2026-10-15T09:55:00Z' }, NOW), false);
});

test('reconcileWithLive: balasan tim dari HP membuat chat tidak lagi menunggu', () => {
  const chat = { ...base, stage: 'cold', aiEnabled: false, lastInboundAt: '2026-10-12T09:00:00Z', lastOutboundAt: null, messages: [{ fromMe: false, body: 'ada 18 watt?' }] };
  const live = [
    { fromMe: false, timestamp: Date.parse('2026-10-12T09:00:00Z') / 1000, body: 'ada 18 watt?', type: 'chat' },
    { fromMe: true, timestamp: Date.parse('2026-10-12T09:20:00Z') / 1000, body: 'Ada kak, ini katalognya', type: 'chat' },
    { fromMe: false, timestamp: Date.parse('2026-10-12T09:21:00Z') / 1000, body: '', type: 'image' },
  ];
  const after = c.reconcileWithLive(chat, live);
  assert.equal(new Date(after.lastOutboundAt).toISOString(), '2026-10-12T09:20:00.000Z');
  assert.equal(c.describeChat(after, NOW).waitingOnUs, false);
  assert.equal(c.needsAction(after, NOW), false);
  assert.deepEqual(after.messages, [{ fromMe: false, body: 'ada 18 watt?' }, { fromMe: true, body: 'Ada kak, ini katalognya' }]);
  // Customer bicara lagi setelah balasan HP: tetap menunggu.
  const later = c.reconcileWithLive({ ...chat, lastInboundAt: '2026-10-12T10:00:00Z' }, live);
  assert.equal(c.describeChat(later, NOW).waitingOnUs, true);
  // WhatsApp tidak terbaca: chat tidak diubah.
  assert.equal(c.reconcileWithLive(chat, null), chat);
  // Lead panas tetap perlu tindakan walau sudah dibalas.
  assert.equal(c.needsAction({ ...after, stage: 'hot' }, NOW), true);
});
