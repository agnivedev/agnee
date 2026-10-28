'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const mapsLink = require('../src/maps-link');
const addressCheck = require('../src/address-check');
const serperPlaces = require('../src/serper-places');

const JALAN = { lat: '-6.2', lon: '106.8', display_name: 'Jalan Melati, Sukajadi, Bandung, Jawa Barat', address: { road: 'Jalan Melati', suburb: 'Sukajadi', city: 'Bandung', state: 'Jawa Barat' } };
const AREA = { lat: '-6.3', lon: '106.7', display_name: 'Cilandak, Jakarta Selatan', address: { suburb: 'Cilandak', city: 'Jakarta Selatan', state: 'DKI Jakarta' } };

/** Nominatim tiruan: kunci = potongan teks pencarian, nilai = baris hasil atau null. */
function fakeNominatim(table) {
  const queries = [];
  const impl = async (url) => {
    const q = decodeURIComponent(new URL(String(url)).searchParams.get('q') || '');
    queries.push(q);
    const key = Object.keys(table).find((k) => (k.startsWith('=') ? q === k.slice(1) : q.includes(k)));
    const row = key ? table[key] : null;
    return { ok: true, status: 200, json: async () => (row ? [row] : []) };
  };
  return { impl, queries };
}

test.beforeEach(() => mapsLink.clearCache());

test('alamat dengan jalan dan nomor rumah: ketemu_jalan, nomor rumah tak ikut dicari', async () => {
  const { impl, queries } = fakeNominatim({ 'Melati': JALAN });
  const out = await addressCheck.check('Jl. Melati No. 5 RT 02/03, Sukajadi, Bandung', { fetchImpl: impl });
  assert.equal(out.status, 'ketemu_jalan');
  assert.equal(out.jalan, 'Jalan Melati');
  assert.equal(out.kota, 'Bandung');
  assert.ok(queries.length >= 1);
});

test('nomor rumah membuat pencarian pertama gagal: pencarian disederhanakan lalu ketemu', async () => {
  const { impl, queries } = fakeNominatim({ 'Jalan Melati': JALAN });
  const out = await addressCheck.check('Jl. Melati No. 5 RT 02/03, Sukajadi, Bandung', { fetchImpl: impl });
  assert.equal(out.status, 'ketemu_jalan');
  assert.ok(queries.length >= 2, 'varian pertama (teks asli) gagal, varian kedua dipakai');
  assert.ok(!/RT|No\./.test(queries.at(-1)));
});

test('hanya wilayah yang terbaca: ketemu_area dan diminta jalan atau patokan', async () => {
  const { impl } = fakeNominatim({ 'Cilandak': AREA });
  const out = await addressCheck.check('Cilandak', { fetchImpl: impl });
  assert.equal(out.status, 'ketemu_area');
  assert.equal(out.kecamatan, null);
  assert.equal(out.kelurahan, 'Cilandak');
  assert.match(out.kurang, /jalan|patokan/);
});

test('jalan yang hanya cocok lewat varian wilayah tetap dihitung area, bukan jalan', async () => {
  const withRoad = { ...AREA, address: { ...AREA.address, road: 'Jalan Lain' } };
  const { impl } = fakeNominatim({ '=Cilandak, Jakarta Selatan': withRoad });
  const out = await addressCheck.check('Gang Mawar 3, Kebon Baru, Cilandak, Jakarta Selatan', { fetchImpl: impl });
  assert.equal(out.status, 'ketemu_area');
});

test('tidak ada hasil, jaringan mati, atau teks terlalu pendek: tidak_ketemu tanpa melempar', async () => {
  const { impl } = fakeNominatim({});
  assert.equal((await addressCheck.check('Gang Antah Berantah 99', { fetchImpl: impl })).status, 'tidak_ketemu');
  mapsLink.clearCache();
  const mati = async () => { throw new Error('ECONNRESET'); };
  assert.equal((await addressCheck.check('Jalan Melati Bandung', { fetchImpl: mati })).status, 'tidak_ketemu');
  assert.equal((await addressCheck.check('ab', { fetchImpl: impl })).status, 'tidak_ketemu');
});

test('nama jalan tanpa kota atau kecamatan: jalan_ambigu, hasil peta tidak diberikan ke model', async () => {
  const { impl } = fakeNominatim({ 'Melati': JALAN });
  const out = await addressCheck.check('Jalan Melati nomor 5', { fetchImpl: impl });
  assert.equal(out.status, 'jalan_ambigu');
  assert.equal(out.terbaca, undefined);
  assert.equal(out.kota, undefined);
  assert.match(out.pesan, /kota atau kecamatan/);
});

test('kota yang sudah disebut customer sebelumnya (digabung ke teks) membuat jalan jelas', async () => {
  const { impl } = fakeNominatim({ 'Melati': JALAN });
  assert.equal((await addressCheck.check('Jalan Melati nomor 5, Bandung', { fetchImpl: impl })).status, 'ketemu_jalan');
  mapsLink.clearCache();
  assert.equal((await addressCheck.check('Jalan Melati nomor 5, Sukajadi', { fetchImpl: impl })).status, 'ketemu_jalan');
  mapsLink.clearCache();
  // Kota lain yang disebut customer bukan bukti: hasil peta di Bandung tidak cocok dengan "Surabaya".
  assert.equal((await addressCheck.check('Jalan Melati nomor 5, Surabaya', { fetchImpl: impl })).status, 'jalan_ambigu');
});

