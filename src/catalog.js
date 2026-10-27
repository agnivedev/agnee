'use strict';

/**
 * Katalog produk & jasa per company, plus ribbon (Unggulan, Best Seller,
 * Promo, Baru, label sendiri).
 *
 * Dua sumber item: diisi tangan (berdiri sendiri) atau ditarik dari POS.
 * POS yang didukung sekarang DealPOS: `/Product` untuk barang (gambar,
 * kategori, diskon, tanggal rilis) dan `/Report/ProductSold` untuk penjualan
 * per varian, yang menentukan ribbon Best Seller. Fungsi di sini murni
 * (tanpa database) supaya bisa diuji tanpa DealPOS.
 */

const { tokens, matchProducts } = require('./dealpos-prices.js');

const PAGE_SIZE = 200;
const MAX_PAGES = 200;
const PAGE_GAP_MS = 400;

const TAG_COLORS = ['amber', 'rose', 'emerald', 'sky', 'violet', 'slate'];
const AUTO_RULES = ['best_seller', 'promo', 'new'];

/** Ribbon bawaan, dibuat saat company pertama kali membuka katalog. */
const DEFAULT_TAGS = [
  { name: 'Unggulan', color: 'amber', autoRule: null, highlight: true, sortOrder: 0 },
  { name: 'Best Seller', color: 'rose', autoRule: 'best_seller', highlight: true, sortOrder: 1 },
  { name: 'Promo', color: 'emerald', autoRule: 'promo', highlight: false, sortOrder: 2 },
  { name: 'Baru', color: 'sky', autoRule: 'new', highlight: false, sortOrder: 3 },
];

// Katalog sekecil ini dikirim utuh ke AI; di atasnya hanya yang cocok dengan
// percakapan plus yang diutamakan (toko bangunan bisa punya ribuan varian).
const FULL_LIST_MAX = 40;
const MAX_HIGHLIGHT = 15;
const MAX_MATCHES = 20;

