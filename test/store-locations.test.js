'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const storeLocations = require('../src/store-locations');
const { buildApp } = require('../src/server');

const BSD = { id: '1', name: 'Toko BSD', kind: 'store', address: 'Jl. Raya Serpong No. 1, BSD', lat: -6.3, lng: 106.65, mapsUrl: null, openingHours: 'Senin–Sabtu 08.00–17.00, Minggu tutup', openToCustomers: true, isPickup: true, notes: 'Parkir di depan ruko', contactName: 'Pak Budi', contactPhone: '081200000001' };
const KEMANG = { id: '2', name: 'Toko Kemang', kind: 'store', address: 'Jl. Kemang Raya No. 9', lat: -6.27, lng: 106.81, mapsUrl: 'https://maps.app.goo.gl/kemang', openingHours: '', openToCustomers: true, isPickup: false, notes: '', contactName: 'Bu Sari', contactPhone: '081200000002' };
const GUDANG = { id: '3', name: 'Gudang Tangerang', kind: 'warehouse', address: 'Kawasan Pergudangan Blok C', lat: -6.2, lng: 106.6, mapsUrl: null, openingHours: '07.00–16.00', openToCustomers: false, isPickup: false, notes: 'Hanya untuk kurir', contactName: 'Pak Jaga', contactPhone: '081200000003' };
const PONDOK_INDAH = '-6.2650,106.7830';

test('hanya lokasi yang boleh dikunjungi customer yang sampai ke AI', () => {
  const open = storeLocations.customerFacing([BSD, KEMANG, GUDANG]);
  assert.deepEqual(open.map((l) => l.name), ['Toko BSD', 'Toko Kemang']);
  const text = storeLocations.section([BSD, KEMANG, GUDANG]);
  assert.match(text, /Toko BSD \(Toko\); alamat: Jl\. Raya Serpong No\. 1, BSD; jam buka: Senin–Sabtu/);
  assert.match(text, /catatan: Parkir di depan ruko/);
  assert.ok(!/Gudang Tangerang|Pergudangan|Hanya untuk kurir/.test(text), 'gudang tidak boleh bocor');
  assert.ok(!/Pak Budi|Bu Sari|0812000000/.test(text), 'kontak kurir tidak boleh bocor');
});

test('jam buka kosong ditandai belum diisi, link peta dibuat dari titik bila tidak ada', () => {
  const text = storeLocations.section([BSD, KEMANG]);
  assert.match(text, /Toko Kemang \(Toko\); alamat: Jl\. Kemang Raya No\. 9; jam buka: belum diisi; peta: https:\/\/maps\.app\.goo\.gl\/kemang/);
  assert.match(text, /peta: https:\/\/www\.google\.com\/maps\?q=-6\.3,106\.65/);
});

test('tanpa lokasi yang boleh dikunjungi, tidak ada bagian prompt dan alat', () => {
  assert.equal(storeLocations.section([GUDANG]), '');
  assert.equal(storeLocations.section([]), '');
  assert.equal(storeLocations.isUsable([BSD]), false);
  assert.equal(storeLocations.isUsable([BSD, GUDANG]), false);
  assert.equal(storeLocations.isUsable([BSD, KEMANG]), true);
});

test('toko terdekat diurutkan menurut jarak garis lurus', async () => {
  const out = await storeLocations.findNearest([BSD, KEMANG, GUDANG], { lokasi_customer: PONDOK_INDAH });
  assert.equal(out.status, 'ok');
  assert.equal(out.ketepatan, 'titik');
  assert.deepEqual(out.toko_terdekat.map((t) => t.nama), ['Toko Kemang', 'Toko BSD']);
  assert.ok(out.toko_terdekat[0].jarak_garis_lurus_km < 4);
  assert.equal(out.toko_terdekat[0].jam_buka, null);
  assert.ok(!JSON.stringify(out).includes('Gudang'));
});

test('lokasi customer tak terbaca: hasil jelas, bukan error', async () => {
  const out = await storeLocations.findNearest([BSD, KEMANG], { lokasi_customer: '' });
  assert.equal(out.status, 'lokasi_tidak_terbaca');
  assert.equal(out.toko_terdekat, undefined);
});

// ── Lewat /v1/coach/simulate, seperti customer sungguhan ────────────────────

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};
const LALAMOVE = {
  environment: 'production', market: 'ID', apiKey: 'pk_prod_x', apiSecret: 'sk_prod_x', enabled: true,
  cities: [{ locode: 'ID JKT', name: 'Jakarta', services: [{ key: 'MOTORCYCLE', description: 'Motor' }, { key: 'VAN', description: 'Van' }] }],
  pickupLat: -6.3, pickupLng: 106.65, pickupAddress: 'Toko BSD', defaultService: 'VAN', aiQuotesEnabled: true,
};

