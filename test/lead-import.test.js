'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { buildXlsx } = require('../src/xlsx-writer');
const li = require('../src/lead-import');

/** XLSX tulisan tangan dengan sel formula, untuk membuktikan formula tidak dijalankan. */
async function xlsxWithFormula() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>Nama</t></si><si><t>HP</t></si><si><t>Budi</t></si></sst>');
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><f>HYPERLINK("https://jahat.example","x")</f><v>81234567890</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>=cmd|' /C calc'!A0</t></is></c><c r="B3"><v>6281300000000</v></c></row>
  </sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('CSV: kutip, pemisah titik koma, BOM, dan baris kosong', async () => {
  const csv = '﻿Nama;HP;Catatan\r\n"Budi; Jr";0812-3456-7890;"baris 1\nbaris 2"\r\n\r\nSiti;+62 813 0000 1111;"kata ""kutip"""\r\n';
  const table = await li.parseTable(Buffer.from(csv, 'utf8'), 'kontak.csv');
  assert.deepEqual(table.headers, ['Nama', 'HP', 'Catatan']);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0][0], 'Budi; Jr');
  assert.equal(table.rows[0][2], 'baris 1\nbaris 2');
  assert.equal(table.rows[1][2], 'kata "kutip"');
});

test('CSV windows-1252 dibaca tanpa merusak aksen', async () => {
  const table = await li.parseTable(Buffer.from([...Buffer.from('Nama,HP\nJos'), 0xe9, ...Buffer.from(',08123456789\n')]), 'x.csv');
  assert.equal(table.rows[0][0], 'José');
});

test('XLSX hasil ekspor Agnee sendiri bisa dibaca kembali', async () => {
  const file = buildXlsx(['Nama', 'Nomor HP'], [['Ani', '081211112222'], ['Joko', '+62 812 3333 4444']], { sheetName: 'Lead List' });
  const table = await li.parseTable(file, 'agnee-lead.xlsx');
  assert.deepEqual(table.headers, ['Nama', 'Nomor HP']);
  assert.deepEqual(table.rows, [['Ani', '081211112222'], ['Joko', '+62 812 3333 4444']]);
  assert.equal(table.format, 'xlsx');
});

test('XLSX: formula tidak dijalankan, hanya nilai tersimpan; teks "=..." tetap teks', async () => {
  const table = await li.parseTable(await xlsxWithFormula(), 'f.xlsx');
  assert.equal(table.formulaCells, 1);
  assert.equal(table.rows[0][1], '81234567890'); // nilai cache, bukan hasil HYPERLINK
  assert.ok(!table.rows.flat().some((v) => v.includes('jahat.example')));
  assert.equal(table.rows[1][0], "=cmd|' /C calc'!A0"); // disimpan apa adanya; dinetralkan saat ekspor
});

test('XLSX bermakro, .xls lama, dan berkas bukan tabel ditolak', async () => {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook/>');
  zip.file('xl/vbaProject.bin', 'x');
  await assert.rejects(li.parseTable(await zip.generateAsync({ type: 'nodebuffer' }), 'm.xlsx'), /makro/);
  await assert.rejects(li.parseTable(Buffer.from('abc'), 'lama.xls'), /\.xls/);
  await assert.rejects(li.parseTable(Buffer.from('%PDF-1.4 ...'), 'x.pdf'), /tidak didukung/);
  await assert.rejects(li.parseTable(Buffer.from('Nama,HP\n'), 'x.csv'), /minimal satu baris data/);
  await assert.rejects(li.parseTable(Buffer.alloc(0), 'x.csv'), /kosong/);
});

