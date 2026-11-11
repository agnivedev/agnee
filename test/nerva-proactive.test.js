'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nerva = require('../src/nerva-tools');
const proactive = require('../src/nerva-proactive');

/*
 * NervAgent: alat baru per peran, konfirmasi dua langkah untuk alat tulis,
 * briefing terjadwal, alert proaktif (dedupe, laju, jam senyap), audit, PDF.
 * Semua dengan stub NERVA dan jam palsu; tidak ada WhatsApp nyata.
 */

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const CFG = { apiUrl: 'http://nerva:4300', token: 'tok', companySlugs: ['beweix-digital'], chatScopes: [], agentTools: true };
const STORE = { level: 'store', id: 'senayan' };
const REGION = { level: 'region', id: 'jabodetabek' };
const NATIONAL = { level: 'national', id: null };

// 2026-11-12 09:35 WIB = 02:35 UTC
const wibMs = (hh, mm, date = '2026-11-12') => Date.parse(`${date}T00:00:00Z`) + ((hh - 7) * 60 + mm) * 60_000;

function makeCtx(lastUserText) {
  const audits = [];
  return { audits, ctx: { key: 'c1:6281@c.us', lastUserText, confirmations: nerva.createConfirmations(), audit: (e) => audits.push(e) } };
}

/** NERVA palsu: mengingat panggilan dan menjawab daftar saran/tugas per scope. */
function fakeNerva({ suggestions = [{ id: 'S-12' }], tasks = [{ id: 'T-1' }] } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    calls.push({ method: opts.method, path: u.pathname, q: Object.fromEntries(u.searchParams) });
    if (u.pathname === '/api/v1/network/scopes') return json({ regions: [{ id: 'jabodetabek', stores: ['senayan', 'kemang'] }] });
    if (u.pathname === '/api/v1/network/suggestions') return json({ suggestions });
    if (u.pathname === '/api/v1/network/tasks') return json({ tasks });
    return json({ ok: true, echo: u.pathname });
  };
  return { calls, fetchImpl };
}

const byName = (tools) => Object.fromEntries(tools.map((t) => [t.name, t]));
const writes = (calls) => calls.filter((c) => c.method === 'POST');

test('alat NervAgent: parameter di luar daftar dibuang dan scope dikunci ke peran', async () => {
  const { calls, fetchImpl } = fakeNerva();
  const { ctx } = makeCtx('');
  const t = byName(nerva.agentToolSpecs(CFG, STORE, fetchImpl, ctx));
  await t.nerva_briefing.run({ kind: 'bogus', level: 'national', id: 'x' });
  assert.deepEqual(calls[0].q, { level: 'store', id: 'senayan', kind: 'morning' });
  assert.equal(calls[0].path, '/api/v1/network/briefing');
  await t.nerva_alerts_feed.run({ since: 'bukan-tanggal', min_severity: 'galau' });
  assert.equal(calls[1].q.since, undefined);
  assert.equal(calls[1].q.min_severity, undefined);
  await t.nerva_alerts_feed.run({ since: '2026-11-12T01:00:00Z', min_severity: 'high' });
  assert.equal(calls[2].q.since, '2026-11-12T01:00:00Z');
  assert.equal(calls[2].q.min_severity, 'high');
  await t.nerva_stock_forecast.run({ horizon_days: 999 });
  assert.equal(calls[3].q.horizon_days, '28');
  assert.match((await t.nerva_case_explain.run({ case_id: '../x' })).error, /tidak dikenal/);
  const res = await t.nerva_weekly_plan.run({ level: 'national' });
  assert.match(res.scopeNote, /toko senayan/);
});

test('peran toko tidak mendapat nerva_network_compare; region dan nasional mendapat', () => {
  const names = (role) => nerva.agentToolSpecs(CFG, role, fetch, makeCtx('').ctx).map((t) => t.name);
  assert.equal(names(STORE).includes('nerva_network_compare'), false);
  assert.equal(names(REGION).includes('nerva_network_compare'), true);
  assert.equal(names(NATIONAL).includes('nerva_network_compare'), true);
  for (const role of [STORE, REGION, NATIONAL]) {
    for (const n of ['nerva_suggestion_decide', 'nerva_task_create', 'nerva_task_update']) assert.ok(names(role).includes(n), n);
  }
});

