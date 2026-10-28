'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { judgeReply, isSameReply, usefulSuggestion } = require('../src/reply-style.js');

const REPLY = 'Halo kak, saya Agnes dari ESBEJE. Sedang cari bahan bangunan apa?';

function fakeLlm(payload) {
  return { enabled: true, async generateReply() { return { text: JSON.stringify(payload), model: 'tiruan' }; } };
}
const judge = (payload, reply = REPLY) => judgeReply(fakeLlm(payload), {
  customerMessage: 'Hai', reply, context: '## PLAYBOOK', transcript: [], companyId: 'c1',
});

test('isSameReply mengabaikan huruf besar/kecil, tanda baca, dan spasi', () => {
  assert.equal(isSameReply('Halo kak, saya Agnes!', 'halo kak saya   agnes'), true);
  assert.equal(isSameReply('Halo kak', 'Halo kak, ada yang bisa dibantu?'), false);
  assert.equal(isSameReply('', ''), false);
});

test('usefulSuggestion: sama dengan balasan dibuang, beda dipertahankan', () => {
  const scores = { accuracy: 3, helpfulness: 3, funnel: 3, tone: 3 };
  assert.equal(usefulSuggestion({ suggestedReply: REPLY, reply: REPLY, verdict: 'revise', scores }), '');
  assert.equal(usefulSuggestion({ suggestedReply: 'Halo kak, cari bahan apa?', reply: REPLY, verdict: 'revise', scores }), 'Halo kak, cari bahan apa?');
});

test('usefulSuggestion: lulus dengan semua nilai penuh tidak perlu saran, lulus dengan nilai kurang tetap boleh', () => {
  const alt = 'Halo kak, cari bahan bangunan apa?';
  const perfect = { accuracy: 5, helpfulness: 5, funnel: 5, tone: 5 };
  const almost = { accuracy: 5, helpfulness: 5, funnel: 4, tone: 5 };
  assert.equal(usefulSuggestion({ suggestedReply: alt, reply: REPLY, verdict: 'pass', scores: perfect }), '');
  assert.equal(usefulSuggestion({ suggestedReply: alt, reply: REPLY, verdict: 'pass', scores: almost }), alt);
  assert.equal(usefulSuggestion({ suggestedReply: alt, reply: REPLY, verdict: 'revise', scores: perfect }), alt);
});

test('judgeReply: kasus dari Uji AI (lulus 5/5, saran = balasan) tidak lagi memunculkan saran', async () => {
  const result = await judge({
    scores: { accuracy: 5, helpfulness: 5, funnel: 5, tone: 5 }, verdict: 'pass',
    strengths: ['Memperkenalkan diri'], issues: [], suggestedReply: REPLY, missingInfo: [],
  });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.suggestedReply, '');
});

test('judgeReply: balasan yang memang perlu diperbaiki tetap mendapat saran', async () => {
  const result = await judge({
    scores: { accuracy: 1, helpfulness: 1, funnel: 1, tone: 2 }, verdict: 'revise',
    strengths: [], issues: ['tidak menjawab'], suggestedReply: 'Bisa COD kak, boleh share alamatnya?', missingInfo: [],
  }, 'Halo, ada yang bisa saya bantu?');
  assert.equal(result.suggestedReply, 'Bisa COD kak, boleh share alamatnya?');
});