test('batas ukuran: berkas, jumlah baris, dan isi XLSX setelah dibuka', async () => {
  await assert.rejects(li.parseTable(Buffer.alloc(li.LIMITS.fileBytes + 1, 97), 'besar.csv'), (e) => e.code === 'too_large');
  const rows = ['Nama,HP', ...Array.from({ length: li.LIMITS.rows + 5 }, (_, i) => `n${i},0812${String(i).padStart(8, '0')}`)];
  await assert.rejects(li.parseTable(Buffer.from(rows.join('\n')), 'banyak.csv'), (e) => e.code === 'too_large');
  // 60 MB nol terkompresi jadi ~60 KB: lolos batas berkas, harus kena batas isi.
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook/>');
  zip.file('xl/worksheets/sheet1.xml', Buffer.alloc(60 * 1024 * 1024));
  const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  assert.ok(bomb.length < li.LIMITS.fileBytes);
  await assert.rejects(li.parseTable(bomb, 'bom.xlsx'), (e) => e.code === 'too_large');
});

test('normalizePhone: format lazim di Indonesia dan yang tidak valid', () => {
  const n = li.normalizePhone;
  assert.equal(n('0812-3456-7890'), '6281234567890');
  assert.equal(n('+62 812 3456 7890'), '6281234567890');
  assert.equal(n('6281234567890'), '6281234567890');
  assert.equal(n('81234567890'), '6281234567890'); // nol hilang di Excel
  assert.equal(n('0062 812 3456 7890'), '6281234567890');
  assert.equal(n('+620812 3456 7890'), '6281234567890'); // "(0)" yang terselip
  assert.equal(n('+1 415 555 0132'), '14155550132'); // negara lain dengan plus
  assert.equal(n('0812-1111-2222 / 0813-3333-4444'), '6281211112222');
  assert.equal(n('8,12345E+11'), null); // angka ilmiah Excel: data sudah rusak
  assert.equal(n('12345'), null);
  assert.equal(n('abc'), null);
  assert.equal(n(''), null);
  assert.equal(n('0812345678901234567'), null);
});

test('suggestMapping membaca judul dan isi kolom', () => {
  const headers = ['Nama Customer', 'No. WhatsApp', 'E-mail', 'Keterangan'];
  const rows = [['Ani', '08121111222', 'a@x.co', 'vip'], ['Budi', '08133334444', '', '']];
  assert.deepEqual(li.suggestMapping(headers, rows), { phone: 1, email: 2, name: 0, note: 3 });
  // Judul tidak membantu, isinya yang menentukan.
  assert.deepEqual(li.suggestMapping(['A', 'B'], [['Ani', '08121111222'], ['Budi', '08133334444']]), { phone: 1 });
});

test('validateMapping: nomor wajib, kolom tidak boleh dobel atau di luar berkas', () => {
  assert.throws(() => li.validateMapping({ name: 0 }, 3), /Nomor HP/);
  assert.throws(() => li.validateMapping({ phone: 0, name: 0 }, 3), /dua isian/);
  assert.throws(() => li.validateMapping({ phone: 9 }, 3), /tidak ada/);
  assert.deepEqual(li.validateMapping({ phone: '1', name: -1, email: '' }, 3), { phone: 1 });
});

test('evaluateRows: duplikat di berkas, sudah ada di Lead List, nomor rusak, email rusak', () => {
  const rows = [
    ['Ani', '0812 1111 2222', 'ani@x.co', ''],
    ['Ani lagi', '+62 812-1111-2222', '', ''], // duplikat di berkas (format lain, nomor sama)
    ['Budi', '081333334444', 'b@x.co', 'vip'], // sudah ada
    ['Citra', '12345', '', ''],
    ['Dewi', '082100009999', 'bukan-email', 'catatan'],
  ];
  const { leads, summary, problems } = li.evaluateRows(rows, { name: 0, phone: 1, email: 2, note: 3 }, new Set(['6281333334444']));
  assert.deepEqual(leads.map((l) => l.phone), ['6281211112222', '6282100009999']);
  assert.deepEqual(summary, { total: 5, ready: 2, invalidPhone: 1, duplicateInFile: 1, alreadyExists: 1, invalidEmail: 1 });
  assert.deepEqual(problems.map((p) => [p.line, p.kind]), [[3, 'duplicate_in_file'], [4, 'already_exists'], [5, 'invalid_phone']]);
  assert.equal(problems[0].firstLine, 2);
  assert.equal(leads[1].note, 'catatan');
  assert.equal(leads[1].email, ''); // email rusak dibuang, barisnya tetap masuk
});

