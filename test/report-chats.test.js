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
  assert.deepEqual([...ok.entries()], [[1, { summary: 'Minta diskon', nextStep: 'Kirim penawaran' }]]);
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
