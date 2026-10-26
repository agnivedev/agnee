'use strict';

/**
 * Membaca lokasi yang dikirim customer: link Google Maps di dalam teks, dan
 * pesan "Lokasi" bawaan WhatsApp.
 *
 * Tanpa ini model hanya melihat "https://maps.app.goo.gl/AbC123" — string
 * acak yang tidak bisa dibukanya — atau, untuk pesan Lokasi lewat
 * whatsapp-web.js, base64 JPEG pratinjau peta yang ditaruh di `body`. Customer
 * yang mengirim alamat pengiriman atau lokasi tokonya lalu ditanya alamatnya
 * lagi.
 *
 * Hasilnya ditempel sebagai penanda teks di belakang pesan customer, sama
 * seperti `mediaMarker` untuk foto, supaya model membaca nama tempat, alamat,
 * dan koordinatnya.
 *
 * Jaringan hanya disentuh untuk dua hal: membuka link pendek (maps.app.goo.gl,
 * goo.gl/maps) — hanya ke host Google di daftar, mengikuti redirect satu per
 * satu tanpa pernah mengambil host lain — dan reverse geocoding koordinat yang
 * datang tanpa nama tempat lewat Nominatim (OpenStreetMap). Keduanya diberi
 * batas waktu; gagal berarti penanda "tidak terbaca", bukan balasan yang macet.
 */

const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co']);
const LINK_PATTERN = /https?:\/\/(?:maps\.app\.goo\.gl\/[^\s<>"']+|goo\.gl\/maps\/[^\s<>"']+|g\.co\/kgs\/[^\s<>"']+|(?:www\.|maps\.)?google\.[a-z.]{2,8}\/maps[^\s<>"']*|maps\.google\.[a-z.]{2,8}\/[^\s<>"']*)/gi;
const MAX_LINKS = 2;
const MAX_HOPS = 5;
const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;
const USER_AGENT = 'Agnee/1.0 (+https://agnee.agnive.co)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';

const cache = new Map();

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

function isGoogleMapsHost(hostname) {
  const host = hostname.toLowerCase();
  return /^(?:www\.|maps\.)?google\.(?:com|co\.id|[a-z]{2,3}(?:\.[a-z]{2})?)$/.test(host);
}

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return SHORT_HOSTS.has(host) || isGoogleMapsHost(host) || host === 'consent.google.com';
}

/** Link Google Maps di dalam teks, tanpa tanda baca penutup kalimat. */
function findMapsLinks(text) {
  const found = String(text || '').match(LINK_PATTERN) || [];
  const cleaned = found.map((url) => url.replace(/[.,;:!?)\]}]+$/, ''));
  return [...new Set(cleaned)].slice(0, MAX_LINKS);
}

function validCoords(lat, lng) {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  if (la === 0 && lo === 0) return null;
  return { lat: la, lng: lo };
}

function coordsFromText(text) {
  const match = String(text || '').match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*\+?\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  return match ? validCoords(match[1], match[2]) : null;
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment.replace(/\+/g, ' ')).trim();
  } catch {
    return segment.replace(/\+/g, ' ').trim();
  }
}

/**
 * Isi URL Google Maps yang sudah panjang: nama tempat, teks pencarian, dan
 * koordinat. Titik pin (`!3d…!4d…`) didahulukan dari pusat layar (`@lat,lng`),
 * karena pusat layar bergeser kalau peta digeser sebelum dibagikan.
 *
 * @returns {{ name?: string, query?: string, lat?: number, lng?: number } | null}
 */
function parseMapsUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!isGoogleMapsHost(url.hostname)) return null;

  const result = {};
  const path = url.pathname;

  const place = path.match(/\/maps\/place\/([^/]+)/);
  if (place) {
    const name = decodeSegment(place[1]);
    const coords = coordsFromText(name);
    if (coords) Object.assign(result, coords);
    else if (name) result.name = name;
  }

  const search = path.match(/\/maps\/search\/([^/]+)/);
  if (search) {
    const text = decodeSegment(search[1]);
    const coords = coordsFromText(text);
    if (coords) Object.assign(result, coords);
    else if (text) result.query = text;
  }

  const dir = path.match(/\/maps\/dir\/(?:[^/]*\/)?([^/@]+)/);
  if (dir && !result.name && !result.query) {
    const text = decodeSegment(dir[1]);
    const coords = coordsFromText(text);
    if (coords) Object.assign(result, coords);
    else if (text) result.query = text;
  }

  const pin = `${path}${url.search}`.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pin && result.lat === undefined) {
    const coords = validCoords(pin[1], pin[2]);
    if (coords) Object.assign(result, coords);
  }

  for (const key of ['q', 'query', 'daddr', 'destination', 'll', 'center']) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const coords = coordsFromText(value.replace(/^loc:/, ''));
    if (coords) {
      if (result.lat === undefined) Object.assign(result, coords);
    } else if (!result.name && !result.query) {
      result.query = value.trim();
    }
  }

  const at = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at && result.lat === undefined) {
    const coords = validCoords(at[1], at[2]);
    if (coords) Object.assign(result, coords);
  }

  return Object.keys(result).length ? result : null;
}

async function fetchWithTimeout(fetchImpl, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * URL panjang dari link pendek. Redirect diikuti satu per satu dan setiap
 * langkah harus tetap di host Google; host lain dihentikan tanpa diambil.
 */
async function expandShortLink(raw, fetchImpl) {
  let current = raw;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    let url;
    try {
      url = new URL(current);
    } catch {
      return null;
    }
    if (url.hostname === 'consent.google.com') {
      const next = url.searchParams.get('continue');
      if (!next) return null;
      current = next;
      continue;
    }
    if (!isAllowedHost(url.hostname)) return null;
    if (isGoogleMapsHost(url.hostname) && parseMapsUrl(current)) return current;

    const response = await fetchWithTimeout(fetchImpl, current, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'id,en;q=0.8' },
    });
    const location = response.headers?.get?.('location');
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) return null;
    // Sebagian link pendek menjawab 200 dengan halaman yang memuat URL
    // tujuannya, bukan redirect.
    const html = String(await response.text()).slice(0, 200_000);
    const embedded = html.match(/https:\/\/(?:www\.|maps\.)?google\.[a-z.]{2,8}\/maps[^"'\s<>\\]*/);
    return embedded ? embedded[0].replace(/&amp;/g, '&') : null;
  }
  return null;
}

