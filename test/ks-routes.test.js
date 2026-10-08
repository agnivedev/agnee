'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildApp } = require('../src/server');
const { loadPackage } = require('../src/ks-package');

const pkg = loadPackage(path.join(__dirname, '..', 'knowledge', 'ks', 'funneling-closing'));
const example = pkg.example;
const offers = example.offers;

const owner = (company, email) => ({
  id: `owner-${company}`, userId: `owner-${company}`, companyId: company,
  email, displayName: `Owner ${company}`, role: 'owner', status: 'active', isPlatformAdmin: false,
});
const OWNER_A = owner('company-a', 'a@pelanggan.test');
const OWNER_B = owner('company-b', 'b@pelanggan.test');
const AGENT_A = { ...OWNER_A, id: 'agent-a', userId: 'agent-a', email: 'agent@pelanggan.test', role: 'agent' };

function fakeDatabase() {
  const installs = new Map();
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) {
      return [OWNER_A, OWNER_B, AGENT_A].find((u) => u.email === email && password === 'password-123') || null;
    },
    async getActiveSessionUser(userId) { return [OWNER_A, OWNER_B, AGENT_A].find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
    async recordSimulationRun() { return { id: 'run-1' }; },
    async listKsInstalls(companyId) { return [...installs.values()].filter((i) => i.companyId === companyId); },
    async getKsInstall(id, companyId) {
      const row = installs.get(id);
      return row && row.companyId === companyId ? row : null;
    },
    async listActiveKs(companyId) { return [...installs.values()].filter((i) => i.companyId === companyId && i.active); },
    async createKsInstall({ code, version, kind, source, pkg: snapshot }, _by, companyId) {
      if ([...installs.values()].some((i) => i.companyId === companyId && i.kind === kind)) {
        throw Object.assign(new Error('duplikat'), { code: '23505' });
      }
      const row = {
        id: crypto.randomUUID(), companyId, code, version, kind, source, package: JSON.parse(JSON.stringify(snapshot)),
        specific: {}, active: false, lastSimulation: null, installedAt: new Date().toISOString(),
      };
      installs.set(row.id, row);
      return row;
    },
    async saveKsSpecific(id, specific, companyId) {
      const row = await known.getKsInstall(id, companyId);
      if (!row) return null;
      Object.assign(row, { specific, active: false, lastSimulation: null });
      return row;
    },
    async saveKsSimulation(id, summary, companyId) {
      const row = await known.getKsInstall(id, companyId);
      if (!row) return null;
      row.lastSimulation = JSON.parse(JSON.stringify(summary));
      return row;
    },
    async setKsActive(id, active, companyId) {
      const row = await known.getKsInstall(id, companyId);
      if (!row) return null;
      row.active = active;
      return row;
    },
    async deleteKsInstall(id, companyId) {
      const row = await known.getKsInstall(id, companyId);
      return row ? installs.delete(id) : false;
    },
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

const pitch = (o) => `${o.name}${o.price ? `, Rp ${o.price.toLocaleString('id-ID')}` : ''}. ${o.pitch}${o.condition ? ` Syaratnya: ${o.condition}` : ''}`;

/** Model tiruan: bot yang mengikuti alur, atau yang terus mengulang tingkat 1. */
function fakeLlm(state) {
  return {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      state.prompts.push(options.systemPrompt || '');
      if (options.purpose === 'ks_grade') return { text: '{"pass": true, "reason": "ok"}', model: 'tiruan' };
      if (state.mode === 'keras-kepala') return { text: pitch(offers[0]), model: 'tiruan' };
      const said = (options.history || []).filter((m) => m.role === 'assistant').map((m) => m.content);
      const lastTier = offers.reduce((top, o, i) => (said.some((s) => s.includes(o.name)) ? i + 1 : top), 0);
      let text;
      if (/stop|berhenti|jangan hubungi/i.test(message)) text = 'Baik kak, terima kasih sudah mampir.';
      else if (lastTier > 0 && /ambil|boleh|caranya|gratis itu mau/i.test(message)) text = offers[lastTier - 1].how || example.order.how;
      else if (lastTier > 0 && /mahal|berat|nggak|tidak|maaf kak/i.test(message)) {
        text = lastTier < offers.length ? `Dimengerti kak. ${pitch(offers[lastTier])}` : 'Baik kak, terima kasih sudah mampir.';
      } else if (said.length < 2) text = 'Boleh tahu dulu kebutuhan kakak? Soal garansi nanti dijawab tim.';
      else if (lastTier === 0) text = `Dari ceritanya, ini yang cocok kak: ${pitch(offers[0])}`;
      else text = 'Silakan kak, kalau ada yang mau ditanyakan saya bantu.';
      return { text, model: 'tiruan', usage: {} };
    },
  };
}

