'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isChatPerorangan, nilaiChat, kelompokKeaktifan, teksUntukProduk, jalankanImpor,
  BATCH_MAKS, PRODUK_AI_MAKS,
} = require('../src/chat-import');

const NOW = 1_800_000_000;
const HARI = 86_400;

test('hanya chat perorangan yang jadi calon lead', () => {
  assert.equal(isChatPerorangan('6281@c.us'), true);
  assert.equal(isChatPerorangan('98765@lid'), true);
  assert.equal(isChatPerorangan('1203630@g.us'), false);
  assert.equal(isChatPerorangan('status@broadcast'), false);
  assert.equal(isChatPerorangan('12345@newsletter'), false);
  assert.equal(isChatPerorangan(''), false);
  assert.equal(isChatPerorangan(null), false);
});

test('pernah membalas hanya kalau ada pesan MASUK di riwayat', () => {
  const masuk = nilaiChat({ pesan: [
    { fromMe: true, timestamp: 100, type: 'chat' },
    { fromMe: false, timestamp: 150, type: 'chat' },
    { fromMe: true, timestamp: 200, type: 'chat' },
  ] });
  assert.equal(masuk.relation, 'replied');
  assert.equal(masuk.lastInboundAt, 150);
  assert.equal(masuk.lastMessageAt, 200);
});

test('hanya kita yang kirim = belum terlihat membalas, bukan "tidak pernah"', () => {
  const nilai = nilaiChat({ pesan: [
    { fromMe: true, timestamp: 100, type: 'chat' },
    { fromMe: true, timestamp: 200, type: 'chat' },
  ] });
  assert.equal(nilai.relation, 'unproven');
  assert.equal(nilai.lastInboundAt, null);
  assert.equal(nilai.lastMessageAt, 200);
});

test('catatan database yang sudah ada mengalahkan jendela baca yang terbatas', () => {
  // Kontak membalas lama sebelumnya, lalu kita kirim puluhan pesan sesudahnya:
  // jendela baca hanya melihat pesan keluar, tapi Agnee pernah mencatat balasannya.
  const nilai = nilaiChat({
    pesan: [{ fromMe: true, timestamp: 900, type: 'chat' }],
    sudahAdaDiDatabase: true,
  });
  assert.equal(nilai.relation, 'replied');
});

test('pesan sistem tidak dihitung sebagai pesan masuk', () => {
  const nilai = nilaiChat({ pesan: [
    { fromMe: false, timestamp: 100, type: 'e2e_notification' },
    { fromMe: false, timestamp: 110, type: 'gp2' },
    { fromMe: true, timestamp: 120, type: 'chat' },
  ] });
  assert.equal(nilai.relation, 'unproven');
  assert.equal(nilai.lastMessageAt, 120);
});

test('keaktifan: batas 30 dan 90 hari, dan kosong kalau tidak diketahui', () => {
  assert.equal(kelompokKeaktifan(NOW - 30 * HARI, NOW), 'active');
  assert.equal(kelompokKeaktifan(NOW - 31 * HARI, NOW), 'cooling');
  assert.equal(kelompokKeaktifan(NOW - 90 * HARI, NOW), 'cooling');
  assert.equal(kelompokKeaktifan(NOW - 91 * HARI, NOW), 'old');
  assert.equal(kelompokKeaktifan(null, NOW), null);
  assert.equal(kelompokKeaktifan(0, NOW), null);
});

test('teks untuk menebak produk: hanya pesan masuk, paling banyak lima terakhir', () => {
  const pesan = [
    { fromMe: true, body: 'dari kita', timestamp: 1, type: 'chat' },
    ...Array.from({ length: 7 }, (_, i) => ({ fromMe: false, body: `masuk ${i + 1}`, timestamp: 10 + i, type: 'chat' })),
  ];
  const teks = teksUntukProduk(pesan);
  assert.ok(!teks.includes('dari kita'));
  assert.deepEqual(teks.split('\n'), ['masuk 3', 'masuk 4', 'masuk 5', 'masuk 6', 'masuk 7']);
});

// ---- jalankanImpor ----

function chat(id, timestamp, extra = {}) { return { id, name: `Nama ${id}`, timestamp, isGroup: false, ...extra }; }

