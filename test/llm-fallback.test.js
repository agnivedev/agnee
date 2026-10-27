'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LlmService = require('../src/llm-service');

/*
 * Jawaban cadangan tanpa alat. Ditemukan lewat uji dengan model sungguhan:
 * Gemini memblokir permintaan beralat (PROHIBITED_CONTENT), cadangan tanpa
 * alat lalu menulis `cek_alamat("...")` sebagai teks ke customer.
 */

function fakeOpenRouter(t, replies) {
  const original = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const next = replies.shift();
    if (next instanceof Error) return { ok: false, statusText: next.message, json: async () => ({ error: { message: next.message } }) };
    return { ok: true, json: async () => next };
  };
  t.after(() => { global.fetch = original; });
  return requests;
}

const answer = (text) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0 } });
const BLOCKED = new Error('Gemini blocked the request: PROHIBITED_CONTENT');
const tools = [{ name: 'cek_alamat', description: 'cek', parameters: { type: 'object' }, run: async () => ({}) }];
const ask = (llm) => llm.generateReply('Cilandak', { systemPrompt: 'PROMPT ASLI', tools });

test('cadangan tanpa alat membawa catatan: jangan tulis pemanggilan alat, jangan mengarang data', async (t) => {
  const requests = fakeOpenRouter(t, [BLOCKED, answer('Baik kak, nanti tim kami cek ya.')]);
  const result = await ask(new LlmService({ apiKey: 'k', model: 'test/m' }));
  assert.equal(result.text, 'Baik kak, nanti tim kami cek ya.');
  assert.equal(requests[1].tools, undefined);
  const system = requests[1].messages[0].content;
  assert.ok(system.startsWith('PROMPT ASLI'), 'prompt asli tetap di depan');
  assert.match(system, /CATATAN SISTEM/);
  assert.match(system, /tim akan mengeceknya/);
  assert.doesNotMatch(requests[0].messages[0].content, /CATATAN SISTEM/, 'percobaan beralat tidak diberi catatan');
});

test('cadangan yang tetap menulis pemanggilan alat dibuang, bukan dikirim ke customer', async (t) => {
  fakeOpenRouter(t, [BLOCKED, answer('cek_alamat("Cilandak")')]);
  const warn = console.warn; console.warn = () => {}; const err = console.error; console.error = () => {};
  t.after(() => { console.warn = warn; console.error = err; });
  assert.equal(await ask(new LlmService({ apiKey: 'k', model: 'test/m' })), null);
});

test('bentuk bocor lain: nama alat berkurung, di awal baris, atau penanda tool_call', async (t) => {
  const warn = console.warn; console.warn = () => {}; const err = console.error; console.error = () => {};
  t.after(() => { console.warn = warn; console.error = err; });
  for (const leak of ['cek_alamat: Cilandak', 'Oke.\ncek_alamat("Cilandak")', '<tool_call>{"name":"cek_alamat"}</tool_call>', 'tool_code\nprint(cek_alamat("x"))', '```json\n{"name": "cek_alamat"}\n```']) {
    fakeOpenRouter(t, [BLOCKED, answer(leak)]);
    assert.equal(await ask(new LlmService({ apiKey: 'k', model: 'test/m' })), null, leak);
  }
});

test('balasan biasa yang menyebut kata alamat tidak ikut dibuang', async (t) => {
  fakeOpenRouter(t, [BLOCKED, answer('Alamatnya sudah saya catat kak, nanti tim cek ongkirnya.')]);
  const result = await ask(new LlmService({ apiKey: 'k', model: 'test/m' }));
  assert.match(result.text, /Alamatnya sudah saya catat/);
});

test('rantai model: model kedua yang bersih dipakai kalau yang pertama membocorkan alat', async (t) => {
  fakeOpenRouter(t, [BLOCKED, BLOCKED, answer('cek_alamat("x")'), answer('Siap kak, tim kami cek ya.')]);
  const warn = console.warn; console.warn = () => {};
  t.after(() => { console.warn = warn; });
  const llm = new LlmService({ apiKey: 'k', model: 'a/m', modelChain: ['a/m', 'b/m'] });
  const result = await ask(llm);
  assert.equal(result.text, 'Siap kak, tim kami cek ya.');
  assert.equal(result.model, 'b/m');
});

test('tanpa alat sama sekali: permintaan tidak diberi catatan cadangan', async (t) => {
  const requests = fakeOpenRouter(t, [answer('Halo kak')]);
  await new LlmService({ apiKey: 'k', model: 'test/m' }).generateReply('Halo', { systemPrompt: 'PROMPT ASLI' });
  assert.equal(requests[0].messages[0].content, 'PROMPT ASLI');
});