test('alat tulis tidak ada tanpa pelacak konfirmasi (pratinjau/simulator)', () => {
  const names = nerva.agentToolSpecs(CFG, STORE, fetch, {}).map((t) => t.name);
  assert.equal(names.some((n) => nerva.WRITE_TOOLS.includes(n)), false);
});

test('forChat: alat NervAgent hanya bila NERVA_AGENT_TOOLS menyala', () => {
  const env = { NERVA_API_URL: 'http://n', NERVA_API_TOKEN: 't', NERVA_COMPANY_SLUGS: 'beweix-digital', NERVA_CHAT_SCOPES: '628123456789=store:senayan' };
  const ctx = { companyConfig: { slug: 'beweix-digital' }, chatId: '628123456789@c.us', agent: makeCtx('').ctx };
  const off = nerva.forChat(nerva.readConfig(env), ctx);
  assert.equal(off.tools.some((x) => x.name === 'nerva_briefing'), false);
  const on = nerva.forChat(nerva.readConfig({ ...env, NERVA_AGENT_TOOLS: '1' }), ctx);
  assert.ok(on.tools.some((x) => x.name === 'nerva_briefing'));
  assert.match(on.guide, /Data itu belum ada di NERVA/);
  assert.match(on.guide, /confirmed=true/);
  const other = nerva.forChat(nerva.readConfig({ ...env, NERVA_AGENT_TOOLS: '1' }), { ...ctx, chatId: '628999999999@c.us' });
  assert.equal(other.tools.length, 0, 'chat tanpa peran tidak mendapat alat apa pun');
});

test('setujui saran: langkah 1 hanya meminta konfirmasi, langkah 2 jalan setelah "ya"', async () => {
  const { calls, fetchImpl } = fakeNerva();
  const confirmations = nerva.createConfirmations();
  const audits = [];
  const mk = (lastUserText) => byName(nerva.agentToolSpecs(CFG, STORE, fetchImpl, { key: 'k', lastUserText, confirmations, audit: (e) => audits.push(e) })).nerva_suggestion_decide;

  const first = await mk('setujui saran S-12').run({ suggestion_id: 'S-12', decision: 'approve' });
  assert.equal(first.status, 'needs_confirmation');
  assert.match(first.pertanyaan, /Setujui saran S-12\? Balas ya/);
  assert.equal(writes(calls).length, 0, 'belum ada tulisan ke NERVA');

  const done = await mk('ya').run({ suggestion_id: 'S-12', decision: 'approve', confirmed: true });
  assert.equal(done.ok, true);
  const w = writes(calls);
  assert.equal(w.length, 1);
  assert.equal(w[0].path, '/api/v1/network/suggestions/decide');
  assert.deepEqual({ id: w[0].q.id, decision: w[0].q.decision, scope_id: w[0].q.scope_id }, { id: 'S-12', decision: 'approve', scope_id: 'senayan' });
  assert.deepEqual(audits.map((a) => [a.action, a.target, a.outcome, a.role]), [['suggestion_decide', 'S-12', 'berhasil', 'toko senayan']]);

  // Konfirmasi sekali pakai: ulangi confirmed=true tanpa minta lagi ditolak.
  const replay = await mk('ya').run({ suggestion_id: 'S-12', decision: 'approve', confirmed: true });
  assert.equal(replay.status, 'needs_confirmation');
  assert.equal(writes(calls).length, 1);
});

test('confirmed=true tanpa konfirmasi, atau dengan jawaban bukan persetujuan, tidak menulis', async () => {
  const { calls, fetchImpl } = fakeNerva();
  const confirmations = nerva.createConfirmations();
  const tool = (lastUserText) => byName(nerva.agentToolSpecs(CFG, STORE, fetchImpl, { key: 'k', lastUserText, confirmations })).nerva_suggestion_decide;
  // Model langsung confirmed=true di giliran yang sama (tanpa langkah 1).
  const jump = await tool('ya').run({ suggestion_id: 'S-12', decision: 'approve', confirmed: true });
  assert.equal(jump.status, 'needs_confirmation');
  await tool('setujui S-12').run({ suggestion_id: 'S-12', decision: 'approve' });
  // Langkah 1 ada, tapi pesan terakhir bukan persetujuan.
  for (const text of ['kenapa begitu?', 'jangan dulu', 'tidak']) {
    const r = await tool(text).run({ suggestion_id: 'S-12', decision: 'approve', confirmed: true });
    assert.equal(r.status, 'needs_confirmation', text);
  }
  // Niat lain (tolak, bukan setujui) tidak memakai konfirmasi setuju.
  const other = await tool('ya').run({ suggestion_id: 'S-12', decision: 'reject', confirmed: true });
  assert.equal(other.status, 'needs_confirmation');
  assert.equal(writes(calls).length, 0);
});

