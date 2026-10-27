'use strict';

const crypto = require('node:crypto');

/**
 * Klien Lalamove Partner API v3. Kunci diambil pelanggan sendiri dari
 * partnerportal.lalamove.com (Developers); login aplikasi Lalamove tidak
 * dipakai sama sekali.
 *
 * Sandbox dan production adalah host terpisah dengan pasangan kunci
 * terpisah: kunci sandbox berawalan pk_test_/sk_test_, production
 * pk_prod_/sk_prod_. Order di sandbox tidak memanggil kurir sungguhan.
 */
const HOSTS = {
  sandbox: 'https://rest.sandbox.lalamove.com',
  production: 'https://rest.lalamove.com',
};
const ENVIRONMENTS = Object.keys(HOSTS);
const MARKET = 'ID';
const LANGUAGE = 'id_ID';

/** Lingkungan yang tersirat dari awalan kunci, atau null kalau awalannya lain. */
function environmentOfKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (key.startsWith('pk_test_')) return 'sandbox';
  if (key.startsWith('pk_prod_')) return 'production';
  return null;
}

/**
 * Header `Authorization: hmac <key>:<timestamp>:<signature>`. Yang
 * ditandatangani: timestamp, metode, path lengkap dengan query, dan body
 * mentah, dipisah CRLF dengan satu baris kosong sebelum body.
 */
function signature({ apiSecret, timestamp, method, path, body = '' }) {
  const raw = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
  return crypto.createHmac('sha256', apiSecret).update(raw).digest('hex');
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

/** Pesan galat Lalamove: `{ errors: [{ id, message }] }`, kadang `{ message }`. */
function failure(data, response) {
  const first = Array.isArray(data?.errors) ? data.errors[0] : null;
  const reason = first?.message || first?.id || data?.message || `HTTP ${response.status}`;
  // Gateway Lalamove membalas 502 "invalid response ... upstream" (bukan 401)
  // untuk kunci yang tidak dikenal, termasuk permintaan tanpa kunci sama sekali.
  const keyRejected = response.status === 401 || response.status === 403
    || (response.status === 502 && /upstream/i.test(String(data?.message || '')));
  const error = new Error(keyRejected
    ? 'Lalamove menolak kunci API. Periksa API Key, API Secret, dan mode (sandbox/production). Kalau kunci sudah benar, coba lagi beberapa menit lagi.'
    : `Lalamove menolak permintaan: ${reason}`);
  error.status = response.status;
  error.code = first?.id || null;
  return error;
}

async function lalamoveRequest(conn, method, path, payload, fetchImpl = fetch) {
  const host = HOSTS[conn.environment];
  if (!host) throw new Error('Mode Lalamove tidak dikenali.');
  const body = payload === undefined ? '' : JSON.stringify({ data: payload });
  const timestamp = String(Date.now());
  const headers = {
    authorization: `hmac ${conn.apiKey}:${timestamp}:${signature({ apiSecret: conn.apiSecret, timestamp, method, path, body })}`,
    market: conn.market || MARKET,
    'request-id': crypto.randomUUID(),
  };
  if (body) headers['content-type'] = 'application/json';
  const response = await fetchImpl(`${host}${path}`, {
    method,
    headers,
    body: body || undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readJson(response);
  if (!response.ok) throw failure(data, response);
  return data?.data;
}

/** Kota yang dilayani dan jenis kendaraan per kota, dirapikan untuk disimpan. */
async function fetchCities(conn, fetchImpl = fetch) {
  const rows = await lalamoveRequest(conn, 'GET', '/v3/cities', undefined, fetchImpl);
  if (!Array.isArray(rows)) throw new Error('Balasan Lalamove tidak dikenali — periksa kembali kunci dan modenya.');
  return rows.map((city) => ({
    locode: String(city.locode || ''),
    name: String(city.name || city.locode || ''),
    services: (Array.isArray(city.services) ? city.services : [])
      .map((service) => ({ key: String(service.key || ''), description: String(service.description || '') }))
      .filter((service) => service.key),
  })).filter((city) => city.locode);
}

/** Dipanggil sebelum kunci disimpan: kunci salah harus gagal di sini. */
async function verifyCredentials(conn, fetchImpl = fetch) {
  const cities = await fetchCities(conn, fetchImpl);
  return { cities };
}

const coordinate = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : null;
};

/**
 * Ongkir dari titik jemput ke satu atau beberapa titik antar. Setiap titik:
 * `{ lat, lng, address }`. Hasilnya berlaku sampai `expiresAt` (beberapa
 * menit) dan `quotationId`-nya yang dipakai untuk membuat order.
 */
async function getQuotation(conn, { serviceType, stops }, fetchImpl = fetch) {
  if (!Array.isArray(stops) || stops.length < 2) throw new Error('Butuh titik jemput dan minimal satu titik antar.');
  const payload = {
    serviceType,
    language: LANGUAGE,
    stops: stops.map((stop) => {
      const lat = coordinate(stop.lat);
      const lng = coordinate(stop.lng);
      if (!lat || !lng) throw new Error('Koordinat titik tidak valid.');
      return { coordinates: { lat, lng }, address: String(stop.address || `${lat},${lng}`).slice(0, 500) };
    }),
  };
  const data = await lalamoveRequest(conn, 'POST', '/v3/quotations', payload, fetchImpl);
  const price = data?.priceBreakdown || {};
  return {
    quotationId: data?.quotationId || null,
    serviceType: data?.serviceType || serviceType,
    expiresAt: data?.expiresAt || null,
    total: price.total != null ? Number(price.total) : null,
    currency: price.currency || 'IDR',
    distanceMeters: data?.distance?.value != null ? Number(data.distance.value) : null,
    stops: Array.isArray(data?.stops) ? data.stops.map((stop) => ({ stopId: stop.stopId, address: stop.address })) : [],
  };
}

/** Nomor 62xxx / 08xxx -> E.164 (+62xxx) yang diminta Lalamove. */
function e164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('62')) return `+${digits}`;
  if (digits.startsWith('0')) return `+62${digits.slice(1)}`;
  return digits ? `+62${digits}` : null;
}

