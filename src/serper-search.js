'use strict';

/**
 * Pencarian Google (Serper `/search`) sebagai gerbang terakhir sebelum AI
 * bertanya ke manusia: barang yang disebut customer tidak ada di POS.
 *
 * Hasilnya HANYA untuk mengenali barang (jenis, merek, nama resmi) supaya
 * pencarian ulang di POS memakai nama yang benar. Harga dan stok dari web
 * bukan harga dan stok toko, jadi tidak pernah boleh dikutip ke customer.
 *
 * Mati kalau SERPER_API_KEY kosong. Kredit habis, kunci ditolak, atau jaringan
 * gagal mengembalikan null; balasan customer tidak boleh gagal karenanya.
 */

const ENDPOINT = 'https://google.serper.dev/search';
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const WARN_EVERY_MS = 10 * 60_000;
const MAX_RESULTS = 4;

const cache = new Map();
let lastWarnAt = 0;

const apiKey = (options = {}) => options.apiKey ?? process.env.SERPER_API_KEY ?? '';
const enabled = (options = {}) => Boolean(apiKey(options));

function warnOnce(message) {
  if (Date.now() - lastWarnAt < WARN_EVERY_MS) return;
  lastWarnAt = Date.now();
  console.warn(`Serper search: ${message}`);
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Hasil organik teratas: [{ judul, ringkasan }] atau null. Link sengaja dibuang. */
async function searchWeb(query, { fetchImpl = globalThis.fetch, ...options } = {}) {
  const key = apiKey(options);
  if (!key) return null;
  const text = clean(query, 150);
  if (text.length < 3) return null;
  const cacheKey = text.toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, gl: 'id', hl: 'id', num: MAX_RESULTS }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.organic)) {
      warnOnce(`permintaan ditolak (${response.status}${data?.message ? `: ${data.message}` : ''})`);
      return null;
    }
    const results = data.organic
      .map((row) => ({ judul: clean(row?.title, 120), ringkasan: clean(row?.snippet, 200) }))
      .filter((row) => row.judul)
      .slice(0, MAX_RESULTS);
    const value = results.length ? results : null;
    cacheSet(cacheKey, value);
    return value;
  } catch (error) {
    warnOnce(`gagal (${error.message})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function clearCache() {
  cache.clear();
  lastWarnAt = 0;
}

module.exports = { enabled, searchWeb, clearCache };
