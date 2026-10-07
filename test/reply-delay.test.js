'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReplyPacer, normalizeSettings, pickDelayMs, DEFAULTS } = require('../src/reply-delay');

const RANGE = { minMs: 5000, maxMs: 60000 };

test('setelan kosong tetap memakai jeda bawaan, bukan menghilangkannya', () => {
  for (const raw of [null, undefined, {}]) {
    assert.deepEqual(normalizeSettings(raw), { enabled: true, minMs: 5000, maxMs: 60000 });
  }
  assert.equal(DEFAULTS.minSeconds, 5);
  assert.equal(DEFAULTS.maxSeconds, 60);
});

test('jeda hanya mati kalau memang dimatikan', () => {
  assert.equal(normalizeSettings({ replyDelayEnabled: false }).enabled, false);
  assert.equal(normalizeSettings({ replyDelayEnabled: true }).enabled, true);
  // NULL dari database bukan "mati".
  assert.equal(normalizeSettings({ replyDelayEnabled: null }).enabled, true);
});

test('rentang dijepit dan batas atas tidak pernah di bawah batas bawah', () => {
  assert.deepEqual(normalizeSettings({ replyDelayMinSeconds: 999, replyDelayMaxSeconds: 1 }),
    { enabled: true, minMs: 120000, maxMs: 120000 });
  assert.equal(normalizeSettings({ replyDelayMinSeconds: -5 }).minMs, 0);
  assert.equal(normalizeSettings({ replyDelayMaxSeconds: 99999 }).maxMs, 300000);
  assert.equal(normalizeSettings({ replyDelayMinSeconds: 'abc' }).minMs, 5000);
});

test('titik ujung sebaran: acak 0 = batas bawah, acak 1 = batas atas', () => {
  assert.equal(pickDelayMs(RANGE, () => 0), 5000);
  assert.equal(pickDelayMs(RANGE, () => 1), 60000);
  // Rentang nol: tidak ada yang diacak.
  assert.equal(pickDelayMs({ minMs: 8000, maxMs: 8000 }, () => 0.9), 8000);
});

test('sebaran condong cepat: sering cepat, sesekali lambat, tak pernah keluar rentang', () => {
  const samples = Array.from({ length: 20000 }, () => pickDelayMs(RANGE));
  assert.ok(samples.every((ms) => ms >= 5000 && ms <= 60000), 'ada jeda di luar rentang');
  const under15 = samples.filter((ms) => ms <= 15000).length / samples.length;
  const over30 = samples.filter((ms) => ms > 30000).length / samples.length;
  // Teori: ~0,567 dan ~0,231. Rentang lebar supaya tes tidak rapuh.
  assert.ok(under15 > 0.52 && under15 < 0.62, `di bawah 15 detik: ${under15}`);
  assert.ok(over30 > 0.18 && over30 < 0.28, `di atas 30 detik: ${over30}`);
  // Rata-rata jauh di bawah titik tengah (32,5 detik) — itu inti "lebih sering cepat".
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  assert.ok(mean < 22000, `rata-rata ${mean}`);
});

// ── pacer ────────────────────────────────────────────────────────────────

function harness({ settings = {}, random = () => 0, now = () => 0, predecessorWaitMs } = {}) {
  const sleeps = [];
  const pacer = createReplyPacer({
    sleep: async (ms) => { sleeps.push(ms); },
    now, random, predecessorWaitMs,
  });
  return { pacer, sleeps, settings };
}

const run = (h, key, opts = {}) => h.pacer.run(key, opts.receivedAt ?? 0, {
  settings: () => h.settings,
  produce: opts.produce || (async () => 'halo'),
  send: opts.send || (async () => {}),
  snapshot: opts.snapshot,
  stillValid: opts.stillValid,
});

test('jeda dimatikan: terkirim seketika tanpa tidur', async () => {
  const h = harness({ settings: { replyDelayEnabled: false } });
  const sent = [];
  const result = await run(h, 'a', { send: async (p) => sent.push(p) });
  assert.equal(result.sent, true);
  assert.deepEqual(sent, ['halo']);
  assert.deepEqual(h.sleeps, []);
});

test('waktu menyusun balasan dihitung sebagai bagian dari jeda', async () => {
  // Jeda terpilih 5 detik (acak=0). Pesan masuk 8 detik lalu: sudah terlampaui.
  const late = harness({ now: () => 8000 });
  await run(late, 'a', { receivedAt: 0 });
  assert.deepEqual(late.sleeps, [], 'jangan menambah jeda di atas waktu yang sudah lewat');

  // Pesan masuk 2 detik lalu: tinggal 3 detik.
  const early = harness({ now: () => 2000 });
  await run(early, 'a', { receivedAt: 0 });
  assert.deepEqual(early.sleeps, [3000]);
});