/** Alamat dari koordinat lewat Nominatim; null kalau gagal. */
async function reverseGeocode(lat, lng, fetchImpl) {
  const key = `geo:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  try {
    const url = `${NOMINATIM}?format=jsonv2&zoom=18&accept-language=id&lat=${lat}&lon=${lng}`;
    const response = await fetchWithTimeout(fetchImpl, url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const address = typeof data?.display_name === 'string' ? data.display_name.trim() : '';
    const value = address || null;
    cacheSet(key, value);
    return value;
  } catch {
    return null;
  }
}

/**
 * Satu link Google Maps menjadi keterangan lokasi.
 *
 * @returns {Promise<{ name?: string, query?: string, address?: string, lat?: number, lng?: number } | null>}
 */
async function resolveMapsLink(raw, { fetchImpl = globalThis.fetch, geocode = true } = {}) {
  const cached = cacheGet(`link:${raw}`);
  if (cached !== undefined) return cached;

  let place = null;
  try {
    let host = '';
    try { host = new URL(raw).hostname.toLowerCase(); } catch { /* bukan URL */ }
    const longUrl = SHORT_HOSTS.has(host) ? await expandShortLink(raw, fetchImpl) : raw;
    place = longUrl ? parseMapsUrl(longUrl) : null;
    if (place && geocode && !place.name && !place.query && place.lat !== undefined) {
      const address = await reverseGeocode(place.lat, place.lng, fetchImpl);
      if (address) place.address = address;
    }
  } catch {
    place = null;
  }
  cacheSet(`link:${raw}`, place);
  return place;
}

function formatCoords(lat, lng) {
  return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

function describePlace(place) {
  const parts = [];
  if (place.name) parts.push(`tempat "${place.name}"`);
  else if (place.query) parts.push(`"${place.query}"`);
  if (place.address) parts.push(`alamat ${place.address}`);
  if (place.lat !== undefined) parts.push(`koordinat ${formatCoords(place.lat, place.lng)}`);
  return parts.join(', ');
}

function linkMarker(place) {
  return place
    ? `[Isi link Google Maps dari customer: ${describePlace(place)}]`
    : '[Customer mengirim link Google Maps yang isinya tidak bisa dibaca]';
}

/**
 * Lokasi dari pesan "Lokasi" WhatsApp. whatsapp-web.js memberi
 * `message.location` ({ latitude, longitude, name, address }), Cloud API
 * memberi `location` dengan bentuk yang sama.
 */
function placeFromLocationMessage(message) {
  const loc = message?.location;
  if (!loc) return null;
  const coords = validCoords(loc.latitude ?? loc.lat, loc.longitude ?? loc.lng);
  const name = typeof loc.name === 'string' ? loc.name.trim() : '';
  const address = typeof loc.address === 'string' ? loc.address.trim() : '';
  if (!coords && !name && !address) return null;
  return { ...(name ? { name } : {}), ...(address ? { address } : {}), ...(coords || {}) };
}

function locationMarker(place, { live = false } = {}) {
  const jenis = live ? 'lokasi terkini (live location)' : 'lokasi';
  return place
    ? `[Customer membagikan ${jenis} WhatsApp: ${describePlace(place)}]`
    : `[Customer membagikan ${jenis} WhatsApp]`;
}

/**
 * Teks pesan customer untuk model, dengan lokasi yang sudah terbaca.
 *
 * Pesan Lokasi diganti seluruhnya — `body`-nya pratinjau peta, bukan tulisan.
 * Pesan teks dengan link Google Maps dipertahankan apa adanya dan diberi
 * penanda di belakangnya.
 */
async function readCustomerText(message, options = {}) {
  if (message?.type === 'location') {
    const place = placeFromLocationMessage(message);
    if (place && !place.name && !place.address && place.lat !== undefined && options.geocode !== false) {
      const address = await reverseGeocode(place.lat, place.lng, options.fetchImpl || globalThis.fetch);
      if (address) place.address = address;
    }
    const caption = typeof message.caption === 'string' ? message.caption.trim() : '';
    const marker = locationMarker(place, { live: Boolean(message.location?.live || message.isLive) });
    return caption ? `${caption}\n\n${marker}` : marker;
  }

  const body = String(message?.body || '');
  const links = findMapsLinks(body);
  if (!links.length) return body;
  const places = await Promise.all(links.map((link) => resolveMapsLink(link, options)));
  return `${body}\n\n${places.map(linkMarker).join('\n')}`;
}

/**
 * Versi tanpa jaringan untuk riwayat percakapan: hanya hasil yang sudah ada di
 * cache. Link yang dibaca di giliran sebelumnya tetap terbaca di giliran
 * berikutnya tanpa dibuka ulang.
 */
function readCustomerTextCached(message) {
  if (message?.type === 'location') {
    const place = placeFromLocationMessage(message);
    if (place && !place.address && place.lat !== undefined) {
      const address = cacheGet(`geo:${place.lat.toFixed(5)},${place.lng.toFixed(5)}`);
      if (address) place.address = address;
    }
    return locationMarker(place);
  }
  const body = String(message?.body || '');
  const links = findMapsLinks(body);
  const known = links.map((link) => cacheGet(`link:${link}`)).filter((place) => place !== undefined);
  if (!known.length) return body;
  return `${body}\n\n${known.map(linkMarker).join('\n')}`;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  findMapsLinks,
  parseMapsUrl,
  resolveMapsLink,
  readCustomerText,
  readCustomerTextCached,
  placeFromLocationMessage,
  clearCache,
};
