'use strict';

/**
 * Rute impor Lead List dan laporan performa: otorisasi (supervisor saja, juga
 * lewat kunci layanan MCP), alur pratinjau -> simpan, dan batas ukuran.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const SUP = { id: 'sup-1', userId: 'sup-1', companyId: 'company-1', email: 'owner@example.com', displayName: 'Supervisor', role: 'supervisor', status: 'active' };
const AGENT = { id: 'agent-1', userId: 'agent-1', companyId: 'company-1', email: 'agent@example.com', displayName: 'Agent', role: 'agent', status: 'active' };
const KEY = 'lead-import-key';

function fakeDatabase() {
  const log = { imports: [], audits: [], agentCalls: [] };
  const existing = ['6281111111111'];
  return {
    log, enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async resolveCompanyId(ref) { return ref === 'company-1' ? 'company-1' : null; },
    async authenticateUser(email, password) { return password === 'password-123' ? [SUP, AGENT].find((u) => u.email === email) || null : null; },
    async getActiveSessionUser(userId) { return [SUP, AGENT].find((u) => u.id === userId) || null; },
    async setPresence() {},
    async listTeamMembers() { return [SUP, AGENT]; },
    async getCompanyConfig() { return { timezone: 'Asia/Jakarta', whatsappProvider: 'whatsapp_web' }; },
    async recordAuditLog(entry) { log.audits.push(entry); return entry; },
    async listLeadPhones() { return existing; },
    async importLeadsFromFile(companyId, payload) {
      log.imports.push({ companyId, ...payload });
      return { importId: 'imp-1', imported: payload.leads.length, raced: 0 };
    },
    async getAgentPerformance(companyId, from, to) {
      log.agentCalls.push({ companyId, from, to });
      return [{ userId: 'agent-1', name: 'Agent', humanReplies: 4, chatsReplied: 2, responseSamples: 2, medianResponseSeconds: 90, averageResponseSeconds: 100, takeovers: 1, handBacks: 0, openAssigned: 0 }];
    },
    async getChatReportStats() { return { inboundMessages: 10, activeChats: 4, newChats: 1, aiReplies: 6, humanReplies: 4, handoffs: 1, hotLeads: 0 }; },
    async getChatReportChats() { return { chats: [], waiting: 3, followUpTotal: 5 }; },
  };
}

async function start(t, who = SUP) {
  const database = fakeDatabase();
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, database, apiKey: KEY, sessionSecret: 'lead-import-secret' });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: who.email, password: 'password-123' } });
  assert.equal(login.statusCode, 200);
  return { app, database, cookie: login.headers['set-cookie'].split(';')[0] };
}

function multipart(file, mapping) {
  const boundary = '----agnee-test-boundary';
  const parts = [];
  if (mapping) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="mapping"\r\n\r\n${JSON.stringify(mapping)}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const body = Buffer.concat([Buffer.from(parts.join('')), Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const CSV = 'Nama,No HP,Email\n=HYPERLINK("https://jahat"),0812 3333 4444,a@x.co\nBudi,081111111111,b@x.co\nSiti,12,\nAni,+62 812-3333-4444,\n';

test('pratinjau: judul, tebakan pemetaan, hitungan siap/duplikat/tidak valid; tidak menyimpan apa pun', async (t) => {
  const { app, database, cookie } = await start(t);
  const { body, headers } = multipart({ name: 'kontak.csv', data: CSV });
  const res = await app.inject({ method: 'POST', url: '/v1/leads/import/preview', headers: { ...headers, cookie }, payload: body });
  assert.equal(res.statusCode, 200, res.body);
  const out = res.json();
  assert.deepEqual(out.headers, ['Nama', 'No HP', 'Email']);
  assert.deepEqual(out.mapping, { phone: 1, email: 2, name: 0 });
  assert.deepEqual(out.summary, { total: 4, ready: 1, invalidPhone: 1, duplicateInFile: 1, alreadyExists: 1, invalidEmail: 0 });
  assert.equal(out.readyPreview[0].phone, '6281233334444');
  assert.deepEqual(out.problems.map((p) => p.kind), ['already_exists', 'invalid_phone', 'duplicate_in_file']);
  assert.equal(database.log.imports.length, 0);
});

test('simpan: memakai pemetaan yang dikonfirmasi, mencatat audit, dan hanya baris siap', async (t) => {
  const { app, database, cookie } = await start(t);
  const { body, headers } = multipart({ name: 'kontak.csv', data: CSV }, { phone: 1, name: 0, email: 2 });
  const res = await app.inject({ method: 'POST', url: '/v1/leads/import', headers: { ...headers, cookie }, payload: body });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().imported, 1);
  assert.deepEqual(res.json().skipped, { invalidPhone: 1, duplicateInFile: 1, alreadyExists: 1, raced: 0 });
  const saved = database.log.imports[0];
  assert.equal(saved.leads[0].chatId, '6281233334444@c.us');
  assert.equal(saved.leads[0].name, '=HYPERLINK("https://jahat")'); // tersimpan apa adanya, tidak dieksekusi
  assert.equal(database.log.audits.at(-1).action, 'contacts.file_imported');
  assert.equal(database.log.audits.at(-1).metadata.imported, 1);
});

test('simpan tanpa pemetaan, tanpa nomor, atau tanpa baris siap ditolak', async (t) => {
  const { app, database, cookie } = await start(t);
  const send = (file, mapping) => {
    const { body, headers } = multipart(file, mapping);
    return app.inject({ method: 'POST', url: '/v1/leads/import', headers: { ...headers, cookie }, payload: body });
  };
  assert.equal((await send({ name: 'k.csv', data: CSV })).statusCode, 400);
  assert.equal((await send({ name: 'k.csv', data: CSV }, { name: 0 })).statusCode, 422);
  const none = await send({ name: 'k.csv', data: 'Nama,HP\nA,1\n' }, { phone: 1 });
  assert.equal(none.statusCode, 422);
  assert.equal(database.log.imports.length, 0);
});

test('berkas terlalu besar atau tipe tak didukung ditolak dengan kode yang tepat', async (t) => {
  const { app, cookie } = await start(t);
  const send = (file) => {
    const { body, headers } = multipart(file);
    return app.inject({ method: 'POST', url: '/v1/leads/import/preview', headers: { ...headers, cookie }, payload: body });
  };
  assert.equal((await send({ name: 'besar.csv', data: Buffer.alloc(6 * 1024 * 1024, 97) })).statusCode, 413);
  assert.equal((await send({ name: 'x.pdf', data: '%PDF-1.4 abc' })).statusCode, 415);
});

test('agent tidak boleh mengimpor atau melihat kinerja agent', async (t) => {
  const { app, cookie } = await start(t, AGENT);
  const { body, headers } = multipart({ name: 'kontak.csv', data: CSV });
  assert.equal((await app.inject({ method: 'POST', url: '/v1/leads/import/preview', headers: { ...headers, cookie }, payload: body })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/reports/agents', headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/reports/summary', headers: { cookie } })).statusCode, 403);
});

test('kinerja agent: jendela hari, catatan batas data, dan tanpa metrik rekaan', async (t) => {
  const { app, database, cookie } = await start(t);
  const res = await app.inject({ method: 'GET', url: '/v1/reports/agents?days=30', headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.equal(out.days, 30);
  assert.equal(Math.round((new Date(out.to) - new Date(out.from)) / 86400000), 30);
  assert.equal(out.agents[0].medianResponseSeconds, 90);
  assert.ok(out.notes.some((n) => /ponsel/.test(n)) && out.notes.some((n) => /closing/.test(n)));
  assert.equal(database.log.agentCalls[0].companyId, 'company-1');
  assert.equal((await app.inject({ method: 'GET', url: '/v1/reports/agents?days=500', headers: { cookie } })).statusCode, 400);
});

test('ringkasan laporan: empat periode dengan pembanding dan chat yang menunggu', async (t) => {
  const { app, cookie } = await start(t);
  const out = (await app.inject({ method: 'GET', url: '/v1/reports/summary', headers: { cookie } })).json();
  assert.deepEqual(out.periods.map((p) => p.key), ['today', 'yesterday', '7d', '30d']);
  assert.equal(out.periods[2].stats.inboundMessages, 10);
  assert.equal(out.periods[2].previous.humanReplies, 4);
  assert.equal(out.waitingNow, 3);
  assert.equal(out.timezone, 'Asia/Jakarta');
});

test('kunci layanan (MCP): supervisor boleh membaca laporan, agent ditolak, dari internet ditolak', async (t) => {
  const { app } = await start(t);
  const as = (user) => ({ 'x-api-key': KEY, 'x-agnee-company': 'company-1', 'x-agnee-user': user.id });
  assert.equal((await app.inject({ method: 'GET', url: '/v1/reports/summary', headers: as(SUP) })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/reports/agents?days=7', headers: as(SUP) })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/reports/agents', headers: as(AGENT) })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/reports/agents', headers: { ...as(SUP), 'x-forwarded-for': '203.0.113.9' } })).statusCode, 403);
  // Rute impor tidak termasuk rute MCP.
  const { body, headers } = multipart({ name: 'k.csv', data: CSV });
  assert.equal((await app.inject({ method: 'POST', url: '/v1/leads/import/preview', headers: { ...headers, ...as(SUP) }, payload: body })).statusCode, 403);
});
