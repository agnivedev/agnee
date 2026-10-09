'use strict';

/**
 * Train AI bisa diubah hanya lewat obrolan dengan AI, tanpa menyentuh markdown.
 *
 * Alur yang diuji: obrolan (`/chat`) -> susun (`/compile`) -> ubah lewat
 * perintah (`/revise`) -> terapkan. Yang dijaga: `/revise` hanya MENGUSULKAN
 * (tidak menyimpan), dokumen antarperusahaan tidak bocor, dan hanya supervisor
 * yang boleh.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');

const owner = (company) => ({
  id: `owner-${company}`, userId: `owner-${company}`, companyId: company,
  email: `${company}@pelanggan.test`, displayName: `Owner ${company}`, role: 'owner', status: 'active',
  isPlatformAdmin: false,
});
const OWNER_A = owner('company-a');
const OWNER_B = owner('company-b');
const AGENT_A = { ...OWNER_A, id: 'agent-a', userId: 'agent-a', email: 'agent@pelanggan.test', role: 'agent' };
const USERS = [OWNER_A, OWNER_B, AGENT_A];

function fakeDatabase() {
  const docs = new Map();
  const key = (companyId, kind, productId) => `${companyId}|${kind}|${productId || ''}`;
  return {
    enabled: true, connected: true,
    docs,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) {
      return USERS.find((u) => u.email === email && password === 'password-123') || null;
    },
    async getActiveSessionUser(userId) { return USERS.find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone' }; },
    async getPlaybookContext() { return ''; },
    async listPlaybookDocs(companyId, productId) {
      return [...docs.entries()]
        .filter(([k]) => k.startsWith(`${companyId}|`) && k.endsWith(`|${productId || ''}`))
        .map(([, d]) => ({ kind: d.kind, version: d.version, updatedAt: d.updatedAt, contentLength: d.contentMd.length }));
    },
    async getPlaybookDoc(kind, companyId, productId) { return docs.get(key(companyId, kind, productId)) || null; },
    async savePlaybookDoc({ kind, contentMd, interview, productId = null }, _by, companyId) {
      const k = key(companyId, kind, productId);
      const prev = docs.get(k);
      const next = {
        kind,
        contentMd,
        // Sama seperti SQL asli: tanpa `interview`, obrolan lama tetap.
        interview: interview || prev?.interview || [],
        version: prev ? prev.version + (prev.contentMd !== contentMd ? 1 : 0) : 1,
        updatedAt: new Date().toISOString(),
      };
      docs.set(k, next);
      return next;
    },
  };
}

/**
 * Model tiruan yang membedakan tiga pekerjaan lewat `purpose`, seperti server
 * memanggilnya. Panggilannya dicatat supaya prompt-nya bisa diperiksa.
 */
function fakeLlm(state) {
  return {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      state.calls.push({ message, ...options });
      if (state.fail) return null;
      if (options.purpose === 'playbook_chat') return { text: 'Apa larangan paling penting?', model: 'tiruan' };
      if (options.purpose === 'playbook_compile') {
        return { text: '## Larangan\n\n- Jangan menjanjikan profit.\n\n## Belum ditentukan\n\n- Soal testimoni', model: 'tiruan' };
      }
      if (options.purpose === 'playbook_revise') {
        return { text: state.reviseText ?? '## Larangan\n\n- Jangan menjanjikan profit.\n- Jangan sebut harga kompetitor.', model: 'tiruan' };
      }
      return { text: 'tidak dikenal', model: 'tiruan' };
    },
  };
}

async function setup(t) {
  const state = { calls: [], fail: false, reviseText: null };
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'playbook-chat-edit',
    database, llmService: fakeLlm(state),
  });
  t.after(() => app.close());
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    assert.equal(res.statusCode, 200);
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  return { state, database, call, a: await login(OWNER_A), b: await login(OWNER_B), agent: await login(AGENT_A) };
}

