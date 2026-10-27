'use strict';

/**
 * Alat AI `cek_ongkir`: estimasi ongkir Lalamove dari toko ke lokasi customer.
 *
 * Tanpa ini AI hanya bisa berkata "ongkirnya saya pastikan dulu" dan customer
 * menunggu sampai ada orang yang membuka aplikasi Lalamove. Titik jemput
 * = lokasi bertanda titik jemput di Pengaturan > Lokasi; titik antar diambil
 * dari lokasi yang dikirim customer (pin WhatsApp atau link Google Maps, yang
 * sudah dibaca maps-link.js menjadi koordinat), atau dari nama tempat yang
 * diketiknya sebagai perkiraan area.
 *
 * Di chat sungguhan alat ini hanya hidup pada mode production: harga sandbox
 * Lalamove adalah angka uji dan tidak boleh sampai ke customer. Simulator
 * (tanpa chatId) boleh memakai sandbox, dengan penanda di hasilnya.
 */

const lalamove = require('./lalamove');
const mapsLink = require('./maps-link');
const promoRules = require('./promo-rules');

const TOOL_NAME = 'cek_ongkir';
const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*\+?\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

const GUIDE = `## ONGKIR LALAMOVE (alat ${TOOL_NAME})
- Kalau customer menanyakan ongkir atau total, atau barang dan lokasinya sudah diketahui, panggil ${TOOL_NAME}. Jangan menyuruh customer menunggu untuk ongkir yang bisa dihitung alat ini.
- Isi "tujuan" dengan koordinat dari penanda lokasi atau link Google Maps customer (mis. "-6.301234,106.652345") kalau ada di percakapan. Kalau customer baru menyebut nama daerah atau alamat, isi dengan teks itu apa adanya.
- Pilih "kendaraan" sesuai berat dan ukuran barang yang dipesan. Kosongkan kalau ragu; kendaraan bawaan toko yang dipakai.
- Sebut hasilnya sebagai estimasi ongkir via Lalamove, lengkap dengan kendaraannya. Kalau "ketepatan" = "perkiraan_area", katakan itu perkiraan ke area tersebut dan minta customer share location WhatsApp supaya angkanya pas.
- Kalau ada daftar toko di parameter "dari_toko" dan customer ingin barang dikirim dari toko tertentu atau yang terdekat dengannya, isi "dari_toko" dengan nama tokonya. Kosongkan untuk memakai titik jemput bawaan.
- Kalau ada promo gratis ongkir (lihat bagian PROMO), isi "total_belanja", "jumlah_barang", dan "produk" dari pesanan customer sejauh sudah diketahui. Hasil "promo_gratis_ongkir" menentukan apakah gratis; "ongkir_dibayar_customer" adalah yang harus dibayar customer setelah promo.
- Alat ini tidak menentukan jadwal kirim; jangan menjanjikan jam.
- Kalau alat gagal atau lokasi tidak terbaca, jangan mengarang angka. Minta share location, atau katakan ongkirnya dipastikan dulu.`;

/** Lalamove siap dipakai AI? `realChat` = balasan untuk customer sungguhan (ada chatId). */
function lalamoveUsable(conn, { realChat }) {
  if (!conn || !conn.enabled || !conn.aiQuotesEnabled) return false;
  if (conn.pickupLat == null || conn.pickupLng == null) return false;
  return conn.environment === 'production' || !realChat;
}

/** Alat dipakai bila Lalamove siap, atau ada promo gratis ongkir aktif (promo bisa berdiri sendiri). */
function isUsable(conn, { realChat, promos = [] } = {}) {
  return lalamoveUsable(conn, { realChat }) || promoRules.activeRules(promos).length > 0;
}

/** Jenis kendaraan dari semua kota, tanpa kembar. */
function servicesOf(conn) {
  const byKey = new Map();
  for (const city of Array.isArray(conn?.cities) ? conn.cities : []) {
    for (const service of Array.isArray(city.services) ? city.services : []) {
      if (service?.key && !byKey.has(service.key)) byKey.set(service.key, String(service.description || ''));
    }
  }
  return [...byKey.entries()].map(([key, description]) => ({ key, description }));
}

