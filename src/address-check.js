'use strict';

/**
 * Alat cek_alamat: alamat yang diketik customer dicari di peta SEBELUM AI
 * meminta customer memperjelas.
 *
 * Tanpa pengecekan, tidak ada yang membedakan alamat yang sudah cukup jelas
 * dari yang belum, jadi AI meminta ulang yang sudah jelas atau menerima yang
 * ngawur. Yang diinginkan: alamat diterima dulu, dicek ke peta, dan hanya
 * bagian yang memang tidak ketemu yang ditanyakan.
 *
 * Petanya OpenStreetMap (Nominatim): gratis dan tanpa kunci, tapi sering tidak
 * mengenal nama perumahan, toko, atau mal. Kalau SERPER_API_KEY terpasang,
 * Google Maps (Serper /places) dicoba sebagai cadangan untuk yang OpenStreetMap
 * tidak temukan atau hanya kenal wilayahnya. "Tidak ketemu" TIDAK berarti
 * alamatnya salah — hasilnya hanya dipakai untuk menahan AI dari meminta ulang
 * yang sudah jelas, bukan untuk menolak.
 */

const mapsLink = require('./maps-link');
const serperPlaces = require('./serper-places');

const TOOL_NAME = 'cek_alamat';

const GUIDE = `## ALAMAT CUSTOMER (alat ${TOOL_NAME})
- Kalau customer menyebut alamat, kelurahan, kecamatan, kota, atau nama tempat tujuan (bukan link Google Maps atau share location, yang sudah terbaca sendiri), panggil ${TOOL_NAME} dengan teks alamatnya SEBELUM membalas soal alamat.
- Kirim alamat bersama kota atau kecamatan yang SUDAH disebut customer sebelumnya di percakapan ini, bukan hanya pesan terakhirnya.
- status "ketemu_jalan": alamat sudah cukup jelas. Terima dan lanjutkan; JANGAN minta alamat lengkap atau minta dikirim ulang.
- status "jalan_ambigu": nama jalan atau tempatnya ada, tapi customer belum menyebut kota atau kecamatan, dan namanya bisa ada di banyak tempat. JANGAN menebak atau menyebut kota/kecamatan dari hasil alat; tanyakan kota atau kecamatannya (atau tawarkan share location).
- status "ketemu_tempat": nama tempat (toko, mal, perumahan) dikenali dan wilayahnya cocok dengan yang customer sebut. Terima dan lanjutkan seperti "ketemu_jalan"; sebut tempatnya seperti customer menuliskannya.
- status "ketemu_area": baru wilayahnya yang terbaca. Terima wilayahnya, lalu tanyakan SATU hal saja yang kurang (nama jalan atau patokan terdekat), atau tawarkan share location WhatsApp.
- status "tidak_ketemu": jangan menuduh alamatnya salah. Minta share location WhatsApp atau link Google Maps, atau patokan terdekat.
- Jangan menyebut koordinat, nama layanan peta, atau kata "alat" ke customer. Sebut alamat seperti customer menuliskannya.`;

function toolSpec({ run }) {
  return {
    name: TOOL_NAME,
    description: 'Cek alamat atau nama tempat yang diketik customer di peta, untuk memutuskan apakah alamatnya sudah cukup jelas atau perlu diperjelas.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['alamat'],
      properties: {
        alamat: { type: 'string', maxLength: 300, description: 'Alamat atau nama tempat seperti yang diketik customer, digabung dengan kota atau kecamatan yang sudah disebutnya sebelumnya.' },
      },
    },
    run,
  };
}

/** Nomor rumah, RT/RW, dan awalan wilayah dibuang: Nominatim jarang mengenalnya. */
function simplify(text) {
  return String(text || '')
    .replace(/\b(?:rt|rw)\.?\s*\d+(?:\s*\/\s*\d+)?/gi, ' ')
    .replace(/\bno(?:mor)?\.?\s*[\w-]+/gi, ' ')
    .replace(/\bblok\s*[\w-]+/gi, ' ')
    .replace(/\b(?:kel|kelurahan|kec|kecamatan|kab|kabupaten|desa)\.?\s+/gi, ' ')
    .replace(/\b(?:jl|jln)\.?\s+/gi, 'Jalan ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*(?:,\s*)+/g, ', ')
    .trim();
}

/**
 * Daftar pencarian dari yang paling rinci sampai wilayahnya saja. Yang
 * terakhir ditandai `areaOnly`: cocoknya hanya membuktikan wilayah itu ada,
 * bukan jalannya.
 */
function variants(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const simple = simplify(raw);
  const parts = simple.split(',').map((p) => p.trim()).filter(Boolean);
  const detailed = [...new Set([raw, simple].filter((v) => v.length >= 3))];
  const area = parts.length > 2 ? parts.slice(-2).join(', ') : '';
  return [
    ...detailed.map((q) => ({ q, areaOnly: false })),
    ...(area.length >= 3 && !detailed.includes(area) ? [{ q: area, areaOnly: true }] : []),
  ];
}

// Kata yang tidak membedakan satu tempat dari yang lain; tidak dihitung sebagai
// bukti cocok antara teks customer dan hasil peta.
const KATA_UMUM = new Set(['dekat', 'depan', 'samping', 'belakang', 'seberang', 'perumahan', 'perum', 'komplek', 'kompleks', 'cluster', 'blok', 'nomor', 'toko', 'rumah', 'gang', 'lantai', 'sebelah']);

const GENERIK = new Set(['kota', 'kabupaten', 'kab', 'daerah', 'khusus', 'ibukota', 'jalan', 'jawa', 'barat', 'timur', 'tengah', 'selatan', 'utara', 'indonesia', 'kecamatan', 'kelurahan', 'desa', 'raya']);

/** Kata penanda wilayah dari hasil peta (kelurahan, kecamatan, kota) yang bukan kata umum. */
function wilayahKata(found) {
  return [found.kelurahan, found.kecamatan, found.kota]
    .filter(Boolean)
    .flatMap((n) => String(n).toLowerCase().split(/[^a-z0-9]+/))
    .filter((w) => w.length >= 4 && !GENERIK.has(w));
}

/** Customer sendiri menyebut wilayahnya? Tanpa itu nama jalan saja bisa di kota mana pun. */
function wilayahDisebut(text, found) {
  const kata = new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/));
  return wilayahKata(found).some((w) => kata.has(w));
}

