'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { buildXlsx, escapeXml, isPlainNumber, sheetXml, crc32 } = require('../src/xlsx-writer.js');

/**
 * Baca satu entry dari arsip ZIP yang dihasilkan.
 *
 * Ditulis di test, bukan di modulnya: modulnya hanya perlu menulis, dan
 * membaca balik di sini membuktikan arsipnya benar-benar bisa dibongkar
 * pihak lain — bukan hanya konsisten dengan dirinya sendiri.
 */
function readZipEntry(buffer, wantedName) {
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (name === wantedName) return zlib.inflateRawSync(data).toString('utf8');
    offset = dataStart + compressedSize;
  }
  return null;
}

function zipEntryNames(buffer) {
  const names = [];
  let offset = 0;
  while (offset < buffer.length - 4 && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    names.push(buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'));
    offset = offset + 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

test('CRC-32 cocok dengan nilai rujukan', () => {
  // Nilai baku untuk "123456789" di spesifikasi CRC-32.
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('XML di-escape dan karakter kontrol dibuang', () => {
  assert.equal(escapeXml('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;');
  // Excel menolak membuka file yang memuat karakter kontrol terlarang.
  assert.equal(escapeXml(`halo${String.fromCharCode(7)}dunia`), 'halodunia');
  // Tab dan baris baru sah, jadi harus tetap ada.
  assert.equal(escapeXml('a\tb\nc'), 'a\tb\nc');
});

test('angka murni dibedakan dari teks', () => {
  assert.equal(isPlainNumber('80'), true);
  assert.equal(isPlainNumber('-3.5'), true);
  assert.equal(isPlainNumber(''), false);
  assert.equal(isPlainNumber('  '), false);
  // Nomor telepon harus tetap teks: angka akan membuang nol di depan.
  assert.equal(isPlainNumber('081234567890'), true);
  assert.equal(isPlainNumber('+6281234'), false);
});

test('kolom angka ditulis sebagai angka, sisanya sebagai teks', () => {
  const xml = sheetXml(['Nomor', 'Skor'], [['081234', '80']], { numericColumns: new Set([1]) });
  // Kolom 0 tidak ada di numericColumns, jadi tetap inlineStr walau isinya angka.
  assert.match(xml, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">081234<\/t>/);
  assert.match(xml, /<c r="B2"><v>80<\/v><\/c>/);
});

test('sel kosong ditulis ringkas', () => {
  const xml = sheetXml(['A', 'B'], [['isi', '']]);
  assert.match(xml, /<c r="B2"\/>/);
});

test('arsip xlsx memuat lima bagian wajib dan bisa dibongkar kembali', () => {
  const buffer = buildXlsx(['Nomor', 'Nama'], [['0812', 'Nadia']], { sheetName: 'Lead' });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.readUInt32LE(0), 0x04034b50, 'harus diawali tanda tangan ZIP');
  assert.deepEqual(zipEntryNames(buffer), [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/worksheets/sheet1.xml',
  ]);

  const sheet = readZipEntry(buffer, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /Nadia/);
  assert.match(sheet, /<dimension ref="A1:B2"\/>/);

  const workbook = readZipEntry(buffer, 'xl/workbook.xml');
  assert.match(workbook, /name="Lead"/);
});

test('nama sheet dirapikan agar Excel menerimanya', () => {
  const buffer = buildXlsx(['A'], [], { sheetName: 'Lead/List: 2026 [draft] yang sangat panjang sekali' });
  const workbook = readZipEntry(buffer, 'xl/workbook.xml');
  const name = workbook.match(/name="([^"]*)"/)[1];
  assert.ok(name.length <= 31, `nama sheet ${name.length} karakter, maksimal 31`);
  assert.ok(!/[:\\/?*[\]]/.test(name), 'karakter terlarang harus hilang');
});

test('tabel kosong tetap menghasilkan file yang sah', () => {
  const buffer = buildXlsx(['Nomor'], []);
  const sheet = readZipEntry(buffer, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<dimension ref="A1:A1"\/>/);
  assert.match(sheet, /Nomor/);
});
