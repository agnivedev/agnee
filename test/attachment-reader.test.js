'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const reader = require('../src/attachment-reader.js');
const imageReference = require('../src/image-reference.js');

test('dokumen teks/CSV dibaca jadi penanda, dengan peringatan harga di dokumen bukan harga toko', async () => {
  const csv = Buffer.from('nama,harga\nCat Dulux 5kg,150000\nSemen,50000\n');
  const marker = await reader.readDocument({ buffer: csv, mimeType: 'text/csv', filename: 'penawaran.csv' });
  assert.match(marker, /Customer mengirim file "penawaran\.csv"/);
  assert.match(marker, /Cat Dulux 5kg,150000/);
  assert.match(marker, /BUKAN harga toko/);
});

test('gambar tidak diproses pembaca dokumen (null); file terlalu besar ditolak sopan', async () => {
  assert.equal(await reader.readDocument({ buffer: Buffer.from('x'), mimeType: 'image/png', filename: 'a.png' }), null);
  const big = Buffer.alloc(reader.MAX_FILE_BYTES + 1);
  const marker = await reader.readDocument({ buffer: big, mimeType: 'application/pdf', filename: 'besar.pdf' });
  assert.match(marker, /tidak bisa dibaca otomatis/);
});

test('OCR gambar marketplace: watermark diabaikan, tulisan dibaca, harga di gambar bukan harga toko', () => {
  const reading = imageReference.parseReading(JSON.stringify({
    kind: 'produk', description: 'Kaleng cat putih 5kg', keywords: ['cat', 'putih'],
    textInImage: 'Danabrite 2290 Brilliant White 5KG Cat Tembok Interior Rp 206.000', overlayIgnored: 'logo Tokopedia, nama toko Official Store', searchQuery: 'danabrite 2290 5kg',
  }));
  assert.equal(reading.overlayIgnored, 'logo Tokopedia, nama toko Official Store');
  const text = imageReference.marker({ kind: 'produk', reading, match: null, web: [] });
  assert.match(text, /Danabrite 2290 Brilliant White 5KG/);
  assert.match(text, /Watermark\/logo diabaikan: logo Tokopedia/);
  assert.match(text, /BUKAN harga toko kita/);
  assert.match(imageReference.READ_PROMPT, /Tokopedia/);
});
