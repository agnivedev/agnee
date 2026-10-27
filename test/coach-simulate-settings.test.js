'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const esbeje = require('./fixtures/esbeje-catalog.js');

/*
 * Audit setelan -> balasan AI lewat /v1/coach/simulate. Setiap setelan yang
 * mengubah apa yang dibaca model dites dari sisi customer: isi prompt di
 * simulator harus sama dengan chat asli (jalur buildContext yang sama).
 */

const OWNER = {
  id: 'owner-a', userId: 'owner-a', companyId: 'company-a', email: 'a@toko.test',
  displayName: 'Owner A', role: 'owner', status: 'active', isPlatformAdmin: false,
};

async function setup(t, { config = {}, playbook = '', ai = { enabled: false, items: [], tags: [] }, locations = [], lalamove = null } = {}) {
  const seen = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      seen.push({ message, prompt: options.systemPrompt || '', tools: (options.tools || []).map((x) => x.name) });
      return { text: 'Baik kak.', model: 'tiruan', usage: {} };
    },
  };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(userId) { return userId === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: config.aiIdentity || 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member', ...config }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
    async getPlaybookContext() { return playbook; },
    async listCatalogForAi() { return ai; },
    async listCompanyLocations() { return locations; },
    async getLalamoveConnection() { return lalamove; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'sim-settings', database, llmService: llm });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const simulate = async (customerMessage) => {
    const res = await app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage, grade: false } });
    assert.equal(res.statusCode, 200);
    return seen.at(-1);
  };
  return { simulate };
}

test('pembayaran: link, rekening, keduanya, dan tidak ada; catatan ikut', async (t) => {
  const link = await (await setup(t, { config: { paymentMethod: 'link', paymentLink: 'https://bayar.test/abc', bankAccount: '1234567890' } })).simulate('bayarnya gimana kak?');
  assert.match(link.prompt, /PANDUAN PEMBAYARAN/);
  assert.match(link.prompt, /https:\/\/bayar\.test\/abc/);
  assert.ok(!/1234567890/.test(link.prompt), 'rekening tidak bocor saat metode link');

  const bank = await (await setup(t, { config: { paymentMethod: 'bank_transfer', bankName: 'BCA', bankAccount: '1234567890', bankHolder: 'PT Toko', paymentLink: 'https://bayar.test/abc', paymentNotes: 'DP 50%' } })).simulate('transfer ke mana?');
  assert.match(bank.prompt, /Bank: BCA/);
  assert.match(bank.prompt, /No\. Rekening: 1234567890/);
  assert.match(bank.prompt, /Atas nama: PT Toko/);
  assert.match(bank.prompt, /Catatan: DP 50%/);
  assert.ok(!/bayar\.test/.test(bank.prompt), 'link tidak bocor saat metode transfer');

  const both = await (await setup(t, { config: { paymentMethod: 'both', paymentLink: 'https://bayar.test/abc', bankName: 'BCA', bankAccount: '1234567890' } })).simulate('mau bayar');
  assert.match(both.prompt, /Ada dua cara membayar/);
  assert.match(both.prompt, /bayar\.test/);
  assert.match(both.prompt, /1234567890/);

  const none = await (await setup(t, { config: { paymentMethod: 'none', paymentLink: 'https://bayar.test/abc' } })).simulate('mau bayar');
  assert.ok(!/PANDUAN PEMBAYARAN/.test(none.prompt));
  assert.ok(!/bayar\.test/.test(none.prompt));
});

test('identitas AI: team_member tidak mengaku bot, chatbot mengaku jujur', async (t) => {
  const member = await (await setup(t, { config: { aiIdentity: 'team_member' } })).simulate('kamu bot ya?');
  assert.match(member.prompt, /JANGAN PERNAH menyebut dirimu AI, bot/);
  assert.ok(!/jawab jujur bahwa kamu\s+chatbot/.test(member.prompt));
  const bot = await (await setup(t, { config: { aiIdentity: 'chatbot' } })).simulate('kamu bot ya?');
  assert.match(bot.prompt, /jawab jujur bahwa kamu\s+chatbot/);
  assert.ok(!/JANGAN PERNAH menyebut dirimu AI, bot/.test(bot.prompt));
});

test('playbook company masuk sebagai sumber utama, kosong berarti tidak ada bagiannya', async (t) => {
  const withPlaybook = await (await setup(t, { playbook: '### persona\nNama kamu Agnes dari ESBEJE.' })).simulate('halo');
  assert.match(withPlaybook.prompt, /PLAYBOOK PERUSAHAAN INI/);
  assert.match(withPlaybook.prompt, /Nama kamu Agnes dari ESBEJE/);
  const without = await (await setup(t, { playbook: '' })).simulate('halo');
  assert.ok(!/PLAYBOOK PERUSAHAAN INI/.test(without.prompt));
});