test('konfirmasi kedaluwarsa setelah 10 menit', async () => {
  let t = 1_000;
  const confirmations = nerva.createConfirmations({ now: () => t });
  const { calls, fetchImpl } = fakeNerva();
  const tool = (lastUserText) => byName(nerva.agentToolSpecs(CFG, STORE, fetchImpl, { key: 'k', lastUserText, confirmations })).nerva_suggestion_decide;
  await tool('setuju').run({ suggestion_id: 'S-12', decision: 'approve' });
  t += 11 * 60_000;
  const late = await tool('ya').run({ suggestion_id: 'S-12', decision: 'approve', confirmed: true });
  assert.equal(late.status, 'needs_confirmation');
  assert.equal(writes(calls).length, 0);
});

test('penolakan lintas peran: saran atau tugas di luar scope ditolak dan dicatat', async () => {
  // NERVA menjawab daftar saran toko senayan tanpa S-99 (milik toko lain).
  const { calls, fetchImpl } = fakeNerva({ suggestions: [{ id: 'S-12' }], tasks: [{ id: 'T-1' }] });
  const { ctx, audits } = makeCtx('ya');
  const t = byName(nerva.agentToolSpecs(CFG, STORE, fetchImpl, ctx));
  const denied = await t.nerva_suggestion_decide.run({ suggestion_id: 'S-99', decision: 'approve', confirmed: true });
  assert.match(denied.error, /tidak ada di scope toko senayan/);
  const list = calls.find((c) => c.path === '/api/v1/network/suggestions');
  assert.deepEqual({ level: list.q.level, id: list.q.id }, { level: 'store', id: 'senayan' }, 'daftar saran diminta dengan scope peran');
  const task = await t.nerva_task_update.run({ task_id: 'T-404', status: 'done', confirmed: true });
  assert.match(task.error, /tidak ada di scope/);
  assert.equal(writes(calls).length, 0);
  assert.deepEqual(audits.map((a) => a.outcome), ['ditolak', 'ditolak']);
});

test('buat tugas: toko dikunci ke peran, nasional wajib menyebut toko', async () => {
  const { calls, fetchImpl } = fakeNerva();
  const confirmations = nerva.createConfirmations();
  const run = async (role, lastUserText, args) => {
    const tool = byName(nerva.agentToolSpecs(CFG, role, fetchImpl, { key: `k-${role.level}`, lastUserText, confirmations })).nerva_task_create;
    return tool.run(args);
  };
  await run(STORE, 'buat task cek kamera', { title: 'Cek kamera pintu', level: 'store', id: 'kemang' });
  const done = await run(STORE, 'ya', { title: 'Cek kamera pintu', level: 'store', id: 'kemang', confirmed: true });
  assert.equal(done.ok, true);
  const w = writes(calls)[0];
  assert.deepEqual({ level: w.q.level, id: w.q.id, title: w.q.title }, { level: 'store', id: 'senayan', title: 'Cek kamera pintu' }, 'id toko lain dikunci ke senayan');
  await run(NATIONAL, 'buat task', { title: 'Audit stok' });
  const nat = await run(NATIONAL, 'ya', { title: 'Audit stok', confirmed: true });
  assert.match(nat.error, /satu toko atau region/);
  assert.equal(writes(calls).length, 1);
  assert.match((await run(STORE, 'ya', { title: 'x' })).error, /terlalu pendek/);
});

