'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../src/dealpos-sync.js');

test('hanya nomor HP Indonesia yang jadi nomor WhatsApp', () => {
  assert.equal(sync.normalizePhone('081234567890'), '6281234567890');
  assert.equal(sync.normalizePhone('+62 812-3456-7890'), '6281234567890');
  assert.equal(sync.normalizePhone('8123456789'), '628123456789');
  assert.equal(sync.normalizePhone('6281234567890'), '6281234567890');
  // Yang tampil di Lead List produksi: bukan nomor HP.
  for (const junk of ['2158354552', '26052362', '1234', '021-5551234', '62 21 5551234', '0']) {
    assert.equal(sync.normalizePhone(junk), null, junk);
  }
});

test('nomor yang bukan HP disimpan sebagai telp lain, bukan dibuang', () => {
  assert.equal(sync.otherPhone('021-5551234'), '021-5551234');
  assert.equal(sync.otherPhone('2158354552'), '2158354552');
  assert.equal(sync.otherPhone('081234567890'), null, 'nomor HP sah tidak jadi telp lain');
  assert.equal(sync.otherPhone('1234'), null, 'terlalu pendek untuk berarti');
  assert.equal(sync.otherPhone(null), null);
});

function fakeFetch(handler) {
  return async (url, options) => {
    const { status = 200, body } = handler(String(url), options);
    return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
}

test('detail customer: alamat dibersihkan, tanggal kosong dan alamat titik dibuang', async () => {
  const fetchImpl = fakeFetch((url) => {
    assert.match(url, /\/api\/v3\/Customer\/Detail\?ID=abc$/);
    return { body: { Address: '  KP.SETU  RT 01/005\nDESA DANGDANG ', City: 'Tangerang', Phone: '021-5551234', Gender: 'Male', Birthday: '0001-01-01T00:00:00', Group: 'Gold', LoyaltyPoint: 12 } };
  });
  const detail = await sync.fetchCustomerDetail('toko.dealpos.co.id', 'tok', 'abc', fetchImpl);
  assert.deepEqual(detail, {
    address: 'KP.SETU RT 01/005 DESA DANGDANG', city: 'Tangerang', phoneAlt: '021-5551234',
    gender: 'Male', birthDate: null, memberGroup: 'Gold', loyaltyPoints: 12,
  });

  const empty = await sync.fetchCustomerDetail('toko.dealpos.co.id', 'tok', 'abc', fakeFetch(() => ({ body: { Address: '.', City: '', Phone: null, Birthday: '1990-05-17T00:00:00' } })));
  assert.equal(empty.address, null);
  assert.equal(empty.city, null);
  assert.equal(empty.phoneAlt, null);
  assert.equal(empty.birthDate, '1990-05-17');
});

test('429 dari DealPOS jadi galat yang bisa dikenali beserta lama tunggunya', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 429, body: { Message: 'Too many requests. Please try again after 180 second(s).' } }));
  await assert.rejects(
    () => sync.fetchCustomerDetail('toko.dealpos.co.id', 'tok', 'abc', fetchImpl),
    (error) => error.rateLimited === true && error.retryAfter === 180 && /3 menit/.test(error.message),
  );
});
