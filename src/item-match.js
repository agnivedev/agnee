'use strict';

/**
 * Mencocokkan barang yang ditulis model (nama bebas atau kode) ke barang
 * DealPOS/katalog. Model sering menulis "MU-301" atau "Toren Penguin 1050L"
 * alih-alih kode persis; pencocokan longgar dijaga harga: nama yang dekat
 * hanya diterima bila harga satuan yang disebut sama dengan harga barangnya.
 * Beberapa varian (warna) dengan harga sama dilaporkan sebagai ambigu supaya
 * customer yang memilih, bukan model.
 */

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// "MU301" / "1050L" dipecah di batas huruf-angka supaya "MU-301" cocok dengan "MU 301" dan "1050 liter" dengan "1050L".
const tokensOf = (value) => [...new Set(norm(value).replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').split(' ').filter((t) => t.length >= 2 || /\d/.test(t)))];
const priceOf = (item) => {
  const value = item.price ?? item.unitPrice;
  return value === null || value === undefined ? null : Number(value);
};

/**
 * @returns {{ status: 'ok'|'harga_beda'|'varian_ambigu'|'tidak_dikenal', item?: object, candidates?: object[] }}
 */
function resolveLine(items, { kode, nama, harga } = {}) {
  const key = String(kode || nama || '').trim();
  if (!key || !items?.length) return { status: 'tidak_dikenal', candidates: [] };
  const lower = key.toLowerCase();
  const byCode = items.find((i) => i.code && String(i.code).toLowerCase() === lower);
  const normKey = norm(key);
  const exact = byCode || items.find((i) => norm(i.name) === normKey);
  const quoted = harga == null ? null : Math.round(Number(harga));
  if (exact) {
    if (quoted != null && Math.round(priceOf(exact)) !== quoted) return { status: 'harga_beda', item: exact, candidates: [exact] };
    return { status: 'ok', item: exact };
  }

  const q = tokensOf(key);
  if (!q.length) return { status: 'tidak_dikenal', candidates: [] };
  const need = Math.min(2, q.length);
  const near = items
    .map((item) => {
      const set = new Set(tokensOf(item.name));
      const shared = q.filter((t) => set.has(t)).length;
      return { item, shared, all: shared === q.length };
    })
    .filter((x) => x.shared >= need)
    .sort((a, b) => (b.all - a.all) || (b.shared - a.shared));
  if (!near.length) return { status: 'tidak_dikenal', candidates: [] };

  const top = near.slice(0, 12).map((x) => x.item);
  if (quoted == null) return near.length === 1 && near[0].all ? { status: 'ok', item: near[0].item } : { status: 'varian_ambigu', candidates: top };
  const samePrice = near.filter((x) => Math.round(priceOf(x.item)) === quoted);
  if (!samePrice.length) return { status: 'harga_beda', candidates: top };
  // Yang cocok sempurna (semua kata) didahulukan; sisa lebih dari satu = customer harus memilih varian.
  const best = samePrice.filter((x) => x.all);
  let pool = best.length ? best : samePrice;
  if (!best.length) {
    const top = Math.max(...pool.map((x) => x.shared));
    pool = pool.filter((x) => x.shared === top);
  }
  if (pool.length === 1) return { status: 'ok', item: pool[0].item };
  return { status: 'varian_ambigu', candidates: pool.slice(0, 8).map((x) => x.item) };
}

module.exports = { norm, tokensOf, priceOf, resolveLine };
