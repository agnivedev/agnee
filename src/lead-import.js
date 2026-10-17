'use strict';

/**
 * Impor Lead List dari berkas Excel (.xlsx) atau CSV.
 *
 * Berkas ini datang dari luar, jadi diperlakukan sebagai data mentah:
 *   - Formula TIDAK PERNAH dijalankan. Pembaca XLSX hanya membaca nilai yang
 *     tersimpan di sel (<v>), tidak pernah isi formulanya (<f>); sel berformula
 *     dihitung supaya pratinjau bisa memperingatkan. Teks berawalan `= + - @`
 *     disimpan apa adanya dan dinetralkan saat diekspor (lihat formula-guard.js).
 *   - Ukuran dibatasi di tiga tempat: berkas terkompresi, isi XLSX setelah
 *     dibuka (zip bomb), dan jumlah baris/kolom.
 *   - Tidak ada makro, tautan eksternal, atau gambar yang dibaca.
 *
 * Modul ini murni (tanpa database, tanpa jaringan): pencocokan duplikat dengan
 * Lead List yang sudah ada dikerjakan pemanggil lewat `existingPhones`.
 */

const path = require('node:path');
const JSZip = require('jszip');

const LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  unzippedBytes: 40 * 1024 * 1024,
  rows: 20000,
  columns: 60,
  cellChars: 2000,
};

class ImportError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

// ── Pembaca CSV ──────────────────────────────────────────────────────────────

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    // Excel di Windows menyimpan "CSV" dalam windows-1252 kalau bukan "CSV UTF-8".
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** Pemisah yang paling sering muncul di luar tanda kutip pada beberapa baris pertama. */
function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 5; i += 1) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '\n') lines += 1;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/** RFC 4180: kutip ganda untuk koma/baris baru, `""` = satu kutip. */
function parseCsv(text) {
  // Excel menulis "sep=;" di baris pertama CSV bila pemisahnya bukan koma; baris itu
  // petunjuk, bukan judul kolom.
  const hint = /^sep=(.)\r?\n/i.exec(text);
  if (hint) text = text.slice(hint[0].length);
  const delimiter = hint ? hint[1] : detectDelimiter(text);
  const rows = [];
  const rowNumbers = [];
  let record = 0; // nomor baris di spreadsheet = urutan rekaman, termasuk yang kosong (Excel tidak menampilkan baris sep=)
  let row = [];
  let cell = '';
  let inQuotes = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    record += 1;
    if (row.some((value) => value.trim() !== '')) { rows.push(row); rowNumbers.push(record); }
    row = [];
    if (rows.length > LIMITS.rows + 1) throw new ImportError(`Berkas terlalu besar: maksimal ${LIMITS.rows.toLocaleString('id-ID')} baris data.`, 'too_large');
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === delimiter) endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] !== '\n') endRow(); } else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return { rows, rowNumbers, formulaCells: 0 };
}

// ── Pembaca XLSX ─────────────────────────────────────────────────────────────

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, ent) => {
    if (ent[0] === '#') {
      const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 8 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return XML_ENTITIES[ent.toLowerCase()] ?? match;
  });
}

/** Isi semua <t> di dalam satu fragmen (<si> atau <is>), mengabaikan teks fonetik <rPh>. */
function textOf(fragment) {
  const withoutPhonetic = fragment.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g)) out += decodeXml(m[1] || '');
  return out;
}

function columnIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() || '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readEntry(zip, name) {
  const entry = zip.file(name);
  if (!entry) return null;
  return entry.async('string');
}