async function setup(t, mode = 'patuh') {
  const state = { mode, prompts: [] };
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'ks-routes',
    database: fakeDatabase(), llmService: fakeLlm(state),
  });
  t.after(() => app.close());
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    assert.equal(res.statusCode, 200);
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  const a = await login(OWNER_A);
  const b = await login(OWNER_B);
  const agent = await login(AGENT_A);
  return { app, state, a, b, agent, call };
}

async function untilDone(call, who, id) {
  for (let i = 0; i < 100; i += 1) {
    const res = await call(who, 'GET', `/v1/ks/installs/${id}/simulation`);
    if (res.json().job?.status !== 'running') return res.json();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('simulasi tidak selesai');
}

test('katalog, pasang, dan batas akses', async (t) => {
  const { call, a, b, agent } = await setup(t);
  const catalog = (await call(a, 'GET', '/v1/ks/catalog')).json();
  assert.equal(catalog.packages[0].code, 'ks-funneling-closing');
  assert.equal(catalog.packages[0].installed, false);

  assert.equal((await call(agent, 'GET', '/v1/ks/catalog')).statusCode, 403);
  assert.equal((await call(a, 'POST', '/v1/ks/installs', { code: 'ks-tidak-ada' })).statusCode, 404);

  const created = await call(a, 'POST', '/v1/ks/installs', { code: 'ks-funneling-closing' });
  assert.equal(created.statusCode, 201);
  const install = created.json().install;
  assert.equal(install.active, false);
  assert.ok(install.blockedReason);
  assert.equal((await call(a, 'POST', '/v1/ks/installs', { code: 'ks-funneling-closing' })).statusCode, 409);

  assert.equal((await call(b, 'GET', '/v1/ks/installs')).json().installs.length, 0);
  assert.equal((await call(b, 'PUT', `/v1/ks/installs/${install.id}/specific`, { specific: example })).statusCode, 404);
  assert.equal((await call(b, 'DELETE', `/v1/ks/installs/${install.id}`)).statusCode, 404);
});

test('aktivasi menunggu isian lengkap dan simulasi yang lulus untuk isian itu', async (t) => {
  const { call, a, state } = await setup(t);
  const { install } = (await call(a, 'POST', '/v1/ks/installs', { code: 'ks-funneling-closing' })).json();
  const id = install.id;

  assert.match((await call(a, 'POST', `/v1/ks/installs/${id}/activate`, { active: true })).json().error, /Isian belum lengkap/);
  assert.equal((await call(a, 'POST', `/v1/ks/installs/${id}/simulate`)).statusCode, 400);

  const saved = await call(a, 'PUT', `/v1/ks/installs/${id}/specific`, { specific: example });
  assert.deepEqual(saved.json().install.problems, []);
  assert.match((await call(a, 'POST', `/v1/ks/installs/${id}/activate`, { active: true })).json().error, /Jalankan simulasi/);

  const started = await call(a, 'POST', `/v1/ks/installs/${id}/simulate`);
  assert.equal(started.statusCode, 202);
  const done = await untilDone(call, a, id);
  assert.equal(done.job.status, 'done');
  assert.equal(done.job.done, done.job.total);
  assert.deepEqual(done.simulation.scenarios.filter((s) => !s.pass).map((s) => s.id), []);
  assert.equal(done.simulation.failed, 0);
  assert.equal(done.blockedReason, null);
  assert.ok(state.prompts.some((p) => /TEMPLATE PERCAKAPAN: Funneling Closing/.test(p)), 'simulasi harus memakai prompt KS');

  const on = await call(a, 'POST', `/v1/ks/installs/${id}/activate`, { active: true });
  assert.equal(on.statusCode, 200);
  assert.equal(on.json().install.active, true);

  const edited = await call(a, 'PUT', `/v1/ks/installs/${id}/specific`, { specific: { ...example, order: { how: 'cara baru' } } });
  assert.equal(edited.json().install.active, false);
  assert.match((await call(a, 'POST', `/v1/ks/installs/${id}/activate`, { active: true })).json().error, /Jalankan simulasi/);
});

test('simulasi yang gagal menahan aktivasi', async (t) => {
  const { call, a } = await setup(t, 'keras-kepala');
  const { install } = (await call(a, 'POST', '/v1/ks/installs', { code: 'ks-funneling-closing' })).json();
  await call(a, 'PUT', `/v1/ks/installs/${install.id}/specific`, { specific: example });
  await call(a, 'POST', `/v1/ks/installs/${install.id}/simulate`);
  const done = await untilDone(call, a, install.id);
  assert.ok(done.simulation.failed > 0);
  assert.match((await call(a, 'POST', `/v1/ks/installs/${install.id}/activate`, { active: true })).json().error, /belum lulus/);
});

test('template aktif masuk prompt balasan company itu saja', async (t) => {
  const { call, a, b, state } = await setup(t);
  const { install } = (await call(a, 'POST', '/v1/ks/installs', { code: 'ks-funneling-closing' })).json();
  await call(a, 'PUT', `/v1/ks/installs/${install.id}/specific`, { specific: example });
  await call(a, 'POST', `/v1/ks/installs/${install.id}/simulate`);
  await untilDone(call, a, install.id);
  await call(a, 'POST', `/v1/ks/installs/${install.id}/activate`, { active: true });

  const promptFor = async (who) => {
    state.prompts.length = 0;
    const res = await call(who, 'POST', '/v1/coach/simulate', { mode: 'ai', customerMessage: 'Halo kak', grade: false });
    assert.equal(res.statusCode, 200, res.body);
    return state.prompts[0];
  };
  const withKs = await promptFor(a);
  assert.match(withKs, /Template percakapan di bawah mengatur ALUR closing/);
  assert.match(withKs, /Tingkat 1 \(berbayar\): Paket Lengkap, Rp 2\.500\.000/);
  assert.doesNotMatch(await promptFor(b), /TEMPLATE PERCAKAPAN/);

  await call(a, 'POST', `/v1/ks/installs/${install.id}/activate`, { active: false });
  assert.doesNotMatch(await promptFor(a), /TEMPLATE PERCAKAPAN/);
});

test('simulasi dibatasi per jam dan paket bisa dilepas', async (t) => {
  const { call, a } = await setup(t);
  const { install } = (await call(a, 'POST', '/v1/ks/installs', { code: 'ks-funneling-closing' })).json();
  await call(a, 'PUT', `/v1/ks/installs/${install.id}/specific`, { specific: example });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await call(a, 'POST', `/v1/ks/installs/${install.id}/simulate`)).statusCode, 202);
    await untilDone(call, a, install.id);
  }
  assert.equal((await call(a, 'POST', `/v1/ks/installs/${install.id}/simulate`)).statusCode, 429);

  assert.equal((await call(a, 'DELETE', `/v1/ks/installs/${install.id}`)).statusCode, 204);
  assert.equal((await call(a, 'GET', '/v1/ks/installs')).json().installs.length, 0);
});
