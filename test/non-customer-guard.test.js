'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/non-customer-guard');

test('pesan tagihan dan OTP dikenali sebagai pemberitahuan otomatis', () => {
  assert.equal(guard.isAutomatedNotice('Yuk, segera selesaikan tagihan SPayLater-mu sebesar Rp 4.059.506 yang akan jatuh tempo!'), true);
  assert.equal(guard.isAutomatedNotice('Tagihan SPinjam kamu akan jatuh tempo, yuk bayarkan sebesar Rp 2.770.000!'), true);
  assert.equal(guard.isAutomatedNotice('Pengingat Tagihan Halo\n\nTerima kasih atas kesetiaan Bapak/Ibu menggunakan layanan Telkomsel Halo. MSISDN: 0812xxxx Mohon abaikan pesan ini jika Anda telah melakukan pembayaran.'), true);
  assert.equal(guard.isAutomatedNotice('Kode verifikasi Anda 123456. Jangan berikan kepada siapa pun.'), true);
});

test('customer yang menyebut tagihan atau bayar tetap dianggap customer', () => {
  assert.equal(guard.isAutomatedNotice('kak tagihan saya kemarin sudah dibayar ya'), false);
  assert.equal(guard.isAutomatedNotice('Semen tiga roda 50kg berapa? mau bayar transfer'), false);
  assert.equal(guard.isAutomatedNotice('Sore ka'), false);
  assert.equal(guard.isAutomatedNotice(''), false);
});

test('jenis template resmi akun bisnis', () => {
  assert.equal(guard.isBusinessTemplateType('notification_template'), true);
  assert.equal(guard.isBusinessTemplateType('chat'), false);
});

test('tawaran kosong vs balasan berisi', () => {
  assert.equal(guard.isGenericOffer('Oke kak. Ada yang bisa saya bantu terkait bahan bangunan?'), true);
  assert.equal(guard.isGenericOffer('Saya Agnes dari ESBEJE. Ada yang bisa saya bantu, kak?'), true);
  assert.equal(guard.isGenericOffer('Maaf, saya tidak mengerti maksudnya kak. Ada yang bisa saya bantu?'), true);
  assert.equal(guard.isGenericOffer('Semen Tiga Roda 50KG Rp 57.500 per sak, kak. Ada yang bisa saya bantu lagi?'), false);
  assert.equal(guard.isGenericOffer('Toko kami buka 08.00–20.00 di Cisauk, kak.'), false);
});

test('teman pemilik: tawaran kosong ketiga berturut-turut ditahan', () => {
  const history = [
    { role: 'user', content: 'Mihhh' },
    { role: 'assistant', content: 'Oke kak. Ada yang bisa saya bantu terkait bahan bangunan?' },
    { role: 'user', content: 'Km da smbu blm vertigo nyaa?' },
    { role: 'assistant', content: 'Halo kak, saya Agnes dari ESBEJE. Saya bantu terkait bahan bangunan ya kak. Ada yang bisa saya bantu?' },
    { role: 'user', content: 'Oo ud ganti no yah Ibu V?' },
  ];
  assert.equal(guard.isStuckLoop({ history, reply: 'Saya Agnes kak, admin penjualan ESBEJE. Ada yang bisa saya bantu?', customerText: 'Oo ud ganti no yah Ibu V?' }), true);
  // Balasan kedua masih boleh.
  assert.equal(guard.isStuckLoop({ history: history.slice(0, 3), reply: 'Ada yang bisa saya bantu, kak?', customerText: 'Km da smbu blm vertigo nyaa?' }), false);
});

test('customer sungguhan yang menyebut barang tidak pernah ditahan', () => {
  const history = [
    { role: 'user', content: 'Sore ka' },
    { role: 'assistant', content: 'Sore kak, ada yang bisa saya bantu?' },
    { role: 'user', content: 'mau tanya' },
    { role: 'assistant', content: 'Boleh kak, ada yang bisa saya bantu?' },
  ];
  assert.equal(guard.isStuckLoop({ history, reply: 'Ada yang bisa saya bantu, kak?', customerText: 'ada paralon 4 inch?' }), false);
  // Barang disebut di giliran sebelumnya: putaran belum terbukti.
  const withProduct = [
    { role: 'user', content: 'harga semen berapa' },
    { role: 'assistant', content: 'Ada yang bisa saya bantu, kak?' },
    { role: 'user', content: 'halo' },
    { role: 'assistant', content: 'Ada yang bisa saya bantu, kak?' },
  ];
  assert.equal(guard.isStuckLoop({ history: withProduct, reply: 'Ada yang bisa saya bantu, kak?', customerText: 'halo' }), true);
  const productBetween = [
    { role: 'assistant', content: 'Ada yang bisa saya bantu, kak?' },
    { role: 'user', content: 'harga semen berapa' },
    { role: 'assistant', content: 'Ada yang bisa saya bantu, kak?' },
    { role: 'user', content: 'halo' },
  ];
  assert.equal(guard.isStuckLoop({ history: productBetween, reply: 'Ada yang bisa saya bantu, kak?', customerText: 'halo' }), false);
  // Balasan berisi di tengah memutus hitungan.
  const substantive = [
    { role: 'assistant', content: 'Ada yang bisa saya bantu, kak?' },
    { role: 'user', content: 'oh' },
    { role: 'assistant', content: 'Kami toko bahan bangunan di Cisauk, buka setiap hari 08.00–20.00.' },
    { role: 'user', content: 'oke' },
  ];
  assert.equal(guard.isStuckLoop({ history: substantive, reply: 'Ada yang bisa saya bantu, kak?', customerText: 'oke' }), false);
});
