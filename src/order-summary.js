'use strict';

/**
 * Alat AI `susun_rincian`: rincian pesanan berformat WhatsApp sebelum closing.
 *
 * Penjumlahan tidak boleh dikerjakan model (salah hitung di depan customer
 * langsung terbaca sebagai toko yang tidak teliti), jadi model hanya
 * menyerahkan barang, jumlah, harga, dan ongkir; alat ini yang menghitung dan
 * menyusun teksnya. Dipakai semua company; harga tetap hanya dari playbook,
 * katalog, atau daftar harga POS.
 */

const TOOL_NAME = 'susun_rincian';
const LINE = '━━━━━━━━━━━━━━';

const rupiah = (value) => `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;

const GUIDE = `## RINCIAN PESANAN SEBELUM CLOSING (alat ${TOOL_NAME})
- Begitu barang, jumlah, dan harganya jelas dan kamu mau mengarahkan customer ke closing, panggil ${TOOL_NAME}, lalu kirim "teks" hasilnya persis seperti diberikan (jangan diubah, jangan dihitung ulang).
- Isi "barang" hanya dengan harga dari playbook, katalog, atau daftar harga. Jangan mengarang harga.
- Ongkir: isi dari hasil cek_ongkir ("ongkir_dibayar_customer" bila ada, kalau tidak "ongkir"). Kalau ongkir belum bisa dihitung, kosongkan dan tulis di pesan bahwa ongkir menyusul; jangan menebak angkanya.
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

function toolSpec() {
  return {
    name: TOOL_NAME,
    description: 'Susun rincian pesanan berformat WhatsApp (barang, total produk, ongkir, garis, grand total). Penjumlahan dikerjakan alat ini.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['barang'],
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
        keterangan_ongkir: { type: 'string', maxLength: 80, description: 'Mis. "Ongkir (Lalamove, Motor)".' },
        diskon: { type: 'number', minimum: 0 },
      },
    },
    run: (args = {}) => run(args),
  };
}

function run(args) {
  const items = (Array.isArray(args.barang) ? args.barang : [])
    .map((b) => ({ name: String(b.nama || '').trim(), qty: Number(b.jumlah), unitPrice: Number(b.harga_satuan), unit: b.satuan ? String(b.satuan).trim() : '' }))
    .filter((b) => b.name && b.qty > 0 && Number.isFinite(b.unitPrice) && b.unitPrice >= 0);
  if (!items.length) return { status: 'gagal', pesan: 'Barang, jumlah, dan harga belum lengkap. Lengkapi dulu sebelum menyusun rincian.' };
  const summary = buildSummary({
    items,
    shipping: args.ongkir == null ? null : Number(args.ongkir),
    shippingLabel: args.keterangan_ongkir || 'Ongkir',
    discount: args.diskon,
  });
  return { status: 'ok', teks: summary.text, total_produk: summary.productTotal, ongkir: summary.shipping, grand_total: summary.grandTotal };
}

module.exports = { TOOL_NAME, GUIDE, LINE, rupiah, buildSummary, toolSpec, run };
