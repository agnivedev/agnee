'use strict';

const MAYAR = 'https://api.mayar.id';
const PAGE_LIMIT = 50;
// Jaring pengaman kalau API Mayar kelak punya bug `hasMore` yang tidak
// pernah `false` — tanpa ini satu koneksi rusak bisa membuat sinkronisasi
// berputar selamanya. 500 halaman x 50 = 25.000 baris, jauh di atas skala
// company mana pun yang realistis hari ini.
const MAX_PAGES = 500;

/** Nomor lokal Mayar ("0851...") -> format yang dipakai `phone` WhatsApp Agnee ("6285..."). */
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (!digits.startsWith('62')) digits = `62${digits}`;
  return digits;
}

async function mayarGet(path, apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(`${MAYAR}${path}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Mayar menolak permintaan: ${data?.messages || data?.message || `HTTP ${response.status}`}`);
  }
  return data;
}

/** Dipanggil sebelum kredensial disimpan: kunci salah harus gagal di sini, bukan diam-diam tiap sinkron. */
async function verifyApiKey(apiKey, fetchImpl = fetch) {
  const data = await mayarGet('/hl/v2/customers?limit=1', apiKey, fetchImpl);
  if (typeof data?.total !== 'number') throw new Error('Balasan Mayar tidak dikenali — periksa kembali API key-nya.');
  return { total: data.total };
}

async function fetchAllPages(path, apiKey, fetchImpl) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) query.set('startingAfter', cursor);
    const data = await mayarGet(`${path}?${query}`, apiKey, fetchImpl);
    items.push(...(data.data || []));
    if (!data.hasMore || !data.nextStartingAfter) break;
    cursor = data.nextStartingAfter;
  }
  return items;
}

/**
 * Tarik semua customer + transaksi dari Mayar, agregasi jadi satu ringkasan
 * per customer siap dioper ke `database.upsertMayarLeads`.
 *
 * Satu baris per customer, bukan per transaksi: Lead List Agnee sudah
 * "satu baris per orang untuk ditindaklanjuti", bukan per pembelian.
 */
async function fetchMayarLeads(apiKey, fetchImpl = fetch) {
  const [customers, transactions] = await Promise.all([
    fetchAllPages('/hl/v2/customers', apiKey, fetchImpl),
    fetchAllPages('/hl/v2/transactions', apiKey, fetchImpl),
  ]);

  const byCustomer = new Map();
  for (const customer of customers) {
    byCustomer.set(customer.id, {
      mayarCustomerId: customer.id,
      name: customer.name || null,
      email: customer.email || null,
      phone: normalizePhone(customer.mobile),
      totalTransactions: 0,
      totalAmount: 0,
      products: new Set(),
      lastTransactionAt: null,
    });
  }

  for (const tx of transactions) {
    const customerId = tx.customerId || tx.customer?.id;
    if (!customerId) continue;
    let lead = byCustomer.get(customerId);
    if (!lead) {
      // Transaksi bisa menyebut customer yang tidak muncul di halaman
      // /customers yang sudah ditarik (jarang, tapi jangan dibuang diam-diam).
      lead = {
        mayarCustomerId: customerId,
        name: tx.customer?.name || null,
        email: tx.customer?.email || null,
        phone: normalizePhone(tx.customer?.mobile),
        totalTransactions: 0,
        totalAmount: 0,
        products: new Set(),
        lastTransactionAt: null,
      };
      byCustomer.set(customerId, lead);
    }
    lead.totalTransactions += 1;
    lead.totalAmount += Number(tx.amount) || 0;
    const productName = tx.paymentLink?.name;
    if (productName) lead.products.add(productName);
    const createdAt = Number(tx.createdAt);
    if (Number.isFinite(createdAt)) {
      const at = new Date(createdAt);
      if (!lead.lastTransactionAt || at > lead.lastTransactionAt) lead.lastTransactionAt = at;
    }
  }

  return [...byCustomer.values()]
    .filter((lead) => lead.phone) // tanpa nomor HP, baris ini tidak bisa digabung ATAU dihubungi — tidak berguna di Lead List
    .map((lead) => ({
      ...lead,
      products: [...lead.products].join(', ') || null,
    }));
}

module.exports = { normalizePhone, verifyApiKey, fetchAllPages, fetchMayarLeads, MAYAR };
