'use strict';

/**
 * Pagar relay jawaban departemen dan satu pertanyaan terbuka per topik.
 * Kasus dari audit chat ESBEJE 9 Nov (nomor dan nama disamarkan).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const departmentAsk = require('../src/department-ask');

const MEMBER = '22222222-2222-4222-8222-222222222222';
const Q1 = 'aaaaaa00-0000-4000-8000-000000000001';
const Q2 = 'bbbbbb00-0000-4000-8000-000000000002';
const Q3 = 'cccccc00-0000-4000-8000-000000000003';
const CHAT = '62811@c.us';
const PARALON = 'Customer minta harga paralon 4 inci dan 3/4 inci, masing-masing 7 batang. Mohon harga per batang.';

async function harness(t, {
  question = PARALON,
  replies = ['Harga pipa Rucika 4 inch D Rp 193.500 per batang dan 3/4 inch AW Rp 37.000 per batang, kak.'],
  lastHumanAt = null,
  otherOpen = [],
} = {}) {
  const state = { answered: [], closed: [], reopened: [], routing: [], prompts: [], supervisor: [], relayed: [] };
  const createdAt = new Date('2026-11-05T10:00:00Z');
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async findMemberByWhatsapp(_c, digits) { return digits === '628123456789' ? { userId: MEMBER } : null; },
    async listOpenQuestionsForMember() { return [{ id: Q1, chatId: CHAT, question, department: 'Management' }]; },
    async answerDepartmentQuestion(id, { answer }) {
      state.answered.push({ id, answer });
      return { id, chatId: CHAT, customerText: 'paralon 4 inch 7 batang', question, answer, kind: 'general', createdAt };
    },
    async listDepartmentQuestions(_c, { status }) {
      return status === 'open' ? otherOpen.filter((q) => !state.closed.includes(q.id)) : [];
    },
    async closeDepartmentQuestion(id) { state.closed.push(id); return { id }; },
    async reopenDepartmentQuestion(id) { state.reopened.push(id); return true; },
    async saveConversationRouting(change) { state.routing.push(change); return { ...change }; },
    async getLastHumanReplyAt() { return lastHumanAt; },
    async notifySupervisors(entry) { state.supervisor.push(entry); return []; },
    async markDepartmentQuestionRelayed(id) { state.relayed.push(id); return true; },
    async listRecentChatTexts() {
      return [
        { fromMe: false, body: 'paralon 4 inch sama 3/4 masing2 7 batang', at: new Date() },
        { fromMe: true, body: 'Baik kak, saya cek dulu ya.', at: new Date() },
      ];
    },
    async getHandoffNotifyNumbers() { return []; },
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
  };
  const database = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  let i = 0;
  const llmService = {
    enabled: true,
    async generateReply(text) {
      state.prompts.push(text);
      const out = replies[Math.min(i, replies.length - 1)];
      i += 1;
      return { text: out, model: 'tiruan', usage: {} };
    },
    async generateJson() { return null; },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'relay-guard' });
  t.after(() => server.close());
  const dm = (body) => ({ from: '628123456789@c.us', body, type: 'chat', timestamp: 1, id: { _serialized: `m-${body}` }, async reply() {} });
  return { server, state, dm };
}

const relayPrompts = (state) => state.prompts.filter((p) => p.includes('Hasil yang sudah dipastikan'));

test('angka di balasan wajib ada di jawaban: total karangan tidak terkirim', async (t) => {
  const { server, state, dm } = await harness(t, {
    replies: ['Totalnya untuk 7 batang 4 inch dan 7 batang 3/4 inch jadi Rp 1.508.500 ya kak. Saya proseskan ordernya sekarang?'],
  });
  await server.handleInboundMessage('co-1', dm('Harga Pipa Rucika 4in D 193.500 per batang\nHarga Pipa Rucika 3/4in AW 37.000 per batang'));
  const prompts = relayPrompts(state);
  assert.equal(prompts.length, 2, 'dicoba ulang sekali dengan peringatan angka');
  assert.match(prompts[1], /angka yang tidak ada di hasil/);
  assert.equal(state.relayed.length, 0, 'tidak diteruskan ke customer');
  assert.equal(state.supervisor.length, 1, 'supervisor diberi tahu');
});

test('relay membawa riwayat chat dan larangan menghitung total', async (t) => {
  const { server, state, dm } = await harness(t);
  await server.handleInboundMessage('co-1', dm('Harga Pipa Rucika 4in D 193.500 per batang\nHarga Pipa Rucika 3/4in AW 37.000 per batang'));
  const [prompt] = relayPrompts(state);
  assert.match(prompt, /Riwayat percakapan terakhir/);
  assert.match(prompt, /masing2 7 batang/);
  assert.match(prompt, /JANGAN menjumlahkan/);
});

test('"jangan dijawab" tidak diteruskan; chat dipindah ke manusia dan semua pertanyaan chat itu ditutup', async (t) => {
  const { server, state, dm } = await harness(t, {
    question: 'Customer menanyakan ongkir/alamat: "Pengingat Tagihan Halo ..."',
    otherOpen: [{ id: Q2, chatId: CHAT, question: 'Hal lain apa pun', department: 'Finance' }],
  });
  await server.handleInboundMessage('co-1', dm('kalo dapet message dari nomer ini jangan dijawab'));
  assert.equal(relayPrompts(state).length, 0, 'model tidak dipanggil');
  assert.equal(state.relayed.length, 0);
  assert.equal(state.routing.length, 1);
  assert.equal(state.routing[0].mode, 'human');
  assert.deepEqual(state.closed, [Q2]);
});

test('jawaban yang hanya me-mention rekan tidak diteruskan dan pertanyaan dibuka lagi', async (t) => {
  const { server, state, dm } = await harness(t);
  await server.handleInboundMessage('co-1', dm('Yg ini beneran salah kirim barang @276213792813094'));
  assert.equal(relayPrompts(state).length, 0);
  assert.deepEqual(state.reopened, [Q1]);
});

test('CS manusia sudah membalas sejak pertanyaan dibuat: tidak dikirim otomatis', async (t) => {
  const { server, state, dm } = await harness(t, { lastHumanAt: new Date('2026-11-05T11:30:00Z') });
  await server.handleInboundMessage('co-1', dm('stok kosong, belum bisa indent'));
  assert.equal(relayPrompts(state).length, 0);
  assert.equal(state.relayed.length, 0);
  assert.match(state.supervisor[0].body, /CS sudah membalas/);
});

test('satu jawaban menutup pertanyaan terbuka lain bertopik sama, bukan yang beda topik', async (t) => {
  const { server, state, dm } = await harness(t, {
    otherOpen: [
      { id: Q2, chatId: CHAT, question: 'Customer menanyakan harga paralon 4" dan paralon 3/4" (tidak ada di daftar harga POS).', department: 'Management' },
      { id: Q3, chatId: CHAT, question: 'Customer pesan 4 lembar gypsum anti air, mohon konfirmasi harga per lembar.', department: 'Management' },
    ],
  });
  await server.handleInboundMessage('co-1', dm('Harga Pipa Rucika 4in D 193.500 per batang\nHarga Pipa Rucika 3/4in AW 37.000 per batang'));
  assert.deepEqual(state.closed, [Q2]);
});

test('helper: pertanyaan parafrase dianggap satu topik; barang berbeda tidak', () => {
  const a = 'Customer menanyakan harga paralon 4" dan paralon 3/4" (tidak ada di daftar harga POS, dicari dengan nama tersebut). Mohon konfirmasi harga per batang/satuan untuk kedua ukuran, dan merek yang tersedia.';
  const b = 'Customer minta harga paralon Rucika 4 inch dan 3/4 inch, masing-masing 7 batang, tidak ada di daftar harga DealPOS; mohon konfirmasi harga per batang kedua ukuran tersebut. Lokasi kirim belum diketahui.';
  const c = 'Customer menanyakan harga/produk: "berapa harga cat mowilex emulsion 5 kg warna putih?". AI tidak punya datanya dan tidak mau menebak; mohon dipastikan jawabannya. (Sinyal: Menyebut harga yang tak ada sumbernya.)';
  const d = 'Customer menanyakan harga/produk: "berapa harga gypsum anti air 9mm untuk 4 lembar?". AI tidak punya datanya dan tidak mau menebak; mohon dipastikan jawabannya. (Sinyal: Menyebut harga yang tak ada sumbernya.)';
  assert.equal(departmentAsk.sameTopic(a, b), true);
  assert.equal(departmentAsk.sameTopic(c, d), false);
  assert.equal(departmentAsk.sameTopic(a, d), false);
});

test('helper: angka rupiah dan jawaban yang bukan untuk customer', () => {
  assert.deepEqual(departmentAsk.foreignAmounts('Rp 193.500 dan Rp 37rb, total Rp 1.508.500', 'D 193.500, AW 37.000'), [1508500]);
  assert.deepEqual(departmentAsk.foreignAmounts('Buka jam 08.00, 7 batang Rp 193.500', '193500'), []);
  assert.equal(departmentAsk.answerProblem('kalo dapet message dari nomer ini jangan dijawab'), 'stop_ai');
  assert.equal(departmentAsk.answerProblem('ga usah dibales'), 'stop_ai');
  assert.equal(departmentAsk.answerProblem('Udh dijawab @276213792813094 nanya lagi'), 'mention');
  assert.equal(departmentAsk.answerProblem('Stok Ready, harga 193.500 per batang'), null);
  assert.equal(departmentAsk.answerProblem('Kami tidak jual'), null);
});
