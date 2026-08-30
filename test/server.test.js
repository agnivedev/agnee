'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp, normalizeChatId, inlineImageFromBody, messagePreviewForUi, normalizeMessageForUi } = require('../src/server');

test('normalizes Indonesian phone numbers', () => {
  assert.equal(normalizeChatId('0812-3456-7890', '62'), '6281234567890@c.us');
});

test('normalizes interactive image payloads without leaking base64 as text', () => {
  const jpeg = `/9j/${'A'.repeat(120)}`;
  assert.equal(inlineImageFromBody(jpeg).extension, 'jpg');
  assert.equal(messagePreviewForUi('interactive', jpeg), 'Pesan interaktif WhatsApp');
  assert.equal(messagePreviewForUi('video', jpeg), 'Video');
  const message = normalizeMessageForUi({ type: 'interactive', body: jpeg, quoted: null });
  assert.equal(message.body, '');
  assert.match(message.inlineImage, /^data:image\/jpeg;base64,/);
  assert.equal(normalizeMessageForUi({ type: 'image', body: jpeg, caption: 'Promo hari ini' }).body, 'Promo hari ini');
  assert.equal(inlineImageFromBody('normal customer message'), null);
});

test('login, list chats, read and send in demo mode', async (t) => {
  const app = await buildApp({
    logger: false,
    startupEnabled: false,
    demoMode: true,
    apiKey: 'test-key',
    sessionSecret: 'test-session-secret',
    adminEmail: 'owner@example.com',
    adminPassword: 'strong-pass',
  });
  t.after(() => app.close());

  const unauthorized = await app.inject({ method: 'GET', url: '/v1/chats' });
  assert.equal(unauthorized.statusCode, 401);

  const login = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { email: 'owner@example.com', password: 'strong-pass' },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];

  const chats = await app.inject({ method: 'GET', url: '/v1/chats', headers: { cookie } });
  assert.equal(chats.statusCode, 200);
  assert.ok(chats.json().chats.length >= 3);
  assert.equal(chats.json().chats[0].id, 'demo-raka');
  assert.equal(chats.json().chats[0].pinned, true);

  const search = await app.inject({ method: 'GET', url: '/v1/chats?q=nadia', headers: { cookie } });
  assert.equal(search.json().chats.length, 1);
  const noMatch = await app.inject({ method: 'GET', url: '/v1/chats?q=tidak-ada', headers: { cookie } });
  assert.equal(noMatch.json().chats.length, 0);
  const unread = await app.inject({ method: 'GET', url: '/v1/chats?filter=unread', headers: { cookie } });
  assert.ok(unread.json().chats.every((chat) => chat.unreadCount > 0));
  const qualified = await app.inject({ method: 'GET', url: '/v1/chats?filter=qualified', headers: { cookie } });
  assert.equal(qualified.json().chats.length, 0);
  const pinned = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/pinned', headers: { cookie } });
  assert.equal(pinned.statusCode, 200);
  assert.deepEqual(pinned.json().messages.map((message) => message.id), ['d2']);

  const send = await app.inject({
    method: 'POST',
    url: '/v1/messages/send',
    headers: { cookie },
    payload: { chatId: 'demo-nadia', text: 'Boleh, saya bantu hitungkan.', clientRequestId: 'request-demo-123' },
  });
  assert.equal(send.statusCode, 200);

  const duplicateRetry = await app.inject({
    method: 'POST',
    url: '/v1/messages/send',
    headers: { cookie },
    payload: { chatId: 'demo-nadia', text: 'Boleh, saya bantu hitungkan.', clientRequestId: 'request-demo-123' },
  });
  assert.equal(duplicateRetry.json().messageId, send.json().messageId);

  const messages = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/messages', headers: { cookie } });
  assert.equal(messages.json().messages.at(-1).body, 'Boleh, saya bantu hitungkan.');
  assert.equal(messages.json().messages.filter((message) => message.body === 'Boleh, saya bantu hitungkan.').length, 1);

  const reply = await app.inject({
    method: 'POST',
    url: '/v1/messages/send',
    headers: { cookie },
    payload: {
      chatId: 'demo-nadia',
      text: 'Ini balasan terkutip.',
      quotedMessageId: messages.json().messages[0].id,
      clientRequestId: 'request-demo-reply-123',
    },
  });
  assert.equal(reply.statusCode, 200);
  const afterReply = await app.inject({ method: 'GET', url: '/v1/chats/demo-nadia/messages', headers: { cookie } });
  assert.equal(afterReply.json().messages.at(-1).quoted.body, 'Pesan dibalas');
  assert.equal(afterReply.json().messages.at(-1).quoted.id, messages.json().messages[0].id);

  const attachment = await app.inject({
    method: 'POST',
    url: '/v1/messages/send',
    headers: { cookie },
    payload: {
      chatId: 'demo-nadia',
      text: '',
      attachment: { data: 'aGVsbG8=', mimetype: 'image/png', filename: 'contoh.png', filesize: 5 },
      clientRequestId: 'request-demo-media-123',
    },
  });
  assert.equal(attachment.statusCode, 200);

  const assigned = await app.inject({
    method: 'POST',
    url: '/v1/chats/demo-nadia/assign',
    headers: { cookie },
    payload: { assignee: 'Sales team' },
  });
  assert.equal(assigned.statusCode, 200);
  assert.equal(assigned.json().stage, 'assigned');
  const qualifiedAfterAssign = await app.inject({ method: 'GET', url: '/v1/chats?filter=qualified', headers: { cookie } });
  assert.ok(qualifiedAfterAssign.json().chats.some((chat) => chat.id === 'demo-nadia'));
});
