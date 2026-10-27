'use strict';

/**
 * Harga jual dari DealPOS untuk balasan AI.
 *
 * Varian (`/Variant`) ditarik berkala ke `dealpos_products`. Saat membalas,
 * AI tidak diberi seluruh katalog (toko bangunan bisa punya ribuan varian):
 * hanya varian yang namanya cocok dengan pesan customer dan ringkasan chat.
 * Harga yang tidak ada di daftar ini tidak boleh dikarang; playbook menyuruh
 * AI menanyakannya ke departemen.
 */

const { fetchToken, sleep, PAGE_GAP_MS } = require('./dealpos-sync.js');
const { MIN_UNIT_PRICE } = require('./dealpos-orders.js');

const PAGE_SIZE = 200;
const MAX_PAGES = 200;
const MAX_MATCHES = 20;

const firstText = (...values) => {
  for (const value of values) {
    if (value && typeof value === 'object') {
      const nested = firstText(value.Name, value.name, value.Code);
      if (nested) return nested;
      continue;
    }
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(number)) return number;
  }
  return null;
};

/**
 * Satu baris varian DealPOS -> baris `dealpos_products`. Nama field DealPOS
 * tidak terdokumentasi lengkap untuk respons GET, jadi beberapa ejaan dicoba.
 * Varian nonaktif dan yang tanpa harga dilewati.
 */
function mapVariant(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.Inactive === true || row.IsActive === false || row.Active === false || row.Discontinued === true) return null;
  const id = firstText(row.ID, row.Id, row.VariantID, row.Code);
  const productName = firstText(row.ProductName, row.Product);
  const variantName = firstText(row.Name, row.VariantName);
  const name = productName && variantName && !variantName.toLowerCase().includes(productName.toLowerCase())
    ? `${productName} ${variantName}`
    : variantName || productName;
  // Respons DealPOS asli (ESBEJE, 27 Okt): `/Variant` memberi UnitPrice (harga jual)
  // dan UnitCost (harga beli, tidak dipakai). SellingPrice didahulukan kalau suatu
  // akun memakainya.
  const unitPrice = firstNumber(row.SellingPrice, row.SellPrice, row.UnitPrice, row.Price, row.SalesPrice);
  if (!id || !name || unitPrice === null || unitPrice <= 0) return null;
  return {
    variantId: String(id),
    code: firstText(row.Code),
    name: name.slice(0, 200),
    category: firstText(row.Category, row.CategoryName)?.slice(0, 100) || null,
    unit: firstText(row.Unit, row.UOM, row.UnitName)?.slice(0, 30) || null,
    unitPrice,
  };
}

/** Semua varian aktif berharga. `get(path)` disuntik supaya bisa diuji tanpa DealPOS. */
async function fetchVariants(get) {
  const byId = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await get(`/Variant?PageNumber=${page}&PageSize=${PAGE_SIZE}`);
    const rows = Array.isArray(data) ? data : Array.isArray(data?.Data) ? data.Data : Array.isArray(data?.Items) ? data.Items : [];
    if (!rows.length) break;
    for (const row of rows) {
      const mapped = mapVariant(row);
      if (mapped) byId.set(mapped.variantId, mapped);
    }
    if (rows.length < PAGE_SIZE) break;
    await sleep(PAGE_GAP_MS);
  }
  return [...byId.values()];
}

/** Penarik untuk produksi: token + GET dengan tunggu bila dibatasi laju. */
async function fetchProducts(credentials, { dealposGet, token = null, onRateLimit = null } = {}) {
  const bearer = token || await fetchToken(credentials, undefined, { patient: true });
  const get = async (path) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await dealposGet(credentials.host, bearer, path);
      } catch (error) {
        if (!error.rateLimited || attempt >= 3) throw error;
        const wait = Math.min(((error.retryAfter || 180) + 5) * 1000, 400_000);
        onRateLimit?.(wait);
        await sleep(wait);
      }
    }
  };
  return fetchVariants(get);
}

