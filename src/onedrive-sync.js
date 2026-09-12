'use strict';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';

/**
 * Nomor kolom (1-based) menjadi huruf kolom Excel.
 *
 * Dipakai untuk menyusun alamat range. Ditulis sendiri karena satu-satunya
 * alternatif adalah menarik pustaka spreadsheet utuh hanya demi fungsi ini.
 */
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

/** Alamat range untuk blok mulai baris `startRow`. */
function rangeAddress(startRow, rowCount, columnCount) {
  const lastCol = columnLetter(columnCount);
  return `A${startRow}:${lastCol}${startRow + Math.max(rowCount, 1) - 1}`;
}

/**
 * Berapa baris kosong yang harus ditimpa di bawah data baru.
 *
 * Excel tidak menghapus baris hanya karena kita menulis lebih sedikit. Kalau
 * kontak berkurang dari 40 jadi 30, sepuluh baris lama tetap terlihat seperti
 * kontak yang masih ada. Jadi sisanya ditimpa dengan sel kosong.
 */
function blankRowCount(previousRowCount, nextRowCount) {
  return Math.max(0, previousRowCount - nextRowCount);
}

/**
 * Tautan berbagi OneDrive menjadi token `shares/{id}` milik Graph.
 * Aturannya dari dokumentasi Graph: base64url, awalan 'u!', tanpa padding.
 */
function encodeShareLink(url) {
  const base64 = Buffer.from(String(url).trim(), 'utf8').toString('base64');
  return `u!${base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
}

/**
 * Token aplikasi (client credentials). Alur ini tidak memerlukan seseorang
 * untuk login, jadi sinkronisasi tetap jalan tanpa sesi pengguna — tapi
 * sebagai gantinya app-nya butuh persetujuan admin tenant.
 */
async function fetchAppToken({ tenantId, clientId, clientSecret }, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const response = await fetchImpl(`${LOGIN}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Token Microsoft ditolak: ${data?.error_description || data?.error || `HTTP ${response.status}`}`);
  }
  if (!data.access_token) throw new Error('Microsoft tidak mengembalikan access token.');
  return { accessToken: data.access_token, expiresInSeconds: Number(data.expires_in) || 3600 };
}

/** Resolusi tautan berbagi menjadi driveId/itemId yang stabil. */
async function resolveWorkbook(accessToken, shareUrl, fetchImpl = fetch) {
  const response = await fetchImpl(`${GRAPH}/shares/${encodeShareLink(shareUrl)}/driveItem`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`File tidak dapat dibuka: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  const driveId = data?.parentReference?.driveId;
  if (!driveId || !data?.id) throw new Error('Tautan itu tidak menunjuk ke file di OneDrive.');
  if (!/\.xlsx$/i.test(data.name || '')) {
    throw new Error(`File harus .xlsx, bukan "${data.name}".`);
  }
  return { driveId, itemId: data.id, fileName: data.name, webUrl: data.webUrl || null };
}

/** Tulis satu blok nilai ke worksheet. */
async function writeRange(accessToken, { driveId, itemId, worksheetName, address, values }, fetchImpl = fetch) {
  const url = `${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets/${encodeURIComponent(worksheetName)}/range(address='${address}')`;
  const response = await fetchImpl(url, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`Gagal menulis ke Excel: ${data?.error?.message || `HTTP ${response.status}`}`);
  }
  return true;
}

/** Buat worksheet kalau belum ada. Sudah ada -> dibiarkan. */
async function ensureWorksheet(accessToken, { driveId, itemId, worksheetName }, fetchImpl = fetch) {
  const response = await fetchImpl(`${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: worksheetName }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return 'created';
  const data = await response.json().catch(() => ({}));
  // Graph menolak nama yang sudah dipakai; itu justru keadaan yang kita mau.
  if (/already exists|ItemAlreadyExists|NameNotUnique/i.test(JSON.stringify(data))) return 'exists';
  throw new Error(`Worksheet tidak dapat disiapkan: ${data?.error?.message || `HTTP ${response.status}`}`);
}

/**
 * Tulis header + baris ke worksheet, lalu kosongkan sisa baris lama.
 *
 * @returns {Promise<{rowCount: number, blanked: number}>}
 */
async function syncRows(accessToken, {
  driveId, itemId, worksheetName, header, rows, previousRowCount = 0,
}, fetchImpl = fetch) {
  const columnCount = header.length;
  const target = { driveId, itemId, worksheetName };

  await writeRange(accessToken, {
    ...target,
    address: rangeAddress(1, 1, columnCount),
    values: [header],
  }, fetchImpl);

  if (rows.length) {
    await writeRange(accessToken, {
      ...target,
      address: rangeAddress(2, rows.length, columnCount),
      values: rows,
    }, fetchImpl);
  }

  const blanked = blankRowCount(previousRowCount, rows.length);
  if (blanked > 0) {
    const empty = Array.from({ length: blanked }, () => Array(columnCount).fill(''));
    await writeRange(accessToken, {
      ...target,
      address: rangeAddress(2 + rows.length, blanked, columnCount),
      values: empty,
    }, fetchImpl);
  }

  return { rowCount: rows.length, blanked };
}

module.exports = {
  columnLetter, rangeAddress, blankRowCount, encodeShareLink,
  fetchAppToken, resolveWorkbook, ensureWorksheet, writeRange, syncRows,
};
