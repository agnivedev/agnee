'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const orders = require('../src/dealpos-orders.js');

const PRODUCTS = [{ variantId: 'v1', code: 'MU480', name: 'MU 480 RENOFIX 25KG', unit: 'sak', unitPrice: 313000 }];
const POS = { enabled: true, aiOrdersEnabled: true, host: 'esbeje.dealpos.co.id', clientId: 'x', clientSecret: 'y', orderOutlet: 'OUT1', orderTag: 'WA', orderTaxType: 'Inclusive', shippingVariantCode: 'ONGKIR' };
const LALA = { environment: 'production', enabled: true, apiKey: 'pk_prod_x', apiSecret: 'sk_prod_x' };
const PICKUP = { name: 'Gudang', address: 'Jl. A', lat: -6.2, lng: 106.7, contactName: 'Budi', contactPhone: '08111' };

function setup({ pos = POS, quote, fetchLog = [], lalamoveFail = false } = {}) {
  const docs = [];
  const lalaOrders = [];
  const database = {
    findDealposCustomerByPhone: async () => null,
    createAiSalesDocument: async (companyId, doc) => { const row = { id: String(docs.length + 1), status: 'open', ...doc }; docs.push(row); return row; },
    latestAiSalesDocument: async (companyId, chatId, kind, status) => [...docs].reverse().find((d) => d.kind === kind && (!status || d.status === status)) || null,
    createLalamoveOrder: async (companyId, order) => { lalaOrders.push(order); return order; },
  };
  const fetchImpl = async (url, init) => {
    fetchLog.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    if (url.includes('/Token/OAuth2')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    if (url.includes('/api/v3/Estimate')) return new Response(JSON.stringify({ ID: 'est-1' }), { status: 200 });
    if (url.includes('/api/v3/Invoice')) return new Response(JSON.stringify({ ID: 'inv-1', Number: 'INV-77' }), { status: 200 });
    if (url.includes('/v3/quotations')) return new Response(JSON.stringify({ data: { quotationId: 'q1', priceBreakdown: { total: '48000', currency: 'IDR' }, stops: [{ stopId: 's0' }, { stopId: 's1' }] } }), { status: 200 });
    if (url.includes('/v3/orders')) {
      if (lalamoveFail) return new Response(JSON.stringify({ errors: [{ id: 'ERR', message: 'boom' }] }), { status: 422 });
      return new Response(JSON.stringify({ data: { orderId: 'o1', status: 'ASSIGNING_DRIVER', shareLink: 'https://share.lalamove/o1' } }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  };
  const tools = orders.createTools({
    database, companyId: 'c1', chatId: '6281234@c.us', phone: '6281234', customerName: 'Pak Dedi',
    dealposConn: pos, products: PRODUCTS, lalamoveConn: LALA, lalamoveReady: true, pickup: PICKUP, fetchImpl,
    quote: quote || (async () => ({ status: 'ok', ketepatan: 'titik', ongkir_angka: 45000, ongkir_dibayar_angka: 45000, layanan: 'MOTORCYCLE', kendaraan: 'MOTORCYCLE (Motor)', titik_antar: { lat: -6.3, lng: 106.6, address: 'BSD' } })),
  });
  return { tools: Object.fromEntries(tools.map((t) => [t.name, t])), docs, lalaOrders };
}

test('isUsable butuh saklar dan setelan dokumen lengkap', () => {
  assert.equal(orders.isUsable(POS), true);
  assert.equal(orders.isUsable({ ...POS, aiOrdersEnabled: false }), false);
  assert.equal(orders.isUsable({ ...POS, orderTag: '' }), false);
  assert.equal(orders.isUsable({ ...POS, enabled: false }), false);
  assert.equal(orders.isUsable(null), false);
});

test('proforma: harga dari DB, Estimate dikirim, rincian WhatsApp keluar', async () => {
  const log = [];
  const { tools, docs } = setup({ fetchLog: log });
  const out = await tools.buat_proforma.run({ barang: [{ kode: 'mu480', jumlah: 10 }], tujuan: '-6.3,106.6' });
  assert.equal(out.status, 'ok');
  assert.equal(out.grand_total, 3175000);
  assert.match(out.teks, /\*Proforma Invoice\*/);
  assert.match(out.teks, /\*GRAND TOTAL: Rp 3\.175\.000\*/);
  const post = log.find((l) => l.url.includes('/Estimate'));
  assert.equal(post.method, 'POST');
  assert.equal(post.body.Outlet, 'OUT1');
  assert.deepEqual(post.body.Variants[0], { Code: 'MU480', Quantity: 10, Price: 313000 });
  assert.equal(docs[0].payload.shipping, 45000);
  assert.equal(docs[0].payload.delivery.serviceType, 'MOTORCYCLE');
});

test('proforma: kode tak dikenal ditolak tanpa menulis ke DealPOS', async () => {
  const log = [];
  const { tools } = setup({ fetchLog: log });
  const out = await tools.buat_proforma.run({ barang: [{ kode: 'NGAWUR', jumlah: 1 }], tujuan: '-6.3,106.6' });
  assert.equal(out.status, 'barang_tidak_dikenal');
  assert.equal(log.some((l) => l.url.includes('/Estimate')), false);
});

test('proforma: lokasi hanya perkiraan area diminta titik', async () => {
  const { tools } = setup({ quote: async () => ({ status: 'ok', ketepatan: 'perkiraan_area', ongkir_angka: 1, ongkir_dibayar_angka: 1 }) });
  const out = await tools.buat_proforma.run({ barang: [{ kode: 'MU480', jumlah: 1 }], tujuan: 'BSD' });
  assert.equal(out.status, 'butuh_lokasi');
});

test('proforma: ambil di toko tanpa ongkir dan tanpa kurir', async () => {
  const { tools, docs } = setup();
  const out = await tools.buat_proforma.run({ barang: [{ kode: 'MU480', jumlah: 2 }], ambil_di_toko: true });
  assert.equal(out.status, 'ok');
  assert.equal(out.grand_total, 626000);
  assert.equal(docs[0].payload.pickup, true);
});

test('invoice: ditolak di giliran yang sama dengan proforma', async () => {
  const { tools } = setup();
  await tools.buat_proforma.run({ barang: [{ kode: 'MU480', jumlah: 1 }], tujuan: '-6.3,106.6' });
  assert.equal((await tools.buat_invoice.run({})).status, 'belum_disetujui');
});

test('invoice: tanpa proforma ditolak', async () => {
  const { tools } = setup();
  assert.equal((await tools.buat_invoice.run({})).status, 'tidak_ada_proforma');
});

test('invoice: dari proforma tersimpan, Invoice dikirim lalu Lalamove dipesan dan dicatat', async () => {
  const log = [];
  const first = setup({ fetchLog: log });
  await first.tools.buat_proforma.run({ barang: [{ kode: 'MU480', jumlah: 10 }], tujuan: '-6.3,106.6' });
  // Giliran berikutnya: alat baru dengan database yang sama.
  const next = orders.createTools({
    database: { findDealposCustomerByPhone: async () => null, latestAiSalesDocument: async (c, ch, kind, status) => first.docs.filter((d) => d.kind === kind && (!status || d.status === status)).pop() || null,
      createAiSalesDocument: async (c, doc) => { first.docs.push({ id: '9', status: 'invoiced', ...doc }); return doc; }, createLalamoveOrder: async (c, o) => { first.lalaOrders.push(o); } },
    companyId: 'c1', chatId: '6281234@c.us', phone: '6281234', customerName: 'Pak Dedi', dealposConn: POS, products: PRODUCTS,
    lalamoveConn: LALA, lalamoveReady: true, pickup: PICKUP, quote: async () => null,
    fetchImpl: async (url, init) => {
      log.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes('/Token/OAuth2')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
      if (url.includes('/api/v3/Invoice')) return new Response(JSON.stringify({ ID: 'inv-1', Number: 'INV-77' }), { status: 200 });
      if (url.includes('/v3/quotations')) return new Response(JSON.stringify({ data: { quotationId: 'q2', priceBreakdown: { total: '47000', currency: 'IDR' }, stops: [{ stopId: 's0' }, { stopId: 's1' }] } }), { status: 200 });
      if (url.includes('/v3/orders')) return new Response(JSON.stringify({ data: { orderId: 'o1', status: 'ASSIGNING_DRIVER', shareLink: 'https://share.lalamove/o1' } }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    },
  });
  const invoiceTool = next.find((t) => t.name === 'buat_invoice');
  const out = await invoiceTool.run({});
  assert.equal(out.status, 'ok');
  assert.equal(out.nomor_invoice, 'INV-77');
  assert.equal(out.tautan_pelacakan, 'https://share.lalamove/o1');
  const inv = log.find((l) => l.url.includes('/api/v3/Invoice'));
  assert.equal(inv.body.ReferenceNumber, first.docs[0].number);
  assert.deepEqual(inv.body.Variants.map((v) => v.Code), ['MU480', 'ONGKIR']);
  assert.equal(first.lalaOrders[0].orderId, 'o1');
});

test('invoice: ongkir kurir naik >10% dari proforma diminta proforma baru, Invoice tidak ditulis', async () => {
  const log = [];
  const first = setup({ fetchLog: log });
  await first.tools.buat_proforma.run({ barang: [{ kode: 'MU480', jumlah: 1 }], tujuan: '-6.3,106.6' });
  const next = orders.createTools({
    database: { findDealposCustomerByPhone: async () => null, latestAiSalesDocument: async () => first.docs[0], createAiSalesDocument: async () => null, createLalamoveOrder: async () => null },
    companyId: 'c1', chatId: '6281234@c.us', phone: '6281234', dealposConn: POS, products: PRODUCTS, lalamoveConn: LALA, lalamoveReady: true, pickup: PICKUP, quote: async () => null,
    fetchImpl: async (url, init) => {
      log.push({ url, method: init?.method });
      if (url.includes('/v3/quotations')) return new Response(JSON.stringify({ data: { quotationId: 'q2', priceBreakdown: { total: '90000', currency: 'IDR' }, stops: [{ stopId: 's0' }, { stopId: 's1' }] } }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    },
  });
  const out = await next.find((t) => t.name === 'buat_invoice').run({});
  assert.equal(out.status, 'ongkir_berubah');
  assert.equal(log.some((l) => l.url.includes('/api/v3/Invoice')), false);
});
