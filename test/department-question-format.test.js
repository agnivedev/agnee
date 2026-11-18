'use strict';

/**
 * Format pertanyaan ke grup Management (permintaan Hanny 18 Nov): "Sudah dicek" disusun kode dari panggilan
 * alat yang benar-benar terjadi, "Tahap (asumsi Agnes)" + "Usul barang berikutnya", penolakan bertanya
 * sebelum cek_harga, dan koreksi Management di jawaban. Data di tes ini karangan.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const departmentAsk = require('../src/department-ask');
const journal = require('../src/tool-journal');
const stages = require('../src/build-stage');

const PRODUCTS = [
  { name: 'MU 380 PEREKAT BATA RINGAN 40KG', unit: 'sak', unitPrice: 98000 },
  { name: 'MU 420 CERAFIX 25KG', unit: 'sak', unitPrice: 85000 },
  { name: 'MU 301 PLESTER 40KG', unit: 'sak', unitPrice: 62000 },
  { name: 'TOREN PENGUIN 500L', unit: 'unit', unitPrice: 750000 },
];

test('jurnal alat: ringkasan per alat, jujur soal Google/web, kosong = belum ada pengecekan', () => {
  assert.deepEqual(journal.describe('cek_harga', { barang: 'plafon gypsum' }, { status: 'ok', hasil: [{}, {}, {}] }), { tool: 'cek_harga', query: 'plafon gypsum', result: '3 barang cocok' });
  assert.equal(journal.describe('cek_harga', { barang: 'x' }, { status: 'tidak_ketemu' }).result, 'tidak ketemu');
  assert.equal(journal.describe('cek_ongkir', { tujuan: 'Cisauk' }, { status: 'lokasi_tidak_terbaca' }).result, 'gagal: alamat belum terbaca di peta');
  assert.equal(journal.describe('cek_alamat', { alamat: 'Jl Mawar' }, { status: 'jalan_ambigu' }).result, 'jalan ada di banyak kota (ambigu)');
  assert.equal(journal.describe('ask_department', {}, {}), null, 'alat lain tidak dicatat');
  const line = journal.checkedLine([
    { tool: 'cek_harga', query: 'plafon', result: 'tidak ketemu' },
    { tool: 'cek_harga', query: 'plafon', result: '2 barang cocok' },
    { tool: 'cek_ongkir', query: 'Cisauk', result: 'gagal: alamat belum terbaca di peta' },
  ]);
  assert.equal(line, 'DealPOS "plafon": 2 barang cocok; Lalamove "Cisauk": gagal: alamat belum terbaca di peta. Google/web: belum tersedia');
  assert.equal(journal.checkedLine([]), 'Belum ada pengecekan alat. Google/web: belum tersedia');
  assert.doesNotMatch(line, /sudah dicek di google/i);
});

test('tahap pembangunan: tebakan, koreksi Management, barang tawaran hanya yang ada di DealPOS', () => {
  assert.equal(stages.stageLine(stages.guessStage(['cari plafon gypsum 4 lembar'])), '3 Atap dan plafon (customer cari plafon gypsum)');
  assert.equal(stages.guessStage(['halo kak']), null);
  assert.equal(stages.stageLine(null), 'belum jelas');
  assert.deepEqual(stages.parseCorrection('tahap 4 lantai, tawarkan perekat MU 380'), { stage: 4, offer: 'perekat MU 380', rest: '' });
  assert.deepEqual(stages.parseCorrection('Ada 130.000/dus. Tahap 3'), { stage: 3, offer: null, rest: 'Ada 130.000/dus' });
  assert.equal(stages.matchOffer(PRODUCTS, 'perekat MU 380')[0].name, 'MU 380 PEREKAT BATA RINGAN 40KG');
  assert.deepEqual(stages.matchOffer(PRODUCTS, 'perekat MU 999'), [], 'tak ketemu = tidak ditawarkan');
  // Tahap 3 -> barang tahap 4 (lantai): MU 420.
  assert.deepEqual(stages.suggestNext(3, PRODUCTS).map((p) => p.name), ['MU 420 CERAFIX 25KG']);
  assert.deepEqual(stages.suggestNext(6, PRODUCTS), []);
});

test('pesan ke grup memuat semua baris dengan urutan yang diminta', () => {
  const brief = { awal: 'Cari plafon gypsum', ringkasan: 'Customer minta 20 lembar. Agnes menawarkan 9mm Rp 85.000. Stok menggantung.', pemicu: 'ada yang 12mm?', diketahui: 'Gypsum 9mm Rp 85.000/lembar', putuskan: 'Gypsum 12mm ready dan berapa harganya?' };
  const text = departmentAsk.buildQuestionNotice({
    department: 'Management', question: 'q', customerLabel: 'Budi (+62811)', code: 'ab12cd', group: true, brief,
    checked: 'DealPOS "gypsum 12mm": tidak ketemu. Google/web: belum tersedia',
    stageText: '3 Atap dan plafon (customer cari plafon gypsum)', suggest: 'MU 420 CERAFIX 25KG Rp 85.000 per sak',
  });
  const keys = ['Customer:', 'Awal chat:', 'Ringkasan:', 'Pesan terakhir:', 'Tahap (asumsi Agnes):', 'Sudah diketahui:', 'Sudah dicek:', 'Mohon diputuskan:', 'Usul barang berikutnya:'];
  const at = keys.map((k) => text.indexOf(k));
  assert.ok(at.every((i) => i >= 0), text);
  assert.deepEqual(at, [...at].sort((a, b) => a - b));
  assert.match(text, /\(balas 'ganti \.\.\.' atau 'tahap N' kalau keliru\)/);
  assert.match(text, /#ab12cd/);
});

function appWith(t, over = {}) {
  const state = { created: [], stages: [], prompts: [], reopened: [], relayed: [] };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async listDepartmentQuestions() { return []; },
    async recentToolCalls() { return over.calls || []; },
    async recentConversation() { return { first: 'Cari plafon gypsum', turns: [{ from: 'customer', body: 'Cari plafon gypsum' }, { from: 'ai', body: 'Gypsum 9mm Rp 85.000' }, { from: 'customer', body: 'ada yang 12mm?' }] }; },
    async getBuildStage() { return over.savedStage || null; },
    async setBuildStage(_c, chatId, value) { state.stages.push({ chatId, ...value }); return value; },
    async listDealposProducts() { return { products: PRODUCTS, syncedAt: null }; },
    async createDepartmentQuestion(input) { state.created.push(input); return { id: 'aaaaaa00-0000-4000-8000-000000000001', department: 'Management', whatsappGroupId: null, members: [] }; },
    async getCustomerContactName() { return null; },
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async reopenDepartmentQuestion(id) { state.reopened.push(id); return true; },
    async markDepartmentQuestionRelayed(id) { state.relayed.push(id); return true; },
    async answerDepartmentQuestion(id, { answer }) { return { id, chatId: 'c1@c.us', customerText: 'lantai', question: 'q', answer, kind: 'general', createdAt: new Date('2026-11-05T10:00:00Z') }; },
    async getHandoffNotifyNumbers() { return []; },
    async listRecentChatTexts() { return []; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const llmService = {
    enabled: true,
    async generateReply(text) {
      state.prompts.push(text);
      if (/merangkum percakapan/.test(arguments[1]?.systemPrompt || '')) return { text: '{"awal":"Cari plafon gypsum","ringkasan":"Customer cari gypsum; Agnes menawarkan 9mm.","pemicu":"ada yang 12mm?","diketahui":"Gypsum 9mm Rp 85.000","putuskan":"Gypsum 12mm ready dan harganya?"}', model: 't', usage: {} };
      return { text: 'Baik kak, barangnya ada, Rp 98.000 per sak ya.', model: 't', usage: {} };
    },
    async generateJson() { return null; },
  };
  return buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'fmt' })
    .then((server) => { t.after(() => server.close()); return { server, state }; });
}

const DEPARTMENTS = [{ id: 'd1', name: 'Management', members: [], whatsappGroupId: '1203@g.us' }];
const ask = (server, question, meta) => server.askDepartment({
  companyId: 'co-1', chatId: 'c1@c.us', customerText: 'ada yang 12mm?', departments: DEPARTMENTS, args: { department: 'Management', question }, meta,
});

test('ask_department ditolak bila cek_harga belum dipanggil di chat itu; setelahnya lolos dengan Sudah dicek', async (t) => {
  const refused = await appWith(t, { calls: [] });
  const out = await ask(refused.server, 'Gypsum 12mm ready? Berapa harganya?', { needPriceCheck: true });
  assert.match(out.error, /cek_harga/);
  assert.equal(refused.state.created.length, 0);

  const ok = await appWith(t, { calls: [{ tool: 'cek_harga', query: 'gypsum 12mm', result: 'tidak ketemu' }] });
  const sent = await ask(ok.server, 'Gypsum 12mm ready? Berapa harganya?', { needPriceCheck: true });
  assert.equal(sent.status, 'sent');
  const payload = ok.state.created[0].payload;
  assert.equal(payload.checked, 'DealPOS "gypsum 12mm": tidak ketemu. Google/web: belum tersedia');
  assert.equal(payload.stageText, '3 Atap dan plafon (customer cari plafon gypsum)');
  assert.match(payload.suggest, /MU 420 CERAFIX 25KG Rp 85\.000 per sak/);
  assert.equal(ok.state.stages[0].stage, 3, 'tebakan disimpan sebagai tebakan Agnes');
  assert.equal(ok.state.stages[0].source, 'agnes');

  // Pertanyaan non-barang (mis. kebijakan) tidak wajib cek_harga.
  const policy = await appWith(t, { calls: [] });
  assert.equal((await ask(policy.server, 'Boleh diskon 5% untuk 20 lembar?', { needPriceCheck: true })).status, 'sent');
});

test('koreksi Management tersimpan, barang yang tak ketemu tak ditawarkan, "tahap" tak sampai ke customer', async (t) => {
  const { server, state } = await appWith(t);
  const row = (answer) => ({ id: 'q1', chatId: 'c1@c.us', customerText: 'lantai', question: 'q', answer, kind: 'general' });

  const found = await server.applyAnswerCorrection(row('Ada, Rp 98.000 per sak. Tahap 4 lantai, tawarkan perekat MU 380'), 'co-1');
  assert.equal(found.only, false);
  assert.deepEqual([state.stages.at(-1).stage, state.stages.at(-1).source], [4, 'management']);
  assert.match(found.row.answer, /^Ada, Rp 98\.000 per sak\. Barang yang boleh ditawarkan \(harga dari DealPOS\): MU 380 PEREKAT BATA RINGAN 40KG Rp 98\.000 per sak$/);
  assert.doesNotMatch(found.row.answer, /tahap/i, 'koreksi bukan kalimat untuk customer');
  assert.match(found.stageNote, /fase Lantai/);
  assert.doesNotMatch(found.stageNote.replace(/jangan menulis kata "tahap"/, ''), /tahap/i);
  assert.match(found.extraAck.join(' '), /Tahap dicatat: 4 Lantai/);

  const missing = await server.applyAnswerCorrection(row('Ada, Rp 98.000 per sak. tawarkan perekat MU 999'), 'co-1');
  assert.match(missing.extraAck.join(' '), /tidak ketemu di DealPOS, jadi tidak ditawarkan/);
  assert.doesNotMatch(missing.row.answer, /MU 999/);

  const only = await server.applyAnswerCorrection(row('tahap 5 pengecatan'), 'co-1');
  assert.equal(only.only, true);
  assert.equal(state.stages.at(-1).stage, 5);

  // Tanpa koreksi: jawaban lewat apa adanya.
  const plain = await server.applyAnswerCorrection(row('Ada, 130.000/dus'), 'co-1');
  assert.equal(plain.row.answer, 'Ada, 130.000/dus');
  assert.deepEqual(plain.extraAck, []);
});

test('relay memakai jawaban yang sudah dikoreksi dan catatan fase (tanpa kata "tahap" di jawaban)', async (t) => {
  const { server, state } = await appWith(t);
  await server.relayDepartmentAnswerForTest(
    { id: 'q1', chatId: 'c1@c.us', customerText: 'lantai', question: 'q', answer: 'Ada, Rp 98.000 per sak. Tahap 4 lantai, tawarkan perekat MU 380', kind: 'general', createdAt: new Date('2026-11-05T10:00:00Z'), department: 'Management' },
    'co-1',
  ).catch(() => {}); // pengiriman WhatsApp tak ada di tes; yang diperiksa prompt relay-nya
  const prompt = state.prompts.find((p) => p.includes('Hasil yang sudah dipastikan'));
  assert.ok(prompt, 'relay sampai ke model');
  assert.match(prompt, /Hasil yang sudah dipastikan: "Ada, Rp 98\.000 per sak\. Barang yang boleh ditawarkan/);
  assert.doesNotMatch(prompt.match(/Hasil yang sudah dipastikan: "[^"]*"/)[0], /tahap/i);
  assert.match(prompt, /fase Lantai/);
});
