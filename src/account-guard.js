'use strict';

/**
 * Penjaga nomor rekening karangan.
 *
 * Saat jawaban cadangan tanpa alat (llm-fallback, 28 Okt), model mengarang
 * nomor rekening. Nomor rekening yang salah berarti uang customer masuk ke
 * orang lain, jadi larangan di prompt tidak cukup: setiap deret angka
 * panjang di balasan harus punya sumber di percakapan itu sendiri (prompt,
 * hasil alat, kata customer), sama seperti penjaga harga.
 *
 * Yang dihitung nomor rekening/telepon: 10-16 digit, boleh dipisah spasi atau
 * strip. Angka berformat uang (titik ribuan, atau didahului "Rp") tidak
 * dihitung; itu urusan price-guard. Dua nomor dianggap sama bila 9 digit
 * terakhirnya sama, supaya 0812... dan +62812... tidak dianggap karangan.
 */

const MIN_DIGITS = 10;
const MAX_DIGITS = 16;
const TAIL = 9;

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Deret angka panjang di teks, hanya digitnya. */
function longNumbers(text) {
  const value = String(text || '');
  const out = [];
  for (const m of value.matchAll(/\+?\d[\d .-]{8,22}\d/g)) {
    const raw = m[0];
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) continue;
    if (/\bRp\.?\s*$/i.test(value.slice(Math.max(0, m.index - 4), m.index))) continue;
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS) out.push(digits);
  }
  return out;
}

const keyOf = (digits) => digits.slice(-TAIL);

/** @returns {{ sentence: string, number: string }[]} */
function findInventedAccounts(reply, sourceText) {
  const known = new Set(longNumbers(sourceText).map(keyOf));
  const out = [];
  for (const sentence of splitSentences(reply)) {
    const bad = longNumbers(sentence).find((digits) => !known.has(keyOf(digits)));
    if (bad) out.push({ sentence, number: bad });
  }
  return out;
}

/** Buang kalimat yang menyebut nomor panjang tanpa sumber. */
function stripInventedAccounts(reply, sourceText) {
  const bad = new Set(findInventedAccounts(reply, sourceText).map((v) => v.sentence));
  if (!bad.size) return reply;
  return splitSentences(reply).filter((s) => !bad.has(s)).join('\n').trim();
}

module.exports = { longNumbers, findInventedAccounts, stripInventedAccounts };
