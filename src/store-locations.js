'use strict';

/**
 * Lokasi toko untuk AI: alamat, jam buka, dan toko terdekat dari customer.
 *
 * Sumbernya Pengaturan > Lokasi (`company_locations`). Hanya lokasi yang
 * `openToCustomers` yang sampai ke AI: gudang dan tempat tertutup tidak
 * pernah disebut ke customer. Nama dan nomor penanggung jawab juga tidak ikut,
 * karena itu data pengirim kurir, bukan untuk customer.
 */

const deliveryQuote = require('./delivery-quote');
const openingHours = require('./opening-hours');

const TOOL_NAME = 'cari_toko_terdekat';
const MAX_LOCATIONS = 30;
const MAX_RESULTS = 3;

const clip = (value, max) => {
  const out = String(value ?? '').replace(/\s+/g, ' ').trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
};

/** Lokasi yang boleh disebut ke customer dan punya titik peta. */
function customerFacing(locations) {
  return (Array.isArray(locations) ? locations : [])
    .filter((l) => l && l.openToCustomers !== false && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)))
    .slice(0, MAX_LOCATIONS);
}

function mapsUrlOf(location) {
  if (location.mapsUrl && /^https?:\/\//i.test(location.mapsUrl)) return location.mapsUrl;
  return `https://www.google.com/maps?q=${Number(location.lat)},${Number(location.lng)}`;
}

/** Jarak garis lurus (km) antara dua titik. */
function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Lokasi terurut dari yang terdekat ke `point`, dengan jarak pembulatan 0,1 km. */
function nearest(locations, point, limit = MAX_RESULTS) {
  return customerFacing(locations)
    .map((location) => ({
      location,
      km: Math.round(distanceKm({ lat: Number(location.lat), lng: Number(location.lng) }, point) * 10) / 10,
    }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

const GUIDE = `## LOKASI TOKO
- Alamat dan jam buka hanya boleh disebut dari daftar ini, apa adanya. Kalau customer menanyakan lokasi atau jam buka yang tidak ada di daftar, katakan akan dipastikan dulu. Jangan menebak.
- Alamat atau jam buka yang tertulis "tidak tersedia" tidak boleh disebut, dan keadaan datanya pun tidak boleh disinggung sama sekali (jangan menyebut isian, sistem, data, atau pengaturan). Cukup katakan jam bukanya (atau alamatnya) kamu pastikan dulu, lalu lanjutkan percakapan.
- "sekarang" pada sebuah toko sudah dihitung dari jadwal dan zona waktu toko: pakai itu untuk menjawab "sekarang buka atau tutup?" dan "kapan buka lagi?". Jadwal berlaku untuk hari biasa; libur atau hari khusus ada di catatan jam buka.
- Daftar ini tidak memuat stok. Jangan menjanjikan barang ada di toko tertentu.
- Tempat lain yang tidak ada di daftar tidak untuk dikunjungi customer; jangan menyebutnya dan jangan mengarahkan customer ke sana.
- Sertakan link peta saat customer ingin datang atau minta lokasi.`;

const TOOL_GUIDE = `- Kalau ada lebih dari satu toko dan customer menanyakan toko terdekat, atau sudah mengirim lokasinya (penanda lokasi, link Google Maps, atau nama daerah), panggil ${TOOL_NAME}. Sebut jaraknya sebagai jarak garis lurus, bukan jarak tempuh.
- Kalau lokasi customer belum ada, tanyakan daerahnya atau minta share location WhatsApp. Jangan menebak toko mana yang terdekat.`;

/** "sekarang buka/tutup" dari jadwal per hari; kosong untuk lokasi yang jam bukanya hanya teks. */
function nowStatus(location, { now, timeZone } = {}) {
  return location.openingSchedule ? openingHours.statusLine(location.openingSchedule, now || new Date(), timeZone) : '';
}

function locationLine(location, context = {}) {
  const kind = location.kind === 'warehouse' ? 'Gudang' : 'Toko';
  const parts = [`- ${clip(location.name, 80)} (${kind})`];
  const address = clip(location.address, 300);
  parts.push(address ? `alamat: ${address}` : 'alamat: tidak tersedia');
  const hours = clip(location.openingHours, 200);
  parts.push(hours ? `jam buka: ${hours}` : 'jam buka: tidak tersedia');
  const status = nowStatus(location, context);
  if (status) parts.push(`sekarang: ${status}`);
  parts.push(`peta: ${mapsUrlOf(location)}`);
  const notes = clip(location.notes, 300);
  if (notes) parts.push(`catatan: ${notes}`);
  return parts.join('; ');
}

/** Bagian prompt. Kosong bila tidak ada lokasi yang boleh disebut. */
function section(locations, { withNearestTool = false, now, timeZone } = {}) {
  const open = customerFacing(locations);
  if (!open.length) return '';
  return [GUIDE, withNearestTool ? TOOL_GUIDE : '', '', ...open.map((location) => locationLine(location, { now, timeZone }))].filter((l) => l !== '').join('\n');
}

/** Alat hanya berguna bila ada pilihan: minimal dua tempat yang boleh dikunjungi. */
function isUsable(locations) {
  return customerFacing(locations).length >= 2;
}

function toolSpec({ locations, run }) {
  return {
    name: TOOL_NAME,
    description: 'Cari toko yang paling dekat dengan lokasi customer, lengkap dengan alamat, jam buka, dan jarak garis lurus.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['lokasi_customer'],
      properties: {
        lokasi_customer: { type: 'string', maxLength: 300, description: 'Koordinat "lat,lng" atau link Google Maps dari customer; kalau belum ada, nama daerah atau alamat yang diketik customer.' },
      },
    },
    run,
  };
}

/** Menjalankan alat. Tidak pernah melempar, supaya model tidak mengarang. */
async function findNearest(locations, args = {}, { fetchImpl = globalThis.fetch, now, timeZone } = {}) {
  const destination = await deliveryQuote.resolveDestination(args.lokasi_customer, { fetchImpl }).catch(() => null);
  if (!destination) {
    return { status: 'lokasi_tidak_terbaca', pesan: 'Lokasi customer belum terbaca. Minta customer share location WhatsApp, kirim link Google Maps, atau sebut daerahnya.' };
  }
  const ranked = nearest(locations, { lat: destination.lat, lng: destination.lng });
  if (!ranked.length) return { status: 'tidak_ada_toko', pesan: 'Belum ada toko yang bisa dikunjungi customer.' };
  return {
    status: 'ok',
    ketepatan: destination.accuracy,
    toko_terdekat: ranked.map(({ location, km }) => ({
      nama: clip(location.name, 80),
      alamat: clip(location.address, 300) || null,
      jam_buka: clip(location.openingHours, 200) || null,
      sekarang: nowStatus(location, { now, timeZone }) || null,
      jarak_garis_lurus_km: km,
      peta: mapsUrlOf(location),
      catatan: clip(location.notes, 300) || null,
    })),
    catatan: destination.accuracy === 'perkiraan_area'
      ? 'Lokasi customer hanya perkiraan area dari nama tempat; minta share location bila ingin lebih tepat.'
      : 'Jarak adalah garis lurus, bukan jarak tempuh.',
  };
}

module.exports = {
  TOOL_NAME, GUIDE, customerFacing, mapsUrlOf, distanceKm, nearest, section, isUsable, toolSpec, findNearest,
};
