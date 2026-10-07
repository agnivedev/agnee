'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mediaMarker, conversationRules } = require('../src/reply-style');

test('pesan customer berisi berkas saja diberi penanda, bukan dibuang', () => {
  assert.equal(mediaMarker({ type: 'album', body: '' }), '[Customer mengirim foto]');
  assert.equal(mediaMarker({ type: 'image', body: null }), '[Customer mengirim foto]');
  assert.equal(mediaMarker({ type: 'ptt', body: '' }), '[Customer mengirim pesan suara]');
  assert.equal(mediaMarker({ type: 'document', body: '  ' }), '[Customer mengirim dokumen]');
});

test('pesan yang punya teks, buatan tim, atau bukan berkas tidak diberi penanda', () => {
  assert.equal(mediaMarker({ type: 'image', body: 'ini produknya' }), null);
  assert.equal(mediaMarker({ type: 'image', body: '', fromMe: true }), null);
  assert.equal(mediaMarker({ type: 'sticker', body: '' }), null);
  assert.equal(mediaMarker({ type: 'revoked', body: '' }), null);
  assert.equal(mediaMarker(null), null);
});

test('aturan berkas ada untuk kedua identitas', () => {
  for (const identity of ['team_member', 'chatbot']) {
    assert.match(conversationRules(identity), /\[Customer mengirim foto\]/);
  }
});