const STOP = new Set([
  'yang', 'dan', 'atau', 'ada', 'ini', 'itu', 'mau', 'kak', 'min', 'gan', 'bisa', 'berapa', 'harga', 'harganya',
  'untuk', 'dengan', 'dari', 'saya', 'aku', 'kami', 'kita', 'tolong', 'info', 'stok', 'ready', 'beli', 'pesan',
  'order', 'butuh', 'perlu', 'buat', 'pakai', 'sama', 'juga', 'aja', 'saja', 'dong', 'nya', 'per', 'customer',
  'pelanggan', 'tanya', 'menanyakan', 'kirim', 'lokasi', 'tahap', 'pembangunan',
  // Kata obrolan yang juga muncul di nama barang ("GOLOK BAGUS", "BELONI HURUF
  // RUMAH") dan membuat barang acak ikut menang.
  'brp', 'apa', 'bagus', 'gimana', 'gmn', 'kakak', 'mas', 'mbak', 'mba', 'pak', 'sis', 'rumah', 'bangun', 'baru',
  // Kata dua huruf yang sering muncul di chat; kode barang dua huruf ("MU 480")
  // tetap dihitung.
  'di', 'ke', 'ya', 'ga', 'gk', 'yg', 'ok', 'dg', 'sy', 'tp', 'dr', 'kk', 'ka', 'pa', 'bu', 'se', 'aj', 'si', 'an', 'kg', 'mm', 'cm',
]);

// Ukuran ditulis customer dengan banyak cara ("1050 liter", "40 kilo"),
// di nama barang biasanya rapat ("1050L", "40KG"). Keduanya dijadikan satu
// bentuk. "lt" sengaja tidak ikut: di chat bangunan "2 lt" berarti 2 lantai.
const UNITS = {
  l: ['liter', 'litre', 'ltr', 'l'],
  ml: ['mililiter', 'ml'],
  kg: ['kilogram', 'kilo', 'kgs', 'kg'],
  g: ['gram', 'grm', 'gr', 'g'],
  mm: ['milimeter', 'mili', 'mm'],
  cm: ['centimeter', 'sentimeter', 'senti', 'cm'],
  m: ['meter', 'mtr', 'm'],
  inch: ['inchi', 'inch', 'inci', '"'],
  w: ['watt', 'w'],
};
const UNIT_OF = new Map(Object.entries(UNITS).flatMap(([unit, names]) => names.map((name) => [name, unit])));
const UNIT_RE = new RegExp(`(\\d)\\s*(${[...UNIT_OF.keys()].sort((a, b) => b.length - a.length).join('|')})(?![a-z0-9])`, 'g');
// Token ukuran: angka+satuan ("1050l", "1/2inch") atau dimensi ("60x60").
const SPEC_RE = /^(\d[\d./]*(?:x\d[\d./]*)*?)(l|ml|kg|g|mm|cm|m|inch|w)?$/;
const isSpec = (t) => /^\d/.test(t) && /[a-z]/.test(t) && SPEC_RE.test(t);

// Harga di bawah ini bukan harga jual (DealPOS memakai Rp 1 untuk base tinting,
// colorant, varian pelengkap); proforma pun menolaknya.
const MIN_PRICE = MIN_UNIT_PRICE;

function tokens(text) {
  return String(text || '').toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1x')
    .replace(UNIT_RE, (_, digit, unit) => `${digit}${UNIT_OF.get(unit)}`)
    .replace(/[^a-z0-9.,/ ]+/g, ' ')
    // Garis miring hanya bagian dari pecahan ("1/2"); "B/PLUMBING" jadi dua kata.
    .replace(/(?<!\d)\/|\/(?!\d)/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.,/]+|[.,/]+$/g, ''))
    .filter((t) => (t.length >= 2 || /\d/.test(t)) && !STOP.has(t));
}

/**
 * Kata untuk pencocokan: `tokens` plus bentuk turunan supaya penulisan yang
 * berbeda tetap bertemu. Ukuran juga menyumbang angkanya saja ("1050l" ->
 * "1050"), dan kode huruf pendek + angka digabung ("mu 301" -> "mu301",
 * "tb 110" -> "tb110").
 */
function matchTerms(text) {
  const base = tokens(text);
  const out = new Set(base);
  base.forEach((t, i) => {
    const size = isSpec(t) && SPEC_RE.exec(t);
    if (size?.[2]) out.add(size[1]);
    const next = base[i + 1];
    if (next && /^[a-z]{1,3}$/.test(t) && /^\d+$/.test(next)) out.add(t + next);
  });
  return out;
}