test('simplify membuang RT/RW, nomor, blok, dan awalan wilayah', () => {
  assert.equal(addressCheck.simplify('Jl. Melati No. 5 Blok C RT 02/03 Kel. Sukajadi'), 'Jalan Melati Sukajadi');
});

// ---- Chat sebagai customer lewat simulator ---------------------------------

const SUP = {
  id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'sup@toko.test',
  displayName: 'Supervisor', role: 'supervisor', status: 'active', isPlatformAdmin: false,
};

function fakeDatabase() {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === SUP.email && password === 'password-123' ? SUP : null; },
    async getActiveSessionUser(userId) { return userId === SUP.id ? SUP : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

/**
 * LLM tiruan yang berperilaku sesuai GUIDE: memanggil cek_alamat dengan
 * alamat customer, lalu membalas menurut status. Yang diuji adalah rantainya
 * (alat terpasang, panduan ada di prompt, hasil peta sampai ke balasan).
 */
async function setup(t, table, { serper } = {}) {
  mapsLink.clearCache();
  const { impl, queries } = fakeNominatim(table);
  const seen = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      if (options.purpose !== 'simulate') return { text: '{}', model: 'tiruan', usage: {} };
      const tool = (options.tools || []).find((x) => x.name === 'cek_alamat');
      seen.push({ prompt: options.systemPrompt, hasTool: Boolean(tool) });
      if (!tool) return { text: 'Boleh kirim alamat lengkapnya kak?', model: 'tiruan', usage: {} };
      const out = await tool.run({ alamat: message });
      const text = out.status === 'ketemu_jalan' ? 'Siap kak, dikirim ke sana ya.'
        : out.status === 'ketemu_tempat' ? `Siap kak, dikirim ke ${out.tempat} ya.`
        : out.status === 'ketemu_area' ? 'Noted wilayahnya kak, nama jalan atau patokannya apa ya?'
          : out.status === 'jalan_ambigu' ? 'Jalan itu di kota mana ya kak?'
          : 'Boleh share location WhatsApp kak?';
      return { text, model: 'tiruan', usage: {} };
    },
  };
  const realFetch = globalThis.fetch;
  const previousKey = process.env.SERPER_API_KEY;
  if (serper) process.env.SERPER_API_KEY = 'kunci-uji'; else delete process.env.SERPER_API_KEY;
  serperPlaces.clearCache();
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (u.startsWith('https://nominatim.openstreetmap.org/')) return impl(url);
    if (u === 'https://google.serper.dev/places') return Promise.resolve({ ok: true, status: 200, json: async () => ({ places: serper }) });
    return realFetch(url, init);
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'addr-sim', database: fakeDatabase(), llmService: llm });
  t.after(async () => {
    globalThis.fetch = realFetch;
    if (previousKey === undefined) delete process.env.SERPER_API_KEY; else process.env.SERPER_API_KEY = previousKey;
    await app.close();
  });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUP.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const say = async (customerMessage) => (await app.inject({
    method: 'POST', url: '/v1/coach/simulate', headers: { cookie },
    payload: { mode: 'ai', grade: false, customerMessage },
  })).json().reply;
  return { say, seen, queries };
}

test('simulator: alat dan panduan terpasang di balasan customer', async (t) => {
  const { say, seen } = await setup(t, { 'Melati': JALAN });
  await say('Jl. Melati No. 5, Sukajadi, Bandung');
  assert.equal(seen[0].hasTool, true);
  assert.match(seen[0].prompt, /ALAMAT CUSTOMER \(alat cek_alamat\)/);
});

test('simulator: alamat jelas diterima tanpa minta alamat lengkap', async (t) => {
  const { say } = await setup(t, { 'Melati': JALAN });
  const reply = await say('Jl. Melati No. 5, Sukajadi, Bandung');
  assert.equal(reply, 'Siap kak, dikirim ke sana ya.');
  assert.doesNotMatch(reply, /alamat lengkap/i);
});

test('simulator: baru wilayah, AI minta satu hal yang kurang', async (t) => {
  const { say } = await setup(t, { 'Cilandak': AREA });
  assert.match(await say('Cilandak'), /jalan atau patokan/);
});

test('simulator: alamat tidak terbaca, AI minta share location tanpa menuduh salah', async (t) => {
  const { say } = await setup(t, {});
  const reply = await say('Perum Griya Antah blok Z');
  assert.match(reply, /share location/);
  assert.doesNotMatch(reply, /salah|tidak valid/i);
});

test('simulator: jalan tanpa kota, AI menanyakan kota dan tidak mengarang dari hasil peta', async (t) => {
  const { say } = await setup(t, { 'Melati': JALAN });
  const reply = await say('Jalan Melati nomor 5');
  assert.match(reply, /kota mana/);
  assert.doesNotMatch(reply, /Bandung|Sukajadi/);
});

test('simulator: tempat yang hanya dikenal Google Maps (Serper) diterima tanpa minta alamat lengkap', async (t) => {
  const kasablanka = { title: 'Kota Kasablanka', address: 'Jl. Casablanca Raya Kav. 88, Tebet, Jakarta Selatan', latitude: -6.2241, longitude: 106.8419 };
  const { say } = await setup(t, {}, { serper: [kasablanka] });
  assert.equal(await say('dekat Mall Kota Kasablanka Jakarta'), 'Siap kak, dikirim ke Kota Kasablanka ya.');
});

test('simulator: tanpa kunci Serper, tempat yang sama tetap ditanyakan share location', async (t) => {
  const { say } = await setup(t, {});
  assert.match(await say('dekat Mall Kota Kasablanka Jakarta'), /share location/);
});
