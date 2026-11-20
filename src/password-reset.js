'use strict';

/**
 * Lupa password: token, pembatas laju, dan isi email.
 *
 * Token asli (32 byte acak, base64url) hanya ada di email. Database menyimpan
 * SHA-256-nya, jadi isi tabel yang bocor tidak bisa dipakai mereset akun.
 */

const crypto = require('node:crypto');

const RESET_TTL_MS = 60 * 60 * 1000; // 60 menit
const MIN_PASSWORD_LENGTH = 8;

function generateResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Pembatas jendela tetap: `hit(key)` mengembalikan false bila `key` sudah melewati `max` dalam `windowMs`. */
function createLimiter({ max, windowMs, now = Date.now }) {
  const entries = new Map();
  const timer = setInterval(() => {
    const t = now();
    for (const [key, entry] of entries) if (entry.resetAt < t) entries.delete(key);
  }, 60_000);
  timer.unref?.();
  return {
    hit(key) {
      const t = now();
      let entry = entries.get(key);
      if (!entry || t > entry.resetAt) entry = { count: 0, resetAt: t + windowMs };
      entry.count += 1;
      entries.set(key, entry);
      return entry.count <= max;
    },
    retryAfterSeconds(key) {
      const entry = entries.get(key);
      return entry ? Math.max(1, Math.ceil((entry.resetAt - now()) / 1000)) : 1;
    },
    stop() { clearInterval(timer); },
  };
}

/** Tautan memakai domain dari konfigurasi (APP_BASE_URL), tidak pernah dari header Host. */
function buildResetLink(appBaseUrl, token) {
  return `${String(appBaseUrl).replace(/\/+$/, '')}/?token=${encodeURIComponent(token)}`;
}

function buildResetEmail({ displayName, link }) {
  return {
    subject: 'Atur ulang password Agnee',
    text: [
      `Halo ${displayName || ''}`.trim() + ',',
      '',
      'Kami menerima permintaan mengatur ulang password akun Agnee Anda. Buka tautan berikut untuk membuat password baru (berlaku 60 menit, hanya sekali pakai):',
      '',
      link,
      '',
      'Kalau Anda tidak memintanya, abaikan email ini — password Anda tidak berubah.',
    ].join('\n'),
  };
}

module.exports = {
  RESET_TTL_MS, MIN_PASSWORD_LENGTH, generateResetToken, hashResetToken, createLimiter, buildResetLink, buildResetEmail,
};
