'use strict';

/**
 * Pencarian web lewat Jina (s.jina.ai). Dipakai AI hanya saat gambar referensi
 * customer tidak cocok dengan katalog. Kunci dari JINA_API_KEY; tanpa kunci
 * pencarian dilewati (hasil kosong), bukan error.
 *
 * Isi halaman web adalah DATA TIDAK TEPERCAYA yang akan dibaca model. Karena
 * itu yang diambil hanya judul dan cuplikan pendek, tanpa tautan, tanpa
 * karakter kendali; pemanggil membungkusnya sebagai data.
 */

const ENDPOINT = 'https://s.jina.ai/';
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 4;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map();

const clean = (value, max) => String(value ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/https?:\/\/\S+/gi, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

async function search(query, { apiKey = process.env.JINA_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  const q = clean(query, 160);
  if (!apiKey || q.length < 3) return [];
  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;
  try {
    const response = await fetchImpl(`${ENDPOINT}?q=${encodeURIComponent(q)}&gl=ID&hl=id`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'X-Respond-With': 'no-content' },
    });
    if (!response.ok) return [];
    const body = await response.json();
    const results = (Array.isArray(body?.data) ? body.data : []).slice(0, MAX_RESULTS)
      .map((row) => ({ title: clean(row.title, 100), snippet: clean(row.description || row.content, 180) }))
      .filter((row) => row.title);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(q.toLowerCase(), { at: Date.now(), results });
    return results;
  } catch {
    return [];
  }
}

const clearCache = () => cache.clear();

module.exports = { search, clean, clearCache };