// ── Diuji dengan berkas asli (temuan uji 17 Okt) ─────────────────────────────

test('XLSX asli dari LibreOffice: sel berformat, baris kosong, nomor angka, spasi, formula', async () => {
  const buffer = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', 'lead-import-libreoffice.xlsx'));
  const table = await li.parseTable(buffer, 'kontak.xlsx');
  assert.deepEqual(table.headers, ['No. WhatsApp', 'Nama Pelanggan', 'E-mail', 'Keterangan']);
  assert.equal(table.format, 'xlsx');
  assert.equal(table.formulaCells, 1);
  const mapping = li.suggestMapping(table.headers, table.rows);
  assert.deepEqual(mapping, { phone: 0, email: 2, name: 1, note: 3 });
  const { leads, summary, problems } = li.evaluateRows(table.rows, mapping, new Set(), table.rowNumbers);
  assert.deepEqual(summary, { total: 11, ready: 7, invalidPhone: 3, duplicateInFile: 1, alreadyExists: 0, invalidEmail: 1 });
  assert.deepEqual(leads.map((lead) => lead.phone), [
    '6281234567801', '6281345678902', '6281456789003', '6281567890004', '6281678900005', '14155552671', '6281800000006']);
  assert.equal(leads[0].name, 'Budi Santoso');
  assert.equal(leads[6].name, 'Spasi');
  assert.equal(leads[2].note, "=cmd|' /C calc'!A0"); // teks apa adanya, tidak dieksekusi
  // Baris kosong di berkas (5–6) ikut terhitung: nomor baris sama dengan yang dilihat di Excel.
  assert.deepEqual(problems.map(({ line, kind }) => [line, kind]), [
    [9, 'duplicate_in_file'], [10, 'invalid_phone'], [12, 'invalid_phone'], [13, 'invalid_phone']]);
  assert.equal(problems.find((problem) => problem.kind === 'duplicate_in_file').firstLine, 2);
});

test('XLSX: baris kosong berformat <row/> tidak menelan baris sesudahnya', async () => {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>HP</t></is></c><c r="B1" t="inlineStr"><is><t>Nama</t></is></c></row>
    <row r="2" ht="20" customHeight="1"/>
    <row spans="1:2" r="3"><c r="A3" t="inlineStr"><is><t>081211110001</t></is></c><c r="B3" t="inlineStr"><is><t>Satu</t></is></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>tidak valid</t></is></c></row>
  </sheetData></worksheet>`);
  const table = await li.parseTable(await zip.generateAsync({ type: 'nodebuffer' }), 'a.xlsx');
  assert.deepEqual(table.rows, [['081211110001', 'Satu'], ['tidak valid', '']]);
  assert.deepEqual(table.rowNumbers, [3, 4]);
});

test('CSV: baris "sep=;" dari Excel dibuang dan dipakai sebagai pemisah', async () => {
  const table = await li.parseTable(Buffer.from('sep=;\r\nNama;HP\r\nJaka;081211110011\r\n'), 'a.csv');
  assert.deepEqual(table.headers, ['Nama', 'HP']);
  assert.deepEqual(table.rows, [['Jaka', '081211110011']]);
  assert.deepEqual(table.rowNumbers, [2]); // Excel tidak menampilkan baris sep=
});

test('CSV: nomor baris masalah mengikuti berkas, termasuk baris kosong dan sel berbaris-baru', async () => {
  const csv = 'Nama,HP,Catatan\n\nAni,0812111100001,"baris1\nbaris2"\n\nBudi,abc,\n';
  const table = await li.parseTable(Buffer.from(csv), 'a.csv');
  const { problems } = li.evaluateRows(table.rows, { name: 0, phone: 1 }, new Set(), table.rowNumbers);
  assert.deepEqual(table.rowNumbers, [3, 5]);
  assert.deepEqual(problems.map(({ line }) => line), [5]);
});