const text = (value) => {
  const out = String(value ?? '').replace(/\s+/g, ' ').trim();
  return out || null;
};
const num = (value) => {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? n : null;
};
const date = (value) => {
  if (!value || String(value).startsWith('0001')) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Satu baris `/Product` DealPOS -> satu item per varian. Varian bernama
 * "Default"/kosong memakai nama produk saja. Produk/varian discontinued dan
 * yang tanpa harga dilewati: barang Rp 0 di POS biasanya bukan barang jual.
 */
function mapDealposProduct(row) {
  if (!row || typeof row !== 'object' || row.Discontinued === true) return [];
  const productName = text(row.Name);
  if (!productName) return [];
  const variants = Array.isArray(row.Variants) && row.Variants.length ? row.Variants : [];
  const out = [];
  for (const v of variants) {
    if (!v || v.Discontinued === true) continue;
    const id = text(v.ID) || text(v.Code);
    // Respons DealPOS asli (ESBEJE, 27 Okt) hanya punya UnitPrice, dan itu harga jual:
    // harga beli ada di UnitCost. SellingPrice/SellPrice didahulukan kalau suatu akun
    // memakainya; harga 0 berarti dilewati, bukan jatuh ke field berikutnya.
    const price = [v.SellingPrice, v.SellPrice, v.UnitPrice, v.Price, v.SalesPrice].map(num).find((n) => n !== null) ?? null;
    if (!id || price === null || price <= 0) continue;
    const model = text(v.Model ?? v.Name);
    const name = model && !/^default$/i.test(model) && !model.toLowerCase().includes(productName.toLowerCase())
      ? `${productName} ${model}`
      : productName;
    const discount = num(v.Discount);
    out.push({
      externalId: id,
      productId: text(row.ID),
      code: text(v.Code),
      name: name.slice(0, 200),
      category: text(row.Category)?.slice(0, 100) || null,
      price,
      discountPct: discount && discount > 0 && discount < 100 ? discount : 0,
      imageUrl: safeUrl(v.ImageURL) || safeUrl(row.ImageUrl ?? row.ImageURL) || safeUrl(row.ThumbnailUrl ?? row.ThumbnailURL),
      releasedAt: date(row.Released),
    });
  }
  return out;
}

/** Deskripsi Mayar berupa HTML; AI dan tabel hanya butuh teksnya. */
function stripHtml(value) {
  const raw = String(value ?? '');
  if (!raw) return '';
  return raw
    .replace(/<\s*(br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim()
    .slice(0, 2000);
}

/**
 * Satu produk Mayar -> satu item katalog. Hanya produk `active`: yang ditutup
 * (webinar selesai, link dimatikan) hilang dari tarikan dan ditandai
 * `missing_from_source`, jadi AI berhenti menawarkannya. `amount` 0 dibaca
 * "tidak dicantumkan", bukan Rp 0: webinar gratis tetap boleh disebut, tapi
 * AI tidak menyebut harga yang bisa salah.
 */
function mapMayarProduct(row) {
  if (!row || typeof row !== 'object') return null;
  if (String(row.status || '').toLowerCase() !== 'active') return null;
  const id = text(row.id);
  const name = text(row.name);
  if (!id || !name) return null;
  const amount = num(row.amount);
  const created = num(row.createdAt);
  const cover = row.coverImage && typeof row.coverImage === 'object' ? (row.coverImage.url ?? row.coverImage.link) : row.coverImage;
  return {
    externalId: id,
    code: null,
    name: name.slice(0, 200),
    category: (text(row.category) || text(row.type))?.slice(0, 100) || null,
    price: amount !== null && amount > 0 ? amount : null,
    discountPct: 0,
    imageUrl: safeUrl(cover),
    releasedAt: created !== null ? date(new Date(created)) : null,
    description: stripHtml(row.description),
    url: safeUrl(row.linkPayment) || safeUrl(row.linkUrl),
  };
}

function mapMayarProducts(rows) {
  return (Array.isArray(rows) ? rows : []).map(mapMayarProduct).filter(Boolean);
}

/** Hanya http(s); selain itu (javascript:, data:) dibuang. */
function safeUrl(value) {
  const raw = text(value);
  if (!raw || raw.length > 1000) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * Tarik katalog DealPOS. `get(path)` disuntik (produksi: token + antrean laju
 * bersama). Laporan penjualan butuh hak "Report VIEW" di DealPOS; kalau
 * ditolak, katalog tetap masuk dan Best Seller dibiarkan apa adanya
 * (`sold: null`, `soldError` terisi).
 */
async function fetchDealposCatalog(get, { now = new Date(), bestSellerDays = 30, sleep = defaultSleep } = {}) {
  const byId = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await get(`/Product?PageNumber=${page}&PageSize=${PAGE_SIZE}&Discontinued=No`);
    const rows = Array.isArray(data) ? data
      : Array.isArray(data?.DataArray) ? data.DataArray
        : Array.isArray(data?.Data) ? data.Data : [];
    if (!rows.length) break;
    for (const row of rows) for (const item of mapDealposProduct(row)) byId.set(item.externalId, item);
    if (rows.length < PAGE_SIZE) break;
    await sleep(PAGE_GAP_MS);
  }

  let sold = null;
  let soldError = null;
  try {
    const from = new Date(now.getTime() - bestSellerDays * 86_400_000);
    const rows = await get(`/Report/ProductSold?From=${isoDay(from)}&To=${isoDay(now)}&Scope=Variant`);
    sold = new Map();
    for (const row of Array.isArray(rows) ? rows : Array.isArray(rows?.Data) ? rows.Data : []) {
      const code = text(row?.Code);
      const qty = num(row?.Quantity);
      if (code && qty !== null && qty > 0) sold.set(code.toLowerCase(), (sold.get(code.toLowerCase()) || 0) + qty);
    }
  } catch (error) {
    if (error?.rateLimited) throw error;
    soldError = error?.message || String(error);
  }
  return { items: [...byId.values()], sold, soldError };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Item POS mana yang mendapat ribbon otomatis. Kembalian per aturan berisi
 * externalId. `sold` null = laporan tidak terbaca, jadi best_seller null
 * (artinya: jangan ubah pasangan lama).
 */
function autoAssignments(items, sold, { bestSellerCount = 10, newDays = 30, now = new Date() } = {}) {
  const promo = items.filter((i) => i.discountPct > 0).map((i) => i.externalId);
  const cutoff = now.getTime() - newDays * 86_400_000;
  const fresh = items.filter((i) => i.releasedAt && i.releasedAt.getTime() >= cutoff).map((i) => i.externalId);
  let bestSeller = null;
  if (sold) {
    bestSeller = items
      .map((i) => ({ id: i.externalId, qty: (i.code && sold.get(i.code.toLowerCase())) || 0 }))
      .filter((x) => x.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, bestSellerCount)
      .map((x) => x.id);
  }
  return { best_seller: bestSeller, promo, new: fresh };
}

/**
 * Item yang detailnya (merek, tag) ditarik: Best Seller dan Promo saja, paling
 * banyak `max` produk. `/Product/Detail` satu permintaan per produk di API
 * ber-rate-limit; menarik ribuan varian tidak mungkin.
 */
function detailTargets(items, assignments, max = 80) {
  const wanted = new Set([...(assignments.best_seller || []), ...(assignments.promo || [])]);
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!wanted.has(item.externalId) || !item.productId || seen.has(item.productId)) continue;
    seen.add(item.productId);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Tarik merek dan tag untuk `targets`. Map externalId -> { brand, tags }.
 * Berhenti diam-diam bila kena rate limit: detail hanya pelengkap.
 */
async function fetchDealposDetails(get, targets, { sleep = defaultSleep } = {}) {
  const out = new Map();
  for (const item of targets) {
    let data;
    try {
      data = await get(`/Product/Detail?ID=${encodeURIComponent(item.productId)}`);
    } catch (error) {
      if (error?.rateLimited) break;
      continue;
    }
    const tags = (Array.isArray(data?.Tags) ? data.Tags : []).map((t) => text(t)).filter(Boolean).slice(0, 20);
    out.set(item.externalId, { brand: text(data?.Brand)?.slice(0, 100) || null, tags });
    await sleep(PAGE_GAP_MS);
  }
  return out;
}

// Jeda antar varian pada penarikan satuan; laju sebenarnya dibatasi antrean DealPOS bersama.
const DETAIL_GAP_MS = 150;

/**
 * Satuan (UOM) dan merek satu varian dari `/Variant/Detail`. Varian tanpa UOM
 * dikembalikan kosong (bukan galat) supaya tidak ditarik berulang; rate limit
 * dilempar ke pemanggil, yang berhenti dan melanjutkan nanti.
 */
async function fetchVariantDetail(get, variantId) {
  const data = await get(`/Variant/Detail?ID=${encodeURIComponent(variantId)}`);
  return {
    unit: text(data?.UOMName)?.slice(0, 30) || null,
    brand: text(data?.Brand)?.slice(0, 100) || null,
  };
}

/** Tag bawaan DealPOS satu produk dari `/Product/Detail` (juga memberi merek). Rate limit dilempar ke pemanggil. */
async function fetchProductTags(get, productId) {
  const data = await get(`/Product/Detail?ID=${encodeURIComponent(productId)}`);
  return {
    tags: (Array.isArray(data?.Tags) ? data.Tags : []).map((t) => text(t)).filter(Boolean).slice(0, 20),
    brand: text(data?.Brand)?.slice(0, 100) || null,
  };
}

const soldQtyFor = (item, sold) => (sold && item.code ? sold.get(item.code.toLowerCase()) || 0 : null);

const rupiah = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

const RULE_NOTE = {
  best_seller: 'paling laris menurut penjualan toko',
  promo: 'sedang diskon; sebut harga setelah diskon',
  new: 'produk baru',
};

function itemLine(item) {
  const parts = [`- ${item.name}${item.code ? ` [${item.code}]` : ''}${item.kind === 'service' ? ' (jasa)' : ''}${item.brand ? ` (merek ${item.brand})` : ''}`];
  let price = '';
  if (item.price !== null && item.price !== undefined) {
    price = `${rupiah(item.price)}${item.unit ? ` per ${item.unit}` : ''}`;
    if (item.discountPct > 0) {
      price += ` → diskon ${Number(item.discountPct)}% jadi ${rupiah(item.price * (1 - item.discountPct / 100))}`;
    }
  } else {
    price = 'harga tidak dicantumkan';
  }
  if (item.priceNote) price += ` (${item.priceNote})`;
  parts.push(`: ${price}`);
  if (item.tags?.length) parts.push(` · ribbon: ${item.tags.map((t) => t.name).join(', ')}`);
  if (item.description) parts.push(` — ${item.description.replace(/\s+/g, ' ').slice(0, 240)}`);
  if (item.url) parts.push(` · link: ${item.url}`);
  return parts.join('');
}

/**
 * Bagian prompt katalog. `items` sudah tersaring (aktif) dan membawa
 * `tags: [{ id, name }]`. Kosong bila katalog kosong.
 */
function catalogSection({ items, tags, syncedAt = null }, { text: message = '', context = '' } = {}) {
  if (!items.length) return '';
  const activeTags = tags.filter((t) => t.active);
  const highlightIds = new Set(activeTags.filter((t) => t.highlight).map((t) => t.id));
  const when = syncedAt
    ? new Date(syncedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const lines = [
    `## KATALOG PRODUK & JASA${when ? ` (data POS diperbarui ${when} WIB)` : ''}`,
    'Sebut harga hanya dari katalog ini, apa adanya. Barang, ukuran, atau jasa yang tidak ada di sini: jangan menebak harganya. Katalog ini bukan informasi stok.',
  ];
  if (items.some((i) => i.url)) {
    lines.push('Item yang punya "link" boleh dibagikan linknya persis seperti tertulis, hanya saat customer ingin membeli atau mendaftar; jangan mengarang atau mengubah link.');
  }
  const usedTags = activeTags.filter((t) => items.some((i) => i.tags?.some((x) => x.id === t.id)));
  if (usedTags.length) {
    lines.push('Ribbon adalah label resmi toko. Sebut bila relevan; jangan memberi ribbon pada item yang tidak memilikinya.');
    for (const t of usedTags) {
      const note = t.aiNote || RULE_NOTE[t.autoRule] || (t.highlight ? 'pilihan yang diutamakan toko' : '');
      lines.push(`- ${t.name}${note ? `: ${note}` : ''}`);
    }
  }

  if (items.length <= FULL_LIST_MAX) {
    lines.push('', '### Seluruh katalog', ...items.map(itemLine));
    if (highlightIds.size && items.some((i) => i.tags?.some((t) => highlightIds.has(t.id)))) {
      lines.push('', 'Item dengan ribbon yang diutamakan boleh ditawarkan saat customer minta rekomendasi atau belum tahu mau pilih apa.');
    }
    return lines.join('\n');
  }

  const highlighted = items.filter((i) => i.tags?.some((t) => highlightIds.has(t.id))).slice(0, MAX_HIGHLIGHT);
  const shown = new Set(highlighted.map((i) => i.id));
  // Nama dan catatan AI ribbon menjadi sinonim barang yang memakainya: toko
  // mengajari kegunaan barang lewat ribbon ("Perekat Keramik" pada
  // "MU 420 CERAFIX") tanpa mengubah nama barang di POS.
  const tagText = new Map(activeTags.map((t) => [t.id, `${t.name} ${t.aiNote || ''}`]));
  const matched = matchProducts(items.filter((i) => !shown.has(i.id)), { text: message, context }, MAX_MATCHES, { tagText });
  if (highlighted.length) {
    lines.push('', '### Diutamakan (boleh ditawarkan saat customer minta rekomendasi)', ...highlighted.map(itemLine));
  }
  if (matched.length) {
    lines.push('', '### Cocok dengan percakapan ini', ...matched.map(itemLine));
  } else {
    lines.push('', `Katalog berisi ${items.length} item; tidak ada yang cocok dengan pesan ini selain yang di atas. Tanyakan nama/ukuran barangnya bila perlu.`);
  }
  return lines.join('\n');
}

module.exports = {
  TAG_COLORS,
  AUTO_RULES,
  DEFAULT_TAGS,
  mapDealposProduct,
  fetchDealposCatalog,
  mapMayarProduct,
  mapMayarProducts,
  stripHtml,
  autoAssignments,
  soldQtyFor,
  catalogSection,
  detailTargets,
  fetchVariantDetail,
  fetchProductTags,
  DETAIL_GAP_MS,
  fetchDealposDetails,
  safeUrl,
  tokens,
};
