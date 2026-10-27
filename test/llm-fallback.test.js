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
// Kegagalan alat yang BUKAN pemblokiran penyedia: langsung ke jawaban tanpa alat.
const TOOLS_FAIL = new Error('tools not supported');
// Bentuk asli dari OpenRouter: HTTP 200, tanpa choices, alasan di error.message.
const BLOCKED = { error: { message: 'Gemini blocked the request: PROHIBITED_CONTENT' } };
const tools = [{ name: 'cek_alamat', description: 'cek', parameters: { type: 'object' }, run: async () => ({}) }];
const ask = (llm) => llm.generateReply('Cilandak', { systemPrompt: 'PROMPT ASLI', tools });

test('cadangan tanpa alat membawa catatan: jangan tulis pemanggilan alat, jangan mengarang data', async (t) => {
  const requests = fakeOpenRouter(t, [TOOLS_FAIL, answer('Baik kak, nanti tim kami cek ya.')]);
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
  fakeOpenRouter(t, [TOOLS_FAIL, answer('cek_alamat("Cilandak")')]);
  const warn = console.warn; console.warn = () => {}; const err = console.error; console.error = () => {};
  t.after(() => { console.warn = warn; console.error = err; });
  assert.equal(await ask(new LlmService({ apiKey: 'k', model: 'test/m' })), null);
});

test('bentuk bocor lain: nama alat berkurung, di awal baris, atau penanda tool_call', async (t) => {
  const warn = console.warn; console.warn = () => {}; const err = console.error; console.error = () => {};
  t.after(() => { console.warn = warn; console.error = err; });
  for (const leak of ['cek_alamat: Cilandak', 'Oke.\ncek_alamat("Cilandak")', '<tool_call>{"name":"cek_alamat"}</tool_call>', 'tool_code\nprint(cek_alamat("x"))', '```json\n{"name": "cek_alamat"}\n```']) {
    fakeOpenRouter(t, [TOOLS_FAIL, answer(leak)]);
    assert.equal(await ask(new LlmService({ apiKey: 'k', model: 'test/m' })), null, leak);
  }
});

test('balasan biasa yang menyebut kata alamat tidak ikut dibuang', async (t) => {
  fakeOpenRouter(t, [TOOLS_FAIL, answer('Alamatnya sudah saya catat kak, nanti tim cek ongkirnya.')]);
  const result = await ask(new LlmService({ apiKey: 'k', model: 'test/m' }));
  assert.match(result.text, /Alamatnya sudah saya catat/);
});

