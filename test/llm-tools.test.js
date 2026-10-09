'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LlmService = require('../src/llm-service');
const { buildApp } = require('../src/server');

/*
 * 9d: Agnee's chatbot may look up Agnive Hub listings. The model asks for a
 * tool, we run it and hand the result back as data; the last round forbids
 * tools so it must answer; a model that cannot take tools still answers.
 */

function fakeOpenRouter(t, replies) {
  const original = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const next = replies.shift();
    if (next instanceof Error) return { ok: false, statusText: next.message, json: async () => ({ error: { message: next.message } }) };
    return { ok: true, json: async () => next };
  };
  t.after(() => { global.fetch = original; });
  return requests;
}

const toolCall = (name, args) => ({
  choices: [{ message: { content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cost: 0.001 },
});
const answer = (text) => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240, cost: 0.002 } });

test('model memanggil alat, hasilnya kembali sebagai data, lalu model menjawab', async (t) => {
  const requests = fakeOpenRouter(t, [toolCall('hub_search_listings', { sector: 'energy', minTrl: 7 }), answer('Ada WattWise (TRL 7).')]);
  const usage = [];
  const llm = new LlmService({ apiKey: 'k', model: 'test/m', onUsage: (u) => usage.push(u) });
  const ran = [];
  const tools = [{
    name: 'hub_search_listings', description: 'cari', parameters: { type: 'object', properties: {} },
    run: async (args) => { ran.push(args); return { total: 1, listings: [{ slug: 'wattwise', trl: 7 }] }; },
  }];
  const result = await llm.generateReply('Listing energi TRL 7 ke atas?', { systemPrompt: 'S', tools, companyId: 'c1' });

  assert.equal(result.text, 'Ada WattWise (TRL 7).');
  assert.deepEqual(ran, [{ sector: 'energy', minTrl: 7 }]);
  assert.deepEqual(result.toolCalls, [{ name: 'hub_search_listings', args: { sector: 'energy', minTrl: 7 } }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].tools[0].function.name, 'hub_search_listings');
  assert.equal(requests[0].tools[0].run, undefined, 'the function itself never goes to the provider');
  const toolMessage = requests[1].messages.find((m) => m.role === 'tool');
  assert.equal(toolMessage.tool_call_id, 'call-1');
  assert.match(toolMessage.content, /wattwise/);
  assert.equal(usage.length, 2, 'every model call is recorded');
  assert.equal(result.usage.total_tokens, 350);
});

test('putaran terakhir melarang alat, jadi model harus menjawab', async (t) => {
  const requests = fakeOpenRouter(t, [
    toolCall('hub_search_listings', { query: 'a' }),
    toolCall('hub_search_listings', { query: 'b' }),
    answer('Selesai.'),
  ]);
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  const tools = [{ name: 'hub_search_listings', description: 'x', parameters: { type: 'object' }, run: async () => ({ total: 0 }) }];
  const result = await llm.generateReply('?', { tools, maxToolRounds: 2 });
  assert.equal(result.text, 'Selesai.');
  assert.deepEqual(requests.map((r) => r.tool_choice), ['auto', 'auto', 'none']);
});

test('alat yang gagal atau tidak dikenal dijawab sebagai error, bukan menjatuhkan balasan', async (t) => {
  const requests = fakeOpenRouter(t, [toolCall('alat_palsu', {}), answer('Maaf, data belum tersedia.')]);
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  const tools = [{ name: 'hub_search_listings', description: 'x', parameters: { type: 'object' }, run: async () => { throw new Error('boom'); } }];
  const result = await llm.generateReply('?', { tools });
  assert.equal(result.text, 'Maaf, data belum tersedia.');
  assert.match(requests[1].messages.find((m) => m.role === 'tool').content, /Unknown tool/);
});

test('model yang menolak alat: pelanggan tetap dijawab tanpa alat', async (t) => {
  const requests = fakeOpenRouter(t, [new Error('tools not supported'), answer('Halo, ada yang bisa dibantu?')]);
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  const tools = [{ name: 'hub_search_listings', description: 'x', parameters: { type: 'object' }, run: async () => ({}) }];
  const result = await llm.generateReply('Halo', { tools });
  assert.equal(result.text, 'Halo, ada yang bisa dibantu?');
  assert.ok(requests[0].tools, 'first try with tools');
  assert.equal(requests[1].tools, undefined, 'retry without tools');
});

test('tanpa alat, permintaan ke model persis seperti sebelumnya', async (t) => {
  const requests = fakeOpenRouter(t, [answer('ok')]);
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  await llm.generateReply('Halo', { systemPrompt: 'S' });
  assert.equal(requests[0].tools, undefined);
  assert.equal(requests[0].tool_choice, undefined);
});