function kataBermakna(text) {
  return [...new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/))]
    .filter((w) => w.length >= 4 && !GENERIK.has(w) && !KATA_UMUM.has(w) && !/^\d+$/.test(w));
}

/**
 * Apakah tempat dari Google Maps benar-benar yang customer maksud? Pencarian
 * Google selalu mengembalikan sesuatu, bahkan untuk teks ngawur, jadi hasilnya
 * harus berbagi kata dengan teks customer. Kata yang ada di alamat tetapi bukan
 * di nama tempat (kota, kecamatan) dihitung sebagai wilayah yang customer sebut;
 * tanpa itu namanya bisa saja cabang di kota lain.
 */
function nilaiTempat(text, place) {
  const kata = kataBermakna(text);
  const judul = new Set(kataBermakna(place.title));
  const alamat = new Set(kataBermakna(place.address));
  const cocok = kata.filter((w) => judul.has(w) || alamat.has(w));
  const relevan = cocok.length > 0 && cocok.length >= Math.min(2, kata.length);
  const wilayah = kata.some((w) => alamat.has(w) && !judul.has(w));
  return { relevan, wilayah };
}

function components(place) {
  const c = place?.components || {};
  return {
    jalan: c.road || c.pedestrian || c.footway || null,
    kelurahan: c.suburb || c.village || c.neighbourhood || null,
    kecamatan: c.city_district || c.municipality || c.county || null,
    kota: c.city || c.town || c.regency || c.state_district || null,
    provinsi: c.state || null,
  };
}

/**
 * Tidak pernah melempar: hasilnya selalu objek yang bisa dibaca model, supaya
 * kegagalan jaringan menjadi "tidak_ketemu", bukan balasan yang macet.
 */
async function check(raw, { fetchImpl = globalThis.fetch, serperKey } = {}) {
  const text = String(raw || '').trim();
  if (text.length < 3) return { status: 'tidak_ketemu', pesan: 'Alamat terlalu pendek untuk dicek.' };

  const osm = await cekOpenStreetMap(text, fetchImpl);
  if ((osm.status !== 'tidak_ketemu' && osm.status !== 'ketemu_area') || !serperPlaces.enabled({ apiKey: serperKey })) return osm;

  const tempat = await serperPlaces.searchPlaces(text, { fetchImpl, apiKey: serperKey });
  if (!tempat) return osm;
  const nilai = nilaiTempat(text, tempat);
  if (!nilai.relevan) return osm;
  if (!nilai.wilayah) {
    return { status: 'jalan_ambigu', pesan: 'Tempat ini ada di banyak kota. Tanyakan kota atau kecamatannya; jangan menebak.' };
  }
  return { status: 'ketemu_tempat', tempat: tempat.title, terbaca: tempat.address, kategori: tempat.category };
}

async function cekOpenStreetMap(text, fetchImpl) {
  const tries = variants(text);
  for (let i = 0; i < tries.length; i += 1) {
    const place = await mapsLink.searchPlace(tries[i].q, { fetchImpl }).catch(() => null);
    if (!place) continue;
    const found = components(place);
    if (found.jalan && !tries[i].areaOnly) {
      // Nama jalan umum ("Jalan Melati") ada di puluhan kota. Tanpa wilayah dari
      // customer sendiri, hasil peta hanya satu tebakan: tidak boleh dipakai
      // sebagai alamat, dan tidak diberikan ke model supaya tidak ditiru.
      if (!wilayahDisebut(text, found)) {
        return { status: 'jalan_ambigu', pesan: 'Jalan ini ada di banyak kota. Tanyakan kota atau kecamatannya; jangan menebak.' };
      }
      return { status: 'ketemu_jalan', terbaca: place.address, ...found };
    }
    return {
      status: 'ketemu_area',
      terbaca: place.address,
      ...found,
      kurang: found.jalan ? undefined : 'nama jalan atau patokan terdekat',
    };
  }
  return { status: 'tidak_ketemu', pesan: 'Alamat belum terbaca di peta. Bukan berarti salah; minta share location atau patokan.' };
}

module.exports = { TOOL_NAME, GUIDE, toolSpec, check, variants, simplify, nilaiTempat };
