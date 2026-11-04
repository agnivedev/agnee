'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lookup, searchOne, cleanQuery, codeCandidates } = require('../src/price-lookup');
const { buildApp } = require('../src/server');

// Cuplikan katalog ESBEJE produksi (4 Nov 2026). Tiga barang kasus PT Rajawali
// Lintas Kreasi (Sincere/Homeup, Infinity Revolver Gold, Art Keramik Dieng
// Grey) memang tidak ada di DealPOS; yang ada hanya barang mirip ukuran/warna.
const ITEMS = [
  ['1090500027', 'ACCURA AVON GREY 40X40 KW PRO', 51100],
  ['1090500095', 'ACCURA AVON GREY 40X40 KW3', 62500],
  ['1090500023', 'ACCURA GLOSSY WHITE 60X60 KW1', 117400],
  ['1115201255', 'SIGNATURE GLOSSY WHITE 60X60 KW1', 108200],
  ['KONSI-VAL00039', 'VALENTINO OBSIDIAN GOLD 60X60 KW1 (1.44M2)', 287000],
  ['VAL-900063', 'VALENTINO NEW MAHOGANY COFFEE 15X90 KW1 (1.08M2)', 302000],
  ['1014500234', 'CENTRO DIENG BROWN 20X40 KW1', 85800],
  ['2000000001', 'BITAPRIM WP NANO 2.5 LT', 135000],
  ['2000000002', 'SUNPOWER WP 5999 50X50 KW1 HITAM KILAP', 84700],
  ['2000000003', 'PAKU 5CM / DUS (2in)', 417000],
  ['2000000004', 'KERAMIK SALE CAMPUR/NO DUS 40x40 & 50x50', 40000],
  ['2000000005', 'ASIA TILE ORION GREY 40X40 KW A', 77600],
  ['2000000006', 'VALENTINO ALPINUS BROWN GLAZED POLISH 60X60 KW1', 242000],
].map(([code, name, unitPrice], i) => ({ id: `i${i}`, code, name, unitPrice, unit: null }));

const PESAN = [
  'Sincere/Homeup Glazed WP 15x90 REC-DF91502 (1dus=10 keping) 5 Dus',
  'infinity Glossy 60x60 cm QD Revolver Gold (1dus=4 keping) 3 dus',
  'Art Keramik FT. KW I 40x40 cm Dieng Grey (1dus= 6 keping) 13 Dus',
];

test('kemasan dan jumlah dibuang dari kueri, kode dan ukuran tetap', () => {
  assert.equal(cleanQuery(PESAN[0]), 'Sincere/Homeup Glazed WP 15x90 REC-DF91502');
  assert.deepEqual(codeCandidates(cleanQuery(PESAN[0])), ['recdf91502']);
  assert.deepEqual(codeCandidates('Semen 40KG 15x90 1050L'), []);
});

test('tiga barang kasus Rajawali: tidak ada di POS, tak ada pembanding yang menyesatkan', () => {
  for (const text of PESAN) {
    const found = searchOne(ITEMS, text);
    assert.deepEqual(found.matches.map((m) => m.name), [], `harus kosong: ${text}`);
  }
  const out = lookup(ITEMS, { daftar: PESAN });
  assert.equal(out.status, 'tidak_ketemu');
  assert.equal(out.per_barang.length, 3);
  assert.ok(out.per_barang.every((r) => r.status === 'tidak_ketemu' && !r.hasil));
  assert.match(out.per_barang[0].pesan, /REC-?DF91502|recdf91502/i);
  assert.match(out.per_barang[0].pesan, /jangan meminta nama atau kode lagi/);
  assert.match(out.per_barang[0].pesan, /jangan bilang barangnya tidak terdaftar/);
  assert.ok(!/sampaikan jelas/i.test(out.per_barang[0].pesan));
});