function fakeDeps({ chats = [], inbound = {}, imported = [], known = [], labels = new Map(), fail = [], ready = () => true,
  stop = () => false, classify = async () => true } = {}) {
  const calls = { read: [], saved: [], names: [], classified: [], slept: 0 };
  return {
    calls,
    deps: {
      async listChats() { return chats; },
      async readMessages(_wa, chatId) {
        calls.read.push(chatId);
        if (fail.includes(chatId)) throw new Error('serialisasi gagal');
        return { messages: inbound[chatId] || [{ fromMe: true, timestamp: 10, type: 'chat', body: 'halo' }] };
      },
      async readLabels() { if (labels instanceof Error) throw labels; return labels; },
      isReady: ready,
      shouldStop: stop,
      async importedIds() { return new Set(imported); },
      async knownInboundIds() { return new Set(known); },
      async save(companyId, connectionId, rows, names) { calls.saved.push(...rows.map((r) => ({ ...r, companyId, connectionId }))); calls.names.push(...names); },
      async classifyProduct(chatId, teks) { calls.classified.push({ chatId, teks }); return classify(chatId); },
      async sleep() { calls.slept += 1; },
    },
  };
}

const jalan = (setup, options = {}) => jalankanImpor({ wa: {}, companyId: 'c1', connectionId: 'k1', deps: setup.deps, options });

test('grup, status, dan siaran tidak ikut dibaca', async () => {
  const s = fakeDeps({ chats: [
    chat('1@c.us', 100), chat('2@lid', 90),
    chat('3@g.us', 80, { isGroup: true }), chat('status@broadcast', 70), chat('4@newsletter', 60),
  ] });
  const hasil = await jalan(s);
  assert.deepEqual(s.calls.read.sort(), ['1@c.us', '2@lid']);
  assert.equal(hasil.totalOnPhone, 5);
  assert.equal(hasil.eligible, 2);
});

test('yang sudah terimpor dilewati, jadi proses berikutnya melanjutkan', async () => {
  const s = fakeDeps({ chats: [chat('1@c.us', 100), chat('2@c.us', 90), chat('3@c.us', 80)], imported: ['1@c.us', '2@c.us'] });
  const hasil = await jalan(s);
  assert.deepEqual(s.calls.read, ['3@c.us']);
  assert.equal(hasil.alreadyImported, 2);
  assert.equal(hasil.done, 1);
});

test('satu proses dibatasi, sisanya dilaporkan, dan yang terbaru didahulukan', async () => {
  const chats = Array.from({ length: 5 }, (_, i) => chat(`${i}@c.us`, 1000 + i));
  const s = fakeDeps({ chats });
  const hasil = await jalan(s, { batchMaks: 2 });
  assert.deepEqual(s.calls.read, ['4@c.us', '3@c.us']);
  assert.equal(hasil.toDo, 2);
  assert.equal(hasil.remaining, 3);
  assert.ok(BATCH_MAKS >= 100 && BATCH_MAKS <= 1000, 'batas bawaan harus masuk akal untuk halaman WhatsApp yang hidup');
});

test('hubungan dan label tersimpan per chat', async () => {
  const s = fakeDeps({
    chats: [chat('1@c.us', 100), chat('2@c.us', 90)],
    inbound: { '1@c.us': [{ fromMe: false, timestamp: 50, type: 'chat', body: 'tanya harga' }] },
    labels: new Map([['1@c.us', ['Pelanggan baru']]]),
  });
  const hasil = await jalan(s);
  const per = Object.fromEntries(s.calls.saved.map((r) => [r.chatId, r]));
  assert.equal(per['1@c.us'].relation, 'replied');
  assert.deepEqual(per['1@c.us'].waLabels, ['Pelanggan baru']);
  assert.equal(per['2@c.us'].relation, 'unproven');
  assert.deepEqual(per['2@c.us'].waLabels, []);
  assert.equal(hasil.replied, 1);
  assert.equal(hasil.unproven, 1);
  assert.equal(hasil.labelsAvailable, true);
  assert.equal(per['1@c.us'].connectionId, 'k1');
  assert.deepEqual(s.calls.names.map((n) => n.chatId).sort(), ['1@c.us', '2@c.us']);
});

test('akun tanpa label (WhatsApp biasa) tidak menggagalkan impor', async () => {
  const s = fakeDeps({ chats: [chat('1@c.us', 100)], labels: new Error('getLabels bukan fungsi') });
  const hasil = await jalan(s);
  assert.equal(hasil.done, 1);
  assert.equal(hasil.labelsAvailable, false);
  assert.equal(hasil.stoppedBecause, null);
});

