'use strict';

/**
 * Alat AI untuk closing di company yang memakai DealPOS (ESBEJE):
 *
 *  - `buat_proforma`: customer sudah deal -> Estimate DealPOS (proforma) dari
 *    barang dan ongkir yang sudah dilihat customer, lalu rincian WhatsApp.
 *  - `buat_invoice`: customer menyetujui proforma -> Invoice DealPOS dari
 *    proforma yang tersimpan (bukan dari ingatan model) + order kurir Lalamove.
 *
 * Harga selalu dari `dealpos_products`, bukan dari model. Ongkir dari
 * Lalamove. Di chat sungguhan keduanya hanya hidup bila saklar `ai_orders_enabled`
 * dinyalakan supervisor; tanpa itu tidak ada yang ditulis ke DealPOS atau Lalamove.
 */

const dealposSync = require('./dealpos-sync');
const lalamove = require('./lalamove');
const orderSummary = require('./order-summary');

const PROFORMA = 'buat_proforma';
const INVOICE = 'buat_invoice';

// Ongkir Lalamove saat invoice boleh naik sedikit dari proforma (toko menanggung selisihnya);
// lebih dari itu customer harus menyetujui angka baru lewat proforma baru.
const SHIPPING_DRIFT = 0.1;

const GUIDE = `## PROFORMA & INVOICE DEALPOS (alat ${PROFORMA}, ${INVOICE})
- Customer sudah deal (barang, jumlah, dan lokasi jelas): panggil ${PROFORMA} dengan "kode" barang dari DAFTAR HARGA DEALPOS. Kirim "teks" hasilnya persis seperti diberikan, lalu minta customer memeriksa dan menyetujuinya. Alat ini menghitung harga dan ongkir sendiri; jangan menghitung ulang.
- Setelah customer menyatakan setuju dengan proforma itu (di pesannya sendiri, bukan tebakanmu), panggil ${INVOICE}. Jangan memanggilnya di giliran yang sama dengan ${PROFORMA}.
- Kalau customer mengubah pesanan (barang, jumlah, lokasi), buat proforma baru; jangan invoice dari yang lama.
- Setelah ${INVOICE} berhasil, sampaikan nomor invoice dan, bila ada, tautan pelacakan kurir, lalu jelaskan langkah pembayarannya sesuai playbook. Kalau hasilnya "sebagian" atau "gagal", katakan tim akan menindaklanjuti; jangan mengulang pemanggilan dan jangan menjanjikan kurir sudah berangkat.
- Kalau alat bilang lokasi belum berupa titik, minta customer share location WhatsApp atau kirim link Google Maps.`;

const todayInJakarta = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const stamp = (now = new Date()) => `${todayInJakarta(now).replace(/-/g, '')}${now.getTime().toString(36).toUpperCase().slice(-5)}`;

/** Kode/nama pada permintaan AI -> varian di `dealpos_products` (harga dari DB). */
function resolveItems(products, requested) {
  const byCode = new Map();
  for (const p of products) {
    if (p.code) byCode.set(String(p.code).toLowerCase(), p);
    byCode.set(String(p.variantId).toLowerCase(), p);
  }
  const lines = [];
  const unknown = [];
  for (const item of Array.isArray(requested) ? requested : []) {
    const product = byCode.get(String(item.kode || '').trim().toLowerCase());
    const qty = Number(item.jumlah);
    if (!product || !(qty > 0)) { unknown.push(String(item.kode || '?')); continue; }
    lines.push({ code: product.code || product.variantId, name: product.name, unit: product.unit || '', qty, unitPrice: Number(product.unitPrice) });
  }
  return { lines, unknown };
}

function customerBlock({ phone, name, existing }) {
  return {
    Code: existing?.code || `WA${phone}`,
    Name: existing?.name || name || `Customer ${phone}`,
    Mobile: phone ? `0${String(phone).replace(/^62/, '')}` : '',
    Email: existing?.email || '',
  };
}

function documentLines(lines, shipping, shippingVariantCode, quoteLabel) {
  const variants = lines.map((l) => ({ Code: l.code, Quantity: l.qty, Price: l.unitPrice }));
  if (shipping > 0 && shippingVariantCode) variants.push({ Code: shippingVariantCode, Quantity: 1, Price: shipping, Note: quoteLabel });
  return variants;
}

function shippingNote(shipping, shippingVariantCode, label) {
  return shipping > 0 && !shippingVariantCode ? `${label}: ${orderSummary.rupiah(shipping)}` : '';
}

