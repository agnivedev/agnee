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
const SHIPPING_MARK = '\u0001ONGKIR\u0001';
const SHIPPING_WORD = /ongkir|ongkos/i;

function isSumOfOthers(amount, amounts) {
  const others = amounts.filter((a) => a !== amount);
  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      if (others[i] + others[j] === amount) return true;
      for (let k = j + 1; k < others.length; k += 1) if (others[i] + others[j] + others[k] === amount) return true;
    }
  }
  return false;
}

/**
 * Sumber boleh membawa bagian fakta ongkir setelah SHIPPING_MARK (hasil cek_ongkir,
 * baris ongkir di playbook, balasan toko sebelumnya). Angka di kalimat ongkir
 * hanya sah bila ada di bagian itu: angka lain yang kebetulan ada di prompt
 * (harga barang lain) bukan ongkir.
 */
function findShippingInvented(reply, sourceText, quantityText) {
  const at = String(sourceText).indexOf(SHIPPING_MARK);
  if (at === -1) return [];
  const shipText = String(sourceText).slice(at + SHIPPING_MARK.length);
  const all = extractAmounts(reply).map((a) => a.amount);
  const explained = explainer(shipText, { quantityText: `${quantityText}\n${reply}`, replyAmounts: [] });
  const out = [];
  for (const sentence of splitSentences(reply)) {
    // Hanya angka yang langsung mengikuti kata ongkir ("ongkir ... Rp 85.000"), bukan harga lain di kalimat yang sama.
    for (const m of sentence.matchAll(/(?:ongkir|ongkos)[^\d]{0,40}?(Rp\.?\s*\d[\d.,]*)/gi)) {
      for (const a of extractAmounts(m[1])) {
        if (!explained(a.amount) && !isSumOfOthers(a.amount, all)) out.push({ sentence, amount: a.amount });
      }
    }
  }
  return out;
}

/*
 * Harga terikat barang.
 *
 * ESBEJE, 29 Okt: Agnes menulis "MU 301 Plasterplus Rp 62.000". Angka 62.000
 * memang ada di prompt (harga barang LAIN), jadi pemeriksaan "angka ada di
 * sumber" meloloskannya, padahal harga MU 301 di DealPOS Rp 104.000. Hanny:
 * tidak boleh ada harga selain dari DealPOS/playbook/katalog — artinya harga
 * barang itu, bukan sembarang angka yang kebetulan ada.
 *
 * Caranya: setiap angka di sumber dan di balasan diikat ke potongan teks
 * tepat sebelumnya (nama barangnya: "MU 301 PLASTERPLUS 40KG: Rp 104.000").
 * Bila potongan di balasan jelas menunjuk barang di sumber (minimal dua kata
 * khas sama, mis. "mu" + "301"), angkanya harus salah satu harga barang yang
 * paling cocok itu, atau kelipatannya dengan jumlah yang disebut. Bila
 * potongannya tak jelas menunjuk barang mana pun ("Harganya Rp ..."), atau
 * kalimatnya tentang total/ongkir/DP, pengikatan tidak dipakai; pemeriksaan
 * "angka ada di sumber" di atas tetap berlaku.
 */

// Kata yang tidak membedakan satu barang dari yang lain.
const BIND_STOP = new Set([
  'rp', 'per', 'harga', 'harganya', 'seharga', 'hargane', 'cuma', 'hanya', 'mulai', 'sekitar', 'kisaran',
  'untuk', 'buat', 'dan', 'atau', 'yang', 'ini', 'itu', 'ada', 'kak', 'kakak', 'ya', 'yah', 'juga', 'dengan',
  'di', 'ke', 'dari', 'jadi', 'nya', 'kami', 'kita', 'saya', 'sudah', 'masih', 'bisa', 'mau', 'pakai', 'pake',
  'sak', 'zak', 'dus', 'box', 'pail', 'gln', 'galon', 'pcs', 'pc', 'lembar', 'lbr', 'btg', 'batang', 'unit',
  'buah', 'set', 'roll', 'meter', 'kaleng', 'botol', 'pack', 'keping', 'biji', 'satuan', 'isi',
  'diskon', 'promo', 'setelah', 'normal', 'catatan', 'nama', 'kode', 'merek', 'ribbon',
  'tidak', 'dicantumkan', 'the', 'of',
]);
// Kalimat tentang angka gabungan, bukan harga satu barang.
const AGGREGATE_WORD = /total|jumlah|grand|semua(?:nya)?|subtotal|keseluruhan|ongkir|ongkos|kirim|pengiriman|kurir|\bdp\b|uang muka|bayar|transfer|budget|anggaran|hemat|potongan|selisih|tagihan|invoice|proforma|cicil/i;
// Satuan ukuran: angkanya yang membedakan (40 vs 50), bukan satuannya.
const SIZE_UNIT = new Set(['kg', 'gr', 'g', 'gram', 'ml', 'mm', 'cm', 'in', 'inch', 'lt', 'liter', 'l', 'm', 'x', 'w', 'watt']);
// Kalimat yang membahas harga, bukan menyebut harga barang ("harga Rp 35.800
// yang diberikan tidak cocok dengan daftar"): biasanya pertanyaan ke tim.
const META_WORD = /(?:tidak|belum|ga|gak|nggak|bukan)\s+(?:ketemu|ada di daftar|cocok|terdaftar|sesuai)|di luar daftar|sudah diberikan/i;
const QUANTITY_UNIT = '(?:sak|zak|dus|box|pail|gln|galon|pcs|pc|lembar|lbr|btg|batang|unit|buah|set|roll|kaleng|botol|pack|keping|biji|m2|m²)';