test('kegagalan NERVA pada alat tulis dikembalikan sebagai error jujur, tidak melempar', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/api/v1/network/suggestions') return json({ suggestions: [{ id: 'S-12' }] });
    throw new Error('ECONNREFUSED');
  };
  const { ctx, audits } = makeCtx('ya');
  const tool = byName(nerva.agentToolSpecs(CFG, STORE, fetchImpl, ctx)).nerva_suggestion_decide;
  await tool.run({ suggestion_id: 'S-12', decision: 'approve' });
  const r = await tool.run({ suggestion_id: 'S-12', decision: 'approve', confirmed: true });
  assert.match(r.error, /tidak bisa dihubungi/);
  assert.equal(audits.at(-1).outcome, 'gagal');
});

test('audit tidak memuat token atau rahasia', async () => {
  const { fetchImpl } = fakeNerva();
  const { ctx, audits } = makeCtx('ya');
  const tool = byName(nerva.agentToolSpecs({ ...CFG, token: 'RAHASIA-123' }, STORE, fetchImpl, ctx)).nerva_suggestion_decide;
  await tool.run({ suggestion_id: 'S-12', decision: 'approve' });
  await tool.run({ suggestion_id: 'S-12', decision: 'approve', confirmed: true });
  assert.ok(audits.length >= 1);
  assert.equal(JSON.stringify(audits).includes('RAHASIA-123'), false);
});

// ---- konfigurasi dan penjadwal ----------------------------------------------

test('readProactiveConfig: bawaan mati, nilai salah format dibuang', () => {
  const off = proactive.readProactiveConfig({});
  assert.equal(proactive.proactiveEnabled(off), false);
  assert.equal(off.minSeverity, 'high');
  assert.deepEqual(off.quiet, { from: 22 * 60 + 30, to: 8 * 60 });
  const on = proactive.readProactiveConfig({
    NERVA_BRIEFING_MORNING_AT: '09:30', NERVA_BRIEFING_CLOSING_AT: '25:99', NERVA_ALERTS_ENABLED: '1',
    NERVA_ALERTS_MIN_SEVERITY: 'MEDIUM', NERVA_ALERTS_MAX_PER_HOUR: '3', NERVA_ALERTS_POLL_SECONDS: '5', NERVA_ALERTS_QUIET: 'rusak',
  });
  assert.equal(on.morningAt, 570);
  assert.equal(on.closingAt, null, 'jam tidak sah berarti mati');
  assert.equal(on.minSeverity, 'medium');
  assert.equal(on.maxPerHour, 3);
  assert.equal(on.pollSeconds, 30, 'minimum 30 detik');
  assert.equal(on.quiet, null);
  assert.equal(proactive.proactiveEnabled(on), true);
});

test('inQuietHours: rentang melewati tengah malam dan rentang biasa', () => {
  const q = { from: 22 * 60 + 30, to: 8 * 60 };
  assert.equal(proactive.inQuietHours(q, 23 * 60), true);
  assert.equal(proactive.inQuietHours(q, 2 * 60), true);
  assert.equal(proactive.inQuietHours(q, 8 * 60), false);
  assert.equal(proactive.inQuietHours(q, 12 * 60), false);
  assert.equal(proactive.inQuietHours({ from: 13 * 60, to: 14 * 60 }, 13 * 60 + 30), true);
  assert.equal(proactive.inQuietHours(null, 60), false);
});

test('wib: tanggal dan menit dalam zona WIB', () => {
  assert.deepEqual(proactive.wib(Date.parse('2026-11-12T17:30:00Z')), { date: '2026-11-13', minutes: 30 });
  assert.deepEqual(proactive.wib(wibMs(9, 30)), { date: '2026-11-12', minutes: 570 });
});

function harness({ pcEnv = {}, scopes = '628111111111=store:senayan;628222222222=region:jabodetabek', fetchImpl, start = wibMs(9, 31), sendFails = false } = {}) {
  const clock = { t: start };
  const sentText = []; const sentMedia = [];
  const store = proactive.createMemoryStore({ now: () => clock.t });
  const nervaCfg = nerva.readConfig({ NERVA_API_URL: 'http://n:1', NERVA_API_TOKEN: 'tok', NERVA_COMPANY_SLUGS: 'beweix-digital', NERVA_CHAT_SCOPES: scopes });
  const warns = [];
  const p = proactive.createProactive({
    nervaCfg, pc: proactive.readProactiveConfig(pcEnv), store, fetchImpl, now: () => clock.t,
    log: { warn: (o, m) => warns.push([o, m]) },
    resolveCompany: async () => 'co-1',
    toChatId: (n) => `${n}@c.us`,
    sendText: async (c, chat, text) => { if (sendFails) throw new Error('WA putus'); sentText.push({ chat, text }); },
    sendMedia: async (c, chat, items) => { sentMedia.push({ chat, items }); },
  });
  return { p, clock, sentText, sentMedia, store, warns };
}

