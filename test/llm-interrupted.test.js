'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LlmService = require('../src/llm-service');

function fakeOpenRouter(t, replies) {
  const original = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => replies.shift() };
  };
  t.after(() => { global.fetch = original; });
  return requests;
}

const reply = (content, finish_reason = 'stop') => ({
  choices: [{ message: { content }, finish_reason }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

test('balasan setengah jadi dari gangguan penyedia diulang sekali pada model yang sama', async (t) => {
  const requests = fakeOpenRouter(t, [reply('Kakak bisa coba paket yang ditangani sampai selesai tanpa meng', 'error'), reply('Halo kak, ada yang bisa dibantu?')]);
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  const result = await llm.generateReply('halo', {});
  assert.equal(result.text, 'Halo kak, ada yang bisa dibantu?');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, requests[1].model);
});

test('gangguan yang berulang tidak pernah mengirim potongan kalimat', async (t) => {
  const requests = fakeOpenRouter(t, [reply('Kakak bisa coba pa', 'error'), reply('Kakak bisa coba pa', 'error')]);
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  assert.equal(await llm.generateReply('halo', {}), null);
  assert.equal(requests.length, 2);
});

test('balasan yang terpotong batas token pindah ke model berikutnya, tanpa ulang', async (t) => {
  const requests = fakeOpenRouter(t, [reply('Paket Lengkap seharga Rp 2.500', 'length'), reply('Paket Lengkap seharga Rp 2.500.000.')]);
  const llm = new LlmService({ apiKey: 'k', model: 'a/m', modelChain: ['a/m', 'b/m'] });
  const result = await llm.generateReply('harga?', {});
  assert.equal(result.text, 'Paket Lengkap seharga Rp 2.500.000.');
  assert.deepEqual(requests.map((r) => r.model), ['a/m', 'b/m']);
});

test('jendela riwayat bawaan lima pesan, dan bisa dinaikkan pemanggil', async (t) => {
  const history = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `p${i}` }));
  const requests = fakeOpenRouter(t, [reply('ok'), reply('ok'), reply('ok')]);
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  const countHistory = (r) => r.messages.filter((m) => /^p\d+$/.test(m.content)).length;
  await llm.generateReply('x', { history });
  await llm.generateReply('x', { history, historyLimit: 12 });
  await llm.generateReply('x', { history, historyLimit: 999 });
  assert.deepEqual(requests.map(countHistory), [5, 12, 14]);
});
