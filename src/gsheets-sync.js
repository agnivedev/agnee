'use strict';

const crypto = require('node:crypto');

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/** base64url tanpa padding — yang dipakai JWT. */
function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function columnLetter(index) {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Nama tab perlu dikutip kalau mengandung spasi atau tanda kutip. */
function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function rangeA1(sheetName, startRow, rowCount, columnCount) {
  const lastCol = columnLetter(columnCount);
  const endRow = startRow + Math.max(rowCount, 1) - 1;
  return `${quoteSheetName(sheetName)}!A${startRow}:${lastCol}${endRow}`;
}

/**
 * Ambil ID spreadsheet dari URL-nya.
 *
 * Menerima URL penuh maupun ID telanjang, karena orang menyalin salah satunya
 * tanpa berpikir dan menolak salah satu hanya menambah gesekan.
 */
function extractSpreadsheetId(input) {
  const value = String(input || '').trim();
  const fromUrl = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;
  throw new Error('Itu bukan tautan Google Sheets yang bisa dibaca.');
}

/**
 * Tukar kunci service account jadi access token.
 *
 * Service account dipilih daripada OAuth user karena sinkronisasi berjalan di
 * server tanpa ada orang yang login. Bedanya dengan OneDrive: Google tidak
 * menuntut persetujuan admin — pemilik sheet cukup membagikannya ke alamat
 * email service account.
 */
async function fetchAccessToken({ clientEmail, privateKey }, fetchImpl = fetch) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;

  let signature;
  try {
    signature = crypto.createSign('RSA-SHA256')
      .update(signingInput)
      .sign(String(privateKey).replace(/\\n/g, '\n'));
  } catch (error) {
    // Penyebab paling sering: baris \n di JSON tidak ikut ter-unescape saat
    // disalin, jadi PEM-nya rusak. Pesan bawaan OpenSSL tidak menjelaskan itu.
    throw new Error(`Private key service account tidak valid: ${error.message}`);
  }

  const assertion = `${signingInput}.${base64url(signature)}`;
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google menolak kredensial: ${data?.error_description || data?.error || `HTTP ${response.status}`}`);
  }
  if (!data.access_token) throw new Error('Google tidak mengembalikan access token.');
  return { accessToken: data.access_token, expiresInSeconds: Number(data.expires_in) || 3600 };
}

/** Nama tab yang ada di spreadsheet. Sekaligus memastikan sheet-nya terbaca. */
async function listSheetTabs(accessToken, spreadsheetId, fetchImpl = fetch) {
  const response = await fetchImpl(`${SHEETS}/${spreadsheetId}?fields=properties.title,sheets.properties.title`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data?.error?.message || `HTTP ${response.status}`;
    if (response.status === 403 || response.status === 404) {
      throw new Error(`Sheet tidak dapat dibuka (${reason}). Pastikan sheet sudah dibagikan sebagai Editor ke email service account.`);
    }
    throw new Error(`Sheet tidak dapat dibuka: ${reason}`);
  }
  return {
    title: data?.properties?.title || null,
    tabs: (data?.sheets || []).map((sheet) => sheet?.properties?.title).filter(Boolean),
  };
}

/** Buat tab kalau belum ada. */
async function ensureTab(accessToken, spreadsheetId, sheetName, fetchImpl = fetch) {
  const { tabs, title } = await listSheetTabs(accessToken, spreadsheetId, fetchImpl);
  if (tabs.includes(sheetName)) return { created: false, title };
  const response = await fetchImpl(`${SHEETS}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`Tab "${sheetName}" tidak dapat dibuat: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  return { created: true, title };
}

async function writeValues(accessToken, spreadsheetId, range, values, fetchImpl = fetch) {
  const url = `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`Gagal menulis ke Sheets: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  return true;
}

async function clearValues(accessToken, spreadsheetId, range, fetchImpl = fetch) {
  const url = `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`Gagal mengosongkan baris lama: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  return true;
}

/**
 * Tulis header + baris, lalu hapus sisa baris lama.
 *
 * Berbeda dari OneDrive yang ditimpa dengan sel kosong, Sheets punya endpoint
 * `:clear` — barisnya benar-benar dikosongkan, bukan diisi string kosong, jadi
 * rumus COUNTA dan filter di sheet itu tetap benar.
 */
async function syncRows(accessToken, {
  spreadsheetId, sheetName, header, rows, previousRowCount = 0,
}, fetchImpl = fetch) {
  const columnCount = header.length;

  await writeValues(accessToken, spreadsheetId,
    rangeA1(sheetName, 1, 1, columnCount), [header], fetchImpl);

  if (rows.length) {
    await writeValues(accessToken, spreadsheetId,
      rangeA1(sheetName, 2, rows.length, columnCount), rows, fetchImpl);
  }

  const stale = Math.max(0, previousRowCount - rows.length);
  if (stale > 0) {
    await clearValues(accessToken, spreadsheetId,
      rangeA1(sheetName, 2 + rows.length, stale, columnCount), fetchImpl);
  }
  return { rowCount: rows.length, cleared: stale };
}

module.exports = {
  base64url, columnLetter, quoteSheetName, rangeA1, extractSpreadsheetId,
  fetchAccessToken, listSheetTabs, ensureTab, writeValues, clearValues, syncRows,
};
