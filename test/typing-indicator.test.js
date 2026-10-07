'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTypingHooks } = require('../src/typing-indicator');
const { sendCloudApiTyping, TYPING_GRAPH_API_VERSION } = require('../src/cloud-api-sender');

test('whatsapp-web.js: menyalakan lewat sendStateTyping dan memadamkan lewat clearState di chat yang sama', async () => {
  const calls = [];
  const chat = {
    sendStateTyping: async () => { calls.push('typing'); },
    clearState: async () => { calls.push('clear'); },
  };
  const message = { getChat: async () => { calls.push('getChat'); return chat; } };
  const hooks = createTypingHooks({ provider: 'whatsapp_web', message });
  await hooks.start();
  await hooks.stop();
  assert.deepEqual(calls, ['getChat', 'typing', 'clear']);
});

test('whatsapp-web.js: stop sebelum start tidak melempar (balasan dibatalkan sebelum sempat mengetik)', async () => {
  const hooks = createTypingHooks({ provider: 'whatsapp_web', message: { getChat: async () => ({}) } });
  await assert.doesNotReject(hooks.stop());
});

test('Cloud API: memakai id pesan MASUK, dan stop tidak memanggil apa pun (Meta tak punya panggilan padam)', async () => {
  const calls = [];
  const hooks = createTypingHooks({
    provider: 'cloud_api',
    message: { id: { _serialized: 'wamid.MASUK123' } },
    sendCloudTyping: async (id) => { calls.push(id); },
  });
  await hooks.start();
  await hooks.stop();
  assert.deepEqual(calls, ['wamid.MASUK123']);
});

test('tidak ada yang bisa ditampilkan: kembali null, bukan pengait yang melempar nanti', () => {
  assert.equal(createTypingHooks({ provider: 'cloud_api', message: {}, sendCloudTyping: async () => {} }), null);
  assert.equal(createTypingHooks({ provider: 'cloud_api', message: { id: { _serialized: 'x' } } }), null);
  assert.equal(createTypingHooks({ provider: 'whatsapp_web', message: {} }), null);
  assert.equal(createTypingHooks({ provider: 'telegram', message: { getChat: async () => ({}) } }), null);
});

test('permintaan Cloud API sesuai dokumentasi Meta: menandai dibaca + typing_indicator text, versi terpisah', async () => {
  const real = global.fetch;
  let seen;
  global.fetch = async (url, options) => { seen = { url, options }; return new Response('{"success":true}', { status: 200 }); };
  try {
    await sendCloudApiTyping({ phoneNumberId: 'PN123', accessToken: 'TOKEN', messageId: 'wamid.MASUK123' });
  } finally {
    global.fetch = real;
  }
  assert.equal(seen.url, `https://graph.facebook.com/${TYPING_GRAPH_API_VERSION}/PN123/messages`);
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.headers.authorization, 'Bearer TOKEN');
  assert.deepEqual(JSON.parse(seen.options.body), {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: 'wamid.MASUK123',
    typing_indicator: { type: 'text' },
  });
});

test('versi Graph API untuk mengetik tidak menyeret pengiriman pesan ikut pindah versi', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/cloud-api-sender'), 'utf8');
  assert.match(source, /GRAPH_API_VERSION = 'v20\.0'/);
  assert.notEqual(TYPING_GRAPH_API_VERSION, 'v20.0');
});

test('Meta menolak: galat dilempar dengan pesan Meta, supaya pemanggil bisa mencatatnya', async () => {
  const real = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Unknown parameter' } }), { status: 400 });
  try {
    await assert.rejects(
      sendCloudApiTyping({ phoneNumberId: 'PN', accessToken: 'T', messageId: 'm' }),
      /Unknown parameter/,
    );
  } finally {
    global.fetch = real;
  }
});