test('katalog: saklar "dipakai AI" menentukan apakah harga sampai ke model', async (t) => {
  const item = { id: 'i1', name: 'Semen Jakarta 40kg', code: 'SJ40', price: 62000, discountPct: 0, source: 'manual', tags: [] };
  const on = await (await setup(t, { ai: { enabled: true, items: [item], tags: [] } })).simulate('harga semen jakarta?');
  assert.match(on.prompt, /KATALOG PRODUK & JASA/);
  assert.match(on.prompt, /Semen Jakarta 40kg \[SJ40\]: Rp 62\.000/);
  const off = await (await setup(t, { ai: { enabled: false, items: [item], tags: [] } })).simulate('harga semen jakarta?');
  assert.ok(!/Semen Jakarta 40kg/.test(off.prompt));
});

test('katalog besar (ESBEJE asli): harga barang yang ditanya customer sampai ke prompt', async (t) => {
  const tags = [{ id: 't-pk', name: 'Perekat Keramik', autoRule: null, highlight: false, aiNote: 'disebut juga lem keramik', active: true }];
  const items = esbeje.catalogItems((name) => (/CERAFIX|GRANITFIX|RENOFIX/.test(name) ? [{ id: 't-pk', name: 'Perekat Keramik' }] : []));
  const { simulate } = await setup(t, { ai: { enabled: true, items, tags, syncedAt: '2026-10-28T01:00:00Z' } });

  const toren = await simulate('toren penguin 1050 liter brp kak');
  const cocok = toren.prompt.split('### Cocok dengan percakapan ini\n')[1] || '';
  assert.match(cocok, /^- PENGUIN TB110 1050L BIRU TUA \[1000015169\] \(merek PENGUIN\): Rp 2\.619\.000 per pcs/);
  // Harga karangan simulasi 28 Okt berasal dari toren 550 liter; ukuran yang diminta harus di atasnya.
  const asked = cocok.indexOf('PENGUIN TB110 1050L');
  const other = cocok.indexOf('TOREN EXCEL AL-550');
  assert.ok(other === -1 || asked < other);
  const kit = cocok.indexOf('PLUMBING KIT');
  assert.ok(kit === -1 || kit > cocok.lastIndexOf('1050L'), 'varian Rp 1 tidak di atas toren');

  const perekat = await simulate('perekat keramik yg bagus apa ya kak');
  assert.match(perekat.prompt, /- MU 420 CERAFIX 25KG \[1000005368\] \(merek MORTAR UTAMA\): Rp 118\.000 per zak · ribbon: Perekat Keramik/);

  const mu = await simulate('kak MU 301 ada?');
  assert.match(mu.prompt, /### Cocok dengan percakapan ini\n- MU 301 PLASTERPLUS 40KG \[1000011476\] \(merek MORTAR UTAMA\): Rp 104\.000 per zak/);
});

test('lokasi: gudang tertutup tidak sampai ke model; toko terbuka ya', async (t) => {
  const locations = [
    { id: '1', name: 'Toko BSD', kind: 'store', address: 'Jl. A', lat: -6.3, lng: 106.65, openToCustomers: true, openingHours: '08.00-17.00', contactName: 'Pak Budi', contactPhone: '6281200000001' },
    { id: '2', name: 'Gudang Rahasia', kind: 'warehouse', address: 'Blok C', lat: -6.2, lng: 106.6, openToCustomers: false },
  ];
  const seen = await (await setup(t, { locations })).simulate('alamat toko dimana?');
  assert.match(seen.prompt, /Toko BSD/);
  assert.ok(!/Gudang Rahasia|Pak Budi|6281200000001/.test(seen.prompt));
});

test('ongkir otomatis: saklar mati tidak menawarkan alat; production di simulator tetap dipakai', async (t) => {
  const base = {
    environment: 'production', market: 'ID', apiKey: 'pk_prod_x', apiSecret: 'sk_prod_x', enabled: true,
    cities: [{ locode: 'ID JKT', name: 'Jakarta', services: [{ key: 'VAN', description: 'Van' }] }],
    pickupLat: -6.3, pickupLng: 106.65, pickupAddress: 'Toko', defaultService: 'VAN',
  };
  const off = await (await setup(t, { lalamove: { ...base, aiQuotesEnabled: false } })).simulate('ongkir ke BSD berapa?');
  assert.ok(!off.tools.includes('cek_ongkir'));
  const on = await (await setup(t, { lalamove: { ...base, aiQuotesEnabled: true } })).simulate('ongkir ke BSD berapa?');
  assert.ok(on.tools.includes('cek_ongkir'));
  const disabled = await (await setup(t, { lalamove: { ...base, aiQuotesEnabled: true, enabled: false } })).simulate('ongkir?');
  assert.ok(!disabled.tools.includes('cek_ongkir'), 'integrasi dimatikan = alat hilang');
});