function bindTokens(text) {
  const cleaned = String(text || '')
    .toLowerCase()
    // "10 sak", "3 dus": jumlah pesanan, bukan nama barang.
    .replace(new RegExp(`(?<![\\w.,])\\d+(?:[.,]\\d+)?\\s*${QUANTITY_UNIT}\\b`, 'g'), ' ')
    // "40KG", "40 kg", "TB110", "4x8": angka dan huruf dipisah supaya
    // penulisan yang berbeda tetap sama ("40" + satuan yang diabaikan).
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2');
  const out = new Set();
  for (const raw of cleaned.split(/[^a-z0-9]+/)) {
    if (!raw || BIND_STOP.has(raw) || SIZE_UNIT.has(raw)) continue;
    if (raw.length < 2 && !/\d/.test(raw)) continue;
    out.add(raw);
  }
  return out;
}

/**
 * Potong teks menjadi pasangan (kata di depan angka, angka). Potongan dimulai
 * setelah angka sebelumnya di baris/kalimat yang sama.
 *
 * Sumber (`reply: false`): baris daftar "- NAMA: Rp X → diskon jadi Rp Y"
 * mengikat semua angkanya ke NAMA, dan potongan yang miskin kata khas
 * ("→ diskon 10% jadi") meminjam kata potongan sebelumnya.
 *
 * Balasan (`reply: true`): lebih hati-hati supaya tak salah tuduh. Hanya
 * angka pertama di baris daftar yang diikat ke judul barisnya ("- Lem
 * Dextone 40gr: Rp 8.000, atau 400gr Rp 61.000": 61.000 bukan milik 40gr),
 * tanpa meminjam kata, dan hanya delapan kata khas terakhir sebelum angka
 * (nama barang menempel ke harganya).
 */
function bindSegments(text, { reply = false } = {}) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const listHead = line.match(/^\s*[-•*]\s*([^:]{2,160}):\s/);
    let previous = null;
    let from = 0;
    const hits = extractAmounts(line).sort((a, b) => a.index - b.index);
    for (const [i, hit] of hits.entries()) {
      const before = line.slice(from, hit.index);
      from = hit.end ?? hit.index + 1;
      const useHead = listHead && (!reply || i === 0);
      let tokens = bindTokens(useHead ? listHead[1] : before);
      if (reply) tokens = new Set([...tokens].slice(-8));
      else if (previous && tokens.size < 2 && !listHead) tokens = new Set([...previous, ...tokens]);
      out.push({ tokens, amount: hit.amount, text: useHead ? listHead[1] : before, aggregate: AGGREGATE_WORD.test(before) });
      previous = tokens;
    }
  }
  return out;
}

/** Pasangan (nama, angka) dari hasil alat berbentuk JSON: tiap objek bernama. */
function jsonRecords(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) jsonRecords(v, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  const name = ['nama', 'name', 'barang', 'item', 'produk'].map((k) => value[k]).find((v) => typeof v === 'string' && v.trim());
  if (name) {
    const label = [name, value.kode, value.code, value.merek, value.brand].filter((v) => typeof v === 'string').join(' ');
    // Kode/ID barang ("1000003303") bukan harga.
    const flat = Object.entries(value)
      .filter(([k, v]) => (typeof v === 'string' || typeof v === 'number') && !/^(?:kode|code|id|sku|barcode|external_id|pos_product_id)$/i.test(k))
      .map(([, v]) => String(v)).join(' ');
    for (const amount of extractNumbers(flat)) out.push({ tokens: bindTokens(label), amount });
  }
  for (const v of Object.values(value)) if (v && typeof v === 'object') jsonRecords(v, out);
  return out;
}

