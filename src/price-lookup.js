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

const { matchProducts, tokens, matchTerms } = require('./dealpos-prices');
const { rupiah } = require('./price-guard');

const TOOL_NAME = 'cek_harga';
const MAX_RESULTS = 8;
const MAX_ITEMS = 10;

const GUIDE = `## CEK HARGA (alat ${TOOL_NAME})
- Harga hanya boleh disebut dari daftar harga/katalog di atas atau dari hasil ${TOOL_NAME}. Jangan pernah menyebut angka harga dari ingatan atau perkiraan.
- SEBELUM menyebut, menawarkan, atau merekomendasikan barang apa pun yang belum tertulis di daftar di atas (mis. customer menyebut kebutuhan seperti "dinding retak", bukan nama barang), pilih barang yang cocok dari playbook lalu panggil ${TOOL_NAME} dengan nama barangnya (mis. "MU 100 Base Plester") di giliran yang sama, dan sebut harganya dari hasilnya. Boleh memanggilnya beberapa kali untuk beberapa barang. Jangan menulis "harganya saya pastikan dulu" untuk barang yang bisa kamu cari sendiri.
- Cek di sini DULU. Bertanya ke departemen hanya bila ${TOOL_NAME} tidak menemukan barangnya atau kamu ragu barang mana yang dimaksud; jangan bertanya ke departemen untuk harga atau kode barang yang ada di hasil.
- Sebut varian, harga, dan satuan (UOM) PERSIS seperti hasilnya: nama lengkap varian, "harga", dan "satuan" (zak, pcs, dus, set, dst.). Jangan menebak atau mengganti satuan (jangan "sak"/"unit"/"kardus"/"piece" kalau hasilnya "zak"/"pcs"/"dus"). Kalau satuan tidak dicantumkan, jangan menyebut satuan.
- Kalau hasilnya berisi beberapa varian (warna, ukuran, kemasan) dari barang yang sama, sebutkan SEMUA pilihannya langsung beserta harganya dalam satu pesan (mis. "Biru tua Rp 2.619.000, hitam Rp 2.619.000, orange Rp 2.745.000 per pcs") lalu tanyakan mau yang mana. Jangan menanyakan warna tanpa menyebut pilihannya dan jangan berkata semua varian sama saja.
- Customer yang menyebut BANYAK barang dalam satu pesan (daftar kebutuhan/penawaran): panggil ${TOOL_NAME} SEKALI dengan "daftar" berisi semua barangnya (satu teks per barang, persis seperti ditulis customer, termasuk kode dari kemasan), jangan berhenti di barang pertama. Jawab per barang: yang ketemu langsung sebut varian, harga per satuan, dan subtotal (harga x jumlah yang disebut customer); yang tidak ketemu diteruskan ke tim (lihat di bawah).
- Barang yang statusnya "tidak_ketemu" tidak ada di daftar harga/POS: langsung tanyakan ke tim/Management lewat alat tanya departemen bila ada (satu pertanyaan berisi semua barang yang belum ketemu beserta jumlah dan syarat yang diminta customer), tanpa menyuruh customer mengulang nama atau kode yang sudah ia tulis. Ke customer cukup bilang akan dicek dulu ke tim dan kamu kabari; JANGAN mengatakan barangnya "tidak terdaftar/tidak ada di sistem/daftar" (customer tidak perlu tahu urusan teknis; ini belum tentu barang tidak dijual). Jangan menyebut angka, dan jangan menawarkan barang merek/model lain sebagai pembanding kecuali customer memintanya. Jangan menulis "saya pastikan dulu" tanpa benar-benar bertanya.
- Permintaan PENAWARAN (customer menyebut beberapa barang + jumlah + syarat, biasanya perusahaan): balas satu pesan yang (1) mengulang tiap barang beserta jumlahnya dengan sopan, (2) memberi kepastian proses: penawaran disiapkan tim dan akan dikabari begitu siap (jangan menjanjikan jam atau harga), (3) mencatat tiap syarat yang diminta (harga inc. PPN, DP, pelunasan setelah kirim, free ongkir) sebagai hal yang sedang dikonfirmasi tim, tanpa menyetujui atau menolaknya sendiri dan tanpa menjanjikan gratis ongkir kecuali aturan promo menyatakannya, dan (4) bila lokasi kirim sudah disebut, hitung ongkirnya dengan alat ongkir. Satu pertanyaan ke tim/Management berisi: nama customer dan perusahaan, semua barang dengan kode dan jumlah persis seperti ditulis customer (yang sudah ada harganya cantumkan), semua syarat yang diminta, dan lokasi kirim; jangan dipecah per barang atau per syarat.
- Daftar harga tidak menyatakan apakah sudah termasuk PPN. Jangan menghitung atau menyebut "harga include PPN" sendiri; bila customer minta harga inc. PPN, sebut harga dari hasil apa adanya dan katakan PPN/faktur pajak dikonfirmasi staf.
- Jumlah yang dihitung dari kemasan ("1 dus = 10 keping") hanya boleh memakai satuan yang tertulis di hasil; jangan mengubah satuan harga menjadi per keping atau per m2 bila hasilnya tidak menyebut isi dus.
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

// Kata yang tidak membedakan satu barang dari barang lain di pesan customer.
const GENERIC = new Set([
  'dus', 'keping', 'pcs', 'box', 'unit', 'buah', 'lembar', 'roll', 'set', 'pack',
  'keramik', 'granit', 'kw', 'kwp', 'kw1', 'kw2', 'kw3', 'kw4', 'kwa', 'pro', 'cm', 'inc', 'ppn', 'harga',
]);

/**
 * Buang bagian yang hanya berisi jumlah/kemasan: "(1dus=10 keping)", "5 Dus",
 * "3 dus". Kode ("REC-DF91502") dan ukuran ("15x90") dipertahankan.
 */
function cleanQuery(value) {
  return String(value || '')
    .replace(/\([^)]*\b(?:dus|keping|pcs|box|lembar|roll)\b[^)]*\)/gi, ' ')
    .replace(/\b\d+\s*(?:dus|keping|pcs|box|lembar|roll|buah|unit|zak|sak)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

const compact = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Potongan teks yang mirip kode barang (mis. REC-DF91502, VAL-900063, 1090500027). */
function codeCandidates(query) {
  const out = new Set();
  for (const raw of String(query).split(/[\s,;()/]+/)) {
    const t = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
    if (t.length < 5 || !/\d/.test(t)) continue;
    if (/^\d+x\d+(x\d+)?$/i.test(t)) continue;      // ukuran 15x90
    if (/^[\d.,]+[a-z]{0,3}$/i.test(t) && t.replace(/\D/g, '').length < 8) continue; // "1050l", "2.25l"
    out.add(compact(t));
  }
  return [...out];
}

/**
 * Cari satu barang. `matchProducts` longgar (cukup satu kata sama), bagus untuk
 * memilih barang di prompt tetapi menyesatkan untuk alat: "Infinity Glossy
 * 60x60 Revolver Gold" ikut membawa "ACCURA GLOSSY WHITE 60X60" dan "VALENTINO
 * OBSIDIAN GOLD". Di sini hasil hanya diterima bila kodenya sama persis atau
 * paling sedikit separuh kata pembeda (merek/model/warna) di kueri ada di nama
 * barang. Ukuran dan kemasan saja tidak cukup.
 */
function searchOne(items, rawQuery, { tagText } = {}) {
  const query = cleanQuery(rawQuery).slice(0, 200);
  const codes = codeCandidates(query);
  if (codes.length) {
    const byCode = items.filter((i) => i.code && codes.includes(compact(i.code)));
    if (byCode.length) return { query, codes, matches: byCode.slice(0, MAX_RESULTS) };
  }
  const loose = matchProducts(items, { text: query }, 40, tagText ? { tagText } : undefined);
  const ident = [...new Set(tokens(query).filter((t) => !/\d/.test(t) && !GENERIC.has(t) && t.length >= 3))];
  if (!ident.length) return { query, codes, matches: loose.slice(0, MAX_RESULTS) };
  const need = Math.max(1, Math.ceil(ident.length / 2));
  const matches = loose.filter((item) => {
    const own = matchTerms([item.name, item.category, item.brand].filter(Boolean).join(' '));
    const tagged = tagText && item.tags?.length
      ? new Set(item.tags.flatMap((tag) => [...matchTerms(tagText.get(tag.id) || '')]))
      : null;
    return ident.filter((t) => own.has(t) || tagged?.has(t)).length >= need;
  });
  return { query, codes, matches: matches.slice(0, MAX_RESULTS) };
}

function missingNote(found) {
  const codeNote = found.codes.length ? ` Kode "${found.codes.join('", "')}" juga tidak ada di daftar.` : '';
  return `Barang ini tidak ada di daftar harga/POS (belum tentu tidak dijual).${codeNote} Jangan menyebut harga, jangan menawarkan merek atau model lain sebagai pembanding kecuali customer memintanya, dan jangan meminta nama atau kode lagi bila customer sudah menuliskannya. Langsung tanyakan ke tim/Management lewat alat tanya departemen bila tersedia; ke customer cukup katakan akan dicek dulu ke tim, jangan bilang barangnya tidak terdaftar atau tidak ada di sistem.`;
}

/** Hasil pencarian untuk model. Tidak pernah melempar. */
function lookup(items, args = {}, { tagText, onResults } = {}) {
  const list = [
    ...(Array.isArray(args.daftar) ? args.daftar : []),
    ...(args.barang ? [args.barang] : []),
  ].map((v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 300)).filter(Boolean).slice(0, MAX_ITEMS);
  if (!list.length || list.every((v) => v.length < 2)) return { status: 'kueri_kosong', pesan: 'Sebut nama barangnya.' };

  const results = list.map((text) => ({ text, found: searchOne(items, text, { tagText }) }));
  const seen = results.flatMap((r) => r.found.matches);
  if (seen.length) onResults?.(seen);

  if (list.length === 1) {
    const { found } = results[0];
    if (!found.matches.length) {
      return { status: 'tidak_ketemu', pesan: `Tidak ada barang yang cocok di daftar harga. ${missingNote(found)}` };
    }
    return { status: 'ok', hasil: found.matches.map(rowOf), catatan: 'Harga jual dari POS saat ini. Bukan informasi stok.' };
  }

  const per = results.map(({ text, found }) => (found.matches.length
    ? { dicari: text, status: 'ok', hasil: found.matches.map(rowOf) }
    : { dicari: text, status: 'tidak_ketemu', pesan: missingNote(found) }));
  const okCount = per.filter((r) => r.status === 'ok').length;
  const out = { status: okCount === 0 ? 'tidak_ketemu' : okCount === per.length ? 'ok' : 'sebagian', per_barang: per, catatan: 'Harga jual dari POS saat ini. Bukan informasi stok.' };
  if (okCount === 0) out.pesan = 'Tidak ada satu pun barang yang cocok di daftar harga. Jangan menyebut harga; tanyakan semuanya ke tim/Management dalam satu pertanyaan; ke customer cukup katakan akan dicek dulu ke tim, jangan bilang tidak terdaftar atau tidak ada di sistem.';
  return out;
}

function toolSpec({ items, tagText, onResults }) {
  return {
    name: TOOL_NAME,
    description: 'Cari harga barang di katalog/daftar harga toko berdasarkan nama atau kodenya (satu barang lewat "barang", banyak barang sekaligus lewat "daftar"). Wajib dipakai sebelum menyebut harga barang yang belum tertulis di daftar di prompt.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        barang: { type: 'string', maxLength: 300, description: 'Satu barang: nama atau kode, mis. "MU 100 Base Plester" atau "Semen Jakarta 40KG".' },
        daftar: { type: 'array', maxItems: MAX_ITEMS, items: { type: 'string', maxLength: 300 }, description: 'Beberapa barang sekaligus (daftar kebutuhan customer), satu teks per barang persis seperti ditulis customer, termasuk kode. Pakai ini bila ada lebih dari satu barang.' },
      },
    },
    run: (args = {}) => lookup(items, args, { tagText, onResults }),
  };
}

module.exports = { TOOL_NAME, GUIDE, lookup, toolSpec, searchOne, cleanQuery, codeCandidates };