/** Pesan kurir dari quotation yang masih berlaku (order dari percakapan, `src/server.js`). */
async function placeOrder(conn, { quotationId, sender, recipients, metadata }, fetchImpl = fetch) {
  const data = await lalamoveRequest(conn, 'POST', '/v3/orders', {
    quotationId,
    sender: { stopId: sender.stopId, name: sender.name, phone: e164(sender.phone) },
    recipients: recipients.map((r) => ({ stopId: r.stopId, name: r.name, phone: e164(r.phone), remarks: r.remarks || '' })),
    isPODEnabled: false,
    ...(metadata ? { metadata } : {}),
  }, fetchImpl);
  return { orderId: data?.orderId || null, status: data?.status || null, shareLink: data?.shareLink || null };
}

/** Batalkan order; Lalamove menolak bila driver sudah ditugaskan terlalu jauh (galatnya diteruskan). */
async function cancelOrder(conn, orderId, fetchImpl = fetch) {
  await lalamoveRequest(conn, 'DELETE', `/v3/orders/${encodeURIComponent(orderId)}`, undefined, fetchImpl);
  return { orderId };
}

async function getOrder(conn, orderId, fetchImpl = fetch) {
  const data = await lalamoveRequest(conn, 'GET', `/v3/orders/${encodeURIComponent(orderId)}`, undefined, fetchImpl);
  return { orderId: data?.orderId || orderId, status: data?.status || null, shareLink: data?.shareLink || null, driverId: data?.driverId || null };
}

module.exports = {
  HOSTS, ENVIRONMENTS, MARKET, environmentOfKey, signature, e164,
  lalamoveRequest, fetchCities, verifyCredentials, getQuotation, placeOrder, getOrder, cancelOrder,
};
