'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const summary = require('../src/order-summary.js');
const { conversationRules } = require('../src/reply-style.js');

test('rincian: total produk, ongkir, garis, grand total dihitung alat', () => {
  const out = summary.run({
    barang: [
      { nama: 'MU 480 RENOFIX 25KG', jumlah: 10, harga_satuan: 313000, satuan: 'sak' },
      { nama: 'Semen Tiga Roda', jumlah: 2, harga_satuan: 60000 },
    ],
    ongkir: 45000, keterangan_ongkir: 'Ongkir (Lalamove, Motor)',
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.total_produk, 3250000);
  assert.equal(out.grand_total, 3295000);
  assert.match(out.teks, /\*Rincian Pesanan\*/);
  assert.match(out.teks, /10 sak x Rp 313\.000 = Rp 3\.130\.000/);
  assert.match(out.teks, /Total produk: Rp 3\.250\.000/);
  assert.match(out.teks, /Ongkir \(Lalamove, Motor\): Rp 45\.000\n━+\n\*GRAND TOTAL: Rp 3\.295\.000\*/);
});

test('rincian: ongkir kosong = menyusul, 0 = GRATIS', () => {
  const base = { barang: [{ nama: 'A', jumlah: 1, harga_satuan: 1000 }] };
  assert.match(summary.run(base).teks, /Ongkir: menyusul[\s\S]*belum termasuk ongkir/);
  const free = summary.run({ ...base, ongkir: 0 });
  assert.match(free.teks, /Ongkir: GRATIS/);
  assert.equal(free.grand_total, 1000);
});

test('rincian: data tidak lengkap ditolak', () => {
  assert.equal(summary.run({ barang: [{ nama: 'A', jumlah: 0, harga_satuan: 1 }] }).status, 'gagal');
  assert.equal(summary.run({}).status, 'gagal');
});

test('aturan bawaan memuat arahan closing 3-5 giliran dan rincian WhatsApp', () => {
  const rules = conversationRules();
  assert.match(rules, /3-5 giliran/);
  assert.match(rules, /GRAND TOTAL/);
  assert.match(rules, /susun_rincian/);
});