test('rantai model: model kedua yang bersih dipakai kalau yang pertama membocorkan alat', async (t) => {
  fakeOpenRouter(t, [TOOLS_FAIL, TOOLS_FAIL, answer('cek_alamat("x")'), answer('Siap kak, tim kami cek ya.')]);
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

// ---- Pemblokiran penyedia: model cadangan DENGAN alat -----------------------

const toolCall = (name, args) => ({
  choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0 },
});

function quiet(t) {
  const warn = console.warn; const err = console.error;
  console.warn = () => {}; console.error = () => {};
  t.after(() => { console.warn = warn; console.error = err; });
}

test('diblokir penyedia: model cadangan memanggil alat yang sama dan menjawab dengan hasilnya', async (t) => {
  quiet(t);
  const requests = fakeOpenRouter(t, [BLOCKED, toolCall('cek_alamat', { alamat: 'Cilandak' }), answer('Cilandak ketemu kak, nama jalannya apa ya?')]);
  const ran = [];
  const withRun = [{ ...tools[0], run: async (args) => { ran.push(args); return { status: 'ketemu_area' }; } }];
  const llm = new LlmService({ apiKey: 'k', model: 'google/gemini-2.5-flash' });
  const result = await llm.generateReply('Cilandak', { systemPrompt: 'PROMPT ASLI', tools: withRun });

  assert.equal(result.text, 'Cilandak ketemu kak, nama jalannya apa ya?');
  assert.equal(result.model, 'openai/gpt-4o-mini');
  assert.deepEqual(ran, [{ alamat: 'Cilandak' }]);
  assert.equal(requests[0].model, 'google/gemini-2.5-flash');
  assert.equal(requests[1].model, 'openai/gpt-4o-mini');
  assert.ok(requests[1].tools, 'cadangan membawa alat');
  assert.doesNotMatch(requests[1].messages[0].content, /CATATAN SISTEM/, 'jalur beralat tidak diberi catatan tanpa-alat');
});

test('tidak diblokir: tetap di model bawaan, tidak pindah', async (t) => {
  const requests = fakeOpenRouter(t, [answer('Halo kak')]);
  const llm = new LlmService({ apiKey: 'k', model: 'google/gemini-2.5-flash' });
  const result = await llm.generateReply('Halo', { systemPrompt: 'P', tools });
  assert.equal(result.model, 'google/gemini-2.5-flash');
  assert.equal(requests.length, 1);
});

test('kegagalan biasa (bukan blokir) tidak memicu model cadangan beralat', async (t) => {
  const requests = fakeOpenRouter(t, [TOOLS_FAIL, answer('Baik kak, tim kami cek ya.')]);
  const llm = new LlmService({ apiKey: 'k', model: 'google/gemini-2.5-flash' });
  const result = await llm.generateReply('Halo', { systemPrompt: 'P', tools });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].tools, undefined, 'langsung jawaban tanpa alat');
  assert.equal(result.model, 'google/gemini-2.5-flash');
});

test('blokir juga datang sebagai HTTP error: cadangan beralat tetap dicoba', async (t) => {
  quiet(t);
  const requests = fakeOpenRouter(t, [new Error('Gemini blocked the request: PROHIBITED_CONTENT'), answer('Siap kak.')]);
  const llm = new LlmService({ apiKey: 'k', model: 'google/gemini-2.5-flash' });
  const result = await llm.generateReply('Halo', { systemPrompt: 'P', tools });
  assert.equal(result.model, 'openai/gpt-4o-mini');
  assert.ok(requests[1].tools);
});

test('cadangan pertama gagal: cadangan kedua dicoba; semua gagal: jawaban tanpa alat dengan catatan', async (t) => {
  quiet(t);
  const requests = fakeOpenRouter(t, [BLOCKED, TOOLS_FAIL, TOOLS_FAIL, answer('Baik kak, tim kami cek ya.')]);
  const llm = new LlmService({ apiKey: 'k', model: 'google/gemini-2.5-flash' });
  const result = await llm.generateReply('Halo', { systemPrompt: 'P', tools });
  assert.deepEqual(requests.slice(0, 3).map((r) => r.model), ['google/gemini-2.5-flash', 'openai/gpt-4o-mini', 'deepseek/deepseek-chat-v3.1']);
  assert.equal(requests[3].tools, undefined);
  assert.match(requests[3].messages[0].content, /CATATAN SISTEM/);
  assert.equal(result.text, 'Baik kak, tim kami cek ya.');
});

test('model cadangan yang sudah ada di rantai company tidak dicoba dua kali', async (t) => {
  quiet(t);
  const requests = fakeOpenRouter(t, [BLOCKED, answer('Siap kak.')]);
  const llm = new LlmService({ apiKey: 'k', model: 'a/m', toolFallbackModels: ['a/m', 'b/m'] });
  const result = await llm.generateReply('Halo', { systemPrompt: 'P', tools });
  assert.deepEqual(requests.map((r) => r.model), ['a/m', 'b/m']);
  assert.equal(result.model, 'b/m');
});

test('tanpa alat: tidak ada pindah model walau diblokir', async (t) => {
  quiet(t);
  const requests = fakeOpenRouter(t, [BLOCKED]);
  const llm = new LlmService({ apiKey: 'k', model: 'google/gemini-2.5-flash' });
  assert.equal(await llm.generateReply('Halo', { systemPrompt: 'P' }), null);
  assert.equal(requests.length, 1);
});
