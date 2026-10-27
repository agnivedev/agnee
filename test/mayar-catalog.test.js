'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../src/catalog');
const Database = require('../src/database.js');
const { buildApp } = require('../src/server');

// Bentuk asli /hl/v2/products (Mayar, 27 Okt): amount, status, type, linkPayment, createdAt (ms), HTML di description.
const ROWS = [
  { id: 'm1', name: 'Trial 3 Hari EA MT5', amount: 399000, status: 'active', type: 'generic_link', category: null,
    description: '<p>Versi paling ringan &amp; cepat.</p><p>Tanpa revision.</p>', createdAt: 1787570472539,
    linkUrl: 'https://toko.myr.id/plink/trial-3', linkPayment: 'https://toko.myr.id/pl/trial-3', coverImage: null },
  { id: 'm2', name: 'Webinar Gratis', amount: 0, status: 'active', type: 'webinar', description: 'Gratis untuk peserta terdaftar.',
    createdAt: 1788886063831, linkUrl: 'https://toko.myr.id/webinar/gratis', linkPayment: null, coverImage: { url: 'https://cdn.myr.id/c.png' } },
  { id: 'm3', name: 'Webinar Lama', amount: 100000, status: 'closed', type: 'webinar', linkPayment: 'https://toko.myr.id/pl/lama' },
  { id: 'm4', name: 'Link berbahaya', amount: 5000, status: 'active', type: 'generic_link', linkPayment: 'javascript:alert(1)', linkUrl: 'data:text/html,x' },
  { id: 'm5', name: '   ', amount: 1, status: 'active' },
];

test('produk Mayar: hanya yang active, harga 0 = tidak dicantumkan, HTML jadi teks, link berbahaya dibuang', () => {
  const items = catalog.mapMayarProducts(ROWS);
  assert.deepEqual(items.map((i) => i.externalId), ['m1', 'm2', 'm4']);

  const [trial, free, bad] = items;
  assert.equal(trial.price, 399000);
  assert.equal(trial.description, 'Versi paling ringan & cepat. Tanpa revision.');
  assert.equal(trial.url, 'https://toko.myr.id/pl/trial-3');
  assert.equal(trial.category, 'generic_link');
  assert.ok(trial.releasedAt instanceof Date);

  assert.equal(free.price, null);
  assert.equal(free.url, 'https://toko.myr.id/webinar/gratis');
  assert.equal(free.imageUrl, 'https://cdn.myr.id/c.png');

  assert.equal(bad.url, null);
});

test('prompt AI: item Mayar membawa link, dengan aturan kapan boleh dibagikan', () => {
  const items = catalog.mapMayarProducts(ROWS).map((i) => ({ ...i, kind: 'product', tags: [], source: 'mayar' }));
  const section = catalog.catalogSection({ items, tags: [] }, { text: 'mau daftar' });
  assert.match(section, /Trial 3 Hari EA MT5.*Rp ?399\.000.*link: https:\/\/toko\.myr\.id\/pl\/trial-3/);
  assert.match(section, /Webinar Gratis.*harga tidak dicantumkan/);
  assert.match(section, /boleh dibagikan linknya persis seperti tertulis/);
  // Tanpa satu pun link, aturan itu tidak ikut (katalog DealPOS tidak berubah).
  const plain = catalog.catalogSection({ items: [{ name: 'Pipa', kind: 'product', price: 1000, tags: [] }], tags: [] });
  assert.ok(!/link/.test(plain));
});

// ── Jalur sinkron lewat rute hubungkan Mayar ─────────────────────────────────

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};

async function setup(t, productsResponse) {
  const synced = [];
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(userId) { return userId === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async upsertMayarConnection() {},
    async upsertMayarLeads() { return 0; },
    async recordMayarSync() {},
    async syncPosCatalog(companyId, source, items, options) { synced.push({ companyId, source, items, options }); return items.length; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const realFetch = globalThis.fetch;
  const productCalls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (!u.startsWith('https://api.mayar.id')) return realFetch(url);
    const json = (status, body) => new Response(JSON.stringify(body), { status });
    if (u.includes('/hl/v2/products')) {
      productCalls.push(u);
      return productsResponse(u, json);
    }
    return json(200, { total: 0, data: [], hasMore: false });
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'mayar-cat', database });
  t.after(async () => { globalThis.fetch = realFetch; await app.close(); });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const connect = () => app.inject({ method: 'POST', url: '/v1/integrations/mayar', headers: { cookie }, payload: { apiKey: 'mayar-key-1234567890' } });
  return { synced, productCalls, connect };
}

