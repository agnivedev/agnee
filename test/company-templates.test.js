'use strict';

/**
 * Template potret konfigurasi: simpan, simpan baru, pasang.
 * Yang dijaga: hanya supervisor; data company lain tidak ikut; nomor WhatsApp
 * dan anggota departemen tidak masuk potret; memasang tidak menghapus.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const mk = (company, role = 'owner', id = `u-${company}-${role}`) => ({
  id, userId: id, companyId: company, email: `${id}@pelanggan.test`, displayName: id, role, status: 'active', isPlatformAdmin: false,
});
const A = mk('company-a');
const B = mk('company-b');
const AGENT = mk('company-a', 'agent');

function fakeDb() {
  const tpl = [];
  const state = { docs: new Map(), facts: [], brief: new Map(), depts: [], identity: new Map(), tpl };
  state.docs.set('company-a|persona', 'Santai dan sopan.');
  state.facts.push({ id: 'f1', companyId: 'company-a', category: 'pricing', question: 'Harga?', answer: 'Rp 1', priority: 1 });
  state.facts.push({ id: 'f2', companyId: 'company-a', category: 'faq', question: 'Kosong?', answer: '', priority: 2 });
  state.depts.push({ id: 'd1', companyId: 'company-a', name: 'Finance', description: 'Tagihan', members: [{ userId: 'x', whatsappNumber: '62811' }] });
  state.brief.set('company-a', 'Brief A');
  const users = [A, B, AGENT];
  return {
    state, enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, pw) { return users.find((u) => u.email === email && pw === 'password-123') || null; },
    async getActiveSessionUser(id) { return users.find((u) => u.id === id) || null; },
    async setPresence() {},
    async getAiSettings(c) { return { enabled: true, modelChain: [], identity: state.identity.get(c) || 'team_member' }; },
    async setAiSettings(c, { identity }) { if (identity) state.identity.set(c, identity); },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active' }; },
    async listPlaybookDocs(c) {
      return [...state.docs].filter(([k]) => k.startsWith(`${c}|`)).map(([k, v]) => ({ kind: k.split('|')[1], contentLength: v.length }));
    },
    async getPlaybookDoc(kind, c) { const v = state.docs.get(`${c}|${kind}`); return v ? { kind, contentMd: v } : null; },
    async savePlaybookDoc({ kind, contentMd }, _u, c) { state.docs.set(`${c}|${kind}`, contentMd); return {}; },
    async listPlaybookFacts(c, o = {}) { return state.facts.filter((f) => f.companyId === c && (!o.onlyAnswered || f.answer)); },
    async upsertPlaybookFact(f, _u, c) {
      const hit = state.facts.find((x) => x.companyId === c && x.question.toLowerCase() === f.question.toLowerCase());
      if (hit) { hit.answer = f.answer; return hit; }
      const row = { id: `n${state.facts.length}`, companyId: c, ...f };
      state.facts.push(row);
      return row;
    },
    async deletePlaybookFact(id) { const i = state.facts.findIndex((f) => f.id === id); if (i >= 0) state.facts.splice(i, 1); },
    async deletePlaybookDoc(kind, c) { state.docs.delete(`${c}|${kind}`); },
    async deleteDepartment(id) { const i = state.depts.findIndex((d) => d.id === id); if (i >= 0) state.depts.splice(i, 1); },
    async getPlaybook(c) { return { brief: state.brief.get(c) || '' }; },
    async savePlaybookBrief(b, _u, c) { state.brief.set(c, b); },
    async listDepartments(c) { return state.depts.filter((d) => d.companyId === c); },
    async createDepartment(d, c) { const row = { id: `d${state.depts.length}`, companyId: c, members: [], ...d }; state.depts.push(row); return row; },
    async updateDepartment(id, { description }) { state.depts.find((d) => d.id === id).description = description; },
    async listCompanyTemplates(c) { return tpl.filter((t) => t.companyId === c); },
    async getCompanyTemplate(id, c) { return tpl.find((t) => t.id === id && t.companyId === c) || null; },
    async createCompanyTemplate({ name, sections }, _u, c) {
      if (tpl.some((t) => t.companyId === c && t.name.toLowerCase() === name.toLowerCase())) { const e = new Error('dup'); e.code = '23505'; throw e; }
      const row = { id: `00000000-0000-4000-8000-${String(tpl.length + 1).padStart(12, '0')}`, companyId: c, name, sections, version: 1, updatedAt: new Date().toISOString() };
      tpl.push(row); return row;
    },
    async overwriteCompanyTemplate(id, { sections }, c) { const t = tpl.find((x) => x.id === id && x.companyId === c); t.sections = sections; t.version += 1; return t; },
    async deleteCompanyTemplate(id, c) { const i = tpl.findIndex((t) => t.id === id && t.companyId === c); if (i < 0) return false; tpl.splice(i, 1); return true; },
  };
}

async function setup(t) {
  const database = fakeDb();
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'tpl', database, llmService: { enabled: true } });
  t.after(() => app.close());
  const login = async (u) => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: u.email, password: 'password-123' } });
    return { cookie: r.headers['set-cookie'].split(';')[0] };
  };
  const as = { a: await login(A), b: await login(B), agent: await login(AGENT) };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: as[who].cookie }, payload });
  return { database, call };
}

test('simpan baru memotret hanya yang bisa dipakai ulang; nomor WA dan anggota tidak ikut', async (t) => {
  const { call, database } = await setup(t);
  const res = await call('a', 'POST', '/v1/templates', { name: 'Dasar', sections: ['playbook', 'facts', 'brief', 'departments', 'identity'] });
  assert.equal(res.statusCode, 201);
  const snap = database.state.tpl[0].sections;
  assert.deepEqual(snap.playbook, { persona: 'Santai dan sopan.' });
  assert.equal(snap.facts.length, 1, 'fakta tanpa jawaban tidak ikut');
  assert.deepEqual(snap.departments, [{ name: 'Finance', description: 'Tagihan' }]);
  assert.ok(!JSON.stringify(snap).includes('62811'));
  assert.equal((await call('a', 'POST', '/v1/templates', { name: 'dasar', sections: ['brief'] })).statusCode, 409);
});

test('simpan (timpa) menaikkan versi; pasang ke company lain tidak membaca template company lain', async (t) => {
  const { call, database } = await setup(t);
  const id = (await call('a', 'POST', '/v1/templates', { name: 'Dasar', sections: ['brief'] })).json().template.id;
  database.state.brief.set('company-a', 'Brief A baru');
  const up = await call('a', 'PUT', `/v1/templates/${id}`, { sections: ['brief'] });
  assert.equal(up.json().template.version, 2);
  assert.equal(database.state.tpl[0].sections.brief, 'Brief A baru');
  assert.equal((await call('b', 'GET', `/v1/templates/${id}/preview`)).statusCode, 404);
  assert.equal((await call('b', 'POST', `/v1/templates/${id}/apply`, { sections: ['brief'] })).statusCode, 404);
  assert.equal((await call('b', 'GET', '/v1/templates')).json().templates.length, 0);
});

test('pasang: pratinjau menghitung perubahan, pemasangan menambah dan menimpa tanpa menghapus', async (t) => {
  const { call, database } = await setup(t);
  const id = (await call('a', 'POST', '/v1/templates', { name: 'Dasar', sections: ['facts', 'brief', 'departments'] })).json().template.id;
  // Company berubah setelah potret: fakta diganti, fakta baru, departemen baru.
  database.state.facts.find((f) => f.id === 'f1').answer = 'Rp 2';
  database.state.facts.push({ id: 'f3', companyId: 'company-a', category: 'faq', question: 'Tambahan', answer: 'x', priority: 2 });
  database.state.depts.push({ id: 'd9', companyId: 'company-a', name: 'Legal', description: '', members: [] });
  database.state.brief.set('company-a', 'Lain');
  const preview = (await call('a', 'GET', `/v1/templates/${id}/preview`)).json().changes;
  assert.equal(preview.facts.changed, 1);
  assert.equal(preview.brief.changed, true);
  const applied = await call('a', 'POST', `/v1/templates/${id}/apply`, { sections: ['facts', 'brief'] });
  assert.equal(applied.statusCode, 200);
  assert.equal(database.state.facts.find((f) => f.id === 'f1').answer, 'Rp 1');
  assert.ok(database.state.facts.some((f) => f.question === 'Tambahan'), 'fakta di luar template tidak dihapus');
  assert.equal(database.state.brief.get('company-a'), 'Brief A');
  assert.ok(database.state.depts.some((d) => d.name === 'Legal'), 'departemen lain tidak dihapus');
});

test('hanya supervisor yang boleh mengelola template', async (t) => {
  const { call } = await setup(t);
  assert.equal((await call('agent', 'GET', '/v1/templates')).statusCode, 403);
  assert.equal((await call('agent', 'POST', '/v1/templates', { name: 'Xx', sections: ['brief'] })).statusCode, 403);
});

test('pemasangan semua-atau-tidak-sama-sekali: gagal di tengah mengembalikan yang sudah tertulis', async (t) => {
  const { call, database } = await setup(t);
  const id = (await call('a', 'POST', '/v1/templates', { name: 'Dasar', sections: ['playbook', 'facts', 'brief', 'departments', 'identity'] })).json().template.id;
  // Company berubah setelah potret, lalu satu langkah di tengah gagal.
  database.state.docs.set('company-a|persona', 'Persona sekarang');
  database.state.facts.find((f) => f.id === 'f1').answer = 'Rp 2';
  database.state.brief.set('company-a', 'Brief sekarang');
  database.state.depts.push({ id: 'dx', companyId: 'company-a', name: 'Legal', description: '', members: [] });
  database.state.tpl[0].sections.departments.push({ name: 'Baru', description: 'x' });
  database.state.depts = database.state.depts.filter((d) => d.name !== 'Finance'); // Finance akan dibuat ulang
  const create = database.createDepartment;
  database.createDepartment = async (d, c) => { if (d.name === 'Baru') throw new Error('boom'); return create(d, c); };
  const before = JSON.stringify([...database.state.docs], null) + JSON.stringify(database.state.facts) + [...database.state.brief] + JSON.stringify(database.state.depts);
  const res = await call('a', 'POST', `/v1/templates/${id}/apply`, { sections: ['playbook', 'facts', 'brief', 'departments', 'identity'] });
  assert.equal(res.statusCode, 500);
  const after = JSON.stringify([...database.state.docs], null) + JSON.stringify(database.state.facts) + [...database.state.brief] + JSON.stringify(database.state.depts);
  assert.equal(after, before, 'semua tulisan sebelum kegagalan dikembalikan');
  assert.equal(database.state.identity.get('company-a'), undefined);
});
