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
const NET_REPORT = 'laporan-region-jabodetabek-2026-11-11-fedcba9876543210.pdf';

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

// ---- jaringan retail: peran per chat ----------------------------------------

const SCOPES = '6281100000001=national; 0812 0000 0002=region:jabodetabek;6281200000003=store:senayan;bad;628=store:;6289=boss:x';
const NET_REGIONS = {
  regions: [
    { level: 'region', id: 'jabodetabek', stores: ['senayan', 'kelapa-gading'] },
    { level: 'region', id: 'jabar-jateng', stores: ['bandung', 'semarang'] },
    { level: 'region', id: 'jatim-bali', stores: ['surabaya', 'denpasar'] },
  ],
};
const ALL_NETWORK = ['nerva_build_network_report', 'nerva_compare_stores', 'nerva_network_overview', 'nerva_network_scopes', 'nerva_sales_mapping',
  'nerva_stock_status', 'nerva_suggest_promo', 'nerva_suggest_stock_transfer', 'nerva_top_products', 'nerva_traffic_by_hour'];

function netFetch() {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: url.replace('http://nerva:4300', ''), method: opts.method, auth: opts.headers.authorization });
    if (url.endsWith('/api/v1/network/scopes')) return { ok: true, status: 200, json: async () => NET_REGIONS };
    if (url.includes('id=atlantis')) return { ok: false, status: 400, json: async () => ({ error: 'Unknown store "atlantis". Use one of: senayan' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return { calls, fetchImpl, cfg: { apiUrl: 'http://nerva:4300', token: 'tok', companySlugs: ['beweix-digital'], allowedChats: [], chatScopes: nerva.parseChatScopes(SCOPES) } };
}
const byName = (list) => Object.fromEntries(list.map((t) => [t.name, t]));
const urls = (calls) => calls.filter((c) => !c.url.endsWith('/scopes')).map((c) => c.url);

test('parseChatScopes: store/region/national, entri salah format dibuang', () => {
  assert.deepEqual(nerva.parseChatScopes(SCOPES), [
    { chat: '6281100000001', level: 'national', id: null },
    { chat: '0812 0000 0002', level: 'region', id: 'jabodetabek' },
    { chat: '6281200000003', level: 'store', id: 'senayan' },
  ]);
  assert.deepEqual(nerva.parseChatScopes(''), []);
  assert.deepEqual(nerva.readConfig({ NERVA_CHAT_SCOPES: '6281=Store:Senayan' }).chatScopes, [{ chat: '6281', level: 'store', id: 'senayan' }]);
});

test('networkScopeFor: peran dari nomor (format apa pun, @lid lewat chatIds); company lain atau tanpa peran: null', () => {
  const { cfg } = netFetch();
  const co = { companyConfig: { slug: 'beweix-digital' } };
  assert.deepEqual(nerva.networkScopeFor(cfg, { ...co, chatId: '6281100000001@c.us' }), { level: 'national', id: null });
  assert.deepEqual(nerva.networkScopeFor(cfg, { ...co, chatId: '6281200000002@c.us' }), { level: 'region', id: 'jabodetabek' }, 'awalan 0 = 62');
  assert.deepEqual(nerva.networkScopeFor(cfg, { ...co, chatIds: ['1234@lid', '6281200000003'] }), { level: 'store', id: 'senayan' });
  assert.equal(nerva.networkScopeFor(cfg, { ...co, chatId: '6289999999999@c.us' }), null);
  assert.equal(nerva.networkScopeFor(cfg, { companyConfig: { slug: 'bzone' }, chatId: '6281100000001@c.us' }), null);
  assert.equal(nerva.networkScopeFor({ ...cfg, token: '' }, { ...co, chatId: '6281100000001@c.us' }), null);
  assert.equal(nerva.enabledFor(cfg, { ...co, chatId: '6281100000001@c.us' }), false, 'peran jaringan tidak membuka alat toko');
});

test('clampScope: toko hanya tokonya, region hanya region dan tokonya, nasional semua', () => {
  const store = { level: 'store', id: 'senayan' };
  assert.deepEqual(nerva.clampScope(store, {}), { level: 'store', id: 'senayan', clamped: false });
  assert.deepEqual(nerva.clampScope(store, { level: 'store', id: 'SENAYAN' }), { level: 'store', id: 'senayan', clamped: false });
  for (const asked of [{ level: 'store', id: 'bandung' }, { level: 'region', id: 'jabodetabek' }, { level: 'national' }, { level: 'warehouse' }]) {
    assert.deepEqual(nerva.clampScope(store, asked), { level: 'store', id: 'senayan', clamped: true }, JSON.stringify(asked));
  }
  const region = { level: 'region', id: 'jabodetabek' };
  const own = ['senayan', 'kelapa-gading'];
  assert.deepEqual(nerva.clampScope(region, {}, own), { level: 'region', id: 'jabodetabek', clamped: false });
  assert.deepEqual(nerva.clampScope(region, { level: 'store', id: 'kelapa-gading' }, own), { level: 'store', id: 'kelapa-gading', clamped: false });
  for (const asked of [{ level: 'store', id: 'bandung' }, { level: 'region', id: 'jatim-bali' }, { level: 'national' }, { level: 'warehouse' }]) {
    assert.deepEqual(nerva.clampScope(region, asked, own), { level: 'region', id: 'jabodetabek', clamped: true }, JSON.stringify(asked));
  }
  assert.deepEqual(nerva.clampScope(region, { level: 'store', id: 'senayan' }, []), { level: 'region', id: 'jabodetabek', clamped: true }, 'tanpa daftar toko: aman ke region');
  const national = { level: 'national', id: null };
  assert.deepEqual(nerva.clampScope(national, { level: 'store', id: 'denpasar' }), { level: 'store', id: 'denpasar', clamped: false });
  assert.deepEqual(nerva.clampScope(national, { level: 'warehouse' }), { level: 'warehouse', id: '', clamped: false });
});

test('alat jaringan manajer toko: 8 alat, setiap panggilan dikunci ke tokonya', async () => {
  const { calls, fetchImpl, cfg } = netFetch();
  const list = nerva.networkToolSpecs(cfg, { level: 'store', id: 'senayan' }, fetchImpl);
  assert.deepEqual(list.map((t) => t.name).sort(), ALL_NETWORK.filter((n) => !['nerva_network_scopes', 'nerva_compare_stores'].includes(n)));
  const tools = byName(list);
  assert.deepEqual(await tools.nerva_network_overview.run({}), { ok: true });
  const wide = await tools.nerva_sales_mapping.run({ level: 'national', by: 'brand', period: '28d' });
  assert.match(wide.scopeNote, /hanya boleh melihat toko senayan/);
  await tools.nerva_stock_status.run({ level: 'warehouse', filter: 'out' });
  await tools.nerva_top_products.run({ level: 'store', id: 'denpasar', limit: 99, period: 'year' });
  await tools.nerva_build_network_report.run({ level: 'region', id: 'jatim-bali' });
  assert.deepEqual(urls(calls), [
    '/api/v1/network/overview?level=store&id=senayan',
    '/api/v1/network/sales?level=store&id=senayan&by=brand&period=28d',
    '/api/v1/network/stock?level=store&id=senayan&filter=out',
    '/api/v1/network/products?level=store&id=senayan&limit=20',
    '/api/v1/network/report?level=store&id=senayan',
  ]);
  assert.equal(calls.at(-1).method, 'POST');
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
});

test('alat jaringan manajer region: toko di regionnya boleh (id dari /scopes), di luar itu dikunci ke region', async () => {
  const { calls, fetchImpl, cfg } = netFetch();
  const tools = byName(nerva.networkToolSpecs(cfg, { level: 'region', id: 'jabodetabek' }, fetchImpl));
  assert.deepEqual(Object.keys(tools).sort(), ALL_NETWORK);
  assert.equal((await tools.nerva_network_overview.run({ level: 'store', id: 'kelapa-gading' })).scopeNote, undefined);
  assert.match((await tools.nerva_compare_stores.run({ level: 'national' })).scopeNote, /region jabodetabek/);
  await tools.nerva_suggest_stock_transfer.run({ level: 'store', id: 'bandung' });
  await tools.nerva_stock_status.run({ level: 'warehouse' });
  await tools.nerva_traffic_by_hour.run({ period: '7d' });
  assert.deepEqual(urls(calls), [
    '/api/v1/network/overview?level=store&id=kelapa-gading',
    '/api/v1/network/compare?level=region&id=jabodetabek',
    '/api/v1/network/suggestions/transfers?level=region&id=jabodetabek',
    '/api/v1/network/stock?level=region&id=jabodetabek',
    '/api/v1/network/traffic?level=region&id=jabodetabek&period=7d',
  ]);
  assert.equal(calls.filter((c) => c.url.endsWith('/scopes')).length, 1, 'daftar toko region diambil sekali');
});

test('alat jaringan manajer nasional: semua scope, gudang, dan pesan 400 NERVA diteruskan', async () => {
  const { calls, fetchImpl, cfg } = netFetch();
  const tools = byName(nerva.networkToolSpecs(cfg, { level: 'national', id: null }, fetchImpl));
  assert.deepEqual(Object.keys(tools).sort(), ALL_NETWORK);
  await tools.nerva_network_scopes.run();
  await tools.nerva_network_overview.run({});
  await tools.nerva_stock_status.run({ level: 'warehouse', id: 'x' });
  await tools.nerva_suggest_promo.run({ level: 'region', id: 'jatim-bali' });
  await tools.nerva_network_overview.run({ level: 'warehouse' });
  const bad = await tools.nerva_network_overview.run({ level: 'store', id: 'atlantis' });
  assert.match(bad.error, /NERVA menolak permintaan: Unknown store "atlantis"/);
  assert.deepEqual(calls.map((c) => c.url), [
    '/api/v1/network/scopes',
    '/api/v1/network/overview',
    '/api/v1/network/stock?level=warehouse',
    '/api/v1/network/suggestions/promos?level=region&id=jatim-bali',
    '/api/v1/network/overview',
    '/api/v1/network/overview?level=store&id=atlantis',
  ]);
});

test('forChat dan panduan: alat toko dan jaringan masing-masing dengan gerbangnya', () => {
  const { cfg } = netFetch();
  const co = { companyConfig: { slug: 'beweix-digital' } };
  const owner = nerva.forChat({ ...cfg, allowedChats: ['6281100000001'] }, { ...co, chatId: '6281100000001@c.us' });
  assert.ok(owner.tools.some((t) => t.name === 'nerva_store_overview') && owner.tools.some((t) => t.name === 'nerva_network_overview'));
  assert.match(owner.guide, /## NERVA \(data operasional/);
  assert.match(owner.guide, /## NERVA Retail/);
  const storeMgr = nerva.forChat(cfg, { ...co, chatId: '6281200000003@c.us' });
  assert.ok(!storeMgr.tools.some((t) => t.name === 'nerva_store_overview'));
  assert.match(storeMgr.guide, /manajer toko senayan/);
  assert.match(storeMgr.guide, /DATA DUMMY/);
  assert.match(storeMgr.guide, /USULAN/);
  assert.match(storeMgr.guide, /whatsappMessage apa adanya/);
  assert.doesNotMatch(storeMgr.guide, /## NERVA \(data operasional/);
  assert.deepEqual(nerva.forChat(cfg, { ...co, chatId: '6289999999999@c.us' }), { role: null, tools: [], guide: '' });
});

test('REPORT_NAME: laporan toko, region, dan nasional dengan 16 hex; lainnya ditolak', () => {
  const hex = '0123456789abcdef';
  for (const ok of [REPORT, `laporan-toko-kelapa-gading-2026-11-11-${hex}.pdf`, `laporan-region-jabodetabek-2026-11-11-${hex}.pdf`, `laporan-nasional-jaringan-2026-11-11-${hex}.pdf`]) {
    assert.ok(nerva.REPORT_NAME.test(ok), ok);
  }
  for (const bad of [`laporan-gudang-bekasi-dc-2026-11-11-${hex}.pdf`, 'laporan-region-jabodetabek-2026-11-11.pdf', `laporan-region-../x-2026-11-11-${hex}.pdf`,
    `laporan-region-Jabodetabek-2026-11-11-${hex}.pdf`, `laporan-nasional-jaringan-2026-11-11-${hex.toUpperCase()}.pdf`]) {
    assert.ok(!nerva.REPORT_NAME.test(bad), bad);
  }
});

// ---- jalur pesan masuk dan tautan laporan -----------------------------------

async function setup(t, { slug = 'beweix-digital' } = {}) {
  const fake = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer nerva-test-token' && !req.url.startsWith('/reports/')) { res.statusCode = 401; return res.end('{}'); }
    if (req.method === 'POST' && req.url === '/api/v1/store/report') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ fileName: REPORT, url: `https://app.agnee.test/nerva/reports/${REPORT}`, whatsappMessage: 'Laporan toko hari ini sudah siap.' }));
    }
    if (req.method === 'POST' && req.url === '/api/v1/network/report?level=region&id=jabodetabek') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ fileName: NET_REPORT, url: `https://app.agnee.test/nerva/reports/${NET_REPORT}`, whatsappMessage: 'Laporan region (data dummy).' }));
    }
    if (req.url === `/reports/${REPORT}` || req.url === `/reports/${NET_REPORT}`) { res.setHeader('content-type', 'application/pdf'); return res.end('%PDF-1.4 test'); }
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
    NERVA_CHAT_SCOPES: '6281300000002=region:jabodetabek',
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