function toolSpec({ conn, run, stores = [], promos = [], lalamoveReady = true }) {
  const services = servicesOf(conn);
  const hasPromo = promoRules.activeRules(promos).length > 0;
  const vehicleList = services.map((s) => `${s.key}${s.description ? ` (${s.description})` : ''}`).join('; ');
  return {
    name: TOOL_NAME,
    description: `${lalamoveReady ? 'Hitung estimasi ongkir Lalamove dari toko ke lokasi customer.' : 'Cek apakah lokasi customer masuk promo gratis ongkir.'}${hasPromo && lalamoveReady ? ' Sekaligus menentukan apakah promo gratis ongkir berlaku.' : ''}${lalamoveReady ? ` Kendaraan yang tersedia: ${vehicleList || 'bawaan toko'}.` : ''}`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['tujuan'],
      properties: {
        tujuan: { type: 'string', maxLength: 300, description: 'Koordinat "lat,lng" atau link Google Maps dari customer; kalau belum ada, nama tempat atau alamat yang diketik customer.' },
        ...(stores.length && lalamoveReady ? { dari_toko: { type: 'string', enum: stores.map((l) => l.name), description: 'Toko asal pengiriman. Kosongkan untuk titik jemput bawaan.' } } : {}),
        ...(hasPromo ? {
          total_belanja: { type: 'number', minimum: 0, description: 'Total harga barang dalam rupiah, kalau sudah diketahui. Untuk syarat promo.' },
          jumlah_barang: { type: 'integer', minimum: 0, description: 'Jumlah seluruh barang yang dipesan, kalau sudah diketahui. Untuk syarat promo.' },
          produk: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 120 }, description: 'Nama produk yang dipesan. Untuk syarat promo.' },
        } : {}),
        ...(services.length && lalamoveReady ? { kendaraan: { type: 'string', enum: services.map((s) => s.key), description: 'Kendaraan sesuai berat dan ukuran barang.' } } : {}),
      },
    },
    run,
  };
}

/**
 * Teks dari AI -> titik antar. `ketepatan` = 'titik' untuk koordinat/link
 * (titik yang dikirim customer), 'perkiraan_area' untuk nama tempat.
 */
async function resolveDestination(raw, { fetchImpl = globalThis.fetch, withAdmin = false } = {}) {
  const found = await resolvePoint(raw, { fetchImpl, withAdmin });
  if (!found) return null;
  // Teks asli customer ikut dicocokkan ke wilayah promo, per segmen alamat.
  return /^\s*-?\d/.test(String(raw || '')) ? found : { ...found, typed: String(raw || '').slice(0, 300) };
}

async function resolvePoint(raw, { fetchImpl, withAdmin }) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const withComponents = async (point) => {
    if (!withAdmin || point.components) return point;
    const admin = await mapsLink.reverseAdmin(point.lat, point.lng, { fetchImpl }).catch(() => null);
    return admin ? { ...point, address: point.address && !/^-?\d/.test(point.address) ? point.address : (admin.address || point.address), components: admin.components } : point;
  };
  const coords = COORDS.exec(text);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      return withComponents({ lat, lng, address: `${lat},${lng}`, accuracy: 'titik' });
    }
    return null;
  }
  const link = mapsLink.findMapsLinks(text)[0];
  if (link) {
    const place = await mapsLink.resolveMapsLink(link, { fetchImpl });
    if (!place || place.lat === undefined) return null;
    return withComponents({ lat: place.lat, lng: place.lng, address: place.address || place.name || place.query || `${place.lat},${place.lng}`, accuracy: 'titik' });
  }
  const place = await mapsLink.searchPlace(text, { fetchImpl });
  return place ? { ...place, accuracy: 'perkiraan_area' } : null;
}

const rupiah = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

/**
 * Menjalankan alat. Tidak pernah melempar: hasilnya selalu objek yang bisa
 * dibaca model, termasuk saat gagal, supaya model tidak mengarang angka.
 */