function priceRecords(sourceText) {
  const records = [];
  const text = String(sourceText || '');
  const cut = text.indexOf(SHIPPING_MARK);
  for (const line of (cut === -1 ? text : text.slice(0, cut)).split('\n')) {
    const trimmed = line.trim();
    if (/^[[{]/.test(trimmed)) {
      try {
        jsonRecords(JSON.parse(trimmed), records);
        continue;
      } catch { /* bukan JSON utuh: baca sebagai teks */ }
    }
    for (const seg of bindSegments(line)) if (!seg.aggregate && seg.tokens.size) records.push(seg);
  }
  return records;
}

/**
 * Angka di balasan yang menempel ke barang yang dikenal tapi bukan harga
 * barang itu.
 * @returns {{ sentence: string, amount: number, barang: string, seharusnya: number[] }[]}
 */
function findMismatchedPrices(reply, sourceText, { quantityText = '' } = {}) {
  const records = priceRecords(sourceText);
  if (!records.length) return [];
  const replyAmounts = extractAmounts(reply).map((a) => a.amount);
  const quantities = standaloneIntegers(`${quantityText}\n${reply}`);
  const out = [];
  // "Cocok pakai MU 301 Plasterplus. Harganya Rp 62.000 per sak.": kalimat
  // harga tanpa nama merujuk barang di kalimat sebelumnya (yang tanpa angka).
  let named = null;
  for (const sentence of splitSentences(reply)) {
    const segs = bindSegments(sentence, { reply: true });
    if (!segs.length) {
      named = bindTokens(sentence);
      continue;
    }
    for (const [i, seg] of segs.entries()) {
      if (i === 0 && seg.tokens.size < 2 && named?.size && /\b(?:harga(?:nya)?|seharga|cuma|hanya|mulai)\b/i.test(seg.text)) {
        seg.tokens = new Set([...named, ...seg.tokens]);
      }
      if (seg.aggregate || seg.tokens.size < 2 || META_WORD.test(sentence)) continue;
      if (isSumOfOthers(seg.amount, replyAmounts)) continue;
      let best = 0;
      let matches = [];
      for (const rec of records) {
        let score = 0;
        for (const t of seg.tokens) if (rec.tokens.has(t)) score += 1;
        if (score > best) { best = score; matches = [rec]; } else if (score === best && score > 0) matches.push(rec);
      }
      // Dua kata khas sama ("mu" + "301"), dan barangnya tak ambigu dengan
      // kata lain di kalimat: hanya kata yang benar-benar menunjuk barang.
      if (best < 2) continue;
      const allowed = new Set(matches.map((m) => m.amount));
      const fits = [...allowed].some((price) => {
        if (price === seg.amount) return true;
        if (price < MIN_AMOUNT || seg.amount % price !== 0) return false;
        const k = seg.amount / price;
        return k >= 2 && k <= MAX_MULTIPLIER && quantities.has(k);
      });
      if (fits) continue;
      const label = seg.text.replace(/\s+/g, ' ').trim().replace(/^[,;:.\-–—\s]+|[,;:\-–—\s]+$/g, '');
      out.push({ sentence, amount: seg.amount, barang: label.slice(-80) || [...seg.tokens].join(' '), seharusnya: [...allowed].sort((a, b) => a - b).slice(0, 4) });
    }
    named = null;
  }
  return out;
}

function findInventedPrices(reply, sourceText, { quantityText = '' } = {}) {
  const amounts = extractAmounts(reply);
  if (!amounts.length) return [];
  const shipping = findShippingInvented(reply, sourceText, quantityText);
  // Jumlah barang yang sah = yang disebut customer atau di balasan itu sendiri ("10 sak ...").
  const explained = explainer(sourceText, { quantityText: `${quantityText}\n${reply}`, replyAmounts: amounts.map((a) => a.amount) });
  const invented = new Set([...amounts.filter((a) => !explained(a.amount)).map((a) => a.amount), ...shipping.map((h) => h.amount)]);
  const out = [];
  const seen = new Set();
  if (invented.size) {
    for (const sentence of splitSentences(reply)) {
      const hit = extractAmounts(sentence).find((a) => invented.has(a.amount));
      if (hit) { out.push({ sentence, amount: hit.amount }); seen.add(sentence); }
    }
  }
  // Angka yang ada di sumber, tapi milik barang lain. Satu kalimat bisa
  // memuat dua harga tertukar: laporkan keduanya supaya model tahu semuanya.
  for (const hit of findMismatchedPrices(reply, sourceText, { quantityText })) {
    if (invented.has(hit.amount) || seen.has(`${hit.sentence}\u0000${hit.amount}`)) continue;
    out.push(hit);
    seen.add(`${hit.sentence}\u0000${hit.amount}`);
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

module.exports = { SHIPPING_MARK, extractAmounts, extractNumbers, explainer, findInventedPrices, findMismatchedPrices, stripInventedPrices, rupiah };
