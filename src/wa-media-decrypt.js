'use strict';

const crypto = require('node:crypto');

// Jalur cadangan untuk media WhatsApp: unduh file terenkripsi langsung dari
// CDN dan buka sendiri dengan mediaKey pesannya. Dipakai saat pengunduh
// internal WhatsApp Web menolak file yang sebenarnya masih ada — misalnya
// "InvalidMediaFileType: Unexpected mimetype application/octet-stream" karena
// CDN mengirim header tipe yang tidak dikenalnya.

const MEDIA_HKDF_INFO = {
  image: 'WhatsApp Image Keys',
  sticker: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  gif: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  ptt: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
};

const MEDIA_HOST = 'https://mmg.whatsapp.net';
const MAX_BYTES = 40 * 1024 * 1024;

function mediaKeys(mediaKey, type) {
  const info = MEDIA_HKDF_INFO[type];
  if (!info) throw new Error(`unsupported-media-type:${type}`);
  // Dari halaman WhatsApp Web kunci datang sebagai base64; Uint8Array yang
  // diserialisasi puppeteer menjadi objek {0: .., 1: ..}.
  const key = Buffer.isBuffer(mediaKey) || mediaKey instanceof Uint8Array
    ? Buffer.from(mediaKey)
    : mediaKey && typeof mediaKey === 'object'
      ? Buffer.from(Object.values(mediaKey))
      : Buffer.from(String(mediaKey || ''), 'base64');
  if (key.length !== 32) throw new Error('invalid-media-key');
  const expanded = Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(32), Buffer.from(info), 112));
  return {
    iv: expanded.subarray(0, 16),
    cipherKey: expanded.subarray(16, 48),
    macKey: expanded.subarray(48, 80),
  };
}

/** Buka isi file .enc WhatsApp: [ciphertext][10 byte HMAC]. */
function decryptMedia(encrypted, mediaKey, type) {
  const data = Buffer.from(encrypted);
  if (data.length <= 10) throw new Error('media-too-short');
  const { iv, cipherKey, macKey } = mediaKeys(mediaKey, type);
  const file = data.subarray(0, -10);
  const mac = data.subarray(-10);
  const expected = crypto.createHmac('sha256', macKey).update(iv).update(file).digest().subarray(0, 10);
  if (!crypto.timingSafeEqual(mac, expected)) throw new Error('media-mac-mismatch');
  const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([decipher.update(file), decipher.final()]);
}

/** Bentuk sebaliknya, hanya untuk tes. */
function encryptMedia(plain, mediaKey, type) {
  const { iv, cipherKey, macKey } = mediaKeys(mediaKey, type);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  const file = Buffer.concat([cipher.update(plain), cipher.final()]);
  const mac = crypto.createHmac('sha256', macKey).update(iv).update(file).digest().subarray(0, 10);
  return Buffer.concat([file, mac]);
}

function mediaUrl(directPath) {
  const path = String(directPath || '');
  // Hanya jalur relatif di CDN WhatsApp; jangan pernah mengikuti URL lain.
  if (!/^\/[^/]/.test(path)) throw new Error('invalid-direct-path');
  return `${MEDIA_HOST}${path}`;
}

async function downloadAndDecrypt({ directPath, mediaKey, type }, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(mediaUrl(directPath), { signal: controller.signal, redirect: 'error' });
    // 403/404/410 di sini berarti CDN memang sudah membuang filenya.
    if (!response.ok) throw new Error(`cdn-${response.status}`);
    const length = Number(response.headers?.get?.('content-length') || 0);
    if (length > MAX_BYTES) throw new Error('media-too-large');
    const encrypted = Buffer.from(await response.arrayBuffer());
    if (encrypted.length > MAX_BYTES) throw new Error('media-too-large');
    return decryptMedia(encrypted, mediaKey, type);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { decryptMedia, encryptMedia, downloadAndDecrypt, mediaUrl, MEDIA_HKDF_INFO };