test('klien terputus di tengah jalan: berhenti, yang sudah terbaca tetap tersimpan', async () => {
  let panggilan = 0;
  const s = fakeDeps({ chats: [chat('1@c.us', 100), chat('2@c.us', 90), chat('3@c.us', 80)], ready: () => ++panggilan <= 2 });
  const hasil = await jalan(s);
  assert.equal(hasil.stoppedBecause, 'disconnected');
  assert.deepEqual(s.calls.read, ['1@c.us', '2@c.us']);
  assert.equal(s.calls.saved.length, 2);
});

test('dibatalkan pengguna: berhenti dengan alasan yang benar', async () => {
  let n = 0;
  const s = fakeDeps({ chats: [chat('1@c.us', 100), chat('2@c.us', 90)], stop: () => ++n > 1 });
  const hasil = await jalan(s);
  assert.equal(hasil.stoppedBecause, 'cancelled');
  assert.equal(s.calls.read.length, 1);
});

test('satu chat gagal dibaca dihitung dan dilewati, yang lain jalan terus', async () => {
  const s = fakeDeps({ chats: [chat('1@c.us', 100), chat('2@c.us', 90), chat('3@c.us', 80)], fail: ['2@c.us'] });
  const hasil = await jalan(s);
  assert.equal(hasil.failed, 1);
  assert.equal(s.calls.saved.length, 2);
  assert.equal(hasil.stoppedBecause, null);
});

test('gagal beruntun menandakan klien bermasalah: berhenti, jangan teruskan menghantam', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `${i}@c.us`);
  const s = fakeDeps({ chats: ids.map((id, i) => chat(id, 1000 - i)), fail: ids });
  const hasil = await jalan(s);
  assert.equal(hasil.stoppedBecause, 'client_unstable');
  assert.ok(s.calls.read.length < ids.length, 'tidak boleh terus membaca setelah gagal beruntun');
});

test('ada jeda antar chat, supaya halaman WhatsApp sempat melayani customer', async () => {
  const s = fakeDeps({ chats: [chat('1@c.us', 100), chat('2@c.us', 90), chat('3@c.us', 80)] });
  await jalan(s);
  assert.equal(s.calls.slept, 3);
});

test('produk hanya ditebak untuk yang pernah membalas, dan hanya kalau diminta', async () => {
  const chats = [chat('1@c.us', 100), chat('2@c.us', 90)];
  const inbound = { '1@c.us': [{ fromMe: false, timestamp: 50, type: 'chat', body: 'mau CGI' }] };

  const tanpa = fakeDeps({ chats, inbound });
  await jalan(tanpa, { classifyProducts: false });
  assert.equal(tanpa.calls.classified.length, 0);

  const dengan = fakeDeps({ chats, inbound });
  const hasil = await jalan(dengan, { classifyProducts: true });
  assert.deepEqual(dengan.calls.classified.map((c) => c.chatId), ['1@c.us']);
  assert.equal(dengan.calls.classified[0].teks, 'mau CGI');
  assert.equal(hasil.productsAssigned, 1);
});

test('tebakan produk dibatasi per proses dan yang gagal tidak membatalkan impor', async () => {
  const total = PRODUK_AI_MAKS + 20;
  const chats = Array.from({ length: total }, (_, i) => chat(`${i}@c.us`, 5000 - i));
  const inbound = Object.fromEntries(chats.map((c) => [c.id, [{ fromMe: false, timestamp: 50, type: 'chat', body: 'tanya' }]]));
  const s = fakeDeps({ chats, inbound, classify: async (id) => { if (id === '0@c.us') throw new Error('model error'); return true; } });
  const hasil = await jalan(s, { classifyProducts: true, batchMaks: total });
  assert.equal(s.calls.classified.length, PRODUK_AI_MAKS);
  assert.equal(hasil.productsTried, PRODUK_AI_MAKS);
  assert.equal(hasil.productsAssigned, PRODUK_AI_MAKS - 1);
  assert.equal(s.calls.saved.length, total, 'semua chat tetap tersimpan walau satu tebakan produk gagal');
});

test('impor yang berhenti di tengah tidak lanjut menebak produk', async () => {
  let panggilan = 0;
  const chats = [chat('1@c.us', 100), chat('2@c.us', 90)];
  const inbound = { '1@c.us': [{ fromMe: false, timestamp: 5, type: 'chat', body: 'tanya' }] };
  const s = fakeDeps({ chats, inbound, ready: () => ++panggilan <= 1 });
  await jalan(s, { classifyProducts: true });
  assert.equal(s.calls.classified.length, 0);
});
