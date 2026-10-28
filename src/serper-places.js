'use strict';

/**
 * Pencarian tempat di Google Maps lewat Serper (`/places`), cadangan untuk
 * cek_alamat kalau OpenStreetMap tidak mengenal nama tempatnya (mal, toko,
 * nama perumahan). Bentuk responsnya mengikuti SerperService::normalizePlaceItems
 * di backend agnive/be: `places[]` dengan title, address, latitude, longitude,
 * category, cid/placeId.
 *
 * Mati kalau SERPER_API_KEY kosong. Kredit habis, kunci ditolak, atau jaringan
 * putus berarti `null`, bukan error: pemanggil jatuh ke hasil OpenStreetMap.
 * Kegagalannya dicatat satu kali per 10 menit; kalau tidak, kredit yang habis
 * tidak meninggalkan jejak apa pun dan fitur ini diam-diam berhenti bekerja.
 */

const ENDPOINT = 'https://google.serper.dev/places';
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const WARN_EVERY_MS = 10 * 60_000;

const cache = new Map();
let lastWarnAt = 0;

function apiKey(options = {}) {
  return options.apiKey ?? process.env.SERPER_API_KEY ?? '';
}

function enabled(options = {}) {
  return Boolean(apiKey(options));
}

function warnOnce(message) {
  if (Date.now() - lastWarnAt < WARN_EVERY_MS) return;
  lastWarnAt = Date.now();
  console.warn(`Serper places: ${message}`);
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

function toPlace(row) {
  const lat = Number(row?.latitude);
  const lng = Number(row?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const title = String(row.title || '').trim();
  const address = String(row.address || '').trim();
  if (!title && !address) return null;
  return { title, address, lat, lng, category: row.category || null };
}

/**
 * Tempat teratas dari Google Maps untuk teks pencarian, atau null. Hanya hasil
 * yang punya koordinat dan nama atau alamat yang dikembalikan; hasil kosong ikut
 * di-cache supaya alamat yang sama tidak membayar dua kali.
 */
async function searchPlaces(query, { fetchImpl = globalThis.fetch, ...options } = {}) {
  const key = apiKey(options);
  if (!key) return null;
  const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 200);
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
      body: JSON.stringify({ q: text, gl: 'id', hl: 'id' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.places)) {
      warnOnce(`permintaan ditolak (${response.status}${data?.message ? `: ${data.message}` : ''})`);
      return null;
    }
    const place = data.places.map(toPlace).find(Boolean) || null;
    cacheSet(cacheKey, place);
    return place;
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

module.exports = { enabled, searchPlaces, clearCache };
