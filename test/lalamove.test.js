'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const lalamove = require('../src/lalamove');

const CONN = { environment: 'sandbox', market: 'ID', apiKey: 'pk_test_abc123', apiSecret: 'sk_test_secret' };

function fakeFetch(status, json) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return { status, ok: status < 300, text: async () => JSON.stringify(json) };
  };
  return { impl, calls };
}

/** Header hmac harus bisa diverifikasi ulang dengan resep tanda tangan Lalamove. */
function assertSigned(call, method, path) {
  const [scheme, rest] = call.options.headers.authorization.split(' ');
  assert.equal(scheme, 'hmac');
  const [key, timestamp, sig] = rest.split(':');
  assert.equal(key, CONN.apiKey);
  const raw = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${call.options.body || ''}`;
  assert.equal(sig, crypto.createHmac('sha256', CONN.apiSecret).update(raw).digest('hex'));
}

test('awalan kunci menentukan mode', () => {
  assert.equal(lalamove.environmentOfKey('pk_test_123'), 'sandbox');
  assert.equal(lalamove.environmentOfKey(' pk_prod_123 '), 'production');
  assert.equal(lalamove.environmentOfKey('abcdef'), null);
});

test('nomor HP ke E.164', () => {
  assert.equal(lalamove.e164('6281234567890'), '+6281234567890');
  assert.equal(lalamove.e164('0812-3456-7890'), '+6281234567890');
  assert.equal(lalamove.e164('81234567890'), '+6281234567890');
  assert.equal(lalamove.e164(''), null);
});

test('daftar kota: host sandbox, header Market, tanda tangan GET tanpa body', async () => {
  const { impl, calls } = fakeFetch(200, { data: [
    { locode: 'ID JKT', name: 'Jakarta', services: [{ key: 'MOTORCYCLE', description: 'Motor' }, { key: 'MPV' }] },
    { name: 'tanpa locode' },
  ] });
  const { cities } = await lalamove.verifyCredentials(CONN, impl);
  assert.equal(calls[0].url, 'https://rest.sandbox.lalamove.com/v3/cities');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.market, 'ID');
  assert.ok(calls[0].options.headers['request-id']);
  assertSigned(calls[0], 'GET', '/v3/cities');
  assert.deepEqual(cities, [{ locode: 'ID JKT', name: 'Jakarta', services: [
    { key: 'MOTORCYCLE', description: 'Motor' }, { key: 'MPV', description: '' },
  ] }]);
});

test('mode production memakai host production', async () => {
  const { impl, calls } = fakeFetch(200, { data: [] });
  await lalamove.fetchCities({ ...CONN, environment: 'production' }, impl);
  assert.equal(calls[0].url, 'https://rest.lalamove.com/v3/cities');
});

test('kunci ditolak (401) -> pesan yang menyebut kunci dan mode', async () => {
  const { impl } = fakeFetch(401, { errors: [{ id: 'ERR_UNAUTHORIZED', message: 'Unauthorized' }] });
  await assert.rejects(lalamove.verifyCredentials(CONN, impl), /kunci API.*sandbox\/production/);
});

test('kunci tak dikenal: gateway membalas 502 upstream -> pesan kunci', async () => {
  const { impl } = fakeFetch(502, { message: 'An invalid response was received from the upstream server' });
  await assert.rejects(lalamove.verifyCredentials(CONN, impl), /kunci API/);
});

test('galat format pendek { message } tetap terbaca', async () => {
  const { impl } = fakeFetch(422, { message: 'ERR_INVALID_MARKET' });
  await assert.rejects(lalamove.fetchCities(CONN, impl), /ERR_INVALID_MARKET/);
});

test('galat lain membawa pesan Lalamove', async () => {
  const { impl } = fakeFetch(422, { errors: [{ id: 'ERR_OUT_OF_SERVICE_AREA', message: 'Out of service area' }] });
  await assert.rejects(
    lalamove.getQuotation(CONN, { serviceType: 'MOTORCYCLE', stops: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] }, impl),
    (error) => error.code === 'ERR_OUT_OF_SERVICE_AREA' && /Out of service area/.test(error.message),
  );
});

test('quotation: body { data }, koordinat string, hasil dirapikan', async () => {
  const { impl, calls } = fakeFetch(201, { data: {
    quotationId: 'Q1', serviceType: 'MOTORCYCLE', expiresAt: '2026-10-26T10:05:00.00Z',
    priceBreakdown: { base: '10000', total: '24500', currency: 'IDR' },
    distance: { value: '5432', unit: 'm' },
    stops: [{ stopId: 'S1', address: 'Monas' }, { stopId: 'S2', address: 'Kuningan' }],
  } });
  const quote = await lalamove.getQuotation(CONN, {
    serviceType: 'MOTORCYCLE',
    stops: [{ lat: -6.1753, lng: 106.8271, address: 'Monas' }, { lat: -6.2297, lng: 106.8295 }],
  }, impl);
  const call = calls[0];
  assert.equal(call.url, 'https://rest.sandbox.lalamove.com/v3/quotations');
  assert.equal(call.options.headers['content-type'], 'application/json');
  assertSigned(call, 'POST', '/v3/quotations');
  const sent = JSON.parse(call.options.body);
  assert.equal(sent.data.serviceType, 'MOTORCYCLE');
  assert.deepEqual(sent.data.stops[0], { coordinates: { lat: '-6.1753', lng: '106.8271' }, address: 'Monas' });
  assert.equal(sent.data.stops[1].address, '-6.2297,106.8295');
  assert.deepEqual(quote, {
    quotationId: 'Q1', serviceType: 'MOTORCYCLE', expiresAt: '2026-10-26T10:05:00.00Z',
    total: 24500, currency: 'IDR', distanceMeters: 5432,
    stops: [{ stopId: 'S1', address: 'Monas' }, { stopId: 'S2', address: 'Kuningan' }],
  });
});

test('quotation menolak koordinat rusak sebelum memanggil Lalamove', async () => {
  const { impl, calls } = fakeFetch(200, {});
  await assert.rejects(
    lalamove.getQuotation(CONN, { serviceType: 'MOTORCYCLE', stops: [{ lat: 'x', lng: 2 }, { lat: 3, lng: 4 }] }, impl),
    /Koordinat/,
  );
  assert.equal(calls.length, 0);
});

test('order: nomor dikirim E.164, stopId dari quotation', async () => {
  const { impl, calls } = fakeFetch(201, { data: { orderId: 'O1', status: 'ASSIGNING_DRIVER', shareLink: 'https://share' } });
  const order = await lalamove.placeOrder(CONN, {
    quotationId: 'Q1',
    sender: { stopId: 'S1', name: 'Toko', phone: '081234567890' },
    recipients: [{ stopId: 'S2', name: 'Budi', phone: '6289876543210', remarks: 'Pagar hijau' }],
  }, impl);
  const sent = JSON.parse(calls[0].options.body).data;
  assert.equal(sent.sender.phone, '+6281234567890');
  assert.deepEqual(sent.recipients[0], { stopId: 'S2', name: 'Budi', phone: '+6289876543210', remarks: 'Pagar hijau' });
  assert.deepEqual(order, { orderId: 'O1', status: 'ASSIGNING_DRIVER', shareLink: 'https://share' });
});