test('hubungkan Mayar: produk dari dua halaman masuk katalog sebagai source mayar, tanpa menyentuh status POS', async (t) => {
  const { synced, productCalls, connect } = await setup(t, (url, json) => (url.includes('startingAfter=cursor-1')
    ? json(200, { data: [ROWS[3], ROWS[4]], hasMore: false, nextStartingAfter: null })
    : json(200, { data: ROWS.slice(0, 3), hasMore: true, nextStartingAfter: 'cursor-1' })));
  const res = await connect();
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().productCount, 3);
  assert.equal(productCalls.length, 2);
  assert.match(productCalls[1], /startingAfter=cursor-1/);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].source, 'mayar');
  assert.deepEqual(synced[0].items.map((i) => i.externalId), ['m1', 'm2', 'm4']);
  // Tanpa ini sinkron Mayar yang sukses menghapus galat DealPOS dari layar Katalog.
  assert.equal(synced[0].options.touchSettings, false);
});

test('hubungkan Mayar: produk gagal ditarik tidak menggagalkan sinkron lead', async (t) => {
  const { synced, connect } = await setup(t, (url, json) => json(500, { messages: 'boom' }));
  const res = await connect();
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().productCount, null);
  assert.equal(synced.length, 0);
});

test('hubungkan Mayar: tarikan produk kosong tidak menandai katalog hilang', async (t) => {
  const { synced, connect } = await setup(t, (url, json) => json(200, { data: [], hasMore: false }));
  const res = await connect();
  assert.equal(res.statusCode, 201);
  assert.equal(synced.length, 0);
});

// ── Database sungguhan ───────────────────────────────────────────────────────

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';

test('sinkron katalog Mayar: deskripsi hanya mengisi item baru, link ditimpa, produk hilang ditandai, AI ikut koneksi', { skip }, async (t) => {
  const db = new Database({ connectionString: DB_URL });
  await db.connect();
  const companyId = (await db.pool.query(
    'INSERT INTO companies (slug, name) VALUES ($1, $1) RETURNING id', [`cat-mayar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`],
  )).rows[0].id;
  t.after(async () => { await db.pool.query('DELETE FROM companies WHERE id = $1', [companyId]); await db.close(); });

  await db.getCatalogSettings(companyId);
  await db.pool.query("UPDATE catalog_settings SET pos_error = 'galat DealPOS' WHERE company_id = $1", [companyId]);

  await db.syncPosCatalog(companyId, 'mayar', catalog.mapMayarProducts(ROWS), { touchSettings: false });
  const rows = async () => (await db.pool.query(
    'SELECT external_id, price::float8 AS price, description, url, missing_from_source AS missing FROM catalog_items WHERE company_id = $1 AND source = $2 ORDER BY external_id',
    [companyId, 'mayar'])).rows;
  let items = await rows();
  assert.deepEqual(items.map((r) => r.external_id), ['m1', 'm2', 'm4']);
  assert.equal(items[0].description, 'Versi paling ringan & cepat. Tanpa revision.');
  assert.equal(items[1].price, null);

  // Status sinkron POS tidak tersentuh.
  assert.equal((await db.getCatalogSettings(companyId)).posError, 'galat DealPOS');

  // Tim mengedit deskripsi di Agnee; Mayar mengubah harga dan link, dan m4 hilang dari tarikan.
  await db.pool.query("UPDATE catalog_items SET description = 'tulisan tim' WHERE company_id = $1 AND external_id = 'm1'", [companyId]);
  const changed = catalog.mapMayarProducts([{ ...ROWS[0], amount: 450000, description: '<p>deskripsi Mayar baru</p>', linkPayment: 'https://toko.myr.id/pl/trial-3-baru' }, ROWS[1]]);
  await db.syncPosCatalog(companyId, 'mayar', changed, { touchSettings: false });
  items = await rows();
  assert.equal(items[0].price, 450000);
  assert.equal(items[0].url, 'https://toko.myr.id/pl/trial-3-baru');
  assert.equal(items[0].description, 'tulisan tim');
  assert.equal(items.find((r) => r.external_id === 'm4').missing, true);

  // AI membaca item Mayar hanya selama koneksi Mayar menyala.
  assert.equal((await db.listCatalogForAi(companyId)).items.length, 0);
  await db.upsertMayarConnection(companyId, 'mayar-key-1234567890');
  const live = await db.listCatalogForAi(companyId);
  assert.deepEqual(live.items.map((i) => i.name).sort(), ['Trial 3 Hari EA MT5', 'Webinar Gratis']);
  assert.equal(live.items.find((i) => i.name === 'Webinar Gratis').url, 'https://toko.myr.id/webinar/gratis');
  await db.setMayarEnabled(companyId, false);
  assert.equal((await db.listCatalogForAi(companyId)).items.length, 0);

  assert.equal((await db.countCatalogItems(companyId)).mayar, 3);
});
