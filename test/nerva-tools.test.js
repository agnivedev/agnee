'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const nerva = require('../src/nerva-tools');
const { buildApp } = require('../src/server');

/*
 * NERVA: data toko untuk owner uji di satu company. Alat hanya muncul untuk
 * company + nomor yang terdaftar di env; customer lain tidak pernah melihatnya.
 */

const REPORT = 'laporan-toko-senayan-2026-11-11-0123456789abcdef.pdf';

test('chatAllowed: nomor dalam format apa pun, chatId persis, dan angka pendek ditolak', () => {
  const allowed = ['+62 812-3456-7890', '120363000000@g.us', '12'];
  assert.equal(nerva.chatAllowed(allowed, '6281234567890@c.us'), true);
  assert.equal(nerva.chatAllowed(allowed, '120363000000@g.us'), true);
  assert.equal(nerva.chatAllowed(allowed, '6289999999@c.us'), false);
  assert.equal(nerva.chatAllowed(allowed, '12@c.us'), false, 'entri kurang dari 6 digit tidak dipakai');
  assert.equal(nerva.chatAllowed(allowed, null), false);
  assert.equal(nerva.chatAllowed(['082123422800'], '6282123422800@c.us'), true, 'awalan 0 sama dengan 62');
  assert.equal(nerva.chatAllowed(['6282123422800'], '082123422800'), true);
});

test('enabledFor: butuh URL, token, slug company, dan chat yang terdaftar', () => {
  const env = { NERVA_API_URL: 'http://nerva:4300/', NERVA_API_TOKEN: 't', NERVA_COMPANY_SLUGS: 'beweix-digital', NERVA_ALLOWED_CHATS: '6281234567890' };
  const cfg = nerva.readConfig(env);
  assert.equal(cfg.apiUrl, 'http://nerva:4300');
  const ok = { companyConfig: { slug: 'beweix-digital' }, chatId: '6281234567890@c.us' };
  assert.equal(nerva.enabledFor(cfg, ok), true);
  assert.equal(nerva.enabledFor(cfg, { ...ok, chatId: '6280000000@c.us' }), false);
  assert.equal(nerva.enabledFor(cfg, { ...ok, companyConfig: { slug: 'bzone' } }), false);
  assert.equal(nerva.enabledFor(nerva.readConfig({ ...env, NERVA_API_TOKEN: '' }), ok), false);
  assert.equal(nerva.enabledFor(nerva.readConfig({}), ok), false);
});

test('alat memanggil API NERVA dengan token; error jadi pesan jujur, bukan exception', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, auth: opts.headers.authorization });
    if (url.includes('/devices')) return { ok: false, status: 503, json: async () => ({}) };
    if (url.includes('/approvals')) throw new Error('ECONNREFUSED');
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const cfg = { apiUrl: 'http://nerva:4300', token: 'tok', companySlugs: [], allowedChats: [] };
  const tools = Object.fromEntries(nerva.toolSpecs(cfg, fetchImpl).map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(tools).sort(), ['nerva_build_store_report', 'nerva_device_health', 'nerva_list_cases', 'nerva_pending_approvals', 'nerva_store_overview']);
  assert.deepEqual(await tools.nerva_store_overview.run(), { ok: true });
  await tools.nerva_list_cases.run({ department: 'Security', state: 'all' });
  await tools.nerva_list_cases.run({ department: '../x', state: 'bogus' });
  await tools.nerva_build_store_report.run();
  assert.match((await tools.nerva_device_health.run({ onlyProblems: true })).error, /HTTP 503/);
  assert.match((await tools.nerva_pending_approvals.run()).error, /tidak bisa dihubungi/);
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
  assert.equal(calls[1].url, 'http://nerva:4300/api/v1/store/cases?department=Security&state=all');
  assert.equal(calls[2].url, 'http://nerva:4300/api/v1/store/cases?state=open', 'nilai di luar daftar dibuang');
  assert.equal(calls[3].method, 'POST');
  assert.equal(calls[4].url, 'http://nerva:4300/api/v1/store/devices?problems=1');
});

// ---- jalur pesan masuk dan tautan laporan -----------------------------------

