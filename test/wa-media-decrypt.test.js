'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { decryptMedia, encryptMedia, downloadAndDecrypt, mediaUrl } = require('../src/wa-media-decrypt');

const key = crypto.randomBytes(32);
const plain = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), crypto.randomBytes(5000)]);

test('dekripsi media WhatsApp bolak-balik untuk tiap jenis', () => {
  for (const type of ['image', 'sticker', 'video', 'audio', 'ptt', 'document']) {
    const enc = encryptMedia(plain, key, type);
    assert.deepEqual(decryptMedia(enc, key.toString('base64'), type), plain);
    assert.deepEqual(decryptMedia(enc, { ...key }, type), plain, 'kunci objek dari puppeteer');
  }
});

test('MAC salah atau jenis salah ditolak', () => {
  const enc = encryptMedia(plain, key, 'image');
  const tampered = Buffer.from(enc);
  tampered[10] ^= 1;
  assert.throws(() => decryptMedia(tampered, key, 'image'), /mac-mismatch/);
  assert.throws(() => decryptMedia(enc, key, 'video'), /mac-mismatch/);
  assert.throws(() => decryptMedia(enc, Buffer.alloc(5), 'image'), /invalid-media-key/);
});

test('hanya jalur relatif di CDN WhatsApp yang diunduh', () => {
  assert.equal(mediaUrl('/v/t62.7118-24/x.enc?oh=1&oe=2'), 'https://mmg.whatsapp.net/v/t62.7118-24/x.enc?oh=1&oe=2');
  assert.throws(() => mediaUrl('https://evil.example/x'), /invalid-direct-path/);
  assert.throws(() => mediaUrl('//evil.example/x'), /invalid-direct-path/);
  assert.throws(() => mediaUrl(''), /invalid-direct-path/);
});

test('unduh langsung: CDN mengirim octet-stream tetap terbuka; 404 dilaporkan', async () => {
  const enc = encryptMedia(plain, key, 'image');
  let requested = '';
  const ok = async (url) => {
    requested = url;
    return { ok: true, status: 200, headers: new Map([['content-type', 'application/octet-stream']]), arrayBuffer: async () => enc };
  };
  const out = await downloadAndDecrypt({ directPath: '/v/a.enc', mediaKey: key.toString('base64'), type: 'image' }, { fetchImpl: ok });
  assert.deepEqual(out, plain);
  assert.equal(requested, 'https://mmg.whatsapp.net/v/a.enc');

  const gone = async () => ({ ok: false, status: 404, headers: new Map() });
  await assert.rejects(
    downloadAndDecrypt({ directPath: '/v/a.enc', mediaKey: key, type: 'image' }, { fetchImpl: gone }),
    /cdn-404/,
  );
});
