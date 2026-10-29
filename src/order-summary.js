'use strict';

/**
 * Alat AI `susun_rincian`: rincian pesanan berformat WhatsApp sebelum closing.
 *
 * Model menghitung grand total sendiri lalu menyerahkannya bersama barang,
 * jumlah, harga, dan ongkir; alat ini menghitung ulang dan menyusun teksnya.
 * Hitungan model yang meleset dikembalikan sebagai koreksi, dan teks yang
 * dikirim ke customer selalu memakai angka hasil alat (salah hitung di depan
 * customer langsung terbaca sebagai toko yang tidak teliti). Dipakai semua
 * company; harga tetap hanya dari playbook, katalog, atau daftar harga POS.
 */

const { resolveLine, priceOf } = require('./item-match');

const TOOL_NAME = 'susun_rincian';
const LINE = '━━━━━━━━━━━━━━';

const rupiah = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

const GUIDE = `## RINCIAN PESANAN SEBELUM CLOSING (alat ${TOOL_NAME})
- Begitu barang, jumlah, dan harganya jelas dan kamu mau mengarahkan customer ke closing, hitung sendiri subtotal tiap barang dan grand totalnya, lalu panggil ${TOOL_NAME} dengan hasil hitunganmu di "grand_total_hitunganmu". Alat memeriksa ulang hitungan itu.
- Status "ok": hitunganmu benar, kirim "teks" persis seperti diberikan. Status "koreksi": hitunganmu meleset, kirim "teks" dari alat (angkanya sudah diperiksa), jangan angkamu sendiri.
- Isi "barang" hanya dengan harga dari playbook, katalog, atau daftar harga. Jangan mengarang harga. Pakai "nama" lengkap persis seperti hasil cek_harga (termasuk varian/warna yang dipilih customer) dan "satuan" persis dari hasil cek_harga ("satuan"); jangan menebak atau mengganti satuan (zak, pcs, dus, dst.). Alat mencocokkan nama dan harga ke daftar DealPOS dan menolak yang tidak cocok.
- Ongkir: isi dari hasil cek_ongkir ("ongkir_dibayar_customer" bila ada, kalau tidak "ongkir"). Ongkir 0 (gratis) hanya bila hasil cek_ongkir menyatakan GRATIS, atau customer ambil di toko ("ambil_di_toko": true). Kalau ongkir belum bisa dihitung, kosongkan dan tulis di pesan bahwa ongkir menyusul; jangan menebak angkanya.
- Setelah rincian terkirim, tutup dengan satu ajakan konfirmasi ("Kalau sudah sesuai, saya proses ya kak").`;

/**
 * @param {{ items: {name: string, qty: number, unitPrice: number, unit?: string}[],
 *           shipping?: number|null, shippingLabel?: string, discount?: number, title?: string }} order
 */
function buildSummary({ items, shipping = null, shippingLabel = 'Ongkir', discount = 0, title = 'Rincian Pesanan' }) {
  const lines = items.map((item, i) => {
    const qty = Number(item.qty);
    const subtotal = qty * Number(item.unitPrice);
    return {
      subtotal,
      text: `${i + 1}. ${item.name}\n   ${qty} ${item.unit ? `${item.unit} ` : ''}x ${rupiah(item.unitPrice)} = ${rupiah(subtotal)}`,
    };
  });
  const productTotal = lines.reduce((sum, l) => sum + l.subtotal, 0);
  const off = Math.max(0, Math.min(Number(discount) || 0, productTotal));
  const ship = shipping == null ? null : Math.max(0, Number(shipping));
  const grandTotal = productTotal - off + (ship || 0);
  const text = [
    `*${title}*`,
    '',
    ...lines.map((l) => l.text),
    '',
    `Total produk: ${rupiah(productTotal)}`,
    ...(off ? [`Diskon: -${rupiah(off)}`] : []),
    ship == null ? `${shippingLabel}: menyusul` : `${shippingLabel}: ${ship === 0 ? 'GRATIS' : rupiah(ship)}`,
    LINE,
    `*GRAND TOTAL: ${rupiah(grandTotal)}*${ship == null ? ' (belum termasuk ongkir)' : ''}`,
  ].join('\n');
  return { text, productTotal, discount: off, shipping: ship, grandTotal };
}

/**
 * @param {{ items?: object[], shippingProof?: () => { called: boolean, freeConfirmed: boolean, amounts: number[] }|null }} [opts]
 *   items = katalog/daftar harga POS untuk memeriksa harga dan satuan;
 *   shippingProof = bukti cek_ongkir pada balasan ini (null bila company tanpa alat ongkir).
 */