const productTerms = new WeakMap();
function termsOf(product) {
  let terms = productTerms.get(product);
  if (!terms) {
    terms = matchTerms([product.name, product.category, product.brand].filter(Boolean).join(' '));
    productTerms.set(product, terms);
  }
  return terms;
}

const priceOf = (product) => {
  const price = product.price ?? product.unitPrice;
  return price === null || price === undefined ? null : Number(price);
};

/**
 * Varian yang paling cocok dengan teks. Kata dari pesan customer bernilai
 * lebih dari kata ringkasan, supaya pertanyaan terbaru menang. Ukuran yang
 * sama ("1050 liter" = "1050L") bernilai ganda: itu pembeda paling tajam
 * antara barang utama dan aksesori yang hanya menyebut nama barang utama.
 * Barang berharga < Rp 100 diletakkan setelah semua barang berharga jual.
 *
 * `tagText` (opsional): Map id ribbon -> teks sinonim. Kata di situ dihitung
 * seperti kata di nama barang yang memakai ribbon itu, jadi toko bisa
 * mengajari kegunaan barang ("perekat keramik" untuk "MU 420 CERAFIX") tanpa
 * mengubah nama barangnya.
 */
function matchProducts(products, { text = '', context = '' } = {}, limit = MAX_MATCHES, { tagText = null } = {}) {
  const primary = matchTerms(text);
  const secondary = new Set([...matchTerms(context)].filter((t) => !primary.has(t)));
  if (!primary.size && !secondary.size) return [];
  const tagTerms = new Map();
  for (const [id, value] of tagText || []) tagTerms.set(id, matchTerms(value));
  const wanted = [
    ...[...primary].map((t) => ({ t, weight: 3 })),
    ...[...secondary].map((t) => ({ t, weight: 1 })),
  ].map(({ t, weight }) => ({ t, spec: isSpec(t), named: !/^\d/.test(t), weight: isSpec(t) ? weight * 2 : weight }));
  const scored = [];
  for (const product of products) {
    const own = termsOf(product);
    const tagged = tagTerms.size && product.tags?.length
      ? product.tags.map((tag) => tagTerms.get(tag.id)).filter(Boolean)
      : [];
    let score = 0;
    let named = false;
    let sized = false;
    for (const w of wanted) {
      if (!own.has(w.t) && !tagged.some((terms) => terms.has(w.t))) continue;
      score += w.weight;
      if (w.named) named = true;
      if (w.spec) sized = true;
    }
    // Angka saja ("40", "1/2") tidak cukup. Ukuran tanpa kata barang yang cocok
    // ("toren 1050 liter" untuk "PENGUIN TB110 1050L") boleh, dengan nilai separuh.
    if (score > 0 && (named || sized)) {
      const price = priceOf(product);
      scored.push({ product, score: named ? score : score / 2, placeholder: price !== null && price < MIN_PRICE });
    }
  }
  scored.sort((a, b) => a.placeholder - b.placeholder || b.score - a.score || a.product.name.localeCompare(b.product.name, 'id'));
  return scored.slice(0, limit).map((s) => s.product);
}

const rupiah = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

/** Bagian prompt berisi harga yang cocok. Kosong bila tidak ada yang cocok. */
function priceSection(matches, syncedAt) {
  if (!matches.length) return '';
  const when = syncedAt
    ? new Date(syncedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })
    : null;
  return [
    `## DAFTAR HARGA DEALPOS (harga jual satuan${when ? `, diperbarui ${when} WIB` : ''})`,
    'Hanya varian yang cocok dengan percakapan ini. Sebut harga hanya dari daftar ini, apa adanya. Barang atau ukuran yang tidak ada di daftar: jangan menebak harganya. Daftar ini bukan informasi stok.',
    ...matches.map((p) => `- ${p.name}${p.code ? ` [${p.code}]` : ''}: ${rupiah(p.unitPrice)}${p.unit ? ` per ${p.unit}` : ''}`),
  ].join('\n');
}

module.exports = { mapVariant, fetchVariants, fetchProducts, matchProducts, priceSection, tokens, matchTerms };
