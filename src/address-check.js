'use strict';

/**
 * Alat cek_alamat: alamat yang diketik customer dicari di peta SEBELUM AI
 * meminta customer memperjelas.
 *
 * Tanpa ini AI condong menjawab "boleh kirim alamat lengkapnya kak?" untuk
 * alamat yang sebenarnya sudah cukup, atau menerima alamat yang ngawur. Yang
 * diinginkan: alamat diterima dulu, dicek ke peta, dan hanya bagian yang
 * memang tidak ketemu yang ditanyakan.
 *
 * Petanya OpenStreetMap (Nominatim), bukan Google Maps: gratis dan tanpa
 * kunci, tapi sering tidak mengenal nama perumahan atau nomor rumah. Karena
 * itu "tidak ketemu" TIDAK berarti alamatnya salah — hasilnya hanya dipakai
 * untuk menahan AI dari meminta ulang yang sudah jelas, bukan untuk menolak.
 */

const mapsLink = require('./maps-link');

const TOOL_NAME = 'cek_alamat';

const GUIDE = `## ALAMAT CUSTOMER (alat ${TOOL_NAME})
- Kalau customer menyebut alamat, kelurahan, kecamatan, kota, atau nama tempat tujuan (bukan link Google Maps atau share location, yang sudah terbaca sendiri), panggil ${TOOL_NAME} dengan teks alamatnya SEBELUM membalas soal alamat.
- status "ketemu_jalan": alamat sudah cukup jelas. Terima dan lanjutkan; JANGAN minta alamat lengkap atau minta dikirim ulang.
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
        alamat: { type: 'string', maxLength: 300, description: 'Alamat atau nama tempat persis seperti yang diketik customer.' },
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
async function check(raw, { fetchImpl = globalThis.fetch } = {}) {
  const text = String(raw || '').trim();
  if (text.length < 3) return { status: 'tidak_ketemu', pesan: 'Alamat terlalu pendek untuk dicek.' };

  const tries = variants(text);
  for (let i = 0; i < tries.length; i += 1) {
    const place = await mapsLink.searchPlace(tries[i].q, { fetchImpl }).catch(() => null);
    if (!place) continue;
    const found = components(place);
    if (found.jalan && !tries[i].areaOnly) {
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

module.exports = { TOOL_NAME, GUIDE, toolSpec, check, variants, simplify };