async function parseXlsx(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new ImportError('Berkas Excel tidak bisa dibaca. Pastikan formatnya .xlsx (bukan .xls lama) dan tidak rusak.');
  }
  // Zip bomb: jumlah byte setelah dibuka dibatasi SEBELUM satu entri pun dibuka.
  let unzipped = 0;
  zip.forEach((relative, entry) => { unzipped += Number(entry._data?.uncompressedSize) || 0; });
  if (unzipped > LIMITS.unzippedBytes) throw new ImportError('Isi berkas Excel terlalu besar setelah dibuka.', 'too_large');
  if (zip.file('xl/vbaProject.bin')) {
    // Makro tidak dijalankan, tetapi berkas bermakro bukan daftar kontak biasa.
    throw new ImportError('Berkas Excel berisi makro. Simpan sebagai .xlsx biasa (tanpa makro) lalu coba lagi.');
  }

  const workbook = await readEntry(zip, 'xl/workbook.xml');
  if (!workbook) throw new ImportError('Berkas ini bukan buku kerja Excel yang valid.');

  // Lembar pertama saja (urutan di workbook.xml, bukan nama berkasnya).
  const rels = await readEntry(zip, 'xl/_rels/workbook.xml.rels') || '';
  const firstSheet = /<sheet\b[^>]*?r:id="([^"]+)"/.exec(workbook);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (firstSheet) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0])
      .find((tag) => new RegExp(`Id="${firstSheet[1]}"`).test(tag));
    const target = rel && /Target="([^"]+)"/.exec(rel)?.[1];
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
  }
  const sheet = await readEntry(zip, sheetPath);
  if (!sheet) throw new ImportError('Lembar pertama di berkas Excel tidak ditemukan.');

  const sharedXml = await readEntry(zip, 'xl/sharedStrings.xml');
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];

  const rows = [];
  const rowNumbers = [];
  let formulaCells = 0;
  let nextRow = 0;
  // Baris kosong yang hanya berformat ditulis `<row .../>`; tanpa cabang ini ia
  // menelan baris sesudahnya.
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    nextRow = Number(/\sr="(\d+)"/.exec(` ${rowMatch[1]}`)?.[1]) || nextRow + 1;
    const cells = [];
    for (const cellMatch of (rowMatch[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] || '';
      const ref = /\sr="([A-Z]+\d+)"/i.exec(` ${attrs}`)?.[1];
      const type = /\st="([^"]+)"/.exec(` ${attrs}`)?.[1];
      const col = ref ? columnIndex(ref) : cells.length;
      if (col >= LIMITS.columns) continue;
      if (/<f\b/.test(inner)) formulaCells += 1;
      let value = '';
      if (type === 'inlineStr') value = textOf(inner);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          if (type === 's') value = shared[Number(v)] ?? '';
          else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
          else value = decodeXml(v);
        }
      }
      cells[col] = value;
    }
    if (cells.some((value) => String(value ?? '').trim() !== '')) {
      rows.push(Array.from(cells, (value) => value ?? ''));
      rowNumbers.push(nextRow);
    }
    if (rows.length > LIMITS.rows + 1) throw new ImportError(`Berkas terlalu besar: maksimal ${LIMITS.rows.toLocaleString('id-ID')} baris data.`, 'too_large');
  }
  return { rows, rowNumbers, formulaCells };
}

// ── Berkas -> tabel ──────────────────────────────────────────────────────────

const isZip = (buffer) => buffer[0] === 0x50 && buffer[1] === 0x4b;

/**
 * @returns {Promise<{headers: string[], rows: string[][], rowNumbers: number[], formulaCells: number, format: 'xlsx'|'csv'}>}
 *   Baris pertama berkas dianggap judul kolom. `rowNumbers` = nomor baris asli tiap baris data
 *   di spreadsheet (baris kosong ikut terhitung), supaya laporan masalah menunjuk baris yang benar.
 */
