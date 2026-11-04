'use strict';

/**
 * Pencarian fuzzy ringan, tanpa dependensi: tahan salah ketik ("jhon" → John),
 * huruf bersambung/terbalik, aksen, dan awalan ("bud" → Budi). Semua kata di
 * kueri harus ketemu (AND), urutan kata bebas.
 *
 * Salinan kembarnya ada di web/src/lib/fuzzy.ts (server dan bundel web tidak
 * berbagi modul) — ubah keduanya bersamaan; test/fuzzy.test.js menjaga server.
 */

function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokens(value) {
  return fold(value).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Toleransi salah ketik menurut panjang kata: kata pendek harus persis. */
function editLimit(length) {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/** Jarak Damerau–Levenshtein (transposisi dihitung 1), berhenti dini di atas `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2] + 1);
      }
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/** Skor satu kata kueri terhadap seluruh teks: 0 = tidak cocok, 1 = awalan persis. */
function tokenScore(q, words, folded, digits) {
  if (/^\d{3,}$/.test(q)) {
    const bare = q.replace(/^(0|62)/, '');
    if (digits.includes(q) || (bare.length >= 3 && digits.includes(bare))) return 0.9;
  }
  let best = 0;
  for (const word of words) {
    if (word === q) return 1;
    if (word.startsWith(q)) { best = Math.max(best, 0.95); continue; }
    const max = editLimit(q.length);
    if (!max) continue;
    // Ketikan belum selesai: bandingkan dengan awalan kata sepanjang kueri.
    if (distance(q, word.slice(0, q.length), max) <= max) best = Math.max(best, 0.7);
    else if (distance(q, word, max) <= max) best = Math.max(best, 0.65);
  }
  if (!best && q.length >= 2 && folded.includes(q)) best = 0.6;
  return best;
}

/** 0 = tidak cocok; kueri kosong cocok dengan semuanya (skor 1). */
function fuzzyScore(query, text) {
  const qs = tokens(query);
  if (!qs.length) return 1;
  const folded = fold(text);
  const words = tokens(text);
  const digits = folded.replace(/\D/g, '');
  let total = 0;
  for (const q of qs) {
    const score = tokenScore(q, words, folded, digits);
    if (!score) return 0;
    total += score;
  }
  return total / qs.length;
}

/** Saring dan urutkan dari yang paling cocok; urutan asli dipertahankan untuk skor sama. */
function fuzzyFilter(items, query, getText) {
  if (!tokens(query).length) return items;
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, getText(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

/** Beberapa saran unik (dibandingkan tanpa huruf besar/aksen) untuk autosuggest. */
function suggest(pool, query, limit = 6) {
  if (!tokens(query).length) return [];
  const seen = new Set();
  const unique = [];
  for (const entry of pool) {
    const text = String(entry ?? '').trim();
    const key = fold(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return fuzzyFilter(unique, query, (text) => text).slice(0, limit);
}

module.exports = { fold, tokens, fuzzyScore, fuzzyFilter, suggest };
