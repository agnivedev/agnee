'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

/*
 * POST /public/ebook-lead: lead dari form ebook di /landing. Publik, jadi yang
 * diuji adalah apa yang tersimpan dan apa yang ditolak. Rute ini tidak mengirim
 * WhatsApp apa pun: itu dijaga di server.js, bukan di tes ini.
 */

const body = (over = {}) => ({ name: 'Dewi Anggraini', brand: 'Sepatu Lari', email: 'Dewi@Toko.test', whatsapp: '08123456789', ...over });

async function app(t, overrides = {}) {
  const saved = { leads: [], profiles: [] };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(ref) { return ref === 'beweix-digital' ? 'c-beweix' : null; },
    async getCompanyConfig() { return null; },
    async recordWebsiteLead(lead, companyId) { saved.leads.push({ ...lead, companyId }); return {}; },
    async saveWebsiteLeadProfile(lead, companyId) { saved.profiles.push({ ...lead, companyId }); return { id: 'x' }; },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, sessionSecret: 'ebook-lead', ...overrides });
  t.after(() => server.close());
  const post = (payload, headers = {}) => server.inject({ method: 'POST', url: '/public/ebook-lead', payload, headers: { 'content-type': 'application/json', ...headers } });
  return { server, saved, post };
}

test('lead form ebook tersimpan di company yang disebut, tanpa sesi', async (t) => {
  const { saved, post } = await app(t);
  const res = await post(body());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(saved.leads.length, 1);
  assert.equal(saved.leads[0].companyId, 'c-beweix');
  assert.equal(saved.leads[0].chatId, '628123456789@c.us');
  assert.equal(saved.leads[0].title, 'Dewi Anggraini · Sepatu Lari');
  assert.match(saved.leads[0].detail, /ebook-20x-roas/);
  assert.equal(saved.profiles[0].email, 'dewi@toko.test');
  assert.equal(saved.profiles[0].companyId, 'c-beweix');
});

test('kolom jebakan terisi: dijawab sukses tapi tidak disimpan', async (t) => {
  const { saved, post } = await app(t);
  const res = await post(body({ website: 'http://spam.test' }));
  assert.equal(res.statusCode, 200);
  assert.equal(saved.leads.length, 0);
});

test('data tidak valid ditolak', async (t) => {
  const { saved, post } = await app(t);
  assert.equal((await post(body({ email: 'bukan-email' }))).statusCode, 400);
  assert.equal((await post(body({ whatsapp: 'abc' }))).statusCode, 400);
  assert.equal((await post(body({ name: 'D' }))).statusCode, 400);
  assert.equal((await post({ name: 'Dewi', brand: 'Toko' })).statusCode, 400);
  assert.equal(saved.leads.length, 0);
});

test('batas per IP: kiriman ke sembilan ditolak 429', async (t) => {
  const { saved, post } = await app(t);
  for (let i = 0; i < 8; i += 1) assert.equal((await post(body({ whatsapp: `0812345678${i}` }))).statusCode, 200);
  const res = await post(body({ whatsapp: '081234567899' }));
  assert.equal(res.statusCode, 429);
  assert.equal(saved.leads.length, 8);
});

test('company tidak ada di server: 503, tidak jatuh ke company lain', async (t) => {
  const { saved, post } = await app(t, { ebookLeadCompany: 'tidak-ada' });
  assert.equal((await post(body())).statusCode, 503);
  assert.equal(saved.leads.length, 0);
});

test('EBOOK_LEAD_COMPANY kosong menutup pintu (404)', async (t) => {
  const { post } = await app(t, { ebookLeadCompany: '' });
  assert.equal((await post(body())).statusCode, 404);
});
