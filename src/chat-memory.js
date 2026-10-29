'use strict';

/**
 * Ingatan ringan per chat di dalam proses: hasil cek_ongkir dan barang yang
 * sudah ditunjukkan cek_harga. Riwayat chat hanya menyimpan teks, jadi tanpa
 * ini alat pesanan tidak bisa membuktikan bahwa ongkir atau kode barang yang
 * ditulis model berasal dari alat, bukan dari karangannya. Hilang saat restart
 * (alat lalu memintanya dicek ulang), dibatasi ukuran dan umurnya.
 */

const TTL_MS = 6 * 3600_000;
const MAX_CHATS = 500;
const MAX_ENTRIES = 40;

const quotes = new Map();
const shown = new Map();

const keyOf = (companyId, chatId) => `${companyId}:${chatId}`;

function remember(store, companyId, chatId, entries) {
  if (!chatId) return;
  const key = keyOf(companyId, chatId);
  const now = Date.now();
  const current = store.get(key);
  const fresh = current && now - current.at < TTL_MS ? current.rows : [];
  const rows = [...fresh, ...(Array.isArray(entries) ? entries : [entries])];
  const seen = new Set();
  // Yang terbaru menang bila kodenya sama.
  const unique = rows.reverse().filter((row) => {
    const id = row?.code ? `c:${row.code}` : null;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).reverse();
  store.delete(key);
  store.set(key, { at: now, rows: unique.slice(-MAX_ENTRIES) });
  while (store.size > MAX_CHATS) store.delete(store.keys().next().value);
}

function list(store, companyId, chatId) {
  if (!chatId) return [];
  const entry = store.get(keyOf(companyId, chatId));
  return entry && Date.now() - entry.at < TTL_MS ? entry.rows : [];
}

module.exports = { quotes, shown, remember, list };
