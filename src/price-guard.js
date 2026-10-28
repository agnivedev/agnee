'use strict';

/**
 * Penjaga harga karangan.
 *
 * ESBEJE, 28 Okt: customer menulis "dinding retak perlu diperbaiki", AI
 * membalas "MU 100 Base Plester seharga Rp 75.000, MU 301 Plasterplus Rp
 * 90.000". Harga sebenarnya di DealPOS Rp 116.400 dan Rp 104.000. Prompt
 * hanya memuat barang yang namanya cocok dengan pesan customer; "dinding
 * retak" tidak cocok dengan satu barang pun, jadi tidak ada harga di prompt,
 * dan model mengisinya dari ingatan walau playbook melarang "mengarang harga".
 *
 * Larangan di prompt tidak menahannya, jadi ditegakkan di kode: setiap angka
 * rupiah di balasan harus punya sumber di percakapan itu sendiri — prompt
 * (playbook, Fakta, daftar harga, katalog), hasil alat pada giliran itu, atau
 * kata customer sendiri. Angka yang tidak ada sumbernya dianggap karangan.
 *
 * Angka turunan yang sah tidak dihitung sebagai karangan: kelipatan harga
 * satuan (40 sak × harga) dan jumlah dua angka sumber (harga + ongkir).
 */

const MIN_AMOUNT = 1000;
const MAX_MULTIPLIER = 1000;

/** "75.000", "1.250.000", "1,5" -> angka. Titik = ribuan, koma = desimal (cara tulis Indonesia). */
function parseNumber(raw) {
  const text = String(raw).trim();
  if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ''));
  if (/^\d+(?:,\d+)?$/.test(text)) return Number(text.replace(',', '.'));
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return NaN;
}

/**
 * Semua angka rupiah di sebuah teks: "Rp 75.000", "Rp75.000,-", "75rb",
 * "75 ribu", "1,5 juta", "2jt". Hasilnya angka rupiah penuh, hanya >= 1.000.
 */
function extractAmounts(text) {
  const value = String(text || '');
  const found = [];
  for (const m of value.matchAll(/\bRp\.?\s*(\d[\d.,]*\d|\d)(?:\s*(juta|jt|ribu|rb|k)\b)?/gi)) {
    let n = parseNumber(m[1].replace(/[.,]$/, ''));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'juta' || unit === 'jt') n *= 1_000_000;
    else if (unit === 'ribu' || unit === 'rb' || unit === 'k') n *= 1000;
    found.push({ amount: Math.round(n), index: m.index, end: m.index + m[0].length });
  }
  for (const m of value.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(juta|jt|ribu|rb)\b/gi)) {
    // "Rp 2,5 juta" sudah terbaca oleh pola Rp di atas.
    if (found.some((f) => f.end !== undefined && m.index >= f.index && m.index < f.end)) continue;
    const base = parseNumber(m[1]);
    if (!Number.isFinite(base)) continue;
    const unit = m[2].toLowerCase();
    found.push({ amount: Math.round(base * (unit === 'juta' || unit === 'jt' ? 1_000_000 : 1000)), index: m.index });
  }
  return found.filter((f) => f.amount >= MIN_AMOUNT);
}

/** Angka mentah >= 1.000 dari sumber (daftar harga, JSON hasil alat): "45.000", "85000". */
function extractNumbers(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?<![\d.,])\d{1,3}(?:\.\d{3})+(?![\d])|(?<![\d.,])\d{4,}(?![\d])/g)) {
    const n = parseNumber(m[0]);
    if (Number.isFinite(n) && n >= MIN_AMOUNT) out.add(Math.round(n));
  }
  // Pecahan dari penulisan "1.250.000,00" tetap terbaca di atas; "1,5 juta" lewat extractAmounts.
  for (const { amount } of extractAmounts(text)) out.add(amount);
  return out;
}

/** Angka bulat mandiri di teks ("10 sak", "x 40"): jumlah barang yang disebut. */
function standaloneIntegers(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?<![\d.,])(\d{1,4})(?![\d.,]\d)(?!\s*(?:%|kg|mm|cm|m\b|liter|l\b))/gi)) out.add(Number(m[1]));
  return out;
}

/**
 * Apakah angka `amount` punya sumber? Sah bila:
 *  1. ada di sumber (prompt, hasil alat, kata customer), atau
 *  2. kelipatan satu harga sumber dengan pengali yang DISEBUT di percakapan
 *     (customer minta "10 sak"; 10 x harga satuan sah, 12 x 4.000 tanpa ada
 *     "12" di mana pun tidak), atau
 *  3. jumlah dua atau tiga angka lain di balasan yang sama yang sudah sah
 *     (harga + ongkir = total).
 * Angka yang diturunkan sembarang kelipatan dulu meloloskan harga karangan:
 * "Rp 48.000" lolos karena 12 x Rp 4.000 dari teks promo di prompt dasar.
 */
function explainer(sourceText, { quantityText = '', replyAmounts = [] } = {}) {
  const base = extractNumbers(sourceText);
  const pool = [...base];
  const quantities = standaloneIntegers(quantityText);
  const basic = (amount) => {
    if (base.has(amount)) return true;
    for (const a of pool) {
      if (a < MIN_AMOUNT || amount % a !== 0) continue;
      const k = amount / a;
      if (k >= 2 && k <= MAX_MULTIPLIER && quantities.has(k)) return true;
    }
    return false;
  };
  const sound = [...new Set(replyAmounts)].filter(basic);
  return (amount) => {
    if (basic(amount)) return true;
    for (let i = 0; i < sound.length; i += 1) {
      for (let j = i; j < sound.length; j += 1) {
        if (sound[i] + sound[j] === amount) return true;
        for (let k = j; k < sound.length; k += 1) {
          if (sound[i] + sound[j] + sound[k] === amount) return true;
        }
      }
    }
    return false;
  };
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9👉✅🙏])|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Kalimat di balasan yang menyebut harga tanpa sumber.
 * @returns {{ sentence: string, amount: number }[]}
 */
function findInventedPrices(reply, sourceText, { quantityText = '' } = {}) {
  const amounts = extractAmounts(reply);
  if (!amounts.length) return [];
  // Jumlah barang yang sah = yang disebut customer atau di balasan itu sendiri ("10 sak ...").
  const explained = explainer(sourceText, { quantityText: `${quantityText}\n${reply}`, replyAmounts: amounts.map((a) => a.amount) });
  const invented = new Set(amounts.filter((a) => !explained(a.amount)).map((a) => a.amount));
  if (!invented.size) return [];
  const out = [];
  for (const sentence of splitSentences(reply)) {
    const hit = extractAmounts(sentence).find((a) => invented.has(a.amount));
    if (hit) out.push({ sentence, amount: hit.amount });
  }
  return out;
}

const rupiah = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

/** Buang kalimat yang menyebut harga tanpa sumber. */
function stripInventedPrices(reply, sourceText, options) {
  const bad = new Set(findInventedPrices(reply, sourceText, options).map((v) => v.sentence));
  if (!bad.size) return reply;
  return splitSentences(reply).filter((s) => !bad.has(s)).join('\n').trim();
}

module.exports = { extractAmounts, extractNumbers, explainer, findInventedPrices, stripInventedPrices, rupiah };
