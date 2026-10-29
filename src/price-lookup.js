'use strict';

/**
 * Alat AI `cek_harga`: cari harga barang di katalog/daftar harga POS.
 *
 * Prompt hanya memuat barang yang namanya cocok dengan pesan customer
 * (toko bangunan bisa punya ribuan barang). Saat customer bertanya dengan
 * bahasanya sendiri ("dinding retak perlu diperbaiki"), tidak ada barang yang
 * cocok, padahal playbook tahu barangnya ("MU 100 Base Plester") dan model
 * mengisi harganya dari ingatan (ESBEJE, 28 Okt: Rp 75.000, harga asli
 * Rp 116.400). Dengan alat ini model mencari barang yang disebut playbook
 * sebelum menyebut harga; penjaga di reply-style menolak angka yang tetap
 * tidak punya sumber.
 */

const { matchProducts } = require('./dealpos-prices');
const { rupiah } = require('./price-guard');

const TOOL_NAME = 'cek_harga';
const MAX_RESULTS = 8;

const GUIDE = `## CEK HARGA (alat ${TOOL_NAME})
- Harga hanya boleh disebut dari daftar harga/katalog di atas atau dari hasil ${TOOL_NAME}. Jangan pernah menyebut angka harga dari ingatan atau perkiraan.
- SEBELUM menyebut, menawarkan, atau merekomendasikan barang apa pun yang belum tertulis di daftar di atas (mis. customer menyebut kebutuhan seperti "dinding retak", bukan nama barang), pilih barang yang cocok dari playbook lalu panggil ${TOOL_NAME} dengan nama barangnya (mis. "MU 100 Base Plester") di giliran yang sama, dan sebut harganya dari hasilnya. Boleh memanggilnya beberapa kali untuk beberapa barang. Jangan menulis "harganya saya pastikan dulu" untuk barang yang bisa kamu cari sendiri.
- Cek di sini DULU. Bertanya ke departemen hanya bila ${TOOL_NAME} tidak menemukan barangnya atau kamu ragu barang mana yang dimaksud; jangan bertanya ke departemen untuk harga atau kode barang yang ada di hasil.
- Sebut varian, harga, dan satuan (UOM) PERSIS seperti hasilnya: nama lengkap varian, "harga", dan "satuan" (zak, pcs, dus, set, dst.). Jangan menebak atau mengganti satuan (jangan "sak"/"unit"/"kardus"/"piece" kalau hasilnya "zak"/"pcs"/"dus"). Kalau satuan tidak dicantumkan, jangan menyebut satuan.
- Kalau hasilnya berisi beberapa varian (warna, ukuran, kemasan) dari barang yang sama, sebutkan SEMUA pilihannya langsung beserta harganya dalam satu pesan (mis. "Biru tua Rp 2.619.000, hitam Rp 2.619.000, orange Rp 2.745.000 per pcs") lalu tanyakan mau yang mana. Jangan menanyakan warna tanpa menyebut pilihannya dan jangan berkata semua varian sama saja.
- Kalau ${TOOL_NAME} tidak menemukan barangnya, katakan nama barangnya kamu pastikan dulu dan jangan menyebut angka.
- Harga di sini bukan informasi stok.`;

function priceOf(item) {
  const value = item.price ?? item.unitPrice;
  return value === null || value === undefined ? null : Number(value);
}

function rowOf(item) {
  const price = priceOf(item);
  const row = {
    nama: item.name,
    ...(item.code ? { kode: item.code } : {}),
    ...(item.brand ? { merek: item.brand } : {}),
    harga: price === null ? 'harga tidak dicantumkan' : `${rupiah(price)}${item.unit ? ` per ${item.unit}` : ''}`,
    satuan: item.unit || 'tidak dicantumkan',
  };
  if (price !== null && Number(item.discountPct) > 0) {
    row.diskon = `${Number(item.discountPct)}%`;
    row.harga_setelah_diskon = `${rupiah(price * (1 - Number(item.discountPct) / 100))}${item.unit ? ` per ${item.unit}` : ''}`;
  }
  if (item.priceNote) row.catatan_harga = String(item.priceNote);
  if (item.tags?.length) row.ribbon = item.tags.map((t) => t.name);
  return row;
}

/** Hasil pencarian untuk model. Tidak pernah melempar. */
function lookup(items, args = {}, { tagText, onResults } = {}) {
  const query = String(args.barang || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (query.length < 2) return { status: 'kueri_kosong', pesan: 'Sebut nama barangnya.' };
  const matches = matchProducts(items, { text: query }, MAX_RESULTS, tagText ? { tagText } : undefined);
  if (!matches.length) {
    return { status: 'tidak_ketemu', pesan: 'Tidak ada barang yang cocok di daftar harga. Jangan menyebut harga; katakan nama barangnya kamu pastikan dulu, atau tanyakan nama/ukuran yang lebih spesifik.' };
  }
  onResults?.(matches);
  return { status: 'ok', hasil: matches.map(rowOf), catatan: 'Harga jual dari POS saat ini. Bukan informasi stok.' };
}

function toolSpec({ items, tagText, onResults }) {
  return {
    name: TOOL_NAME,
    description: 'Cari harga barang di katalog/daftar harga toko berdasarkan nama atau kodenya. Wajib dipakai sebelum menyebut harga barang yang belum tertulis di daftar di prompt.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['barang'],
      properties: {
        barang: { type: 'string', maxLength: 200, description: 'Nama atau kode barang, mis. "MU 100 Base Plester" atau "Semen Jakarta 40KG".' },
      },
    },
    run: (args = {}) => lookup(items, args, { tagText, onResults }),
  };
}

module.exports = { TOOL_NAME, GUIDE, lookup, toolSpec };
