'use strict';

/**
 * Penjaga konsistensi balasan terhadap RIWAYAT percakapan sendiri.
 *
 * ESBEJE 6 Nov (Rusnandar): AI menyebut "TRIPLEK 3MM 4X8 MC/UT Rp62.000", lalu
 * customer bertanya "Ini 62rb yang mana kak?" dan AI menjawab "Tidak ada yang
 * Rp 62.000" — menyangkal harga yang ia tulis sendiri dua menit sebelumnya.
 * Di chat yang sama, "Ok baik" dibalas dengan pesan yang SAMA PERSIS dengan
 * pesan AI sebelumnya.
 *
 * Dua pemeriksaan murni, tanpa model dan tanpa database:
 *  1. `fixDeniedOwnPrice`: kalimat yang menyangkal harga yang sudah AI sebut
 *     diganti dengan penjelasan dari riwayat ("Rp62.000 itu harga <barang>").
 *  2. `fixVerbatimRepeat`: balasan yang identik dengan salah satu balasan AI
 *     sebelumnya dipangkas ke pertanyaannya saja.
 */

const { STAFF_PREFIX } = require('./staff-context');

function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function squash(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Bilangan rupiah dalam teks: "Rp 62.000", "62.000", "62rb", "62 ribu", "1,5jt". */
function amountsIn(text) {
  const out = new Set();
  const re = /(rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta)?(?![\d])/gi;
  let m;
  const src = String(text || '');
  while ((m = re.exec(src))) {
    const [, rp, raw, unitRaw] = m;
    const unit = String(unitRaw || '').toLowerCase();
    let value = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : Number(raw.replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    if (unit === 'rb' || unit === 'ribu' || unit === 'k') value *= 1000;
    else if (unit === 'jt' || unit === 'juta') value *= 1_000_000;
    value = Math.round(value);
    if (!rp && !unit && value < 1000) continue;
    if (value < 1000) continue;
    out.add(value);
  }
  return out;
}

const DENIAL_RE = /\b(?:tidak|nggak|ga|gak|bukan|belum)\s+(?:ada|ketemu|tersedia|terdaftar|ditemukan)\b/i;
const HEDGE_RE = /\bmungkin\s+(?:kakak|kak|anda)\s+(?:melihat|salah|maksud)/i;

function plain(text) {
  return String(text || '').replace(/\*+/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function assistantTexts(history) {
  return (history || [])
    .filter((turn) => turn?.role === 'assistant')
    .map((turn) => String(turn.content ?? turn.text ?? ''))
    .filter((content) => !content.startsWith(STAFF_PREFIX));
}

/** Nama barang pada baris riwayat yang memuat angka itu: "*TRIPLEK 3MM 4X8 MC/UT* Rp62.000 per lbr". */
function itemLineFor(amount, history) {
  const texts = assistantTexts(history).reverse();
  for (const content of texts) {
    for (const line of content.split(/\n+/)) {
      const found = [...amountsIn(line)];
      if (!found.includes(amount)) continue;
      const unit = /\bper\s+([a-z]+)/i.exec(line)?.[1] || '';
      const priceMatch = /(?:seharga\s+|harganya\s+)?Rp\.?\s?[\d.,]+|\b\d+\s*(?:rb|ribu)\b/i.exec(line);
      if (!priceMatch) continue;
      let name = plain(line.slice(0, priceMatch.index))
        .replace(/^[\s•\-–*\d.)]+/, '')
        .replace(/\b(?:seharga|harganya|harga|yaitu|adalah|ada)\s*[:\-]?\s*$/i, '')
        .replace(/[:\-–,]\s*$/, '')
        .trim();
      // Baris berformat kalimat ("Kami ada A seharga X dan B seharga Y"): ambil frasa terakhir sebelum harga.
      if (/\b(?:kami|kita|ada|untuk|yang)\b/i.test(name) && name.split(/\s+/).length > 7) {
        name = name.split(/\b(?:dan|serta|,)\b/i).pop().trim();
      }
      if (name.length >= 4 && name.length <= 90) return { name, unit };
    }
  }
  return null;
}

function rupiahText(amount) {
  return `Rp${amount.toLocaleString('id-ID')}`;
}

/**
 * Kalimat yang menyangkal harga yang pernah AI sebut sendiri diganti dengan
 * jawaban dari riwayat. Hanya dipicu bila angkanya ADA di balasan AI
 * sebelumnya, jadi menyangkal harga yang memang tidak pernah disebut tetap utuh.
 *
 * @returns {{text: string, changed: boolean, amount?: number}}
 */
function fixDeniedOwnPrice(text, { userMessage = '', history = [] } = {}) {
  const sentences = splitSentences(text);
  const sebelumnya = new Set();
  for (const content of assistantTexts(history)) for (const a of amountsIn(content)) sebelumnya.add(a);
  if (!sebelumnya.size) return { text, changed: false };

  let target = null;
  for (const sentence of sentences) {
    if (!DENIAL_RE.test(sentence)) continue;
    for (const amount of amountsIn(sentence)) {
      if (sebelumnya.has(amount)) { target = { sentence, amount }; break; }
    }
    if (target) break;
  }
  if (!target) return { text, changed: false };

  const item = itemLineFor(target.amount, history);
  if (!item) return { text, changed: false };
  const unit = item.unit ? ` per ${item.unit}` : '';
  const jawaban = `${rupiahText(target.amount)}${unit} itu harga ${item.name}, Kak.`;
  const kept = sentences.filter((s) => s !== target.sentence && !HEDGE_RE.test(s));
  // Kalimat lain yang masih menyebut harga barang lain dibuang kalau bertentangan dengan jawaban ini.
  const rest = kept.filter((s) => !(/\bharga\b/i.test(s) && !amountsIn(s).has(target.amount) && amountsIn(s).size && !sebelumnya.has([...amountsIn(s)][0])));
  return { text: [jawaban, ...rest].join('\n').trim(), changed: true, amount: target.amount };
}

/** Pertanyaan terakhir dalam teks (kalimat yang berakhir "?"), atau null. */
function lastQuestion(text) {
  const qs = splitSentences(text).filter((s) => /\?\s*$/.test(s));
  return qs.length ? qs[qs.length - 1] : null;
}

/**
 * Balasan yang identik dengan salah satu dari tiga balasan AI terakhir dikirim
 * ulang apa adanya = mesin macet. Pertanyaannya saja yang dipertahankan, dengan
 * pengantar singkat; tanpa pertanyaan, teksnya dibiarkan (diam lebih buruk).
 */
function fixVerbatimRepeat(text, { history = [] } = {}) {
  const target = squash(text);
  if (target.split(' ').length < 6) return { text, changed: false };
  const recent = assistantTexts(history).slice(-3);
  if (!recent.some((previous) => squash(previous) === target)) return { text, changed: false };
  const question = lastQuestion(text);
  if (!question) return { text, changed: false };
  return { text: `Baik, Kak. Supaya bisa saya lanjutkan: ${question}`, changed: true };
}

function fixConsistency(text, ctx = {}) {
  let current = String(text || '');
  const applied = [];
  const denied = fixDeniedOwnPrice(current, ctx);
  if (denied.changed) { current = denied.text; applied.push('menyangkal_harga_sendiri'); }
  const repeat = fixVerbatimRepeat(current, ctx);
  if (repeat.changed) { current = repeat.text; applied.push('balasan_identik'); }
  return { text: current, applied };
}

module.exports = { amountsIn, fixDeniedOwnPrice, fixVerbatimRepeat, fixConsistency, lastQuestion };
