'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CloudApiManager } = require('../src/cloud-api-manager.js');

/** DB palsu seperlunya untuk logika rotasi — tanpa Postgres. */
function fakeDb({ numbers = [], assignments = new Map() } = {}) {
  return {
    assignments,
    async listCloudApiConnections() { return numbers; },
    async getCloudChatNumber(_companyId, chatId) {
      const id = assignments.get(chatId);
      return numbers.find((n) => n.id === id) || null;
    },
    async countCloudChatsPerConnection() {
      // Meniru query asli: hanya nomor aktif + connected, diurutkan dari yang
      // paling sedikit percakapannya.
      return numbers
        .filter((n) => n.isActive && n.status === 'connected')
        .map((n) => ({
          id: n.id,
          chatCount: [...assignments.values()].filter((v) => v === n.id).length,
        }))
        .sort((a, b) => a.chatCount - b.chatCount);
    },
    async assignCloudChatNumber(_companyId, chatId, connectionId) {
      if (assignments.has(chatId)) return null; // ON CONFLICT DO NOTHING
      assignments.set(chatId, connectionId);
      return { connectionId };
    },
  };
}

const NUM = (id, over = {}) => ({
  id, phoneNumberId: `pn-${id}`, isActive: true, status: 'connected',
  accessToken: 't', displayPhoneNumber: `+62${id}`, ...over,
});

test('percakapan baru jatuh ke nomor dengan beban paling sedikit', async () => {
  const db = fakeDb({ numbers: [NUM('a'), NUM('b')] });
  const m = new CloudApiManager(db);

  const first = await m.pickConnectionForChat('c1', 'chat-1');
  const second = await m.pickConnectionForChat('c1', 'chat-2');
  const third = await m.pickConnectionForChat('c1', 'chat-3');

  assert.equal(first.id, 'a');
  assert.equal(second.id, 'b', 'nomor kedua dipakai karena nomor pertama sudah punya satu');
  assert.equal(third.id, 'a');
});

test('percakapan yang sudah menempel tidak pernah pindah nomor', async () => {
  const db = fakeDb({ numbers: [NUM('a'), NUM('b')] });
  const m = new CloudApiManager(db);

  const first = await m.pickConnectionForChat('c1', 'chat-1');
  for (let i = 0; i < 5; i += 1) {
    const again = await m.pickConnectionForChat('c1', 'chat-1');
    assert.equal(again.id, first.id);
  }
});

test('nomor nonaktif tetap melayani percakapan lamanya', async () => {
  const numbers = [NUM('a'), NUM('b')];
  const db = fakeDb({ numbers });
  const m = new CloudApiManager(db);

  const attached = await m.pickConnectionForChat('c1', 'chat-1');
  assert.equal(attached.id, 'a');

  numbers[0].isActive = false; // dikeluarkan dari rotasi

  const again = await m.pickConnectionForChat('c1', 'chat-1');
  assert.equal(again.id, 'a', 'memindahkannya akan membuat balasan datang dari nomor asing');

  const fresh = await m.pickConnectionForChat('c1', 'chat-baru');
  assert.equal(fresh.id, 'b', 'percakapan baru tidak boleh masuk ke nomor nonaktif');
});

test('nomor yang belum connected dilewati rotasi', async () => {
  const db = fakeDb({ numbers: [NUM('a', { status: 'error' }), NUM('b')] });
  const m = new CloudApiManager(db);
  const picked = await m.pickConnectionForChat('c1', 'chat-1');
  assert.equal(picked.id, 'b');
});

test('tanpa nomor aktif, pick mengembalikan null', async () => {
  const db = fakeDb({ numbers: [NUM('a', { isActive: false })] });
  const m = new CloudApiManager(db);
  assert.equal(await m.pickConnectionForChat('c1', 'chat-1'), null);
});

test('sendText menolak jelas kalau tidak ada nomor', async () => {
  const m = new CloudApiManager(fakeDb({ numbers: [] }));
  await assert.rejects(
    () => m.sendText('c1', 'chat-1', 'halo'),
    /no WhatsApp Cloud API connection/,
  );
});

test('pesan masuk menempelkan percakapan ke nomor penerima', async () => {
  const db = fakeDb({ numbers: [NUM('a'), NUM('b')] });
  const m = new CloudApiManager(db);

  // Customer menghubungi nomor b lebih dulu, walau rotasi akan memilih a.
  await m.attachInbound('c1', 'chat-1', 'b');
  const picked = await m.pickConnectionForChat('c1', 'chat-1');
  assert.equal(picked.id, 'b');
});