test('tidak ada balasan: tidak tidur, tidak mengirim', async () => {
  const h = harness();
  let sent = false;
  const result = await run(h, 'a', { produce: async () => null, send: async () => { sent = true; } });
  assert.deepEqual(result, { sent: false, reason: 'tidak-ada-balasan' });
  assert.equal(sent, false);
  assert.deepEqual(h.sleeps, []);
});

test('pengambilalihan di tengah jeda benar-benar membuang balasan', async () => {
  let mode = 'ai';
  const pacer = createReplyPacer({
    sleep: async () => { mode = 'human'; }, // agent mengambil alih selama tidur
    now: () => 0, random: () => 0,
  });
  let sent = false;
  const result = await pacer.run('a', 0, {
    settings: () => ({}),
    produce: async () => 'balasan AI',
    snapshot: async () => mode,
    stillValid: async (before) => !(before !== 'human' && mode === 'human'),
    send: async () => { sent = true; },
  });
  assert.equal(sent, false);
  assert.deepEqual([result.sent, result.reason], [false, 'chat-berubah']);
});

test('serah-terima oleh AI sendiri tidak dibuang: chat sudah manusia SEBELUM jeda', async () => {
  // Customer minta bicara dengan manusia; AI memindahkan chat ke manusia lalu
  // membalas "saya teruskan". Balasan itu justru harus terkirim.
  let mode = 'human';
  const pacer = createReplyPacer({ sleep: async () => {}, now: () => 0, random: () => 0 });
  let sent = false;
  await pacer.run('a', 0, {
    settings: () => ({}),
    produce: async () => 'Baik, saya teruskan ke tim kami.',
    snapshot: async () => mode,
    stillValid: async (before) => !(before !== 'human' && mode === 'human'),
    send: async () => { sent = true; },
  });
  assert.equal(sent, true);
});

test('dua pesan beruntun di satu chat: balasan keluar berurutan, bukan menyalip', async () => {
  // Balasan pertama dapat jeda terpanjang, kedua terpendek. Tanpa antrean per
  // chat, kedua keluar lebih dulu.
  const randoms = [1, 0];
  const pacer = createReplyPacer({
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / 100)),
    now: () => 0,
    random: () => randoms.shift(),
  });
  const order = [];
  const make = (label) => pacer.run('chat-1', 0, {
    settings: () => ({}),
    produce: async () => label,
    send: async (p) => { order.push(p); },
  });
  await Promise.all([make('pertama'), make('kedua')]);
  assert.deepEqual(order, ['pertama', 'kedua']);
});

test('chat berbeda tidak saling menunggu', async () => {
  const randoms = [1, 0];
  const pacer = createReplyPacer({
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / 100)),
    now: () => 0,
    random: () => randoms.shift(),
  });
  const order = [];
  const make = (key, label) => pacer.run(key, 0, {
    settings: () => ({}),
    produce: async () => label,
    send: async (p) => { order.push(p); },
  });
  await Promise.all([make('chat-lambat', 'lambat'), make('chat-cepat', 'cepat')]);
  assert.deepEqual(order, ['cepat', 'lambat']);
});

test('satu balasan gagal tidak membisukan chat itu', async () => {
  const h = harness({ settings: { replyDelayEnabled: false } });
  await assert.rejects(run(h, 'a', { produce: async () => { throw new Error('model error'); } }), /model error/);
  const sent = [];
  const result = await run(h, 'a', { send: async (p) => sent.push(p) });
  assert.equal(result.sent, true);
  assert.deepEqual(sent, ['halo']);
});

test('pengirim yang melempar juga tidak meracuni antrean', async () => {
  const h = harness({ settings: { replyDelayEnabled: false } });
  await assert.rejects(run(h, 'a', { send: async () => { throw new Error('WA down'); } }), /WA down/);
  const result = await run(h, 'a');
  assert.equal(result.sent, true);
});

test('pendahulu yang menggantung tidak membisukan chat selamanya', async () => {
  const h = harness({ settings: { replyDelayEnabled: false }, predecessorWaitMs: 40 });
  // Balasan pertama tidak pernah selesai menyusun.
  const hung = run(h, 'a', { produce: () => new Promise(() => {}) });
  hung.catch(() => {});
  const started = Date.now();
  const result = await run(h, 'a');
  assert.equal(result.sent, true);
  assert.ok(Date.now() - started < 1000, 'menunggu jauh melebihi batas');
});

test('antrean bersih setelah semua selesai', async () => {
  const h = harness({ settings: { replyDelayEnabled: false } });
  await Promise.all([run(h, 'a'), run(h, 'a'), run(h, 'b')]);
  assert.equal(h.pacer.pendingChats(), 0);
});