test('banyak barang dalam satu panggilan: yang ketemu dihargai, yang tidak dilaporkan per barang', () => {
  const out = lookup(ITEMS, { daftar: [PESAN[0], 'ACCURA Avon Grey 40x40 KW PRO 13 dus', 'Centro Dieng Brown 20 x 40 2 dus'] });
  assert.equal(out.status, 'sebagian');
  assert.equal(out.per_barang[0].status, 'tidak_ketemu');
  assert.equal(out.per_barang[1].status, 'ok');
  assert.equal(out.per_barang[1].hasil[0].nama, 'ACCURA AVON GREY 40X40 KW PRO');
  assert.equal(out.per_barang[1].hasil[0].harga, 'Rp 51.100');
  assert.equal(out.per_barang[2].hasil[0].nama, 'CENTRO DIENG BROWN 20X40 KW1', 'ukuran "20 x 40" dinormalisasi');
});

test('kode barang dipakai langsung, dengan atau tanpa tanda hubung', () => {
  assert.equal(lookup(ITEMS, { barang: 'VAL900063' }).hasil[0].nama, 'VALENTINO NEW MAHOGANY COFFEE 15X90 KW1 (1.08M2)');
  assert.equal(lookup(ITEMS, { barang: 'kode 1090500027 3 dus' }).hasil[0].kode, '1090500027');
});

test('satu barang tetap berbentuk lama (status + hasil / tidak_ketemu) dan onResults hanya untuk yang ketemu', () => {
  const seen = [];
  const ok = lookup(ITEMS, { barang: 'Accura Avon Grey 40x40' }, { onResults: (r) => seen.push(...r) });
  assert.equal(ok.status, 'ok');
  assert.ok(seen.length >= 2);
  const none = lookup(ITEMS, { barang: PESAN[1] }, { onResults: () => assert.fail('tak boleh dicatat') });
  assert.equal(none.status, 'tidak_ketemu');
  assert.equal(lookup(ITEMS, {}).status, 'kueri_kosong');
});

test('simulate (chat sebagai customer, kasus Rajawali): model memanggil cek_harga sekali dengan daftar dan menjawab jujur per barang', async (t) => {
  const OWNER = { id: 'o', userId: 'o', companyId: 'c', email: 'a@toko.test', displayName: 'O', role: 'owner', status: 'active', isPlatformAdmin: false };
  const calls = [];
  const llm = {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      const tool = options.tools.find((x) => x.name === 'cek_harga');
      calls.push(await tool.run({ daftar: PESAN }));
      return { text: 'Baik Pak Yohanes. Ketiga keramik itu saya cek dulu ke tim ya, nanti saya kabari penawarannya.', model: 'tiruan', usage: {} };
    },
  };
  const known = {
    enabled: true, connected: true, async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return email === OWNER.email && password === 'password-123' ? OWNER : null; },
    async getActiveSessionUser(id) { return id === OWNER.id ? OWNER : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async recordSimulationRun() { return { id: 'r' }; },
    async getPlaybookContext() { return '## PLAYBOOK\nESBEJE'; },
    async listCatalogForAi() { return { enabled: true, items: ITEMS.map((i) => ({ ...i, price: i.unitPrice, source: 'dealpos', tags: [] })), tags: [], syncedAt: null }; },
  };
  const database = new Proxy(known, { get(tg, p) { if (p in tg) return tg[p]; if (p === 'then') return undefined; return async () => (String(p).startsWith('list') ? [] : null); } });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'price-multi', database, llmService: llm });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: OWNER.email, password: 'password-123' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  const res = await app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage: `Selamat siang, saya Yohanes, mencari keramik:\n${PESAN.join('\n')}\nMinta penawaran harga.`, grade: false } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'tidak_ketemu');
  assert.ok(!/Rp\s?\d/.test(String(res.json().reply || '')), 'tak ada harga karangan');
});

test('panduan penawaran: kepastian proses, syarat dicatat, satu pertanyaan lengkap ke tim, tanpa bahasa teknis', () => {
  const { GUIDE } = require('../src/price-lookup');
  assert.match(GUIDE, /Permintaan PENAWARAN/);
  assert.match(GUIDE, /kepastian proses/);
  assert.match(GUIDE, /inc\. PPN, DP, pelunasan setelah kirim, free ongkir/);
  assert.match(GUIDE, /tanpa menyetujui atau menolaknya sendiri/);
  assert.match(GUIDE, /nama customer dan perusahaan, semua barang dengan kode dan jumlah/);
  assert.match(GUIDE, /jangan dipecah per barang atau per syarat/);
  assert.match(GUIDE, /JANGAN mengatakan barangnya "tidak terdaftar/);
});