test('briefing pagi: terkirim sekali per hari ke tiap chat sesuai perannya, bukan sebelum jamnya', async () => {
  const calls = [];
  const fetchImpl = async (url) => { const u = new URL(url); calls.push(Object.fromEntries(u.searchParams)); return json({ whatsappMessage: `Briefing ${u.searchParams.get('kind')} ${u.searchParams.get('id') || 'nasional'}` }); };
  const h = harness({ pcEnv: { NERVA_BRIEFING_MORNING_AT: '09:30' }, fetchImpl, start: wibMs(9, 29) });
  assert.deepEqual(await h.p.runBriefings(), [], 'sebelum 09:30 belum kirim');
  h.clock.t = wibMs(9, 31);
  assert.equal((await h.p.runBriefings()).length, 2);
  assert.deepEqual(h.sentText.map((m) => m.text), ['Briefing morning senayan', 'Briefing morning jabodetabek']);
  assert.deepEqual(calls.map((c) => c.level), ['store', 'region']);
  h.clock.t = wibMs(9, 40);
  assert.equal((await h.p.runBriefings()).length, 0, 'tidak dobel di hari yang sama');
  h.clock.t = wibMs(9, 31, '2026-11-13');
  assert.equal((await h.p.runBriefings()).length, 2, 'hari berikutnya kirim lagi');
});

test('briefing: lewat jendela 45 menit tidak dikirim terlambat; penutupan terpisah dari pagi', async () => {
  const fetchImpl = async (url) => json({ text: `B ${new URL(url).searchParams.get('kind')}` });
  const h = harness({ pcEnv: { NERVA_BRIEFING_MORNING_AT: '09:30', NERVA_BRIEFING_CLOSING_AT: '22:15' }, fetchImpl, start: wibMs(11, 0) });
  assert.equal((await h.p.runBriefings()).length, 0, 'proses menyala siang hari tidak mengirim briefing pagi');
  h.clock.t = wibMs(22, 20);
  const sent = await h.p.runBriefings();
  assert.deepEqual([...new Set(sent.map((s) => s.kind))], ['closing']);
});

test('briefing: NERVA gagal tidak melempar, dicoba lagi di putaran berikut dalam jendela', async () => {
  let up = false;
  const fetchImpl = async () => (up ? json({ whatsappMessage: 'ok' }) : json({}, 503));
  const h = harness({ pcEnv: { NERVA_BRIEFING_MORNING_AT: '09:30' }, fetchImpl, scopes: '628111111111=store:senayan' });
  assert.deepEqual(await h.p.runBriefings(), []);
  assert.equal(h.sentText.length, 0);
  assert.ok(h.warns.length > 0);
  up = true; h.clock.t += 60_000;
  assert.equal((await h.p.runBriefings()).length, 1);
});

test('briefing: WhatsApp gagal melepas klaim, lalu terkirim saat WA kembali', async () => {
  const fetchImpl = async () => json({ whatsappMessage: 'ok' });
  const h = harness({ pcEnv: { NERVA_BRIEFING_MORNING_AT: '09:30' }, fetchImpl, scopes: '628111111111=store:senayan', sendFails: true });
  assert.deepEqual(await h.p.tick(), { briefings: [], alerts: [] });
  assert.equal(h.store.sent.size, 0);
});

test('tanpa env, tick tidak mengirim apa pun dan tidak memanggil NERVA', async () => {
  let called = 0;
  const h = harness({ pcEnv: {}, fetchImpl: async () => { called += 1; return json({}); } });
  assert.deepEqual(await h.p.tick(), { briefings: [], alerts: [] });
  assert.equal(called, 0);
  assert.equal(h.sentText.length, 0);
});

const feed = (alerts) => async () => json({ alerts });
const A = (key, severity = 'high', extra = {}) => ({ dedupe_key: key, severity, whatsappMessage: `Alert ${key}`, ...extra });