test('alur penuh hanya lewat obrolan: obrolan, susun, ubah, terapkan', async (t) => {
  const { call, a, database } = await setup(t);

  const chat = await call(a, 'POST', '/v1/playbooks/compliance/chat', { message: 'Jangan janjikan profit' });
  assert.equal(chat.statusCode, 200);
  assert.equal(chat.json().interview.length, 2);

  const compiled = await call(a, 'POST', '/v1/playbooks/compliance/compile');
  assert.equal(compiled.statusCode, 200);
  assert.match(compiled.json().contentMd, /Jangan menjanjikan profit/);
  // Giliran obrolan pertama sudah membuat barisnya (versi 1, kosong); isi pertama jadi versi 2.
  assert.equal(compiled.json().version, 2);

  const revise = await call(a, 'POST', '/v1/playbooks/compliance/revise', { instruction: 'Tambah larangan menyebut harga kompetitor' });
  assert.equal(revise.statusCode, 200);
  assert.match(revise.json().contentMd, /Jangan sebut harga kompetitor/);
  // Usulan belum tersimpan: dokumen yang dibaca AI ke customer masih yang lama.
  assert.equal(database.docs.get('company-a|compliance|').contentMd, compiled.json().contentMd);

  const applied = await call(a, 'PUT', '/v1/playbooks/compliance', { contentMd: revise.json().contentMd });
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.json().version, 3);

  const read = await call(a, 'GET', '/v1/playbooks/compliance');
  assert.match(read.json().contentMd, /harga kompetitor/);
  // Obrolan penyusunan tidak hilang karena dokumen diterapkan lewat PUT.
  assert.equal(read.json().interview.length, 2);
});

test('revise mengirim dokumen sekarang dan perintahnya ke model, dan tidak menyimpan', async (t) => {
  const { call, a, state, database } = await setup(t);
  await call(a, 'PUT', '/v1/playbooks/persona', { contentMd: '## Persona\n\n- Nama CS: Tari' });

  const res = await call(a, 'POST', '/v1/playbooks/persona/revise', { instruction: 'Ganti nama CS jadi Dini' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().current, '## Persona\n\n- Nama CS: Tari');

  const revise = state.calls.find((c) => c.purpose === 'playbook_revise');
  assert.match(revise.message, /Nama CS: Tari/);
  assert.match(revise.message, /Ganti nama CS jadi Dini/);
  assert.match(revise.systemPrompt, /HANYA perubahan yang diminta/);
  assert.equal(database.docs.get('company-a|persona|').version, 1);
});

test('revise membuang pagar kode yang kadang dibungkus model', async (t) => {
  const { call, a, state } = await setup(t);
  state.reviseText = '```markdown\n## Larangan\n\n- Satu\n```';
  const res = await call(a, 'POST', '/v1/playbooks/compliance/revise', { instruction: 'apa saja' });
  assert.equal(res.json().contentMd, '## Larangan\n\n- Satu');
});

test('revise: model gagal 502, jenis tak dikenal 400, perintah kosong 400', async (t) => {
  const { call, a, state } = await setup(t);
  state.fail = true;
  assert.equal((await call(a, 'POST', '/v1/playbooks/compliance/revise', { instruction: 'x' })).statusCode, 502);
  state.fail = false;
  assert.equal((await call(a, 'POST', '/v1/playbooks/bukan-jenis/revise', { instruction: 'x' })).statusCode, 400);
  assert.equal((await call(a, 'POST', '/v1/playbooks/compliance/revise', { instruction: '' })).statusCode, 400);
});

test('revise hanya untuk supervisor, dan dokumen tidak bocor antarperusahaan', async (t) => {
  const { call, a, b, agent } = await setup(t);
  await call(a, 'PUT', '/v1/playbooks/compliance', { contentMd: '## Rahasia A' });

  assert.equal((await call(agent, 'POST', '/v1/playbooks/compliance/revise', { instruction: 'x' })).statusCode, 403);

  // B mengubah dokumennya sendiri; yang dikirim ke model adalah dokumen B (kosong), bukan A.
  const res = await call(b, 'POST', '/v1/playbooks/compliance/revise', { instruction: 'tambah aturan' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().current, '');
  assert.equal((await call(b, 'GET', '/v1/playbooks/compliance')).json().contentMd, '');
});
