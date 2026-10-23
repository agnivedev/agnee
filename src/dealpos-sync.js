'use strict';

const PAGE_SIZE = 200;
// Jaring pengaman kalau API tidak pernah mengembalikan halaman kosong.
const MAX_PAGES = 500;
// DealPOS membatasi laju permintaan (balasan 429 "try again after N seconds").
const PAGE_GAP_MS = 400;
const MAX_AUTO_WAIT_SECONDS = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Host akun DealPOS, mis. "esbeje.dealpos.co.id". Pengguna sering menempel
 * URL penuh ("https://esbeje.dealpos.co.id/menu/...") — diambil hostnya saja.
 * Hanya domain dealpos yang diterima: host ini dipanggil dari server, jadi
 * host sembarang akan menjadikannya jalur SSRF.
 */
function normalizeHost(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;
  let host = text;
  try {
    host = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  if (!/^[a-z0-9-]+\.dealpos\.(co\.id|net|com|app)$/.test(host)) return null;
  return host;
}

/**
 * Nomor DealPOS -> format `phone` WhatsApp Agnee (62 + 8-11 digit, mis.
 * 6281234567890). Hanya nomor HP Indonesia yang lolos; telepon rumah, nomor
 * luar negeri, dan isian sampah ("1234", "26052362") tidak boleh jadi nomor
 * WhatsApp karena ikut jadi sasaran broadcast.
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const digits = text.replace(/\D/g, '');
  let candidate = null;
  if (digits.startsWith('62')) candidate = digits;
  else if (digits.startsWith('08')) candidate = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) candidate = `62${digits}`;
  return candidate && /^628\d{8,11}$/.test(candidate) ? candidate : null;
}

/** Nomor yang tidak lolos jadi WhatsApp tetap disimpan sebagai "telp lain". */
function otherPhone(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (normalizePhone(text)) return null;
  return text.replace(/\D/g, '').length >= 5 ? text.slice(0, 40) : null;
}

const cleanText = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text && !/^[.\-_,/]+$/.test(text) ? text : null;
};

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

/** Detik tunggu dari header Retry-After, atau dari teks "after 180 second(s)". */
function retryAfterSeconds(data, response) {
  const header = Number(response.headers?.get?.('retry-after'));
  if (Number.isFinite(header) && header > 0) return header;
  const match = /after\s+(\d+)\s*second/i.exec(String(data?.Message || data?.message || data?.title || ''));
  return match ? Number(match[1]) : null;
}

function failure(data, response) {
  if (response.status === 429) {
    const wait = retryAfterSeconds(data, response);
    const error = new Error(`DealPOS sedang membatasi permintaan. Coba lagi ${wait ? `sekitar ${Math.ceil(wait / 60) >= 2 ? `${Math.ceil(wait / 60)} menit` : `${wait} detik`}` : 'beberapa menit'} lagi.`);
    error.rateLimited = true;
    error.retryAfter = wait;
    return error;
  }
  const error = new Error(`DealPOS menolak permintaan: ${data?.Message || data?.message || data?.title || `HTTP ${response.status}`}`);
  error.status = response.status;
  return error;
}

/** Token berlaku 2 hari; satu sinkronisasi cukup dengan satu token. */
async function fetchToken({ host, clientId, clientSecret }, fetchImpl = fetch) {
  const response = await fetchImpl(`https://${host}/api/v3/Token/OAuth2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) throw failure(data, response);
  return data.access_token;
}

async function dealposGet(host, token, path, fetchImpl = fetch, retried = false) {
  const response = await fetchImpl(`https://${host}/api/v3${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await readJson(response);
  if (response.status === 429 && !retried) {
    const wait = retryAfterSeconds(data, response);
    // Tunggu hanya kalau singkat; 180 detik terlalu lama untuk satu permintaan web.
    if (wait && wait <= MAX_AUTO_WAIT_SECONDS) {
      await sleep(wait * 1000);
      return dealposGet(host, token, path, fetchImpl, true);
    }
  }
  if (!response.ok) throw failure(data, response);
  return data;
}

/** Dipanggil sebelum kredensial disimpan: kunci salah harus gagal di sini. */
async function verifyCredentials(credentials, fetchImpl = fetch) {
  const token = await fetchToken(credentials, fetchImpl);
  const data = await dealposGet(credentials.host, token, '/Customer/WithTotalCount?PageNumber=1&PageSize=1', fetchImpl);
  if (typeof data?.TotalCount !== 'number') throw new Error('Balasan DealPOS tidak dikenali — periksa kembali host dan kuncinya.');
  return { total: data.TotalCount, token };
}

/** Semua customer, satu baris per orang, siap dioper ke `upsertDealposCustomers`. */
async function fetchCustomers(credentials, fetchImpl = fetch, existingToken = null) {
  const token = existingToken || await fetchToken(credentials, fetchImpl);
  const byId = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = await dealposGet(credentials.host, token, `/Customer?PageNumber=${page}&PageSize=${PAGE_SIZE}`, fetchImpl);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const row of rows) {
      if (!row.ID) continue;
      const joined = row.JoinDate && !row.JoinDate.startsWith('0001') ? new Date(row.JoinDate) : null;
      byId.set(row.ID, {
        dealposCustomerId: row.ID,
        code: row.Code || null,
        name: row.Name && row.Name.trim() !== '.' ? row.Name.trim() : null,
        email: row.Email || null,
        phone: normalizePhone(row.Mobile),
        phoneExtra: otherPhone(row.Mobile),
        joinedAt: joined && !Number.isNaN(joined.getTime()) ? joined : null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
    await sleep(PAGE_GAP_MS);
  }
  return [...byId.values()];
}

/** Tanggal lahir DealPOS kosong dikirim "0001-01-01". */
function parseDate(value) {
  // Bagian tanggal diambil dari teksnya langsung: lewat `new Date(...)` +
  // toISOString tanggal lahir bergeser sehari di zona waktu server.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match || match[1] === '0001') return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Detail satu customer: alamat dan kawan-kawan yang tidak ada di daftar. */
async function fetchCustomerDetail(host, token, id, fetchImpl = fetch) {
  const data = await dealposGet(host, token, `/Customer/Detail?ID=${encodeURIComponent(id)}`, fetchImpl);
  return {
    address: cleanText(data?.Address),
    city: cleanText(data?.City),
    phoneAlt: String(data?.Phone ?? '').replace(/\D/g, '').length >= 5 ? String(data.Phone).trim().slice(0, 40) : null,
    gender: cleanText(data?.Gender),
    birthDate: parseDate(data?.Birthday),
    memberGroup: cleanText(data?.Group),
    loyaltyPoints: Number.isInteger(data?.LoyaltyPoint) ? data.LoyaltyPoint : null,
  };
}

module.exports = {
  fetchCustomerDetail, otherPhone, cleanText, sleep, PAGE_GAP_MS, normalizeHost, normalizePhone, fetchToken, verifyCredentials, fetchCustomers };
