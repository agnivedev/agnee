'use strict';

/**
 * Jalur chat sungguhan: customer memilih barang, AI menyebut rekening saat
 * closing, lalu customer mengirim foto bukti transfer. Model penglihat
 * dipalsukan; yang diuji adalah sambungannya (saklar, penilaian di server,
 * catatan untuk AI, penyimpanan, notifikasi staf, tanpa kata "lunas").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const sup = { id: '11111111-1111-4111-8111-111111111111', userId: '11111111-1111-4111-8111-111111111111', companyId: 'co-1', email: 'sup@t.test', displayName: 'Sup', role: 'owner', status: 'active' };
const BCA = { id: '1', bankName: 'BCA', accountNumber: '172 172 6989', accountHolder: 'PT Karya Warna Kemenangan', status: 'active' };
const OLD = { id: '2', bankName: 'Mandiri', accountNumber: '1230009876543', accountHolder: 'PT Karya Warna Kemenangan', status: 'retired' };
const JPEG = Buffer.from('fake-jpeg-bytes').toString('base64');
const today = () => new Date().toISOString().slice(0, 10);

async function setup(t, { enabled = true, accounts = [BCA, OLD], reading = {} } = {}) {
  const state = { prompts: [], proofs: [], vision: 0, events: [] };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser() { return sup; },
    async getActiveSessionUser() { return { ...sup, isPlatformAdmin: false }; },
    async setPresence() {}, async setLastCompany() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() {
      return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone', aiMessageLimit: 0, aiMessageCount: 0, paymentMethod: 'none', paymentProofCheck: enabled, aiReadMedia: false };
    },
    async getPlaybookContext() { return ''; },
    async listPaymentAccounts() { return accounts; },
    async findDuplicatePaymentProof(_c, { sha256 }) { return state.proofs.find((p) => p.sha === sha256) ? { id: 'dup' } : null; },
    async recordPaymentProof(_c, p) {
      if (state.proofs.some((x) => x.waMessageId === p.waMessageId)) return null;
      const row = { id: String(state.proofs.length + 1), sha: p.imageSha256, ...p };
      state.proofs.push(row);
      return row;
    },
    async incrementAiMessageCount() { return { exceeded: false, count: 1, limit: 0 }; },
    async recordOutboundReply() { return true; },
    async getFollowUpSettings() { return { enabled: false }; },
    async recordInboundMessage() { return true; },
    async markFollowUpReplied() {}, async stopFollowUpSequence() {}, async upsertContactName() {},
    async listWhatsappConnections() { return []; },
    async getHandoffNotifyNumbers() { return []; },
    async getReplyDelaySettings() { return { replyDelayEnabled: false }; },
  };
  const llmService = {
    enabled: true,
    async generateReply(text, opts) { state.prompts.push({ text, ...opts }); return { text: 'Bukti sudah kami terima, tim kami cek dulu ya Kak.', model: 'x' }; },
    async generateJson() { return null; },
    async describeImage() {
      state.vision += 1;
      return JSON.stringify({
        isTransferProof: true, status: 'success', amount: 1500000, date: today(), time: '09:30',
        recipientName: 'PT KARYA WARNA KEMENANGAN', recipientBank: 'BCA', recipientAccount: '1721726989',
        senderName: 'BUDI', referenceNo: 'REF1', looksEdited: false, notes: '', ...reading,
      });
    },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'proof-chat' });
  t.after(() => server.close());
  return { server, state };
}

function photo(from, id, { body = '' } = {}) {
  const sent = [];
  return {
    sent,
    message: {
      from, body, type: 'image', hasMedia: true, timestamp: 1, id: { _serialized: id },
      async downloadMedia() { return { mimetype: 'image/jpeg', data: JPEG }; },
      async reply(text) { sent.push(text); },
    },
  };
}

test('foto bukti transfer: dibaca, dinilai, disimpan, dan AI menerima catatan pemeriksaan', async (t) => {
  const { server, state } = await setup(t);
  const p = photo('62811@c.us', 'img-1');
  await server.handleInboundMessage('co-1', p.message, {});
  assert.equal(state.vision, 1);
  assert.equal(state.proofs.length, 1);
  assert.equal(state.proofs[0].verdict, 'perlu_dicek', 'total belum diketahui -> staf yang memutuskan');
  assert.ok(state.proofs[0].flags.includes('total_tak_diketahui'));
  const prompt = state.prompts.at(-1);
  assert.match(prompt.text, /\[Customer mengirim foto bukti transfer\]/);
  assert.match(prompt.text, /Pemeriksaan bukti transfer/);
  assert.match(prompt.systemPrompt, /WAJIB sebutkan rekening/);
  assert.match(prompt.systemPrompt, /172 172 6989/);
  assert.doesNotMatch(prompt.systemPrompt, /1230009876543/, 'rekening lama tidak pernah sampai ke AI');
});

test('transfer ke rekening lama ditandai tidak cocok', async (t) => {
  const { server, state } = await setup(t, { reading: { recipientAccount: '1230009876543' } });
  await server.handleInboundMessage('co-1', photo('62812@c.us', 'img-2').message, {});
  assert.equal(state.proofs[0].verdict, 'tidak_cocok');
  assert.deepEqual(state.proofs[0].flags.includes('rekening_lama'), true);
  assert.match(state.prompts.at(-1).text, /REKENING LAMA/);
});

test('saklar mati: foto tidak dikirim ke model penglihat dan tidak ada yang tercatat', async (t) => {
  const { server, state } = await setup(t, { enabled: false });
  await server.handleInboundMessage('co-1', photo('62813@c.us', 'img-3').message, {});
  assert.equal(state.vision, 0);
  assert.equal(state.proofs.length, 0);
});

test('tanpa rekening aktif tidak ada yang bisa dicocokkan: foto tidak diperiksa', async (t) => {
  const { server, state } = await setup(t, { accounts: [OLD] });
  await server.handleInboundMessage('co-1', photo('62814@c.us', 'img-4').message, {});
  assert.equal(state.vision, 0);
});

test('foto yang bukan bukti transfer diproses seperti sebelumnya', async (t) => {
  const { server, state } = await setup(t, { reading: { isTransferProof: false } });
  await server.handleInboundMessage('co-1', photo('62815@c.us', 'img-5').message, {});
  assert.equal(state.vision, 1);
  assert.equal(state.proofs.length, 0);
  assert.equal(state.prompts.length, 0, 'foto tanpa teks tetap tidak memicu AI (perilaku lama)');
});

test('foto yang sama dikirim lagi ditandai dipakai ulang', async (t) => {
  const { server, state } = await setup(t);
  await server.handleInboundMessage('co-1', photo('62816@c.us', 'img-6').message, {});
  await server.handleInboundMessage('co-1', photo('62817@c.us', 'img-7').message, {});
  assert.equal(state.proofs.length, 2);
  assert.equal(state.proofs[1].verdict, 'tidak_cocok');
  assert.ok(state.proofs[1].flags.includes('bukti_dipakai_ulang'));
});

test('kegagalan model penglihat tidak menjatuhkan pesan', async (t) => {
  const { server, state } = await setup(t);
  server.llmService = null;
  state.vision = 0;
  const p = photo('62818@c.us', 'img-8');
  p.message.downloadMedia = async () => { throw new Error('media hilang'); };
  await server.handleInboundMessage('co-1', p.message, {});
  assert.equal(state.proofs.length, 0);
});