function missingSetup(settings) {
  if (!settings.orderOutlet) return 'Outlet DealPOS untuk pesanan AI belum diisi di Pengaturan > Integrasi > DealPOS.';
  if (!settings.orderTag || !settings.orderTaxType) return 'Tag dan jenis pajak DealPOS untuk pesanan AI belum diisi di Pengaturan > Integrasi > DealPOS.';
  return null;
}

/** Layanan siap bila koneksi DealPOS menyala, saklar pesanan AI hidup, dan setelan dokumen lengkap. */
function isUsable(dealposConn) {
  return Boolean(dealposConn?.enabled && dealposConn.aiOrdersEnabled && !missingSetup({
    orderOutlet: dealposConn.orderOutlet, orderTag: dealposConn.orderTag, orderTaxType: dealposConn.orderTaxType,
  }));
}

/**
 * @param {object} ctx
 *   database, companyId, chatId, phone (62xxx), customerName,
 *   dealposConn, products (dealpos_products), lalamoveConn (boleh null), lalamoveReady,
 *   quote(args) -> hasil cek_ongkir, pickup (lokasi titik jemput, boleh null),
 *   fetchImpl, now, onAudit(event, meta)
 */
function createTools(ctx) {
  const { database, companyId, chatId, dealposConn: conn, fetchImpl = globalThis.fetch } = ctx;
  const now = () => ctx.now || new Date();
  // Giliran ini sudah membuat proforma? Invoice butuh persetujuan customer di giliran berikutnya.
  let proformaThisTurn = false;

  const authToken = () => dealposSync.fetchToken(conn, fetchImpl);

  async function proforma(args = {}) {
    const setupGap = missingSetup(conn.orderOutlet ? { orderOutlet: conn.orderOutlet, orderTag: conn.orderTag, orderTaxType: conn.orderTaxType } : {});
    if (setupGap) return { status: 'gagal', pesan: 'Proforma belum bisa dibuat otomatis. Tim yang akan membuatnya.' };
    const { lines, unknown } = resolveItems(ctx.products, args.barang);
    if (unknown.length || !lines.length) {
      return { status: 'barang_tidak_dikenal', kode: unknown, pesan: 'Kode barang tidak ada di daftar harga. Pakai kode persis dari DAFTAR HARGA DEALPOS, atau tanyakan barangnya ke customer.' };
    }
    const pickup = args.ambil_di_toko === true;
    let shipping = 0;
    let delivery = null;
    let shippingLabel = 'Ongkir';
    if (pickup) {
      shippingLabel = 'Ambil di toko';
    } else {
      if (!ctx.lalamoveReady) return { status: 'gagal', pesan: 'Ongkir otomatis belum aktif. Ongkir dipastikan dulu oleh tim.' };
      const quote = await ctx.quote({ tujuan: args.tujuan, total_belanja: lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), jumlah_barang: lines.reduce((s, l) => s + l.qty, 0), produk: lines.map((l) => l.name) });
      if (quote.status !== 'ok' || quote.ongkir_angka == null) return { status: 'gagal', pesan: quote.pesan || 'Ongkir belum bisa dihitung. Pastikan lokasi customer berupa share location atau link Google Maps.' };
      if (quote.ketepatan !== 'titik') return { status: 'butuh_lokasi', pesan: 'Lokasi baru berupa perkiraan area. Minta customer share location WhatsApp atau kirim link Google Maps supaya kurir bisa dipesan.' };
      shipping = quote.ongkir_dibayar_angka;
      shippingLabel = `Ongkir (Lalamove${quote.kendaraan ? `, ${quote.kendaraan}` : ''})`;
      delivery = { serviceType: quote.layanan, lalamoveTotal: quote.ongkir_angka, destination: quote.titik_antar };
    }

    const summary = orderSummary.buildSummary({
      items: lines, shipping: pickup ? null : shipping, shippingLabel, title: 'Proforma Invoice',
    });
    const number = `PF-${stamp(now())}`;
    const existing = await database.findDealposCustomerByPhone(companyId, ctx.phone).catch(() => null);
    const body = {
      Outlet: conn.orderOutlet,
      Number: number,
      Date: todayInJakarta(now()),
      Tag: conn.orderTag,
      TaxType: conn.orderTaxType,
      Customer: customerBlock({ phone: ctx.phone, name: args.nama_penerima || ctx.customerName, existing }),
      Variants: documentLines(lines, pickup ? 0 : shipping, conn.shippingVariantCode, shippingLabel),
    };
    let created;
    try {
      created = await dealposSync.dealposSend(conn.host, await authToken(), 'POST', '/Estimate', body, fetchImpl);
    } catch (error) {
      return { status: 'gagal', pesan: 'Proforma belum bisa dibuat di DealPOS. Tim akan menindaklanjuti.', alasan: String(error.message || '').slice(0, 200) };
    }
    const doc = await database.createAiSalesDocument(companyId, {
      kind: 'proforma', chatId, dealposId: created?.ID || null, number, total: summary.grandTotal,
      payload: {
        lines, shipping: pickup ? 0 : shipping, shippingLabel, pickup, delivery,
        shippingNote: shippingNote(pickup ? 0 : shipping, conn.shippingVariantCode, shippingLabel),
        recipientName: args.nama_penerima || ctx.customerName || null,
        recipientPhone: args.telepon_penerima || ctx.phone || null,
      },
    });
    proformaThisTurn = true;
    ctx.onAudit?.('ai_order.proforma_created', { number, total: summary.grandTotal });
    return {
      status: 'ok', nomor: number, grand_total: summary.grandTotal, teks: summary.text, id_dokumen: doc?.id,
      catatan: 'Kirim "teks" persis, lalu minta customer memeriksa dan menyetujui. Jangan buat invoice sebelum customer setuju.',
    };
  }

  async function invoice(args = {}) {
    if (proformaThisTurn) return { status: 'belum_disetujui', pesan: 'Proforma baru dibuat di giliran ini. Kirim dulu ke customer dan tunggu persetujuannya.' };
    const proformaDoc = await database.latestAiSalesDocument(companyId, chatId, 'proforma', 'open');
    if (!proformaDoc) return { status: 'tidak_ada_proforma', pesan: 'Belum ada proforma yang menunggu persetujuan. Buat proforma dulu.' };
    const p = proformaDoc.payload;
    const lines = p.lines;

    // Kurir dulu dicek (bisa gagal karena harga/area), sebelum invoice ditulis ke DealPOS.
    let fresh = null;
    if (!p.pickup) {
      if (!ctx.lalamoveReady || !ctx.pickup?.contactName || !ctx.pickup?.contactPhone) {
        return { status: 'gagal', pesan: 'Kurir belum bisa dipesan otomatis (titik jemput atau nomor penanggung jawab toko belum lengkap). Tim akan menindaklanjuti.' };
      }
      try {
        fresh = await lalamove.getQuotation(ctx.lalamoveConn, {
          serviceType: p.delivery.serviceType,
          stops: [{ lat: ctx.pickup.lat, lng: ctx.pickup.lng, address: ctx.pickup.address }, p.delivery.destination],
        }, fetchImpl);
      } catch (error) {
        return { status: 'gagal', pesan: 'Ongkir kurir belum bisa dipastikan saat ini. Tim akan menindaklanjuti.', alasan: String(error.message || '').slice(0, 200) };
      }
      if (!fresh.quotationId || fresh.total == null || (fresh.stops || []).length < 2) {
        return { status: 'gagal', pesan: 'Lalamove tidak memberi harga. Tim akan menindaklanjuti.' };
      }
      if (fresh.total > p.delivery.lalamoveTotal * (1 + SHIPPING_DRIFT)) {
        return { status: 'ongkir_berubah', ongkir_baru: orderSummary.rupiah(fresh.total), pesan: 'Ongkir kurir naik dari yang disetujui customer. Buat proforma baru dan minta persetujuan ulang.' };
      }
    }

    const recipientName = String(args.nama_penerima || p.recipientName || ctx.customerName || '').trim();
    const recipientPhone = String(args.telepon_penerima || p.recipientPhone || ctx.phone || '').trim();
    if (!p.pickup && (!recipientName || !recipientPhone)) {
      return { status: 'butuh_data_penerima', pesan: 'Tanyakan nama dan nomor HP penerima (yang akan dihubungi kurir).' };
    }

    const existing = await database.findDealposCustomerByPhone(companyId, ctx.phone).catch(() => null);
    const number = `INV-${stamp(now())}`;
    const body = {
      Outlet: conn.orderOutlet,
      Number: number,
      Date: todayInJakarta(now()),
      Tag: conn.orderTag,
      TaxType: conn.orderTaxType,
      ReferenceNumber: proformaDoc.number,
      Note: [`Dibuat AI Agnee dari proforma ${proformaDoc.number}`, p.shippingNote].filter(Boolean).join('. '),
      Customer: customerBlock({ phone: ctx.phone, name: recipientName, existing }),
      Variants: documentLines(lines, p.shipping, conn.shippingVariantCode, p.shippingLabel),
    };
    let created;
    try {
      created = await dealposSync.dealposSend(conn.host, await authToken(), 'POST', '/Invoice', body, fetchImpl);
    } catch (error) {
      return { status: 'gagal', pesan: 'Invoice belum bisa dibuat di DealPOS. Tim akan menindaklanjuti.', alasan: String(error.message || '').slice(0, 200) };
    }
    const invoiceNumber = created?.Number || number;
    await database.createAiSalesDocument(companyId, {
      kind: 'invoice', chatId, dealposId: created?.ID || null, number: invoiceNumber, total: proformaDoc.total,
      proformaId: proformaDoc.id, payload: { proforma: proformaDoc.number, lines, shipping: p.shipping },
    });
    ctx.onAudit?.('ai_order.invoice_created', { number: invoiceNumber, total: proformaDoc.total });

    const result = { status: 'ok', nomor_invoice: invoiceNumber, total: orderSummary.rupiah(proformaDoc.total) };
    if (p.pickup) return { ...result, kurir: 'Ambil di toko, tidak ada kurir.' };

    try {
      const placed = await lalamove.placeOrder(ctx.lalamoveConn, {
        quotationId: fresh.quotationId,
        sender: { stopId: fresh.stops[0].stopId, name: ctx.pickup.contactName, phone: ctx.pickup.contactPhone },
        recipients: [{ stopId: fresh.stops[1].stopId, name: recipientName, phone: recipientPhone }],
        metadata: { source: 'agnee-ai', invoice: invoiceNumber },
      }, fetchImpl);
      if (!placed.orderId) throw new Error('Lalamove tidak mengembalikan nomor order.');
      await database.createLalamoveOrder(companyId, {
        chatId, orderId: placed.orderId, environment: ctx.lalamoveConn.environment, serviceType: p.delivery.serviceType,
        status: placed.status || 'ASSIGNING_DRIVER', shareLink: placed.shareLink, total: fresh.total, currency: fresh.currency,
        pickupName: ctx.pickup.name, pickupAddress: ctx.pickup.address, dropoffAddress: p.delivery.destination.address,
        recipientName, recipientPhone, createdBy: null,
      });
      ctx.onAudit?.('ai_order.delivery_placed', { orderId: placed.orderId, invoice: invoiceNumber });
      return { ...result, kurir: 'Lalamove sudah dipesan, sedang mencari driver.', tautan_pelacakan: placed.shareLink || undefined };
    } catch (error) {
      // Invoice sudah tercatat; hanya kurirnya yang perlu ditangani manusia.
      return {
        status: 'sebagian', nomor_invoice: invoiceNumber, total: result.total,
        pesan: 'Invoice sudah dibuat, tetapi kurir Lalamove belum berhasil dipesan. Tim akan memesannya secara manual; jangan menjanjikan jam kirim.',
        alasan: String(error.message || '').slice(0, 200),
      };
    }
  }

  return [
    {
      name: PROFORMA,
      description: 'Buat proforma invoice di DealPOS dari pesanan customer yang sudah deal, hitung ongkir Lalamove, dan kembalikan rincian WhatsApp. Hanya setelah customer deal.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['barang'],
        properties: {
          barang: {
            type: 'array', minItems: 1, maxItems: 30,
            items: {
              type: 'object', additionalProperties: false, required: ['kode', 'jumlah'],
              properties: { kode: { type: 'string', maxLength: 60, description: 'Kode barang persis dari DAFTAR HARGA DEALPOS.' }, jumlah: { type: 'number', exclusiveMinimum: 0 } },
            },
          },
          tujuan: { type: 'string', maxLength: 300, description: 'Koordinat "lat,lng" atau link Google Maps dari customer. Tidak perlu bila ambil_di_toko.' },
          ambil_di_toko: { type: 'boolean', description: 'true bila customer mengambil sendiri di toko (tanpa ongkir dan kurir).' },
          nama_penerima: { type: 'string', maxLength: 120 },
          telepon_penerima: { type: 'string', maxLength: 30, description: 'Nomor HP penerima untuk kurir, bila berbeda dari nomor chat.' },
        },
      },
      run: proforma,
    },
    {
      name: INVOICE,
      description: 'Buat invoice DealPOS dari proforma terakhir yang sudah disetujui customer dan pesan kurir Lalamove. Hanya setelah customer menyetujui proforma di pesannya sendiri.',
      parameters: {
        type: 'object', additionalProperties: false, properties: {
          nama_penerima: { type: 'string', maxLength: 120 },
          telepon_penerima: { type: 'string', maxLength: 30 },
        },
      },
      run: invoice,
    },
  ];
}

module.exports = { PROFORMA, INVOICE, GUIDE, SHIPPING_DRIFT, isUsable, missingSetup, resolveItems, createTools, todayInJakarta };
