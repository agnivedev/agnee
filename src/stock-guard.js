'use strict';

/**
 * Penjaga "ada" untuk barang yang stoknya nol.
 *
 * Aturan di prompt ("jangan bilang ada kalau habis") tidak cukup menahan
 * model: ia tetap menjawab "ready kak" untuk varian yang stoknya 0. Di sini
 * ditegakkan di kode: kalimat balasan yang menyebut barang berstok nol
 * (HABIS di DealPOS) dan menyatakan ada/ready/tersedia tanpa kata habis
 * dianggap melanggar.
 *
 * Hati-hati terhadap salah tuduh: varian sejenis sering berbagi nama ("Kawat
 * 1/2 hijau" habis, "Kawat 1/2 biru" ada). Kalimat hanya ditandai bila hampir
 * semua kata nama barang yang habis ada di kalimat itu DAN tidak ada barang
 * berstok yang cocok sama baik atau lebih baik.
 */

const { tokens } = require('./dealpos-prices');
const { stockOf } = require('./dealpos-stock');

const AFFIRM = /\b(?:ada|ready|redy|tersedia|available|masih\s+ada|stok(?:nya)?\s+(?:ada|aman|banyak|cukup)|siap\s+(?:kirim|ambil|order))\b/i;
const NEGATE = /\b(?:habis|kosong|tidak\s+(?:ada|tersedia|ready)|belum\s+(?:ada|tersedia|ready)|n?gak\s+(?:ada|ready|tersedia)|ga\s+(?:ada|ready|tersedia)|tak\s+(?:ada|tersedia)|out\s+of\s+stock|sedang\s+tidak|belum\s+masuk|lagi\s+kosong|dicek(?:\s+dulu)?|saya\s+cek|kami\s+cek|konfirmasi)\b/i;
const COVERAGE = 0.8;
const MIN_TOKENS = 2;

const splitSentences = (text) => String(text || '').split(/(?<=[.!?\n])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/** Siapkan indeks: hanya item habis yang diperiksa; item berstok dipakai untuk membatalkan salah tuduh. */
function indexItems(items) {
  const out = { empty: [], stocked: [] };
  for (const item of Array.isArray(items) ? items : []) {
    const terms = [...new Set(tokens(item.name))];
    if (terms.length < MIN_TOKENS) continue;
    const state = stockOf(item).state;
    const entry = { item, terms };
    if (state === 'habis') out.empty.push(entry);
    else if (state !== 'tidak_diketahui') out.stocked.push(entry);
  }
  return out;
}

const coverage = (entry, sentenceTerms) => entry.terms.filter((t) => sentenceTerms.has(t)).length / entry.terms.length;

/**
 * Kalimat yang menyatakan barang habis sebagai ada: [{ sentence, name }].
 * `items` = item katalog/harga dengan field stok (`stock`, `stockSyncedAt`).
 */
function findFalseAvailability(text, items) {
  const index = typeof items?.empty === 'object' ? items : indexItems(items);
  if (!index.empty.length) return [];
  const found = [];
  for (const sentence of splitSentences(text)) {
    if (!AFFIRM.test(sentence) || NEGATE.test(sentence)) continue;
    const sentenceTerms = new Set(tokens(sentence));
    const lower = sentence.toLowerCase();
    let best = null;
    for (const entry of index.empty) {
      const code = entry.item.code ? String(entry.item.code).toLowerCase() : '';
      const byCode = code.length >= 5 && lower.includes(code);
      const score = byCode ? 1 : coverage(entry, sentenceTerms);
      if (score >= COVERAGE && (!best || score > best.score)) best = { entry, score };
    }
    if (!best) continue;
    const rival = index.stocked.some((e) => coverage(e, sentenceTerms) >= best.score);
    if (rival) continue;
    found.push({ sentence, name: best.entry.item.name });
  }
  return found;
}

/** Buang kalimat yang menyatakan barang habis sebagai ada. */
function stripFalseAvailability(text, items) {
  const bad = new Set(findFalseAvailability(text, items).map((f) => f.sentence));
  if (!bad.size) return text;
  return splitSentences(text).filter((s) => !bad.has(s)).join('\n').trim();
}

module.exports = { indexItems, findFalseAvailability, stripFalseAvailability, AFFIRM, NEGATE };