function toolSpec({ items = [], shippingProof = null } = {}) {
  return {
    name: TOOL_NAME,
    description: 'Susun rincian pesanan berformat WhatsApp (barang, total produk, ongkir, garis, grand total). Penjumlahan dikerjakan alat ini.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['barang', 'grand_total_hitunganmu'],
      properties: {
        barang: {
          type: 'array', minItems: 1, maxItems: 30,
          items: {
            type: 'object', additionalProperties: false, required: ['nama', 'jumlah', 'harga_satuan'],
            properties: {
              nama: { type: 'string', maxLength: 200 },
              jumlah: { type: 'number', exclusiveMinimum: 0 },
              harga_satuan: { type: 'number', minimum: 0, description: 'Rupiah per satuan, dari playbook/katalog/daftar harga.' },
              satuan: { type: 'string', maxLength: 30 },
            },
          },
        },
        ongkir: { type: 'number', minimum: 0, description: 'Rupiah yang dibayar customer; 0 = gratis. Kosongkan bila belum diketahui.' },
        ambil_di_toko: { type: 'boolean', description: 'true bila customer mengambil sendiri di toko (ongkir 0).' },
        keterangan_ongkir: { type: 'string', maxLength: 80, description: 'Mis. "Ongkir (Lalamove, Motor)".' },
        diskon: { type: 'number', minimum: 0 },
        grand_total_hitunganmu: { type: 'number', minimum: 0, description: 'Grand total hasil hitunganmu sendiri (produk - diskon + ongkir) untuk diperiksa alat.' },
      },
    },
    run: (args = {}) => run(args, { items, shippingProof }),
  };
}

/** Harga dan satuan tiap baris dicocokkan ke daftar; satuan selalu UOM DealPOS, bukan tebakan model. */
function verifyLines(lines, catalogItems) {
  const problems = [];
  const out = lines.map((line) => {
    if (!catalogItems.length) return line;
    const hit = resolveLine(catalogItems, { nama: line.name, harga: line.unitPrice });
    if (hit.status === 'ok') {
      return { ...line, name: hit.item.name, unit: hit.item.unit || '' };
    }
    if (hit.status === 'varian_ambigu') {
      problems.push({ nama: line.name, masalah: 'varian_ambigu', pilihan: hit.candidates.slice(0, 8).map((c) => `${c.name} ${rupiah(priceOf(c))}${c.unit ? ` per ${c.unit}` : ''}`) });
    } else if (hit.status === 'harga_beda') {
      problems.push({ nama: line.name, harga_disebut: line.unitPrice, masalah: 'harga_beda', daftar: hit.candidates.slice(0, 5).map((c) => `${c.name} ${rupiah(priceOf(c))}${c.unit ? ` per ${c.unit}` : ''}`) });
    }
    return line; // tidak dikenali sama sekali: harga dari playbook, dilewatkan
  });
  return { lines: out, problems };
}

function run(args, { items: catalogItems = [], shippingProof = null } = {}) {
  const parsed = (Array.isArray(args.barang) ? args.barang : [])
    .map((b) => ({ name: String(b.nama || '').trim(), qty: Number(b.jumlah), unitPrice: Number(b.harga_satuan), unit: b.satuan ? String(b.satuan).trim() : '' }))
    .filter((b) => b.name && b.qty > 0 && Number.isFinite(b.unitPrice) && b.unitPrice >= 0);
  if (!parsed.length) return { status: 'gagal', pesan: 'Barang, jumlah, dan harga belum lengkap. Lengkapi dulu sebelum menyusun rincian.' };
  const { lines: items, problems } = verifyLines(parsed, catalogItems);
  if (problems.length) {
    return {
      status: 'harga_atau_varian_tidak_cocok', barang: problems,
      pesan: 'Rincian TIDAK disusun. Ada barang yang harganya tidak sama dengan daftar atau variannya (warna) belum jelas. Panggil cek_harga, sebutkan pilihan varian ke customer bila perlu, lalu susun ulang dengan nama dan harga persis dari daftar.',
    };
  }
  if (args.ongkir != null && args.ambil_di_toko !== true && shippingProof) {
    const proof = shippingProof();
    const amount = Math.round(Number(args.ongkir));
    const proven = amount === 0 ? proof?.freeConfirmed : (proof?.amounts || []).some((a) => Math.round(a) === amount);
    if (!proven) {
      return {
        status: 'ongkir_tak_terbukti',
        pesan: amount === 0
          ? 'Ongkir 0 tidak boleh ditulis sendiri. Panggil cek_ongkir dulu; gratis hanya bila hasilnya menyatakan GRATIS. Kalau customer ambil di toko, isi "ambil_di_toko": true.'
          : 'Angka ongkir ini tidak berasal dari cek_ongkir di chat ini. Panggil cek_ongkir dengan alamat customer dan pakai angka hasilnya; kalau alat gagal, tulis ongkir menyusul (kosongkan "ongkir"). Jangan memakai angka dari tebakan atau dari customer.',
      };
    }
  }
  const summary = buildSummary({
    items,
    shipping: args.ongkir == null ? null : Number(args.ongkir),
    shippingLabel: args.ambil_di_toko === true ? 'Ambil di toko' : (/lalamove/i.test(String(args.keterangan_ongkir || '')) ? 'Ongkir (Lalamove)' : (args.keterangan_ongkir || 'Ongkir')),
    discount: args.diskon,
  });
  const result = { status: 'ok', teks: summary.text, total_produk: summary.productTotal, ongkir: summary.shipping, grand_total: summary.grandTotal };
  const claimed = args.grand_total_hitunganmu == null ? null : Number(args.grand_total_hitunganmu);
  if (claimed != null && Math.round(claimed) !== Math.round(summary.grandTotal)) {
    return {
      ...result,
      status: 'koreksi',
      pesan: `Hitunganmu ${rupiah(claimed)}, hasil periksa ${rupiah(summary.grandTotal)}. Kirim "teks" ini, bukan angkamu.`,
    };
  }
  return result;
}

module.exports = { TOOL_NAME, GUIDE, LINE, rupiah, buildSummary, toolSpec, run };