async function setup(t, { locations, lalamove = null, customerPlan }) {
  const seen = [];
  const lalamoveCalls = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      const toolNames = (options.tools || []).map((x) => x.name);
      seen.push({ message, prompt: options.systemPrompt || '', tools: toolNames, toolSpecs: options.tools || [] });
      // Model tiruan: menjalankan rencana yang diberikan tes, memakai alat yang sama dengan yang dilihat model asli.
      const results = [];
      for (const step of customerPlan || []) {
        const tool = (options.tools || []).find((x) => x.name === step.tool);
        if (tool) results.push(await tool.run(step.args));
      }
      return { text: JSON.stringify(results), model: 'tiruan', usage: {} };
    },
  };
  const fake = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(userId) { return userId === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
    async listCompanyLocations() { return locations; },
    async getLalamoveConnection() { return lalamove ? { ...lalamove } : null; },
  };
  const database = new Proxy(fake, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('lalamove.com/v3/quotations')) {
      lalamoveCalls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: { quotationId: 'q1', priceBreakdown: { total: '85000', currency: 'IDR' }, distance: { value: '12000' } } }), { status: 201 });
    }
    return realFetch(url, init);
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'store-loc', database, llmService: llm });
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const simulate = (customerMessage) => app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage, grade: false } });
  return { seen, lalamoveCalls, simulate };
}

test('simulate: customer tanya alamat dan jam buka, prompt memuat toko saja', async (t) => {
  const { seen, simulate } = await setup(t, { locations: [BSD, KEMANG, GUDANG] });
  const res = await simulate('Kak, alamat toko dan jam bukanya kapan?');
  assert.equal(res.statusCode, 200);
  const prompt = seen[0].prompt;
  assert.match(prompt, /## LOKASI TOKO/);
  assert.match(prompt, /Jl\. Raya Serpong No\. 1, BSD/);
  assert.match(prompt, /jam buka: Senin–Sabtu 08\.00–17\.00, Minggu tutup/);
  assert.ok(!/Gudang Tangerang|Pergudangan|Pak Budi|Bu Sari|0812000000/.test(prompt));
});

test('simulate: satu toko saja memuat alamat tanpa alat toko terdekat', async (t) => {
  const { seen, simulate } = await setup(t, { locations: [BSD, GUDANG] });
  await simulate('alamatnya di mana kak?');
  assert.match(seen[0].prompt, /Toko BSD/);
  assert.ok(!seen[0].tools.includes('cari_toko_terdekat'));
  assert.ok(!/panggil cari_toko_terdekat/.test(seen[0].prompt));
});

test('simulate: tanpa lokasi, prompt tidak berubah dan tidak ada alat', async (t) => {
  const { seen, simulate } = await setup(t, { locations: [] });
  await simulate('alamatnya di mana kak?');
  assert.ok(!/## LOKASI TOKO/.test(seen[0].prompt));
  assert.ok(!seen[0].tools.includes('cari_toko_terdekat'));
});

test('simulate: customer dari Pondok Indah, alat memberi Toko Kemang sebagai terdekat', async (t) => {
  const { seen, simulate } = await setup(t, {
    locations: [BSD, KEMANG, GUDANG],
    customerPlan: [{ tool: 'cari_toko_terdekat', args: { lokasi_customer: PONDOK_INDAH } }],
  });
  const res = await simulate('toko terdekat dari Pondok Indah yang mana ya?');
  assert.equal(res.statusCode, 200);
  assert.ok(seen[0].tools.includes('cari_toko_terdekat'));
  assert.match(seen[0].prompt, /panggil cari_toko_terdekat/);
  const out = JSON.parse(res.json().reply)[0];
  assert.equal(out.toko_terdekat[0].nama, 'Toko Kemang');
  assert.equal(out.toko_terdekat[0].peta, 'https://maps.app.goo.gl/kemang');
  assert.ok(!res.json().reply.includes('Gudang'));
});

test('simulate: ongkir dari toko terdekat memakai titik toko itu, bukan titik jemput bawaan', async (t) => {
  const { seen, lalamoveCalls, simulate } = await setup(t, {
    locations: [BSD, KEMANG, GUDANG],
    lalamove: LALAMOVE,
    customerPlan: [{ tool: 'cek_ongkir', args: { tujuan: PONDOK_INDAH, dari_toko: 'Toko Kemang' } }],
  });
  const res = await simulate('ongkir ke Pondok Indah dari toko terdekat berapa?');
  assert.equal(res.statusCode, 200);
  const spec = seen[0].toolSpecs.find((x) => x.name === 'cek_ongkir');
  assert.deepEqual(spec.parameters.properties.dari_toko.enum, ['Toko BSD', 'Toko Kemang']);
  assert.equal(JSON.parse(res.json().reply)[0].dari, 'Toko Kemang');
  assert.equal(lalamoveCalls.length, 1);
  assert.deepEqual(lalamoveCalls[0].data.stops[0].coordinates, { lat: '-6.27', lng: '106.81' });
});

test('simulate: ongkir tanpa dari_toko tetap dari titik jemput bawaan', async (t) => {
  const { lalamoveCalls, simulate } = await setup(t, {
    locations: [BSD, KEMANG],
    lalamove: LALAMOVE,
    customerPlan: [{ tool: 'cek_ongkir', args: { tujuan: PONDOK_INDAH } }],
  });
  await simulate('ongkir ke Pondok Indah berapa?');
  assert.deepEqual(lalamoveCalls[0].data.stops[0].coordinates, { lat: '-6.3', lng: '106.65' });
});

test('simulate: satu toko tidak menawarkan parameter dari_toko', async (t) => {
  const { seen, simulate } = await setup(t, { locations: [BSD], lalamove: LALAMOVE });
  await simulate('ongkir berapa?');
  const spec = seen[0].toolSpecs.find((x) => x.name === 'cek_ongkir');
  assert.equal(spec.parameters.properties.dari_toko, undefined);
});
