'use strict';

/**
 * Alat AI `cek_ongkir`: estimasi ongkir Lalamove dari toko ke lokasi customer.
 *
 * Tanpa ini AI hanya bisa berkata "ongkirnya saya pastikan dulu" dan customer
 * menunggu sampai ada orang yang membuka aplikasi Lalamove. Titik jemput
 * diatur sekali di Pengaturan > Integrasi > Lalamove; titik antar diambil
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

const TOOL_NAME = 'cek_ongkir';
const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*\+?\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

const GUIDE = `## ONGKIR LALAMOVE (alat ${TOOL_NAME})
- Kalau customer menanyakan ongkir atau total, atau barang dan lokasinya sudah diketahui, panggil ${TOOL_NAME}. Jangan menyuruh customer menunggu untuk ongkir yang bisa dihitung alat ini.
- Isi "tujuan" dengan koordinat dari penanda lokasi atau link Google Maps customer (mis. "-6.301234,106.652345") kalau ada di percakapan. Kalau customer baru menyebut nama daerah atau alamat, isi dengan teks itu apa adanya.
- Pilih "kendaraan" sesuai berat dan ukuran barang yang dipesan. Kosongkan kalau ragu; kendaraan bawaan toko yang dipakai.
- Sebut hasilnya sebagai estimasi ongkir via Lalamove, lengkap dengan kendaraannya. Kalau "ketepatan" = "perkiraan_area", katakan itu perkiraan ke area tersebut dan minta customer share location WhatsApp supaya angkanya pas.
- Alat ini tidak menentukan jadwal kirim; jangan menjanjikan jam.
- Kalau alat gagal atau lokasi tidak terbaca, jangan mengarang angka. Minta share location, atau katakan ongkirnya dipastikan dulu.`;

/** Alat boleh dipakai? `realChat` = balasan untuk customer sungguhan (ada chatId). */
function isUsable(conn, { realChat }) {
  if (!conn || !conn.enabled || !conn.aiQuotesEnabled) return false;
  if (conn.pickupLat == null || conn.pickupLng == null) return false;
  return conn.environment === 'production' || !realChat;
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

function toolSpec({ conn, run }) {
  const services = servicesOf(conn);
  const vehicleList = services.map((s) => `${s.key}${s.description ? ` (${s.description})` : ''}`).join('; ');
  return {
    name: TOOL_NAME,
    description: `Hitung estimasi ongkir Lalamove dari toko ke lokasi customer. Kendaraan yang tersedia: ${vehicleList || 'bawaan toko'}.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['tujuan'],
      properties: {
        tujuan: { type: 'string', maxLength: 300, description: 'Koordinat "lat,lng" atau link Google Maps dari customer; kalau belum ada, nama tempat atau alamat yang diketik customer.' },
        ...(services.length ? { kendaraan: { type: 'string', enum: services.map((s) => s.key), description: 'Kendaraan sesuai berat dan ukuran barang.' } } : {}),
      },
    },
    run,
  };
}

/**
 * Teks dari AI -> titik antar. `ketepatan` = 'titik' untuk koordinat/link
 * (titik yang dikirim customer), 'perkiraan_area' untuk nama tempat.
 */
async function resolveDestination(raw, { fetchImpl = globalThis.fetch } = {}) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const coords = COORDS.exec(text);
  if (coords) {
    const lat = Number(coords[1]);
    const lng = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      return { lat, lng, address: `${lat},${lng}`, accuracy: 'titik' };
    }
    return null;
  }
  const link = mapsLink.findMapsLinks(text)[0];
  if (link) {
    const place = await mapsLink.resolveMapsLink(link, { fetchImpl });
    if (!place || place.lat === undefined) return null;
    return { lat: place.lat, lng: place.lng, address: place.address || place.name || place.query || `${place.lat},${place.lng}`, accuracy: 'titik' };
  }
  const place = await mapsLink.searchPlace(text, { fetchImpl });
  return place ? { ...place, accuracy: 'perkiraan_area' } : null;
}

const rupiah = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

/**
 * Menjalankan alat. Tidak pernah melempar: hasilnya selalu objek yang bisa
 * dibaca model, termasuk saat gagal, supaya model tidak mengarang angka.
 */
async function quote(conn, args = {}, { fetchImpl = globalThis.fetch, getQuotation = lalamove.getQuotation } = {}) {
  const destination = await resolveDestination(args.tujuan, { fetchImpl }).catch(() => null);
  if (!destination) {
    return { status: 'lokasi_tidak_terbaca', pesan: 'Lokasi customer belum terbaca. Minta customer share location WhatsApp atau kirim link Google Maps.' };
  }
  const services = servicesOf(conn);
  const keys = services.map((s) => s.key);
  const serviceType = keys.includes(args.kendaraan) ? args.kendaraan
    : (keys.includes(conn.defaultService) ? conn.defaultService : (keys.includes('MOTORCYCLE') ? 'MOTORCYCLE' : keys[0]));
  if (!serviceType) return { status: 'gagal', pesan: 'Jenis kendaraan Lalamove belum tersedia. Ongkir dipastikan dulu.' };
  const pickup = { lat: Number(conn.pickupLat), lng: Number(conn.pickupLng), address: conn.pickupAddress || `${conn.pickupLat},${conn.pickupLng}` };
  try {
    const result = await getQuotation(conn, { serviceType, stops: [pickup, destination] }, fetchImpl);
    if (result.total == null) return { status: 'gagal', pesan: 'Lalamove tidak memberi harga. Ongkir dipastikan dulu.' };
    const service = services.find((s) => s.key === serviceType);
    return {
      status: 'ok',
      ongkir: result.currency === 'IDR' ? rupiah(result.total) : `${result.currency} ${result.total}`,
      kendaraan: service?.description ? `${serviceType} (${service.description})` : serviceType,
      jarak_km: result.distanceMeters != null ? Math.round(result.distanceMeters / 100) / 10 : null,
      tujuan: destination.address,
      ketepatan: destination.accuracy,
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
    };
  }
}

module.exports = { TOOL_NAME, GUIDE, isUsable, servicesOf, toolSpec, resolveDestination, quote };