test('manajer region mendapat alat jaringan (bukan alat toko) dan laporannya dikunci ke regionnya', async (t) => {
  const { server, prompts } = await setup(t);
  await server.handleInboundMessage('co-1', inbound('6281300000002@c.us', 'Laporan region hari ini'), { connectionId: 'conn-1' });
  const p = prompts.at(-1);
  assert.ok(toolNames(p).includes('nerva_build_network_report'), toolNames(p).join(','));
  assert.ok(!toolNames(p).includes('nerva_store_overview'));
  assert.match(p.systemPrompt, /## NERVA Retail/);
  assert.match(p.systemPrompt, /manajer region jabodetabek/);
  const report = await p.tools.find((x) => x.name === 'nerva_build_network_report').run({ level: 'national' });
  assert.equal(report.fileName, NET_REPORT);
  assert.match(report.scopeNote, /region jabodetabek/);
});

test('tautan laporan: diteruskan dari NERVA tanpa login; nama yang tidak sah ditolak', async (t) => {
  const { server } = await setup(t);
  for (const name of [REPORT, NET_REPORT]) {
    const ok = await server.inject({ method: 'GET', url: `/nerva/reports/${name}` });
    assert.equal(ok.statusCode, 200, name);
    assert.equal(ok.headers['content-type'], 'application/pdf');
    assert.match(ok.body, /^%PDF-/);
  }
  for (const bad of ['laporan-toko-senayan-2026-11-11.pdf', '..%2F..%2Fetc%2Fpasswd', `laporan-toko-senayan-2026-11-11-${'f'.repeat(16)}.pdf`]) {
    const res = await server.inject({ method: 'GET', url: `/nerva/reports/${bad}` });
    assert.equal(res.statusCode, 404, bad);
  }
});
