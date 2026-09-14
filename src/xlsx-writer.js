'use strict';

const zlib = require('node:zlib');

/**
 * Penulis .xlsx minimal.
 *
 * Sebuah file .xlsx adalah arsip ZIP berisi beberapa file XML. Menuliskannya
 * sendiri jauh lebih ringan daripada menarik pustaka spreadsheet utuh hanya
 * untuk mengekspor satu tabel datar — dan satu-satunya bagian yang benar-benar
 * rumit (kompresi) sudah ada di `zlib` bawaan Node.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** CRC-32 ditulis sendiri: `zlib.crc32` baru tersedia di Node yang lebih baru. */
function crc32(buffer) {
  let c = 0 ^ -1;
  for (let i = 0; i < buffer.length; i += 1) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buffer[i]) & 0xFF];
  }
  return (c ^ -1) >>> 0;
}

// Karakter kontrol yang dilarang XML 1.0. Isi pesan WhatsApp bisa membawanya,
// dan Excel menolak membuka file yang memuatnya.
const FORBIDDEN_CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(FORBIDDEN_CONTROL, '');
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

/** Angka murni ditulis sebagai angka supaya Excel bisa menjumlah dan mengurutkannya. */
function isPlainNumber(value) {
  return typeof value === 'string' && value.trim() !== '' && /^-?\d+(\.\d+)?$/.test(value.trim());
}

function cellXml(ref, value, asNumber) {
  if (value === '' || value === null || value === undefined) return `<c r="${ref}"/>`;
  if (asNumber) return `<c r="${ref}"><v>${escapeXml(value)}</v></c>`;
  // inlineStr menghindari tabel sharedStrings: filenya sedikit lebih besar,
  // tapi penulisannya satu lintasan tanpa perlu menyimpan indeks string.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * @param {string[]} header
 * @param {string[][]} rows
 * @param {{numericColumns?: Set<number>}} options
 *   numericColumns berisi indeks kolom (0-based) yang isinya angka.
 */
function sheetXml(header, rows, { numericColumns = new Set() } = {}) {
  const headerCells = header
    .map((value, i) => cellXml(`${columnLetter(i + 1)}1`, value, false))
    .join('');

  const body = rows.map((row, r) => {
    const cells = row.map((value, i) => cellXml(
      `${columnLetter(i + 1)}${r + 2}`,
      value,
      numericColumns.has(i) && isPlainNumber(value),
    )).join('');
    return `<row r="${r + 2}">${cells}</row>`;
  }).join('');

  const lastCol = columnLetter(Math.max(header.length, 1));
  const dimension = `A1:${lastCol}${rows.length + 1}`;

  // Baris header dibekukan dan diberi filter: tabel ini dibuka orang untuk
  // dibaca dan disortir, bukan hanya untuk disimpan.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetData><row r="1">${headerCells}</row>${body}</sheetData>
<autoFilter ref="${dimension}"/>
</worksheet>`;
}

function zipEntry(name, contentBuffer) {
  const compressed = zlib.deflateRawSync(contentBuffer);
  return {
    name,
    crc: crc32(contentBuffer),
    compressedSize: compressed.length,
    uncompressedSize: contentBuffer.length,
    data: compressed,
  };
}

/** Susun arsip ZIP (deflate) dari daftar entry. */
function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);    // versi minimum
    local.writeUInt16LE(0, 6);     // flag
    local.writeUInt16LE(8, 8);     // metode: deflate
    local.writeUInt16LE(0, 10);    // waktu
    local.writeUInt16LE(0x21, 12); // tanggal tetap, agar file deterministik
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.compressedSize, 18);
    local.writeUInt32LE(entry.uncompressedSize, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuffer, entry.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(entry.crc, 16);
    dir.writeUInt32LE(entry.compressedSize, 20);
    dir.writeUInt32LE(entry.uncompressedSize, 24);
    dir.writeUInt16LE(nameBuffer.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuffer);

    offset += local.length + nameBuffer.length + entry.data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/**
 * Buat file .xlsx satu worksheet.
 *
 * @returns {Buffer} isi file, siap dikirim sebagai unduhan.
 */
function buildXlsx(header, rows, { sheetName = 'Sheet1', numericColumns = new Set() } = {}) {
  // Excel menolak nama sheet di atas 31 karakter atau yang memuat : \ / ? * [ ]
  const safeSheetName = String(sheetName).replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet1';

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const files = [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRels],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', workbookRels],
    ['xl/worksheets/sheet1.xml', sheetXml(header, rows, { numericColumns })],
  ];

  return buildZip(files.map(([name, xml]) => zipEntry(name, Buffer.from(xml, 'utf8'))));
}

module.exports = { buildXlsx, escapeXml, columnLetter, crc32, isPlainNumber, sheetXml };
