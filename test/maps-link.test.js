'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mapsLink = require('../src/maps-link');
const { conversationRules } = require('../src/reply-style');

const MONAS_LONG = 'https://www.google.com/maps/place/Monumen+Nasional/@-6.1753924,106.8245779,17z/data=!3m1!4b1!4m6!3m5!1s0x2e69f5d2e764b12d:0x3d2ad6e1e0e9bcc8!8m2!3d-6.1753083!4d106.8271106!16zL20vMDNxN2hz?entry=ttu';

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    const r = route[1];
    return {
      status: r.status || 200,
      ok: (r.status || 200) < 300,
      headers: { get: (name) => (name === 'location' ? r.location || null : null) },
      text: async () => r.text || '',
      json: async () => r.json,
    };
  };
  return { impl, calls };
}

test.beforeEach(() => mapsLink.clearCache());

test('link Google Maps ditemukan di teks, tanda baca penutup dibuang', () => {
  assert.deepEqual(
    mapsLink.findMapsLinks('Kirim ke sini ya kak https://maps.app.goo.gl/Ab12Cd34. Makasih'),
    ['https://maps.app.goo.gl/Ab12Cd34'],
  );
  assert.deepEqual(mapsLink.findMapsLinks('cek https://goo.gl/maps/xyz dan https://maps.google.com/?q=-6.2,106.8'),
    ['https://goo.gl/maps/xyz', 'https://maps.google.com/?q=-6.2,106.8']);
  assert.deepEqual(mapsLink.findMapsLinks('https://www.tokopedia.com/maps dan https://evil.com/google.com/maps'), []);
});

test('URL panjang: nama tempat dan titik pin, bukan pusat layar', () => {
  assert.deepEqual(mapsLink.parseMapsUrl(MONAS_LONG), { name: 'Monumen Nasional', lat: -6.1753083, lng: 106.8271106 });
});

test('URL panjang: pin tanpa nama, pencarian, dan q= dari aplikasi Android', () => {
  assert.deepEqual(mapsLink.parseMapsUrl('https://www.google.com/maps/search/-6.175392,+106.827153?entry=tts'),
    { lat: -6.175392, lng: 106.827153 });
  assert.deepEqual(
    mapsLink.parseMapsUrl('https://maps.google.com/maps?q=Toko%20Sinar%20Jaya%2C%20Jl.%20Melati%20No.%205%2C%20Bandung&ftid=0x1:0x2&g_st=ic'),
    { query: 'Toko Sinar Jaya, Jl. Melati No. 5, Bandung' },
  );
  assert.deepEqual(mapsLink.parseMapsUrl('https://www.google.co.id/maps?q=-6.9,107.6'), { lat: -6.9, lng: 107.6 });
  assert.equal(mapsLink.parseMapsUrl('https://example.com/maps/place/X'), null);
});

test('link pendek dibuka lewat redirect lalu dibaca', async () => {
  const { impl, calls } = fakeFetch({
    'https://maps.app.goo.gl/Ab12': { status: 302, location: MONAS_LONG },
  });
  const text = await mapsLink.readCustomerText(
    { type: 'chat', body: 'alamat saya https://maps.app.goo.gl/Ab12' }, { fetchImpl: impl });
  assert.equal(calls.length, 1, 'URL panjang Google tidak perlu diambil');
  assert.match(text, /^alamat saya https:\/\/maps\.app\.goo\.gl\/Ab12\n\n\[Isi link Google Maps dari customer: tempat "Monumen Nasional", koordinat -6\.175308,106\.827111\]$/);
});

test('redirect ke host di luar Google dihentikan tanpa diambil', async () => {
  const { impl, calls } = fakeFetch({
    'https://maps.app.goo.gl/Jahat': { status: 302, location: 'http://169.254.169.254/latest/meta-data' },
  });
  const text = await mapsLink.readCustomerText({ type: 'chat', body: 'https://maps.app.goo.gl/Jahat' }, { fetchImpl: impl });
  assert.deepEqual(calls, ['https://maps.app.goo.gl/Jahat']);
  assert.match(text, /\[Customer mengirim link Google Maps yang isinya tidak bisa dibaca\]/);
});

test('pin tanpa nama diberi alamat dari reverse geocoding', async () => {
  const { impl } = fakeFetch({
    'https://maps.app.goo.gl/Pin': { status: 302, location: 'https://www.google.com/maps/search/-6.2,+106.8' },
    'https://nominatim.openstreetmap.org/reverse': { json: { display_name: 'Jl. Sudirman, Jakarta Selatan' } },
  });
  const text = await mapsLink.readCustomerText({ type: 'chat', body: 'https://maps.app.goo.gl/Pin' }, { fetchImpl: impl });
  assert.match(text, /alamat Jl\. Sudirman, Jakarta Selatan, koordinat -6\.200000,106\.800000\]/);
});

test('gagal jaringan menjadi penanda tidak terbaca, bukan error', async () => {
  const impl = async () => { throw new Error('ECONNRESET'); };
  const text = await mapsLink.readCustomerText({ type: 'chat', body: 'https://maps.app.goo.gl/Mati' }, { fetchImpl: impl });
  assert.match(text, /tidak bisa dibaca/);
});

test('pesan tanpa link dikembalikan apa adanya tanpa jaringan', async () => {
  const impl = async () => { throw new Error('tidak boleh dipanggil'); };
  assert.equal(await mapsLink.readCustomerText({ type: 'chat', body: 'halo kak' }, { fetchImpl: impl }), 'halo kak');
});

test('pesan Lokasi WhatsApp: base64 pratinjau diganti keterangan lokasi', async () => {
  const impl = async () => { throw new Error('tidak boleh dipanggil'); };
  const text = await mapsLink.readCustomerText({
    type: 'location',
    body: '/9j/4AAQSkZJRgABAQAAAQABAAD...',
    location: { latitude: -6.9175, longitude: 107.6191, name: 'Gedung Sate', address: 'Jl. Diponegoro No.22, Bandung' },
  }, { fetchImpl: impl });
  assert.equal(text, '[Customer membagikan lokasi WhatsApp: tempat "Gedung Sate", alamat Jl. Diponegoro No.22, Bandung, koordinat -6.917500,107.619100]');
});

test('riwayat memakai hasil cache tanpa membuka link lagi', async () => {
  const { impl } = fakeFetch({ 'https://maps.app.goo.gl/Ab12': { status: 302, location: MONAS_LONG } });
  await mapsLink.readCustomerText({ type: 'chat', body: 'https://maps.app.goo.gl/Ab12' }, { fetchImpl: impl });
  assert.match(mapsLink.readCustomerTextCached({ body: 'ini https://maps.app.goo.gl/Ab12' }), /Monumen Nasional/);
  assert.equal(mapsLink.readCustomerTextCached({ body: 'https://maps.app.goo.gl/Lain' }), 'https://maps.app.goo.gl/Lain');
  assert.match(mapsLink.readCustomerTextCached({ type: 'location', body: '', location: { latitude: -6.2, longitude: 106.8 } }),
    /^\[Customer membagikan lokasi WhatsApp: koordinat -6\.200000,106\.800000\]$/);
});

test('aturan lokasi ada untuk kedua identitas', () => {
  for (const identity of ['team_member', 'chatbot']) {
    assert.match(conversationRules(identity), /Isi link Google Maps dari customer/);
  }
});
