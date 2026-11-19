'use strict';

/**
 * Stok DealPOS per varian.
 *
 * AI pernah menjawab "ada" untuk barang yang stoknya nol karena daftar harga
 * dan katalog memang tidak membawa stok. `/Inventory` DealPOS memberi satu
 * baris per varian: `VariantID`, `Inventory`, dan `I.{OnHand, Allocated,
 * Available}`. Yang dipakai `Available` (sudah dikurangi yang dialokasikan
 * ke pesanan lain), lalu `Inventory`, lalu `OnHand`.
 *
 * Aturan inti: stok yang TIDAK DIKETAHUI bukan stok nol, dan bukan stok ada.
 * Varian yang tidak muncul di `/Inventory`, atau tarikan yang gagal, berarti
 * `null`: AI tidak boleh menyatakan ada maupun habis, hanya mengonfirmasi ke
 * staf.
 */

const PAGE_SIZE = 200;
const MAX_PAGES = 200;
// Stok yang lebih tua dari ini tidak lagi dipercaya (penarikan berkala 6 jam).
const STALE_MS = 24 * 60 * 60 * 1000;
const LOW_STOCK = 5;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Stok tersedia satu baris `/Inventory`, atau null bila tidak terbaca. */
function availableOf(row) {
  if (!row || typeof row !== 'object') return null;
  const inner = row.I && typeof row.I === 'object' ? row.I : {};
  const n = numberOrNull(inner.Available) ?? numberOrNull(row.Inventory) ?? numberOrNull(inner.OnHand);
  return n === null ? null : Math.max(0, n);
}

/**
 * Semua stok: Map VariantID -> jumlah tersedia. `get(path)` disuntik (sama
 * dengan penarik katalog/harga). Melempar bila gagal; pemanggil memutuskan
 * (stok opsional, jangan sampai menggagalkan tarikan harga).
 */
async function fetchInventory(get, { sleep = defaultSleep, gapMs = 0 } = {}) {
  const stock = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await get(`/Inventory?PageNumber=${page}&PageSize=${PAGE_SIZE}`);
    const rows = Array.isArray(data) ? data
      : Array.isArray(data?.Data) ? data.Data
        : Array.isArray(data?.DataArray) ? data.DataArray
          : Array.isArray(data?.Items) ? data.Items : [];
    if (!rows.length) break;
    for (const row of rows) {
      const id = row?.VariantID ?? row?.VariantId ?? row?.ID;
      const available = availableOf(row);
      if (!id || available === null) continue;
      stock.set(String(id), (stock.get(String(id)) || 0) + available);
    }
    if (rows.length < PAGE_SIZE) break;
    if (gapMs) await sleep(gapMs);
  }
  return stock;
}

/**
 * Keadaan stok satu item katalog/harga: { state, qty }.
 * state: 'habis' | 'menipis' | 'tersedia' | 'tidak_diketahui'.
 */
function stockOf(item, now = Date.now()) {
  const raw = item?.stock ?? item?.stockAvailable;
  const qty = numberOrNull(raw);
  if (qty === null) return { state: 'tidak_diketahui', qty: null };
  const at = item?.stockSyncedAt ? new Date(item.stockSyncedAt).getTime() : null;
  if (at !== null && Number.isFinite(at) && now - at > STALE_MS) return { state: 'tidak_diketahui', qty: null };
  if (qty <= 0) return { state: 'habis', qty: 0 };
  return { state: qty <= LOW_STOCK ? 'menipis' : 'tersedia', qty };
}

const fmt = (n) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 });

/** Teks stok untuk prompt dan hasil alat. */
function stockText(item, now) {
  const { state, qty } = stockOf(item, now);
  if (state === 'habis') return 'HABIS (stok 0)';
  if (state === 'tidak_diketahui') return 'stok tidak diketahui (belum bisa dipastikan)';
  return `stok ${fmt(qty)}${item.unit ? ` ${item.unit}` : ''}${state === 'menipis' ? ' (menipis)' : ''}`;
}

module.exports = { fetchInventory, availableOf, stockOf, stockText, STALE_MS, LOW_STOCK };