async function quote(conn, args = {}, {
  fetchImpl = globalThis.fetch, getQuotation = lalamove.getQuotation, stores = [], promos = [], lalamoveReady = true, now = new Date(),
} = {}) {
  const hasPromo = promoRules.activeRules(promos, now).length > 0;
  const destination = await resolveDestination(args.tujuan, { fetchImpl, withAdmin: hasPromo }).catch(() => null);
  if (!destination) {
    return { status: 'lokasi_tidak_terbaca', pesan: 'Lokasi customer belum terbaca. Minta customer share location WhatsApp atau kirim link Google Maps.' };
  }
  const evaluated = hasPromo
    ? promoRules.evaluate(promos, destination, { subtotal: args.total_belanja, qty: args.jumlah_barang, products: args.produk }, now)
    : [];
  const promo = promoRules.summarize(evaluated);
  const promoFields = promo ? { promo_gratis_ongkir: promo } : {};
  const approximate = destination.accuracy === 'perkiraan_area' && promo
    ? { catatan_promo: 'Wilayah dibaca dari nama tempat yang diketik; minta share location WhatsApp bila ingin dipastikan.' }
    : {};

  if (!lalamoveReady || !conn) {
    // Tanpa Lalamove tidak ada angka ongkir; yang bisa dipastikan hanya promonya.
    return { status: 'ok', ketepatan: destination.accuracy, tujuan: destination.address, ...promoFields, ...approximate,
      catatan: 'Ongkir di luar promo tidak dihitung otomatis; dipastikan dulu oleh tim.' };
  }

  const services = servicesOf(conn);
  const keys = services.map((s) => s.key);
  const serviceType = keys.includes(args.kendaraan) ? args.kendaraan
    : (keys.includes(conn.defaultService) ? conn.defaultService : (keys.includes('MOTORCYCLE') ? 'MOTORCYCLE' : keys[0]));
  if (!serviceType) return { status: 'gagal', pesan: 'Jenis kendaraan Lalamove belum tersedia. Ongkir dipastikan dulu.', ...promoFields };
  const store = args.dari_toko ? stores.find((l) => l.name === args.dari_toko) : null;
  const pickup = store
    ? { lat: Number(store.lat), lng: Number(store.lng), address: store.address || `${store.lat},${store.lng}` }
    : { lat: Number(conn.pickupLat), lng: Number(conn.pickupLng), address: conn.pickupAddress || `${conn.pickupLat},${conn.pickupLng}` };
  try {
    const result = await getQuotation(conn, { serviceType, stops: [pickup, destination] }, fetchImpl);
    if (result.total == null) return { status: 'gagal', pesan: 'Lalamove tidak memberi harga. Ongkir dipastikan dulu.', ...promoFields };
    const service = services.find((s) => s.key === serviceType);
    const format = (n) => (result.currency === 'IDR' ? rupiah(n) : `${result.currency} ${n}`);
    const pays = promoRules.customerPays(result.total, evaluated);
    return {
      status: 'ok',
      ongkir: format(result.total),
      ...(pays != null ? { ongkir_dibayar_customer: pays === 0 ? 'GRATIS' : format(pays) } : {}),
      kendaraan: service?.description ? `${serviceType} (${service.description})` : serviceType,
      jarak_km: result.distanceMeters != null ? Math.round(result.distanceMeters / 100) / 10 : null,
      dari: store ? store.name : undefined,
      tujuan: destination.address,
      ketepatan: destination.accuracy,
      ...promoFields,
      ...approximate,
      catatan: conn.environment === 'production'
        ? 'Estimasi Lalamove saat ini; angka final dikonfirmasi saat order dibuat.'
        : 'MODE SANDBOX: angka uji Lalamove, bukan harga asli.',
    };
  } catch (error) {
    const outside = /ERR_OUT_OF_SERVICE_AREA|out of service|service area/i.test(`${error.code || ''} ${error.message || ''}`);
    return {
      status: 'gagal',
      pesan: outside
        ? 'Lokasi customer di luar area layanan Lalamove. Ongkir dipastikan dulu.'
        : 'Ongkir belum bisa dihitung saat ini. Ongkir dipastikan dulu.',
      ...promoFields,
    };
  }
}

module.exports = { TOOL_NAME, GUIDE, isUsable, lalamoveUsable, servicesOf, toolSpec, resolveDestination, quote };
