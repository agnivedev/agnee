'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const serperPlaces = require('../src/serper-places');
const mapsLink = require('../src/maps-link');
const addressCheck = require('../src/address-check');

const KASABLANKA = { title: 'Kota Kasablanka', address: 'Jl. Casablanca Raya Kav. 88, Menteng Dalam, Tebet, Jakarta Selatan', latitude: -6.2241, longitude: 106.8419, category: 'Pusat perbelanjaan' };

/** OpenStreetMap dan Serper tiruan; `osm` = baris hasil atau null, `serper` = places[] atau respons gagal. */
function fakeWorld({ osm = null, serper = [], serperStatus = 200, serperMessage } = {}) {
  const calls = { osm: 0, serper: 0, serperBodies: [], serperHeaders: [] };
  const impl = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://nominatim.openstreetmap.org/')) {
      calls.osm += 1;
      return { ok: true, status: 200, json: async () => (osm ? [osm] : []) };
    }
    if (u === 'https://google.serper.dev/places') {
      calls.serper += 1;
      calls.serperBodies.push(JSON.parse(init.body));
      calls.serperHeaders.push(init.headers);
      return { ok: serperStatus < 300, status: serperStatus, json: async () => (serperStatus < 300 ? { places: serper } : { message: serperMessage }) };
    }
    throw new Error(`fetch tak terduga ${u}`);
  };
  return { impl, calls };
}

test.beforeEach(() => { mapsLink.clearCache(); serperPlaces.clearCache(); });

test('tanpa kunci: tidak ada panggilan ke Serper, hasil OpenStreetMap apa adanya', async () => {
  const { impl, calls } = fakeWorld({ serper: [KASABLANKA] });
  const previous = process.env.SERPER_API_KEY; delete process.env.SERPER_API_KEY;
  try {
    const out = await addressCheck.check('dekat Mall Kota Kasablanka Jakarta', { fetchImpl: impl });
    assert.equal(out.status, 'tidak_ketemu');
    assert.equal(calls.serper, 0);
  } finally { if (previous !== undefined) process.env.SERPER_API_KEY = previous; }
});

test('OpenStreetMap tidak kenal: Google Maps lewat Serper, wilayah cocok = ketemu_tempat', async () => {
  const { impl, calls } = fakeWorld({ serper: [KASABLANKA] });
  const out = await addressCheck.check('dekat Mall Kota Kasablanka Jakarta', { fetchImpl: impl, serperKey: 'kunci-uji' });
  assert.equal(out.status, 'ketemu_tempat');
  assert.equal(out.tempat, 'Kota Kasablanka');
  assert.match(out.terbaca, /Tebet, Jakarta Selatan/);
  assert.equal(calls.serper, 1);
  assert.equal(calls.serperHeaders[0]['X-API-KEY'], 'kunci-uji');
  assert.deepEqual(calls.serperBodies[0], { q: 'dekat Mall Kota Kasablanka Jakarta', gl: 'id', hl: 'id' });
});

test('OpenStreetMap hanya kenal wilayah: Serper menaikkannya jadi ketemu_tempat', async () => {
  const area = { lat: '-6.2', lon: '106.8', display_name: 'Jakarta Selatan', address: { city: 'Jakarta Selatan' } };
  const { impl } = fakeWorld({ osm: area, serper: [KASABLANKA] });
  const out = await addressCheck.check('Mall Kota Kasablanka Jakarta Selatan', { fetchImpl: impl, serperKey: 'k' });
  assert.equal(out.status, 'ketemu_tempat');
});

test('OpenStreetMap sudah menemukan jalan: Serper tidak dipanggil', async () => {
  const road = { lat: '-6.9', lon: '107.6', display_name: 'Jalan Melati, Sukajadi, Bandung', address: { road: 'Jalan Melati', suburb: 'Sukajadi', city: 'Bandung' } };
  const { impl, calls } = fakeWorld({ osm: road, serper: [KASABLANKA] });
  const out = await addressCheck.check('Jalan Melati 5, Sukajadi, Bandung', { fetchImpl: impl, serperKey: 'k' });
  assert.equal(out.status, 'ketemu_jalan');
  assert.equal(calls.serper, 0);
});

test('Google selalu mengembalikan sesuatu: hasil yang tidak berbagi kata dengan teks customer dibuang', async () => {
  const { impl } = fakeWorld({ serper: [KASABLANKA] });
  const out = await addressCheck.check('Perum Griya Antah Berantah blok Z no 9', { fetchImpl: impl, serperKey: 'k' });
  assert.equal(out.status, 'tidak_ketemu');
});

