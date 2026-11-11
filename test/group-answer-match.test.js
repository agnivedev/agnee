'use strict';

/**
 * Jawaban santai di grup Management (tanpa reply, tanpa #kode) dicocokkan ke
 * pertanyaan terbuka oleh LLM; hanya yang yakin tinggi yang diterima.
 * Kasus nyata: 9 Nov, "ga ada" untuk garansi kloset dan "yes" untuk gratis
 * ongkir sesama Cisauk tidak pernah terhubung.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const match = require('../src/group-answer-match');
const guard = require('../src/uncertainty-guard');
const { buildApp } = require('../src/server');

const GARANSI = { id: 'aaaaaa00-0000-4000-8000-000000000001', chatId: 'c1@c.us', departmentId: 'd1', department: 'Management', customerText: 'Ini ada ga garansi nya ga ya kak', question: 'Customer menanyakan garansi kloset' };
const ONGKIR = { id: 'bbbbbb00-0000-4000-8000-000000000002', chatId: 'c2@c.us', departmentId: 'd1', department: 'Management', customerText: '', question: 'Apakah gratis ongkir sesama Cisauk berlaku? Jawab ya atau tidak.' };

test('parseVerdict: hanya nomor sah dengan yakin tinggi', () => {
  assert.equal(match.parseVerdict('{"nomor": 2, "yakin": "tinggi"}', 2), 1);
  assert.equal(match.parseVerdict('```json\n{"nomor": 1, "yakin": "tinggi"}\n```', 2), 0);
  assert.equal(match.parseVerdict('{"nomor": 1, "yakin": "rendah"}', 2), null);
  assert.equal(match.parseVerdict('{"nomor": null, "yakin": "tinggi"}', 2), null);
  assert.equal(match.parseVerdict('{"nomor": 3, "yakin": "tinggi"}', 2), null);
  assert.equal(match.parseVerdict('bukan json', 2), null);
});

test('matchLooseAnswer: memilih kandidat, ragu atau gagal = null, obrolan tak diperiksa', async () => {
  let prompt = '';
  const pick = await match.matchLooseAnswer({
    candidates: [GARANSI, ONGKIR], context: ['Cik, kloset ini ready kan?', 'Ada garansi kah?'], text: 'ga ada',
    ask: async (p) => { prompt = p; return '{"nomor": 1, "yakin": "tinggi"}'; },
  });
  assert.equal(pick.id, GARANSI.id);
  assert.match(prompt, /Ada garansi kah\?/);
  assert.match(prompt, /PESAN BARU: "ga ada"/);

  assert.equal(await match.matchLooseAnswer({ candidates: [GARANSI], text: 'ga ada', ask: async () => '{"nomor":1,"yakin":"rendah"}' }), null);
  assert.equal(await match.matchLooseAnswer({ candidates: [GARANSI], text: 'ga ada', ask: async () => { throw new Error('boom'); } }), null);
  let called = false;
  assert.equal(await match.matchLooseAnswer({ candidates: [GARANSI], text: '😂😂', ask: async () => { called = true; return ''; } }), null);
  assert.equal(called, false, 'emoji saja tidak membayar panggilan model');
  assert.equal(await match.matchLooseAnswer({ candidates: [], text: 'ready', ask: async () => { called = true; return ''; } }), null);
  assert.equal(called, false);
});

test('penjaga: penutup dan "yg ini" tidak jadi pertanyaan ke Management', () => {
  const base = { topic: 'order', departmentNames: ['Management'], canAsk: true };
  for (const t of ['Ok skip ya', 'oke makasih', 'Nanti ya kak', 'ga jadi deh']) {
    assert.equal(guard.chooseAction({ ...base, customerText: t }).action, 'acknowledge', t);
  }
  for (const t of ['Yg ini', 'yang ini kak', 'ini?']) {
    assert.equal(guard.chooseAction({ ...base, topic: 'harga', customerText: t }).action, 'ask_customer', t);
  }
  assert.equal(guard.chooseAction({ ...base, customerText: 'iya kak' }).action, 'notify_staff', 'persetujuan tetap sampai ke staf');
  assert.equal(guard.chooseAction({ ...base, customerText: 'sudah' }).action, 'ask_department', '"sudah" bisa berarti sudah bayar');
  // Bukti transfer dengan caption "ini" / "ok" tetap diperiksa Finance, bukan diminta kirim ulang.
  const pay = { topic: 'transfer', departmentNames: ['Finance'], canAsk: true, proofCheck: true, proofGiven: true };
  assert.equal(guard.chooseAction({ ...pay, customerText: 'ini' }).action, 'ask_department');
  assert.equal(guard.chooseAction({ ...pay, customerText: 'ok kak' }).action, 'ask_department');
  assert.equal(guard.chooseAction({ ...base, topic: 'harga', customerText: 'Harga paralon 4 inch brp' }).action, 'ask_department');
  assert.equal(guard.chooseAction({ ...base, topic: 'stok', customerText: 'Ok ada stok kloset Volk?' }).action, 'ask_department');
});

test('penjaga: "Ok skip ya" dibalas wajar, tanpa janji menyusul', () => {
  const assessment = { topic: 'order', reasons: [{ code: 'order_claim', sentence: 'Pesanan kakak sudah diproses ya.' }] };
  const text = guard.compose({ finalText: 'Pesanan kakak sudah diproses ya.', customerText: 'Ok skip ya', assessment, plan: { action: 'acknowledge' } });
  assert.doesNotMatch(text, /sudah diproses|get back|teruskan/i);
  assert.match(text, /kabari saja/);
});

test('looksLikeBotNotice: pemberitahuan, pengingat, dan balasan pencocokan dikenali', () => {
  assert.ok(match.looksLikeBotNotice('*Pertanyaan dari asisten untuk tim Finance*\nCustomer: X'));
  assert.ok(match.looksLikeBotNotice('*Pengingat 2/4 — tim Management*'));
  assert.ok(match.looksLikeBotNotice('Saya baca pesan tadi sebagai jawaban untuk "x" (#abc123).'));
  assert.ok(match.looksLikeBotNotice('Jawab dengan reply, atau tulis #d87625'));
  assert.ok(!match.looksLikeBotNotice('Ada garansi kah?'));
  assert.ok(!match.looksLikeBotNotice(''));
});

async function harness(t, llmText) {
  const state = { answered: [], sent: [], asked: 0 };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async findGroupDepartmentQuestion() { return null; },
    async listOpenGroupQuestions() { return [GARANSI, ONGKIR]; },
    async recentInboundTexts() { return ['ga ada', 'Ada garansi kah?', 'Cik, kloset ini ready kan?']; },
    async findMemberByWhatsapp() { return null; },
    async listDepartmentQuestions() { return []; },
    async answerDepartmentQuestion(id, { answer }) { state.answered.push({ id, answer }); return { id, chatId: GARANSI.chatId, customerText: '', question: GARANSI.question, answer, kind: 'general' }; },
    async recordInboundMessage() { return true; },
    async getHandoffNotifyNumbers() { return []; },
    async getAiSettings() { return { enabled: false, modelChain: [], identity: 'team_member' }; },
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
    async generateReply(_p, opts) { if (opts.purpose === 'group_match') { state.asked += 1; return { text: llmText, model: 'tiruan', usage: {} }; } return { text: 'Siap.', model: 'tiruan', usage: {} }; },
    async generateJson() { return null; },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'gam-session' });
  t.after(() => server.close());
  const msg = (body, quoted = null) => ({
    from: '120363@g.us', author: '628111@c.us', body, type: 'chat', timestamp: 1, id: { _serialized: `m-${body}` },
    _data: quoted ? { quotedStanzaID: 'STAFF1', quotedMsg: { body: quoted } } : {},
    async reply(text) { state.sent.push(text); },
  });
  return { server, state, msg };
}

test('grup: "ga ada" tanpa reply dicatat sebagai jawaban garansi', async (t) => {
  const { server, state, msg } = await harness(t, '{"nomor": 1, "yakin": "tinggi"}');
  await server.handleInboundMessage('co-1', msg('ga ada'));
  assert.equal(state.asked, 1);
  assert.equal(state.answered.length, 1);
  assert.equal(state.answered[0].id, GARANSI.id);
});

test('grup: model ragu atau obrolan biasa = tidak ada jawaban tercatat', async (t) => {
  const { server, state, msg } = await harness(t, '{"nomor": 1, "yakin": "rendah"}');
  await server.handleInboundMessage('co-1', msg('ga ada'));
  assert.equal(state.answered.length, 0);
  await server.handleInboundMessage('co-1', msg('Udh dijawab nanya lagi'));
  assert.equal(state.asked, 1, 'keluhan tidak masuk jalur pencocokan');
});

test('grup: reply ke pesan sesama staf tetap dicocokkan, kutipannya ikut jadi konteks', async (t) => {
  const { server, state, msg } = await harness(t, '{"nomor": 1, "yakin": "tinggi"}');
  await server.handleInboundMessage('co-1', msg('ga ada', 'Ada garansi kah?'));
  assert.equal(state.asked, 1);
  assert.equal(state.answered[0]?.id, GARANSI.id);
});

test('grup: reply ke pesan bot atau meneruskan pesan bot tidak memanggil model', async (t) => {
  const { server, state, msg } = await harness(t, '{"nomor": 1, "yakin": "tinggi"}');
  await server.handleInboundMessage('co-1', msg('ready', '*Pengingat terakhir — tim Management*\nCustomer · #aaaaaa'));
  await server.handleInboundMessage('co-1', msg('*Pertanyaan dari asisten untuk tim Finance*\nCustomer: Esbeje Cisauk'));
  assert.equal(state.asked, 0);
  assert.equal(state.answered.length, 0);
});