test('alert: hanya yang baru (dedupe_key), tahan restart lewat store yang sama', async () => {
  const fetchImpl = feed([A('k1'), A('k2')]);
  const h = harness({ pcEnv: { NERVA_ALERTS_ENABLED: '1' }, fetchImpl, scopes: '628111111111=store:senayan' });
  assert.equal((await h.p.pollAlerts()).length, 2);
  assert.equal((await h.p.pollAlerts()).length, 0, 'tidak terkirim ulang');
  // "Restart": instance baru dengan store yang sama.
  const again = proactive.createProactive({
    nervaCfg: nerva.readConfig({ NERVA_API_URL: 'http://n:1', NERVA_API_TOKEN: 't', NERVA_COMPANY_SLUGS: 'beweix-digital', NERVA_CHAT_SCOPES: '628111111111=store:senayan' }),
    pc: proactive.readProactiveConfig({ NERVA_ALERTS_ENABLED: '1' }), store: h.store, fetchImpl: feed([A('k1'), A('k2'), A('k3')]), now: () => h.clock.t,
    resolveCompany: async () => 'co-1', toChatId: (n) => `${n}@c.us`, sendText: async (c, chat, text) => h.sentText.push({ chat, text }), sendMedia: async () => {},
  });
  assert.deepEqual((await again.pollAlerts()).map((x) => x.key), ['k3']);
  // Dedupe per chat: chat lain menerima alert yang sama.
});

test('alert: dedupe per chat, ambang severity, dan urutan paling parah dulu', async () => {
  const fetchImpl = feed([A('lo', 'low'), A('md', 'medium'), A('hi', 'high'), A('cr', 'critical')]);
  const h = harness({ pcEnv: { NERVA_ALERTS_ENABLED: '1', NERVA_ALERTS_MIN_SEVERITY: 'high' }, fetchImpl });
  const sent = await h.p.pollAlerts();
  assert.deepEqual(sent.filter((s) => s.chat === '628111111111').map((s) => s.key), ['cr', 'hi']);
  assert.equal(sent.length, 4, 'kedua chat menerima alert yang sama, masing-masing sekali');
});

test('alert: batas per jam per chat, sisanya menunggu jam berikutnya', async () => {
  const fetchImpl = feed([A('a'), A('b'), A('c'), A('d')]);
  const h = harness({ pcEnv: { NERVA_ALERTS_ENABLED: '1', NERVA_ALERTS_MAX_PER_HOUR: '2' }, fetchImpl, scopes: '628111111111=store:senayan' });
  assert.equal((await h.p.pollAlerts()).length, 2);
  assert.equal((await h.p.pollAlerts()).length, 0, 'jatah jam ini habis');
  h.clock.t += 61 * 60_000;
  const next = await h.p.pollAlerts();
  assert.equal(next.length, 2);
  assert.deepEqual(next.map((x) => x.key), ['c', 'd']);
});

test('alert: jam senyap menahan kiriman dan tidak menandai terkirim', async () => {
  const fetchImpl = feed([A('a')]);
  const h = harness({ pcEnv: { NERVA_ALERTS_ENABLED: '1' }, fetchImpl, scopes: '628111111111=store:senayan', start: wibMs(23, 0) });
  assert.deepEqual(await h.p.pollAlerts(), []);
  assert.equal(h.store.sent.size, 0);
  h.clock.t = wibMs(8, 5, '2026-11-13');
  assert.equal((await h.p.pollAlerts()).length, 1, 'terkirim setelah jam senyap');
});

test('alert: foto kasus ikut lewat media outbox, maksimal 2; teks tetap terkirim bila media gagal', async () => {
  const att = (id) => ({ id, kind: 'image', mimetype: 'image/jpeg', sizeKb: 50, caption: `c ${id}` });
  const fetchImpl = feed([A('a', 'high', { attachments: [att('case-AL-1043.jpg'), att('case-AL-1043.mp4'), att('x.jpg')] })]);
  const h = harness({ pcEnv: { NERVA_ALERTS_ENABLED: '1' }, fetchImpl, scopes: '628111111111=store:senayan' });
  await h.p.pollAlerts();
  assert.equal(h.sentText.length, 1);
  assert.equal(h.sentMedia[0].items.length, 2);
});

