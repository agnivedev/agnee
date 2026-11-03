'use strict';

/**
 * Lampiran customer di Uji AI (/v1/coach/simulate): foto dibaca (OCR, watermark
 * diabaikan) dan dokumen dibaca isinya, lalu penandanya menjadi bagian pesan
 * customer yang sampai ke model, sama seperti chat WhatsApp sungguhan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const SUP = { id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'sup@toko.test', displayName: 'Supervisor', role: 'supervisor', status: 'active', isPlatformAdmin: false };

function fakeDatabase() {
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === SUP.email && password === 'password-123' ? SUP : null; },
    async getActiveSessionUser(id) { return id === SUP.id ? SUP : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member', aiReadMedia: true }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
  };
  return new Proxy(known, { get(t, p) { if (p in t) return t[p]; if (p === 'then') return undefined; return async () => (String(p).startsWith('list') ? [] : null); } });
}

async function setup(t) {
  const seen = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async describeImage() {
      return JSON.stringify({ kind: 'produk', description: 'Kaleng cat putih 5kg', keywords: ['cat'], textInImage: 'Danabrite 2290 Brilliant White 5KG', overlayIgnored: 'logo Tokopedia', searchQuery: null });
    },
    async generateReply(message, options) {
      if (options.purpose === 'simulate') seen.push(message);
      return { text: 'Baik kak, saya cek barangnya ya.', model: 'tiruan', usage: {} };
    },
  };
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'att-session-secret', database: fakeDatabase(), llmService: llm, llmEnabled: true, openrouterApiKey: 'k' });
  t.after(() => app.close());
  const cookie = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUP.email, password: 'password-123' } })).headers['set-cookie'].split(';')[0];
  const simulate = (body) => app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', grade: false, ...body } });
  return { simulate, seen };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64');

test('foto dan CSV dilampirkan: penanda isi sampai ke model dan dikembalikan ke layar', async (t) => {
  const { simulate, seen } = await setup(t);
  const csv = Buffer.from('nama,harga\nCat Dulux 5kg,150000\n').toString('base64');
  const res = await simulate({
    customerMessage: 'ini yang saya mau kak',
    attachments: [
      { name: 'tokopedia.png', mimeType: 'image/png', data: PNG },
      { name: 'daftar.csv', mimeType: 'text/csv', data: csv },
    ],
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.match(seen[0], /ini yang saya mau kak/);
  assert.match(seen[0], /Danabrite 2290 Brilliant White 5KG/);
  assert.match(seen[0], /Watermark\/logo diabaikan: logo Tokopedia/);
  assert.match(seen[0], /Customer mengirim file "daftar\.csv"[\s\S]*Cat Dulux 5kg,150000/);
  assert.match(body.attachmentText, /Danabrite 2290/);
});

test('hanya lampiran tanpa teks diterima; tanpa keduanya ditolak', async (t) => {
  const { simulate } = await setup(t);
  assert.equal((await simulate({ customerMessage: '', attachments: [{ name: 'a.png', mimeType: 'image/png', data: PNG }] })).statusCode, 200);
  assert.equal((await simulate({ customerMessage: '' })).statusCode, 400);
});