test('nama yang ada di banyak kota tanpa wilayah dari customer: jalan_ambigu, bukan ketemu_tempat', async () => {
  const cabang = { title: 'Alfamart', address: 'Jl. Raya Cilandak No. 3, Cilandak, Jakarta Selatan', latitude: -6.29, longitude: 106.79, category: 'Minimarket' };
  const { impl } = fakeWorld({ serper: [cabang] });
  const out = await addressCheck.check('Alfamart', { fetchImpl: impl, serperKey: 'k' });
  assert.equal(out.status, 'jalan_ambigu');
  assert.equal(out.tempat, undefined);
  assert.equal(out.terbaca, undefined);
  const dengan = await addressCheck.check('Alfamart Cilandak', { fetchImpl: impl, serperKey: 'k' });
  assert.equal(dengan.status, 'ketemu_tempat');
});

test('kredit habis, kunci ditolak, atau jaringan putus: kembali ke hasil OpenStreetMap tanpa error', async () => {
  const warn = console.warn; const logged = []; console.warn = (m) => logged.push(m);
  try {
    const habis = fakeWorld({ serperStatus: 400, serperMessage: 'Not enough credits' });
    assert.equal((await addressCheck.check('dekat Mall Kota Kasablanka Jakarta', { fetchImpl: habis.impl, serperKey: 'k' })).status, 'tidak_ketemu');
    assert.match(logged[0], /Not enough credits/);

    serperPlaces.clearCache(); logged.length = 0;
    const mati = async (url) => { if (String(url).includes('serper')) throw new Error('ECONNRESET'); return { ok: true, status: 200, json: async () => [] }; };
    assert.equal((await addressCheck.check('dekat Mall Kota Kasablanka Jakarta', { fetchImpl: mati, serperKey: 'k' })).status, 'tidak_ketemu');
    assert.match(logged[0], /ECONNRESET/);
  } finally { console.warn = warn; }
});

test('kegagalan Serper dicatat sekali per 10 menit, tidak membanjiri log', async () => {
  const warn = console.warn; let count = 0; console.warn = () => { count += 1; };
  try {
    const { impl } = fakeWorld({ serperStatus: 400, serperMessage: 'Not enough credits' });
    for (const q of ['Mall A Jakarta', 'Mall B Jakarta', 'Mall C Jakarta']) await serperPlaces.searchPlaces(q, { fetchImpl: impl, apiKey: 'k' });
    assert.equal(count, 1);
  } finally { console.warn = warn; }
});

test('alamat yang sama dua kali hanya membayar satu panggilan, termasuk hasil kosong', async () => {
  const ada = fakeWorld({ serper: [KASABLANKA] });
  await serperPlaces.searchPlaces('Mall Kota Kasablanka Jakarta', { fetchImpl: ada.impl, apiKey: 'k' });
  await serperPlaces.searchPlaces('mall kota kasablanka  jakarta', { fetchImpl: ada.impl, apiKey: 'k' });
  assert.equal(ada.calls.serper, 1);
  const kosong = fakeWorld({ serper: [] });
  assert.equal(await serperPlaces.searchPlaces('Tempat Antah Berantah', { fetchImpl: kosong.impl, apiKey: 'k' }), null);
  assert.equal(await serperPlaces.searchPlaces('Tempat Antah Berantah', { fetchImpl: kosong.impl, apiKey: 'k' }), null);
  assert.equal(kosong.calls.serper, 1);
});

test('hasil tanpa koordinat atau tanpa nama dan alamat dilewati; yang pertama valid dipakai', async () => {
  const { impl } = fakeWorld({ serper: [{ title: 'Tanpa koordinat', address: 'X' }, { latitude: 1, longitude: 2 }, { title: 'Nol', latitude: 0, longitude: 0 }, KASABLANKA] });
  const place = await serperPlaces.searchPlaces('Kasablanka', { fetchImpl: impl, apiKey: 'k' });
  assert.equal(place.title, 'Kota Kasablanka');
  assert.equal(place.lat, -6.2241);
});

test('teks terlalu pendek tidak memanggil Serper', async () => {
  const { impl, calls } = fakeWorld({ serper: [KASABLANKA] });
  assert.equal(await serperPlaces.searchPlaces('ab', { fetchImpl: impl, apiKey: 'k' }), null);
  assert.equal(calls.serper, 0);
});
