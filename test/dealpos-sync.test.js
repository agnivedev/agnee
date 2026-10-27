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

// Jam maya: `wait` memasang pewaktu, `run` memajukan waktu ke pewaktu terdekat
// setiap kali semua pemanggil sedang menunggu.
function virtualClock() {
  let t = 1_000_000;
  const timers = [];
  return {
    now: () => t,
    wait: (ms) => new Promise((resolve) => { timers.push({ at: t + ms, resolve }); }),
    async run(promise) {
      let finished = false;
      const guarded = promise.finally(() => { finished = true; });
      guarded.catch(() => {});
      while (!finished) {
        await new Promise((resolve) => setImmediate(resolve));
        if (finished) break;
        if (!timers.length) continue;
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        t = Math.max(t, next.at);
        next.resolve();
      }
      return guarded;
    },
  };
}

test('antrean: tiga pekerjaan serentak tidak pernah melewati 50 per 180 detik', async () => {
  const clock = virtualClock();
  const limiter = sync.createRateLimiter({ now: clock.now, wait: clock.wait });
  const stamps = [];
  const worker = async (patient, n) => {
    for (let i = 0; i < n; i += 1) {
      await limiter.acquire('toko.dealpos.co.id', { patient });
      stamps.push(clock.now());
    }
  };
  // sinkron pelanggan, tarikan alamat, tarikan harga berbarengan
  await clock.run(Promise.all([worker(true, 40), worker(true, 150), worker(true, 150)]));
  assert.equal(stamps.length, 340);
  for (const start of stamps) {
    const inWindow = stamps.filter((s) => s >= start && s < start + 180_000).length;
    assert.ok(inWindow <= 50, `${inWindow} permintaan dalam 180 detik`);
  }
  assert.ok(stamps[stamps.length - 1] - stamps[0] > 340 / 48 * 150_000, 'laju mendekati jatah, bukan jauh di bawahnya');
});

test('antrean: permintaan web menyerah dengan 429 bila jatah habis, pekerjaan latar menunggu', async () => {
  const clock = virtualClock();
  const limiter = sync.createRateLimiter({ now: clock.now, wait: clock.wait });
  const host = 'toko.dealpos.co.id';
  for (let i = 0; i < 48; i += 1) await limiter.acquire(host);
  await assert.rejects(clock.run(limiter.acquire(host)), (error) => error.rateLimited === true && error.retryAfter > 0);
  const before = clock.now();
  await clock.run(limiter.acquire(host, { patient: true }));
  assert.ok(clock.now() - before >= 100_000, 'latar menunggu jendela bergeser');
});

test('antrean: pekerjaan latar menyisakan jatah untuk permintaan web', async () => {
  const clock = virtualClock();
  const limiter = sync.createRateLimiter({ now: clock.now, wait: clock.wait });
  const host = 'toko.dealpos.co.id';
  for (let i = 0; i < 42; i += 1) await limiter.acquire(host, { patient: true });
  const before = clock.now();
  await clock.run(limiter.acquire(host)); // masih ada sisa 6 untuk web
  assert.equal(clock.now(), before, 'permintaan web langsung jalan');
  assert.equal(limiter.inWindow(host), 43);
});

test('antrean: 429 dari DealPOS menahan semua pemanggil host itu sampai jeda habis', async () => {
  const clock = virtualClock();
  const limiter = sync.createRateLimiter({ now: clock.now, wait: clock.wait });
  const host = 'toko.dealpos.co.id';
  limiter.blockFor(host, 180);
  const before = clock.now();
  await clock.run(limiter.acquire(host, { patient: true }));
  assert.ok(clock.now() - before >= 185_000);
});

test('fetchCustomers pekerjaan latar menarik semua halaman dengan token yang diberikan', async () => {
  const calls = [];
  const fetchImpl = fakeFetch((url) => {
    calls.push(url);
    const page = Number(/PageNumber=(\d+)/.exec(url)[1]);
    const rows = page === 1 ? Array.from({ length: 200 }, (_, i) => ({ ID: `a${i}`, Name: `N${i}`, Mobile: '081234567890' })) : [{ ID: 'z', Name: 'Z', Mobile: '' }];
    return { body: rows };
  });
  const customers = await sync.fetchCustomers({ host: 'uji-latar.dealpos.co.id' }, fetchImpl, 'tok', { patient: true });
  assert.equal(customers.length, 201);
  assert.equal(calls.length, 2);
  assert.equal(customers[0].phone, '6281234567890');
});