async function setup(t, { slug = 'beweix-digital' } = {}) {
  const fake = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer nerva-test-token' && !req.url.startsWith('/reports/')) { res.statusCode = 401; return res.end('{}'); }
    if (req.method === 'POST' && req.url === '/api/v1/store/report') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ fileName: REPORT, url: `https://app.agnee.test/nerva/reports/${REPORT}`, whatsappMessage: 'Laporan toko hari ini sudah siap.' }));
    }
    if (req.url === `/reports/${REPORT}`) { res.setHeader('content-type', 'application/pdf'); return res.end('%PDF-1.4 test'); }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  t.after(() => fake.close());
  const saved = { ...process.env };
  Object.assign(process.env, {
    NERVA_API_URL: `http://127.0.0.1:${fake.address().port}`,
    NERVA_API_TOKEN: 'nerva-test-token',
    NERVA_COMPANY_SLUGS: 'beweix-digital',
    NERVA_ALLOWED_CHATS: '6281234567890',
  });
  t.after(() => { for (const k of Object.keys(process.env)) if (k.startsWith('NERVA_') && !(k in saved)) delete process.env[k]; });

  const prompts = [];
  const database = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async getActiveSessionUser() { return null; },
    async setPresence() {}, async setLastCompany() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', slug, knowledgeClient: 'bzone', aiMessageLimit: 0, aiMessageCount: 0 }; },
    async getPlaybookContext() { return 'Jasa iklan.'; },
    async listWhatsappConnections() { return [{ id: 'conn-1', connectionKey: 'whatsapp-main', label: 'Utama', phoneNumber: null, isActive: true, agentMode: 'standard' }]; },
    async getAgentModeInstructions() { return {}; },
    async listDepartments() { return []; },
    async incrementAiMessageCount() { return { exceeded: false, count: 1, limit: 0 }; },
    async recordOutboundReply() { return true; },
    async getFollowUpSettings() { return { enabled: false }; },
    async recordInboundMessage() { return true; },
    async markFollowUpReplied() {}, async stopFollowUpSequence() {}, async upsertContactName() {},
    async phoneForLid(_c, id) { return id === '99887766554433@lid' ? '6281234567890' : null; },
  };
  const llmService = {
    enabled: true,
    async generateReply(text, opts) { prompts.push({ text, ...opts }); return { text: 'Laporan toko hari ini sudah siap.', model: 'x' }; },
    async generateJson() { return null; },
  };
  const server = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, llmService, llmEnabled: true, openrouterApiKey: 'k', sessionSecret: 'nerva-session' });
  t.after(() => server.close());
  return { server, prompts };
}

function inbound(from, body = 'Buatkan laporan toko hari ini') {
  return { from, body, type: 'chat', timestamp: 1, id: { _serialized: `m-${from}-${body}` }, async reply() {} };
}
const toolNames = (p) => (p.tools || []).map((x) => x.name);

test('owner uji di company terdaftar mendapat alat NERVA dan panduannya; alatnya benar-benar memanggil NERVA', async (t) => {
  const { server, prompts } = await setup(t);
  await server.handleInboundMessage('co-1', inbound('6281234567890@c.us'), { connectionId: 'conn-1' });
  assert.ok(prompts.length >= 1, 'AI dipanggil');
  const p = prompts.at(-1);
  assert.ok(toolNames(p).includes('nerva_build_store_report'), toolNames(p).join(','));
  assert.match(p.systemPrompt, /## NERVA/);
  const report = await p.tools.find((x) => x.name === 'nerva_build_store_report').run({});
  assert.equal(report.fileName, REPORT);
  assert.match(report.url, /\/nerva\/reports\//);
});

test('chat @lid milik owner dikenali lewat peta @lid; @lid lain tidak', async (t) => {
  const { server, prompts } = await setup(t);
  await server.handleInboundMessage('co-1', inbound('99887766554433@lid'), { connectionId: 'conn-1' });
  assert.ok(toolNames(prompts.at(-1)).includes('nerva_store_overview'), toolNames(prompts.at(-1)).join(','));
  await server.handleInboundMessage('co-1', inbound('11112222333344@lid', 'Halo'), { connectionId: 'conn-1' });
  assert.ok(!toolNames(prompts.at(-1)).some((n) => n.startsWith('nerva_')));
});

test('customer lain di nomor yang sama, atau company lain, tidak mendapat alat NERVA', async (t) => {
  const { server, prompts } = await setup(t);
  await server.handleInboundMessage('co-1', inbound('6289900011122@c.us'), { connectionId: 'conn-1' });
  assert.ok(prompts.length >= 1);
  assert.ok(!toolNames(prompts.at(-1)).some((n) => n.startsWith('nerva_')));
  assert.doesNotMatch(prompts.at(-1).systemPrompt, /## NERVA/);

  const other = await setup(t, { slug: 'bzone' });
  await other.server.handleInboundMessage('co-1', inbound('6281234567890@c.us'), { connectionId: 'conn-1' });
  assert.ok(!toolNames(other.prompts.at(-1)).some((n) => n.startsWith('nerva_')));
});

test('tautan laporan: diteruskan dari NERVA tanpa login; nama yang tidak sah ditolak', async (t) => {
  const { server } = await setup(t);
  const ok = await server.inject({ method: 'GET', url: `/nerva/reports/${REPORT}` });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'application/pdf');
  assert.match(ok.body, /^%PDF-/);
  for (const bad of ['laporan-toko-senayan-2026-11-11.pdf', '..%2F..%2Fetc%2Fpasswd', `laporan-toko-senayan-2026-11-11-${'f'.repeat(16)}.pdf`]) {
    const res = await server.inject({ method: 'GET', url: `/nerva/reports/${bad}` });
    assert.equal(res.statusCode, 404, bad);
  }
});
