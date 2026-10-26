'use strict';

/**
 * Lampiran Latih AI dan file rujukan menerima file apa saja. Yang dijaga: teks
 * dari Excel, PowerPoint, OpenDocument, CSV, dan file teks berekstensi asing
 * benar-benar terbaca; gambar dan biner tetap ditolak dengan rapi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { extractPlaybookText } = require('../src/playbook-extractor');
const { buildXlsx } = require('../src/xlsx-writer');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function zipOf(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('Excel dengan shared strings: nama sheet, sel teks, angka, dan entitas XML terbaca', async () => {
  const buffer = await zipOf({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Harga &amp; Paket" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Kelas</t></si><si><t>Harga</t></si><si><r><t>E-</t></r><r><t>zone</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1750000</v></c></row>'
      + '<row r="3"><c r="A3" t="inlineStr"><is><t>Gold &lt;VIP&gt;</t></is></c><c r="B3"/></row>'
      + '</sheetData></worksheet>',
  });
  const out = await extractPlaybookText(buffer, XLSX, 'harga.xlsx');
  assert.equal(out.status, 'ready');
  assert.equal(out.kind, 'document');
  assert.equal(out.text, '## Harga & Paket\n\nKelas\tHarga\nE-zone\t1750000\nGold <VIP>');
});

test('Excel buatan Agnee sendiri (inline string) juga terbaca', async () => {
  const buffer = buildXlsx(['Nama', 'Nomor'], [['Budi', '0812']], { sheetName: 'Lead' });
  const out = await extractPlaybookText(buffer, 'application/octet-stream', 'lead.xlsx');
  assert.equal(out.status, 'ready');
  assert.match(out.text, /Nama\tNomor\nBudi\t0812/);
});

test('PowerPoint: teks per slide berurutan, slide 10 setelah slide 2', async () => {
  const slide = (texts) => `<p:sld><p:cSld>${texts.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:cSld></p:sld>`;
  const buffer = await zipOf({
    'ppt/slides/slide1.xml': slide(['Promo Oktober', 'Diskon 10%']),
    'ppt/slides/slide2.xml': slide(['Syarat']),
    'ppt/slides/slide10.xml': slide(['Penutup']),
  });
  const out = await extractPlaybookText(buffer, '', 'deck.pptx');
  assert.equal(out.status, 'ready');
  assert.equal(out.text, '## Slide 1\n\nPromo Oktober\nDiskon 10%\n\n## Slide 2\n\nSyarat\n\n## Slide 3\n\nPenutup');
});

test('OpenDocument teks: paragraf dan judul jadi baris', async () => {
  const buffer = await zipOf({ 'content.xml': '<office:document-content><text:h>SOP</text:h><text:p>Balas &lt; 5 menit</text:p></office:document-content>' });
  const out = await extractPlaybookText(buffer, 'application/vnd.oasis.opendocument.text', 'sop.odt');
  assert.equal(out.text, 'SOP\nBalas < 5 menit');
});

test('CSV, JSON, dan ekstensi asing yang isinya teks dibaca apa adanya', async () => {
  const csv = await extractPlaybookText(Buffer.from('kelas,harga\nE-zone,1750000'), 'text/csv', 'harga.csv');
  assert.equal(csv.text, 'kelas,harga\nE-zone,1750000');
  const odd = await extractPlaybookText(Buffer.from('1\n00:00:01 --> 00:00:02\nHalo'), 'application/octet-stream', 'video.srt');
  assert.equal(odd.status, 'ready');
  assert.equal(odd.kind, 'document');
});

test('gambar dan biner tak dikenal: tidak dibaca, tidak melempar', async () => {
  const image = await extractPlaybookText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]), 'image/png', 'brosur.png');
  assert.deepEqual(image, { kind: 'image', text: null, status: 'unsupported' });
  const binary = await extractPlaybookText(Buffer.from([1, 0, 2, 0, 3]), 'application/octet-stream', 'data.bin');
  assert.equal(binary.status, 'unsupported');
  const legacy = await extractPlaybookText(Buffer.from('\xd0\xcf\x11\xe0', 'latin1'), 'application/vnd.ms-excel', 'lama.xls');
  assert.equal(legacy.status, 'unsupported');
  const broken = await extractPlaybookText(Buffer.from('bukan zip'), XLSX, 'rusak.xlsx');
  assert.equal(broken.status, 'failed');
});

test('batas panjang bisa diatur pemanggil', async () => {
  const out = await extractPlaybookText(Buffer.from('a'.repeat(50)), 'text/plain', 'a.txt', { maxChars: 10 });
  assert.match(out.text, /^a{10}\n\n\[\.\.\.dipotong/);
});