async function parseTable(buffer, filename = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ImportError('Berkas kosong.');
  if (buffer.length > LIMITS.fileBytes) throw new ImportError('Berkas maksimal 5 MB.', 'too_large');
  const ext = path.extname(String(filename)).toLowerCase();
  if (ext === '.xls') throw new ImportError('Format .xls lama tidak didukung. Simpan ulang sebagai .xlsx atau CSV.');
  const looksXlsx = isZip(buffer);
  if (looksXlsx && ext && !['.xlsx', '.xlsm'].includes(ext) && ext !== '.csv') {
    throw new ImportError('Tipe berkas tidak didukung. Gunakan .xlsx atau .csv.', 'unsupported');
  }
  if (!looksXlsx && !['.csv', '.txt', ''].includes(ext)) {
    throw new ImportError('Tipe berkas tidak didukung. Gunakan .xlsx atau .csv.', 'unsupported');
  }
  const table = looksXlsx ? await parseXlsx(buffer) : parseCsv(decodeText(buffer));
  if (table.rows.length < 2) throw new ImportError('Berkas harus punya baris judul kolom dan minimal satu baris data.');
  const width = Math.min(LIMITS.columns, Math.max(...table.rows.map((row) => row.length)));
  const clean = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, LIMITS.cellChars);
  const grid = table.rows.map((row) => Array.from({ length: width }, (_, i) => clean(row[i])));
  const headers = grid[0].map((h, i) => h || `Kolom ${i + 1}`);
  return { headers, rows: grid.slice(1), rowNumbers: table.rowNumbers.slice(1), formulaCells: table.formulaCells, format: looksXlsx ? 'xlsx' : 'csv' };
}

// ── Nomor HP ─────────────────────────────────────────────────────────────────

/**
 * Nomor HP -> digit internasional tanpa plus (format chat WhatsApp), atau null.
 * Aturan (Indonesia sebagai bawaan): `08…` -> `628…`; `+62…`/`62…`/`0062…` tetap;
 * `8…` (nol hilang di Excel) dengan 9–12 digit -> `628…`; kode negara lain
 * diterima bila diawali `+` atau `00`. Hasil harus 8–15 digit.
 */
function normalizePhone(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  // Excel menyimpan nomor panjang sebagai angka ilmiah (6,2812E+11): datanya sudah rusak.
  if (/^\d+([.,]\d+)?e[+-]?\d+$/i.test(text)) return null;
  // Beberapa sel berisi dua nomor ("0812.. / 0813.."): ambil yang pertama.
  text = text.split(/[\/;,]|\s{2,}|\sdan\s|\satau\s/i)[0].trim();
  const plus = text.startsWith('+');
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (!plus && !digits.startsWith('62') && digits.startsWith('8') && digits.length >= 9 && digits.length <= 12) digits = `62${digits}`;
  if (digits.startsWith('620')) digits = `62${digits.slice(3)}`;
  if (!/^\d{8,15}$/.test(digits)) return null;
  return digits;
}

// ── Pemetaan kolom ───────────────────────────────────────────────────────────

const FIELDS = ['phone', 'name', 'email', 'note'];
const FIELD_LABELS = { phone: 'Nomor HP', name: 'Nama', email: 'Email', note: 'Catatan' };

const HEADER_HINTS = {
  phone: /\b(no\.?\s*)?(hp|wa|whatsapp|handphone|telepon|telp|tlp|phone|mobile|nomor|number|nomer|kontak)\b/i,
  name: /\b(nama|name|customer|pelanggan|kontak|lead)\b/i,
  email: /e-?mail|surel/i,
  note: /\b(catatan|note|notes|keterangan|remark|memo|alamat|kota)\b/i,
};

