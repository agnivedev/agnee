'use strict';

const PAGE_SIZE = 200;
// Jaring pengaman kalau API tidak pernah mengembalikan halaman kosong.
const MAX_PAGES = 500;

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

/** Nomor DealPOS -> format `phone` WhatsApp Agnee (digit saja, berkode negara). */
function normalizePhone(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (text.startsWith('+') || digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return null; }
}

function failure(data, response) {
  return new Error(`DealPOS menolak permintaan: ${data?.Message || data?.message || data?.title || `HTTP ${response.status}`}`);
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

async function dealposGet(host, token, path, fetchImpl = fetch) {
  const response = await fetchImpl(`https://${host}/api/v3${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await readJson(response);
  if (!response.ok) throw failure(data, response);
  return data;
}

/** Dipanggil sebelum kredensial disimpan: kunci salah harus gagal di sini. */
async function verifyCredentials(credentials, fetchImpl = fetch) {
  const token = await fetchToken(credentials, fetchImpl);
  const data = await dealposGet(credentials.host, token, '/Customer/WithTotalCount?PageNumber=1&PageSize=1', fetchImpl);
  if (typeof data?.TotalCount !== 'number') throw new Error('Balasan DealPOS tidak dikenali — periksa kembali host dan kuncinya.');
  return { total: data.TotalCount };
}

/** Semua customer, satu baris per orang, siap dioper ke `upsertDealposCustomers`. */
async function fetchCustomers(credentials, fetchImpl = fetch) {
  const token = await fetchToken(credentials, fetchImpl);
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
        joinedAt: joined && !Number.isNaN(joined.getTime()) ? joined : null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return [...byId.values()];
}

module.exports = { normalizeHost, normalizePhone, fetchToken, verifyCredentials, fetchCustomers };