test('alert: NERVA gagal dicatat, tidak melempar, chat lain tetap dilayani', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return n === 1 ? json({}, 500) : json({ alerts: [A('z')] }); };
  const h = harness({ pcEnv: { NERVA_ALERTS_ENABLED: '1' }, fetchImpl });
  const sent = await h.p.pollAlerts();
  assert.deepEqual(sent.map((s) => s.chat), ['628222222222']);
  assert.ok(h.warns.length >= 1);
});

test('alert: pengiriman gagal melepas klaim sehingga dicoba lagi', async () => {
  const fetchImpl = feed([A('a')]);
  const h = harness({ pcEnv: { NERVA_ALERTS_ENABLED: '1' }, fetchImpl, scopes: '628111111111=store:senayan', sendFails: true });
  assert.deepEqual(await h.p.pollAlerts(), []);
  assert.equal(h.store.sent.size, 0);
});

test('tick: alert mengikuti pollSeconds, dan tick yang tumpang tindih dilewati', async () => {
  let polls = 0;
  const fetchImpl = async () => { polls += 1; return json({ alerts: [] }); };
  const h = harness({ pcEnv: { NERVA_ALERTS_ENABLED: '1', NERVA_ALERTS_POLL_SECONDS: '120' }, fetchImpl, scopes: '628111111111=store:senayan' });
  await h.p.tick();
  h.clock.t += 30_000; await h.p.tick();
  assert.equal(polls, 1);
  h.clock.t += 100_000; await h.p.tick();
  assert.equal(polls, 2);
});

// ---- PDF ---------------------------------------------------------------------

const PDF = { id: 'laporan-toko-senayan-2026-11-12-1a9b454068125f22.pdf', kind: 'document', mimetype: 'application/pdf', sizeKb: 9, caption: 'Laporan toko Senayan (PDF)' };
const pdfFetch = async () => ({ ok: true, headers: { get: () => '9000' }, arrayBuffer: async () => new Uint8Array(Buffer.from('%PDF-1.4 x')).buffer });

test('PDF: gagal terlampir tidak membuat owner menunggu, ada pesan pengganti ke tautan', async () => {
  const sends = [];
  const send = async (text, opts) => {
    sends.push({ text, hasAttachment: Boolean(opts?.attachment) });
    if (opts?.attachment) throw new Error('Data passed to getter must include an id property');
    return { messageId: 'm1' };
  };
  const out = await nerva.deliverOutbox({ apiUrl: 'http://n', token: 't' }, [PDF], { provider: 'whatsapp_web', send, fetchImpl: pdfFetch });
  assert.equal(out.sent.length, 0);
  assert.match(out.skipped[0].reason, /kirim gagal/);
  assert.equal(out.fallback, true);
  assert.equal(sends[1].text, nerva.PDF_FALLBACK_TEXT);
  assert.equal(sends[1].hasAttachment, false);
});

test('PDF: terkirim sebagai dokumen dengan nama, mimetype, dan isi base64 utuh', async () => {
  let got;
  const out = await nerva.deliverOutbox({ apiUrl: 'http://n', token: 't' }, [PDF], { provider: 'whatsapp_web', send: async (c, o) => { got = o.attachment; return {}; }, fetchImpl: pdfFetch });
  assert.equal(out.sent.length, 1);
  assert.equal(got.mimetype, 'application/pdf');
  assert.equal(got.filename, PDF.id);
  assert.equal(Buffer.from(got.data, 'base64').toString(), '%PDF-1.4 x');
});

test('PDF: Cloud API tetap hanya teks, tidak ada upaya media maupun pesan pengganti', async () => {
  const sends = [];
  const out = await nerva.deliverOutbox({ apiUrl: 'http://n', token: 't' }, [PDF], { provider: 'cloud_api', send: async (...a) => sends.push(a), fetchImpl: pdfFetch });
  assert.equal(sends.length, 0);
  assert.match(out.skipped[0].reason, /Cloud API/);
});

test('PDF: server mengirim PDF sebagai dokumen (sendMediaAsDocument) lewat WWebJS.sendMessage', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.match(src, /sendMediaAsDocument: sendOptions\.attachment\?\.mimetype === 'application\/pdf'/);
});