/** Tebakan pemetaan dari judul kolom, dikuatkan dengan isinya (kolom yang berisi nomor valid). */
function suggestMapping(headers, rows) {
  const mapping = {};
  const used = new Set();
  const phoneScore = headers.map((_, i) => {
    const sample = rows.slice(0, 50).map((row) => row[i]).filter(Boolean);
    return sample.length ? sample.filter((v) => normalizePhone(v)).length / sample.length : 0;
  });
  // Nomor HP: judul yang cocok DAN isinya nomor; kalau tak ada judul, kolom dengan isi nomor terbanyak.
  let phoneCol = headers.findIndex((h, i) => HEADER_HINTS.phone.test(h) && !/\bnama\b|name/i.test(h) && phoneScore[i] >= 0.5);
  if (phoneCol < 0) {
    const best = phoneScore.reduce((b, s, i) => (s > phoneScore[b] ? i : b), 0);
    if (phoneScore[best] >= 0.6) phoneCol = best;
  }
  if (phoneCol >= 0) { mapping.phone = phoneCol; used.add(phoneCol); }
  for (const field of ['email', 'name', 'note']) {
    const col = headers.findIndex((h, i) => !used.has(i) && HEADER_HINTS[field].test(h));
    if (col >= 0) { mapping[field] = col; used.add(col); }
  }
  return mapping;
}

/** Pemetaan dari klien -> pemetaan bersih, atau melempar ImportError. */
function validateMapping(mapping, width) {
  const clean = {};
  const seen = new Set();
  for (const field of FIELDS) {
    const raw = mapping?.[field];
    if (raw === undefined || raw === null || raw === '' || raw === -1) continue;
    const col = Number(raw);
    if (!Number.isInteger(col) || col < 0 || col >= width) throw new ImportError(`Kolom untuk ${FIELD_LABELS[field]} tidak ada di berkas.`);
    if (seen.has(col)) throw new ImportError('Satu kolom tidak bisa dipakai untuk dua isian.');
    seen.add(col);
    clean[field] = col;
  }
  if (clean.phone === undefined) throw new ImportError('Pilih kolom Nomor HP.');
  return clean;
}

// ── Penilaian baris ──────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Nilai tiap baris: siap diimpor / tidak valid / duplikat di berkas / sudah ada di Lead List.
 * @param existingPhones Set nomor (digit) yang sudah ada di Lead List company ini
 * @param rowNumbers nomor baris asli per baris data (dari parseTable); bila kosong dihitung dari urutan
 * @returns {{leads: object[], summary: object, problems: object[]}} `leads` hanya yang siap diimpor
 */
function evaluateRows(rows, mapping, existingPhones = new Set(), rowNumbers = null) {
  const leads = [];
  const problems = [];
  const seen = new Map();
  const summary = { total: rows.length, ready: 0, invalidPhone: 0, duplicateInFile: 0, alreadyExists: 0, invalidEmail: 0 };
  rows.forEach((row, index) => {
    const line = rowNumbers?.[index] ?? index + 2; // tanpa nomor asli: baris judul = 1
    const rawPhone = row[mapping.phone] || '';
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      summary.invalidPhone += 1;
      problems.push({ line, kind: 'invalid_phone', value: rawPhone.slice(0, 40) });
      return;
    }
    if (seen.has(phone)) {
      summary.duplicateInFile += 1;
      problems.push({ line, kind: 'duplicate_in_file', value: rawPhone.slice(0, 40), firstLine: seen.get(phone) });
      return;
    }
    seen.set(phone, line);
    if (existingPhones.has(phone)) {
      summary.alreadyExists += 1;
      problems.push({ line, kind: 'already_exists', value: rawPhone.slice(0, 40) });
      return;
    }
    let email = mapping.email === undefined ? '' : (row[mapping.email] || '');
    if (email && !EMAIL_RE.test(email)) { summary.invalidEmail += 1; email = ''; }
    const name = mapping.name === undefined ? '' : (row[mapping.name] || '').slice(0, 200);
    const note = mapping.note === undefined ? '' : (row[mapping.note] || '').slice(0, 1000);
    leads.push({ line, phone, name, email, note });
    summary.ready += 1;
  });
  return { leads, summary, problems };
}

/** chatId WhatsApp dari nomor hasil normalisasi. */
const chatIdFor = (phone) => `${phone}@c.us`;

module.exports = {
  LIMITS, FIELDS, FIELD_LABELS, ImportError,
  parseTable, parseCsv, parseXlsx, normalizePhone, suggestMapping, validateMapping, evaluateRows, chatIdFor,
};