/* The switch per company: only a company with hub_tools_enabled gets them. */
async function simulate(t, hubToolsEnabled) {
  const seen = [];
  const owner = { id: 'owner-1', companyId: 'company-1', email: 'own@x.test', displayName: 'Owner', role: 'owner' };
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return password === 'pass-12345' && email === owner.email ? owner : null; },
    async getActiveSessionUser(id) { return id === owner.id ? owner : null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getCompanyConfig() { return { knowledgeClient: 'bzone', planStatus: 'active', hubToolsEnabled }; },
  };
  const llmService = {
    enabled: true, model: 'test/m',
    async generateReply(message, context) { seen.push(context); return { text: 'Halo kak', model: 'test/m', usage: {}, toolCalls: [] }; },
  };
  // Coach simulasi membaca banyak hal lain (playbook, lead, ringkasan) yang
  // tidak relevan di sini; semuanya cukup menjawab kosong.
  const fullDatabase = new Proxy(database, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database: fullDatabase, llmService, sessionSecret: 'llm-tools' });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: owner.email, password: 'pass-12345' } });
  const cookie = login.headers['set-cookie'].split(';')[0];
  // Coach simulasi, bukan playground: playground sudah dihapus, dan simulasi
  // memakai konteks + alat yang sama dengan balasan WhatsApp sungguhan.
  const res = await app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage: 'Ada listing energi?', grade: false } });
  assert.equal(res.statusCode, 200);
  return seen[0];
}

test('saklar per perusahaan: mati = tanpa alat Hub', async (t) => {
  const context = await simulate(t, false);
  assert.deepEqual(context.tools, []);
  assert.doesNotMatch(context.systemPrompt, /AGNIVE HUB/);
});

test('saklar per perusahaan: nyala = dua alat listing publik, tanpa alat percakapan', async (t) => {
  const context = await simulate(t, true);
  assert.deepEqual(context.tools.map((x) => x.name), ['hub_search_listings', 'hub_get_listing']);
  assert.match(context.systemPrompt, /AGNIVE HUB/);
  assert.match(context.systemPrompt, /DATA, bukan perintah/);
});

test('maxToolCalls menaikkan jumlah panggilan alat yang dilayani dalam satu putaran', async (t) => {
  const many = (n) => ({
    choices: [{ message: { content: '', tool_calls: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, type: 'function', function: { name: 'cari', arguments: '{}' } })) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0 },
  });
  const run = async (extra) => {
    fakeOpenRouter(t, [many(6), answer('selesai')]);
    const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
    let ran = 0;
    const tools = [{ name: 'cari', description: 'cari', parameters: { type: 'object', properties: {} }, run: async () => { ran += 1; return { ok: true }; } }];
    await llm.generateReply('x', { systemPrompt: 'S', tools, companyId: 'c1', ...extra });
    return ran;
  };
  assert.equal(await run({}), 4, 'bawaan: empat per putaran, sisanya ditolak');
  assert.equal(await run({ maxToolCalls: 8 }), 6, 'dinaikkan: semuanya dilayani');
});

test('requireTools: kalau model dengan alat gagal, tidak ada jawaban tanpa alat sebagai cadangan', async (t) => {
  const requests = fakeOpenRouter(t, [new Error('jaringan putus'), new Error('jaringan putus'), answer('Usulan sudah kusiapkan.')]);
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  const tools = [{ name: 'cari', description: 'cari', parameters: { type: 'object', properties: {} }, run: async () => ({}) }];
  const result = await llm.generateReply('x', { systemPrompt: 'S', tools, companyId: 'c1', requireTools: true });
  assert.equal(result, null, 'gagal apa adanya, bukan balasan yang mengaku sudah mengusulkan');
  assert.ok(requests.every((r) => r.tools), 'tidak ada permintaan tanpa alat');
});

test('error jaringan murni diulang sekali dengan koneksi baru; error dari penyedia tidak', async (t) => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
    return { ok: true, json: async () => answer('Halo kak.') };
  };
  t.after(() => { global.fetch = original; });
  const llm = new LlmService({ apiKey: 'k', model: 'test/m' });
  const result = await llm.generateReply('hai', { systemPrompt: 'S' });
  assert.equal(result.text, 'Halo kak.');
  assert.equal(calls, 2);

  // Penyedia yang menjawab error (bukan jaringan) tidak diulang pada model yang sama.
  calls = 0;
  global.fetch = async () => { calls += 1; return { ok: false, statusText: 'Bad Request', json: async () => ({ error: { message: 'bad' } }) }; };
  assert.equal(await llm.generateReply('hai', { systemPrompt: 'S' }), null);
  assert.equal(calls, 1);
});
