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
  assert.ok(text.split('\n')[1].length <= 'Ringkasan: '.length + 200);
});

test('parseChatDigest: array JSON di dalam pagar kode atau teks lain; sampah menghasilkan peta kosong', () => {
  const ok = c.parseChatDigest('Ini hasilnya:\n```json\n[{"id":1,"summary":"Minta diskon","nextStep":"Kirim penawaran"},{"id":"x"}]\n```');
  assert.deepEqual([...ok.entries()], [[1, { summary: 'Minta diskon', nextStep: 'Kirim penawaran', needsFollowUp: true, flow: [] }]]);
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
  assert.deepEqual(after.messages.map((m) => [m.author, m.body]), [['customer', 'ada 18 watt?'], ['phone', 'Ada kak, ini katalognya']]);
  // Customer bicara lagi setelah balasan HP: tetap menunggu.
  const later = c.reconcileWithLive({ ...chat, lastInboundAt: '2026-10-12T10:00:00Z' }, live);
  assert.equal(c.describeChat(later, NOW).waitingOnUs, true);
  // WhatsApp tidak terbaca: chat tidak diubah.
  assert.equal(c.reconcileWithLive(chat, null), chat);
  // Lead panas tetap perlu tindakan walau sudah dibalas.
  assert.equal(c.needsAction({ ...after, stage: 'hot' }, NOW), true);
});

test('blok chat: alur per giliran dari model, chat terakhir dari siapa disorot, usulan Agnee', () => {
  const chat = {
    ...base, stage: 'cold', aiEnabled: false, name: 'Olivia', summary: 'Butuh lampu 18 watt, sudah approval atasan.',
    lastInboundAt: '2026-10-12T09:30:00Z', lastOutboundAt: '2026-10-12T09:10:00Z', nextStep: 'Kirim pilihan 18 watt merek lain',
    flow: [
      { from: 'Customer', text: 'Konsultasi lampu LED untuk proyek' },
      { from: 'CS', text: 'Tanya kebutuhan watt dan jumlah' },
      { from: 'Customer', text: 'Butuh 18 watt, sudah approval atasan' },
      { from: 'CS', text: 'Ada Philips 18 watt' },
      { from: 'Customer', text: 'Selain Philips ada tidak?' },
    ],
    messages: [{ fromMe: false, author: 'customer', body: 'selain brand philip ada tidak bu ?', at: '2026-10-12T09:30:00Z' }],
  };
  const text = c.formatChat({ ...chat, urgent: true }, 0, NOW);
  assert.equal(text, [
    '*🔴 1. Olivia*',
    'Ringkasan: Butuh lampu 18 watt, sudah approval atasan.',
    'Alur chat:',
    '1. CS: Tanya kebutuhan watt dan jumlah',
    '2. Customer: Butuh 18 watt, sudah approval atasan',
    '3. CS: Ada Philips 18 watt',
    '4. Customer: Selain Philips ada tidak?',
    '👉 *Chat terakhir dari Customer* — belum dibalas 3 hari: "selain brand philip ada tidak bu ?"',
    'Status: Baru · Dipegang Tim',
    '💡 *Usulan Agnee:* Kirim pilihan 18 watt merek lain — *Tim*',
  ].join('\n'));
});

test('blok chat: tanpa alur dari model dipakai pesan apa adanya; CS terakhir bicara; customer terakhir kirim foto', () => {
  const messages = [
    { fromMe: false, author: 'customer', body: 'Harga paket?', at: '2026-10-15T07:00:00Z' },
    { fromMe: true, author: 'ai', body: 'Paket mulai 1 juta', at: '2026-10-15T07:01:00Z' },
    { fromMe: true, author: 'phone', body: 'Saya kirim brosurnya ya kak', at: '2026-10-15T08:00:00Z' },
  ];
  const replied = c.formatChat({ ...base, stage: 'hot', name: 'Budi', summary: 's', lastInboundAt: '2026-10-15T07:00:00Z', lastOutboundAt: '2026-10-15T08:00:00Z', messages }, 0, NOW);
  assert.match(replied, /Alur chat:\n1\. Customer: Harga paket\?\n2\. AI: Paket mulai 1 juta\n3\. CS: Saya kirim brosurnya ya kak\n/);
  assert.match(replied, /👉 \*Chat terakhir dari CS\* \(2 jam lalu\): "Saya kirim brosurnya ya kak" — menunggu balasan customer/);
  const photo = c.formatChat({ ...base, name: 'Sri', summary: 's', lastInboundType: 'image', lastInboundAt: '2026-10-15T09:00:00Z', lastOutboundAt: '2026-10-15T08:00:00Z', messages }, 0, NOW);
  assert.match(photo, /👉 \*Chat terakhir dari Customer\* — belum dibalas 1 jam: \(mengirim foto\)/);
});

test('parseChatDigest: alur dinormalkan (pembicara dikenal, 4 giliran terakhir)', () => {
  const out = c.parseChatDigest(JSON.stringify([{ id: 1, summary: 's', nextStep: 'n', flow: [
    { from: 'customer', text: 'a' }, { from: 'Tim', text: 'b' }, { from: 'Bot?', text: 'x' }, { from: 'AI', text: '' },
    { from: 'CS', text: 'c' }, { from: 'Customer', text: 'd' }, { from: 'CS', text: 'e' },
  ] }]));
  assert.deepEqual(out.get(1).flow, [
    { from: 'CS', text: 'b' }, { from: 'CS', text: 'c' }, { from: 'Customer', text: 'd' }, { from: 'CS', text: 'e' },
  ]);
});
