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
  // Harga jual (selling price) didahulukan: UnitPrice di sebagian respons
  // DealPOS adalah harga dasar/beli, bukan harga yang boleh disebut ke customer.
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
  // Kata dua huruf yang sering muncul di chat; kode barang dua huruf ("MU 480")
  // tetap dihitung.
  'di', 'ke', 'ya', 'ga', 'gk', 'yg', 'ok', 'dg', 'sy', 'tp', 'dr', 'kk', 'ka', 'pa', 'bu', 'se', 'aj', 'si', 'an', 'kg', 'mm', 'cm',
]);

function tokens(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9.,/ ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.,/]+|[.,/]+$/g, ''))
    .filter((t) => (t.length >= 2 || /\d/.test(t)) && !STOP.has(t));
}

/**
 * Varian yang paling cocok dengan teks. Kata dari pesan customer bernilai
 * lebih dari kata ringkasan, supaya pertanyaan terbaru menang.
 */
function matchProducts(products, { text = '', context = '' } = {}, limit = MAX_MATCHES) {
  const primary = new Set(tokens(text));
  const secondary = new Set(tokens(context).filter((t) => !primary.has(t)));
  if (!primary.size && !secondary.size) return [];
  const scored = [];
  for (const product of products) {
    const words = new Set(tokens(`${product.name} ${product.category || ''}`));
    let score = 0;
    let named = false;
    for (const t of primary) if (words.has(t)) { score += 3; if (!/^\d/.test(t)) named = true; }
    for (const t of secondary) if (words.has(t)) { score += 1; if (!/^\d/.test(t)) named = true; }
    // Angka saja ("40", "1/2") tidak cukup: harus ada kata barang yang cocok.
    if (score > 0 && named) scored.push({ product, score });
  }
  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'id'));
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

module.exports = { mapVariant, fetchVariants, fetchProducts, matchProducts, priceSection, tokens };
