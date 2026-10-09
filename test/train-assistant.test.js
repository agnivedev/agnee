'use strict';

/**
 * Asisten Latih AI: satu obrolan untuk semua tab, tetapi hanya MENGUSULKAN.
 *
 * Yang dijaga: tidak ada alat yang menyimpan; suntingan diterapkan persis ke
 * dokumen yang sebenarnya (bukan ke salinan terpotong yang dibaca model);
 * data antarperusahaan tidak bocor; hanya supervisor.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildApp } = require('../src/server');
const { applyEdits } = require('../src/train-assistant');
const { loadPackage } = require('../src/ks-package');

const pkg = loadPackage(path.join(__dirname, '..', 'knowledge', 'ks', 'funneling-closing'));
const INSTALL_A = '11111111-1111-4111-8111-111111111111';

const owner = (company) => ({
  id: `owner-${company}`, userId: `owner-${company}`, companyId: company,
  email: `${company}@pelanggan.test`, displayName: `Owner ${company}`, role: 'owner', status: 'active', isPlatformAdmin: false,
});
const OWNER_A = owner('company-a');
const OWNER_B = owner('company-b');
const AGENT_A = { ...OWNER_A, id: 'agent-a', userId: 'agent-a', email: 'agent@pelanggan.test', role: 'agent' };
const USERS = [OWNER_A, OWNER_B, AGENT_A];

function fakeDatabase() {
  const writes = [];
  const docs = new Map([
    ['company-a|compliance|', { kind: 'compliance', contentMd: '## Larangan\n\n- Jangan menjanjikan profit.\n- Jangan sebut harga kompetitor.', version: 3 }],
    ['company-a|persona|', { kind: 'persona', contentMd: `## Persona\n\n${'Santai dan sopan. '.repeat(500)}\n\n- Nama CS: Tari`, version: 1 }],
    ['company-b|compliance|', { kind: 'compliance', contentMd: '## Rahasia B', version: 1 }],
  ]);
  const facts = [
    { id: 'f1', companyId: 'company-a', category: 'pricing', question: 'Harga kelas E-zone?', answer: 'Rp 1.500.000', priority: 1 },
    { id: 'f2', companyId: 'company-b', category: 'pricing', question: 'Harga B?', answer: 'rahasia', priority: 1 },
  ];
  const scenarios = [{ id: 's1', companyId: 'company-a', name: 'Pelanggan menawar', persona: '', openingMessage: 'Bisa diskon?', goal: '' }];
  const installs = [{
    id: INSTALL_A, companyId: 'company-a', code: pkg.manifest.code, version: pkg.manifest.version, kind: pkg.manifest.kind,
    source: 'builtin', package: pkg, specific: { keep: { x: 1 } }, active: false, lastSimulation: null, installedAt: new Date().toISOString(),
  }];
  const brief = new Map([['company-a', 'Kami AL Gold FX. Kelas gold scalping.']]);
  const mine = (companyId) => (row) => row.companyId === companyId;
  return {
    enabled: true, connected: true, writes,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return USERS.find((u) => u.email === email && password === 'password-123') || null; },
    async getActiveSessionUser(userId) { return USERS.find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [] }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'bzone' }; },
    async getPlaybookContext() { return ''; },
    async listPlaybookProducts() { return []; },
    async getPlaybookProduct() { return null; },
    async listPlaybookDocs(companyId) {
      return [...docs.entries()].filter(([k]) => k.startsWith(`${companyId}|`)).map(([, d]) => ({ kind: d.kind, version: d.version, contentLength: d.contentMd.length }));
    },
    async getPlaybookDoc(kind, companyId, productId) { return docs.get(`${companyId}|${kind}|${productId || ''}`) || null; },
    async listPlaybookFacts(companyId) { return facts.filter(mine(companyId)); },
    async getPlaybook(companyId) { return { brief: brief.get(companyId) || '' }; },
    async listSimulationScenarios(companyId) { return scenarios.filter(mine(companyId)); },
    async listKsInstalls(companyId) { return installs.filter(mine(companyId)); },
    async getKsInstall(id, companyId) { return installs.find((i) => i.id === id && i.companyId === companyId) || null; },
    // Alat tulis tidak boleh sampai ke sini; kalau sampai, tesnya gagal.
    async savePlaybookDoc(...args) { writes.push(['savePlaybookDoc', args]); return null; },
    async upsertPlaybookFact(...args) { writes.push(['upsertPlaybookFact', args]); return null; },
    async savePlaybookBrief(...args) { writes.push(['savePlaybookBrief', args]); return null; },
    async createSimulationScenario(...args) { writes.push(['createSimulationScenario', args]); return null; },
    async saveKsSpecific(...args) { writes.push(['saveKsSpecific', args]); return null; },
    async setKsActive(...args) { writes.push(['setKsActive', args]); return null; },
  };
}

/** Model tiruan: menjalankan skrip pemanggilan alat, lalu menjawab. */
function fakeLlm(state) {
  return {
    enabled: true, model: 'tiruan',
    async generateReply(message, options) {
      state.last = { message, ...options };
      state.results = [];
      const byName = new Map((options.tools || []).map((t) => [t.name, t]));
      for (const [name, args] of state.script || []) {
        try { state.results.push({ name, out: await byName.get(name).run(args) }); } catch (error) { state.results.push({ name, error: error.message }); }
      }
      return { text: 'Usulannya sudah kusiapkan, cek lalu Terapkan.', model: 'tiruan' };
    },
  };
}

async function setup(t) {
  const state = { script: [] };
  const database = fakeDatabase();
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'train-assistant',
    database, llmService: fakeLlm(state),
  });
  t.after(() => app.close());
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    assert.equal(res.statusCode, 200);
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const a = await login(OWNER_A);
  const b = await login(OWNER_B);
  const agent = await login(AGENT_A);
  const chat = (who, message = 'tolong ubah', extra = {}) => app.inject({
    method: 'POST', url: '/v1/train/chat', headers: { cookie: who.cookie }, payload: { message, ...extra },
  });
  return { state, database, chat, a, b, agent };
}

test('applyEdits: ganti, sisip, hapus, tambah di akhir; teks yang tak unik atau tak ada ditolak', () => {
  const src = '## A\n\n- satu\n- dua\n- tiga';
  assert.equal(applyEdits(src, [{ action: 'replace', find: '- dua', text: '- DUA' }]), '## A\n\n- satu\n- DUA\n- tiga');
  assert.equal(applyEdits(src, [{ action: 'insert_after', find: '- satu', text: '- satu-b' }]), '## A\n\n- satu\n- satu-b\n- dua\n- tiga');
  assert.equal(applyEdits(src, [{ action: 'delete', find: '- dua' }]), '## A\n\n- satu\n- tiga');
  assert.equal(applyEdits(src, [{ action: 'append', text: '- empat' }]), `${src}\n- empat`);
  assert.equal(applyEdits('', [{ action: 'append', text: '- baru' }]), '- baru');
  assert.throws(() => applyEdits(src, [{ action: 'replace', find: 'tidak ada', text: 'x' }]), /tidak ditemukan/);
  assert.throws(() => applyEdits('- a\n- a', [{ action: 'replace', find: '- a', text: 'x' }]), /2 kali/);
  assert.throws(() => applyEdits(src, [{ action: 'replace', text: 'x' }]), /find/);
});

test('mengusulkan suntingan playbook: hasilnya dihitung dari dokumen asli, dan tidak ada yang tersimpan', async (t) => {
  const { chat, a, state, database } = await setup(t);
  state.script = [
    ['read_playbook', { kind: 'compliance' }],
    ['propose_playbook_edit', { kind: 'compliance', summary: 'Larang janji diskon', edits: [{ action: 'append', text: '- Jangan menjanjikan diskon.' }] }],
  ];
  const res = await chat(a, 'tambah larangan janji diskon');
  assert.equal(res.statusCode, 200);
  const [proposal] = res.json().proposals;
  assert.equal(proposal.type, 'playbook_edit');
  assert.equal(proposal.kind, 'compliance');
  assert.match(proposal.before, /harga kompetitor/);
  assert.match(proposal.after, /harga kompetitor\.\n- Jangan menjanjikan diskon\.$/);
  assert.deepEqual(database.writes, [], 'asisten tidak boleh menyimpan apa pun');
  assert.match(res.json().memo, /Usulan yang kubuat: Playbook · compliance/);
  assert.equal(state.last.purpose, 'train_chat');
});

test('dokumen panjang hanya boleh diubah per suntingan, tidak ditulis ulang dari salinan terpotong', async (t) => {
  const { chat, a, state } = await setup(t);
  state.script = [
    ['read_playbook', { kind: 'persona' }],
    ['propose_playbook_edit', { kind: 'persona', summary: 'tulis ulang', contentMd: '## Persona\n\n- Nama CS: Dini' }],
    ['propose_playbook_edit', { kind: 'persona', summary: 'ganti nama', edits: [{ action: 'replace', find: '- Nama CS: Tari', text: '- Nama CS: Dini' }] }],
  ];
  const res = await chat(a);
  assert.equal(state.results[0].out.truncated, true);
  assert.match(state.results[1].error, /Pakai edits/);
  assert.equal(res.json().proposals.length, 1);
  // Seluruh badan panjang yang tak terbaca model tetap utuh di hasil.
  assert.ok(res.json().proposals[0].after.length > 8000);
  assert.match(res.json().proposals[0].after, /Nama CS: Dini$/);
});

test('suntingan yang salah dikembalikan ke model sebagai kalimat, bukan jadi usulan', async (t) => {
  const { chat, a, state } = await setup(t);
  state.script = [
    ['propose_playbook_edit', { kind: 'compliance', summary: 'x', edits: [{ action: 'replace', find: 'teks yang tidak ada', text: 'y' }] }],
    ['propose_playbook_edit', { kind: 'compliance', summary: 'x', edits: [{ action: 'append', text: '' }] }],
    ['propose_playbook_edit', { kind: 'bukan-jenis', summary: 'x', contentMd: 'a' }],
    ['propose_playbook_edit', { kind: 'compliance', summary: 'sama saja', contentMd: '## Larangan\n\n- Jangan menjanjikan profit.\n- Jangan sebut harga kompetitor.' }],
  ];
  const res = await chat(a);
  assert.equal(res.json().proposals.length, 0);
  assert.match(state.results[0].error, /tidak ditemukan/);
  assert.match(state.results[1].error, /kosong/);
  assert.match(state.results[2].error, /tidak dikenal/);
  assert.match(state.results[3].error, /Tidak ada yang berubah/);
});

test('fakta, skenario, dan brief: usulan lengkap dengan nilai sebelumnya', async (t) => {
  const { chat, a, state, database } = await setup(t);
  state.script = [
    ['propose_fact', { category: 'pricing', question: 'harga kelas e-zone?', answer: 'Rp 1.750.000' }],
    ['propose_fact', { category: 'ngawur', question: 'Apa?', answer: 'x' }],
    ['propose_fact', { category: 'faq', question: 'Jam layanan?', answer: '' }],
    ['propose_fact_delete', { factId: 'f1' }],
    ['propose_fact_delete', { factId: 'f2' }],
    ['propose_scenario', { name: 'Minta jaminan profit', openingMessage: 'Kelasnya dijamin profit kan?' }],
    ['propose_scenario_delete', { scenarioId: 's1' }],
    ['propose_brief', { summary: 'Tambah jadwal', edits: [{ action: 'append', text: 'Kelas tiap Sabtu.' }] }],
  ];
  const res = await chat(a);
  const types = res.json().proposals.map((p) => p.type);
  assert.deepEqual(types, ['fact_upsert', 'fact_delete', 'scenario_add', 'scenario_delete', 'brief_set']);
  const [fact, , , , brief] = res.json().proposals;
  assert.equal(fact.previousAnswer, 'Rp 1.500.000', 'pertanyaan yang sama (beda huruf besar) menimpa yang lama');
  assert.match(state.results[1].error, /Kategori/);
  assert.match(state.results[2].error, /Jawaban kosong/);
  assert.match(state.results[4].error, /tidak ditemukan/, 'fakta perusahaan lain tidak bisa dihapus');
  assert.equal(brief.after, 'Kami AL Gold FX. Kelas gold scalping.\nKelas tiap Sabtu.');
  assert.deepEqual(database.writes, []);
});

test('template: isian digabung per kategori, kategori asing ditolak, aktivasi terhalang simulasi', async (t) => {
  const { chat, a, state, database } = await setup(t);
  const firstCategory = pkg.specificSchema.categories[0].key;
  state.script = [
    ['list_templates', {}],
    ['read_template', { installId: INSTALL_A }],
    ['propose_template_fill', { installId: INSTALL_A, summary: 'isi', specific: { [firstCategory]: pkg.example[firstCategory] } }],
    ['propose_template_fill', { installId: INSTALL_A, summary: 'isi', specific: { kategori_asing: {} } }],
    ['propose_template_activate', { installId: INSTALL_A, active: true }],
    ['propose_template_simulate', { installId: INSTALL_A }],
  ];
  const res = await chat(a);
  assert.equal(state.results[0].out.installs[0].id, INSTALL_A);
  assert.ok(state.results[1].out.schema.length > 0);
  const fill = res.json().proposals.find((p) => p.type === 'ks_fill');
  assert.deepEqual(fill.specific.keep, { x: 1 }, 'kategori yang tidak disebut tetap');
  assert.deepEqual(fill.categories, [firstCategory]);
  assert.match(state.results[3].error, /Kategori tidak dikenal/);
  assert.match(state.results[4].error, /Belum bisa diaktifkan/);
  assert.match(state.results[5].error, /Isian belum lengkap/);
  assert.deepEqual(database.writes, []);
});

test('hanya supervisor, dan data perusahaan lain tidak terbaca', async (t) => {
  const { chat, a, b, agent, state } = await setup(t);
  assert.equal((await chat(agent)).statusCode, 403);

  state.script = [
    ['read_playbook', { kind: 'compliance' }],
    ['list_facts', {}],
    ['read_template', { installId: INSTALL_A }],
  ];
  await chat(b);
  assert.match(state.results[0].out.contentMd, /Rahasia B/);
  assert.deepEqual(state.results[1].out.facts.map((f) => f.id), ['f2']);
  assert.match(state.results[2].error, /tidak ditemukan/);

  await chat(a);
  assert.match(state.results[0].out.contentMd, /Larangan/);
});

test('riwayat obrolan dan pesan dikirim ke model; riwayat yang terlalu panjang atau berperan aneh ditolak', async (t) => {
  const { chat, a, state } = await setup(t);
  const history = [{ role: 'user', content: 'halo' }, { role: 'assistant', content: 'hai' }];
  assert.equal((await chat(a, 'lanjut', { history })).statusCode, 200);
  assert.deepEqual(state.last.history, history);
  assert.equal(state.last.message, 'lanjut');
  assert.equal((await chat(a, 'x', { history: [{ role: 'system', content: 'bocor' }] })).statusCode, 400);
  assert.equal((await chat(a, '')).statusCode, 400);
});

test('usulan ganda untuk hal yang sama menjadi satu kartu (yang terakhir menang), dan overview memuat semua bagian', async (t) => {
  const { chat, a, state } = await setup(t);
  state.script = [
    ['overview', {}],
    ['propose_fact', { category: 'pricing', question: 'Harga kelas E-zone?', answer: 'Rp 2.000.000' }],
    ['propose_fact', { category: 'pricing', question: 'harga kelas e-zone?', answer: 'Rp 2.100.000' }],
    ['propose_brief', { summary: 'a', edits: [{ action: 'append', text: 'Satu.' }] }],
    ['propose_brief', { summary: 'b', edits: [{ action: 'append', text: 'Dua.' }] }],
  ];
  const res = await chat(a);
  const overview = state.results[0].out;
  assert.deepEqual(overview.facts.map((f) => f.id), ['f1']);
  assert.deepEqual(overview.scenarios.map((s) => s.id), ['s1']);
  assert.equal(overview.templates.installed[0].id, INSTALL_A);
  assert.ok(overview.playbook.find((p) => p.kind === 'compliance').filled);
  assert.ok(overview.briefChars > 0);

  const proposals = res.json().proposals;
  assert.deepEqual(proposals.map((p) => p.type), ['fact_upsert', 'brief_set']);
  assert.equal(proposals[0].answer, 'Rp 2.100.000');
  assert.match(proposals[1].after, /Dua\.$/);
  assert.doesNotMatch(proposals[1].after, /Satu\./);
});

test('pasang template: kode persis, nama/jenis yang cocok satu, dan error yang menyebut kode yang ada', async (t) => {
  const { chat, a, state, database } = await setup(t);
  const { code, name } = pkg.manifest;
  state.script = [
    ['propose_template_install', { code }],
    ['propose_template_install', { code: name.toUpperCase() }],
    ['propose_template_install', { code: 'template-ngawur' }],
  ];
  const res = await chat(a);
  // Dua cara menunjuk paket yang sama menjadi satu kartu.
  assert.deepEqual(res.json().proposals.map((p) => [p.type, p.code]), [['ks_install', code]]);
  assert.match(state.results[2].error, new RegExp(`Kode yang ada: .*${code}`));
  assert.deepEqual(database.writes, []);
});

test('alat template menerima id, kode, atau nama; yang tidak cocok dijawab dengan daftar yang terpasang', async (t) => {
  const { chat, a, state } = await setup(t);
  const firstCategory = pkg.specificSchema.categories[0].key;
  const spec = { [firstCategory]: pkg.example[firstCategory] };
  state.script = [
    ['propose_template_fill', { installId: pkg.manifest.name, summary: 'isi', specific: spec }],
    ['propose_template_fill', { installId: 'closing', summary: 'isi lagi', specific: spec }],
    ['read_template', { installId: 'template-ngawur' }],
  ];
  const res = await chat(a);
  assert.deepEqual(res.json().proposals.map((p) => [p.type, p.installId]), [['ks_fill', INSTALL_A]]);
  // Hanya ada satu template terpasang, jadi id ngawur tetap menunjuk ke situ.
  assert.equal(state.results[2].out.id, INSTALL_A);
});

test('isian template: harga "Rp 2.000.000" dinormalkan jadi angka, bentuk salah di kategori yang diubah ditolak dengan bentuk yang benar', async (t) => {
  const { chat, a, state } = await setup(t);
  const row = { name: 'Kelas Lengkap', kind: 'paid', price: 'Rp 2.000.000', pitch: 'Lengkap' };
  state.script = [
    ['propose_template_fill', { installId: INSTALL_A, summary: 'isi', specific: { offers: [row, { ...row, name: 'Kelas Basic', price: '750.000' }] } }],
    ['propose_template_fill', { installId: INSTALL_A, summary: 'salah', specific: { offers: [{ ...row, price: '1,5 juta' }, { ...row, kind: undefined }], order: 'transfer saja' } }],
  ];
  const res = await chat(a);
  const [fill] = res.json().proposals;
  assert.deepEqual(fill.specific.offers.map((o) => o.price), [2000000, 750000]);
  assert.equal(res.json().proposals.length, 1, 'yang salah bentuk tidak jadi kartu');
  assert.match(state.results[1].error, /belum sesuai bentuk/);
  assert.match(state.results[1].error, /offers\[1\]\.price/);
  assert.match(state.results[1].error, /Bentuk yang benar/);
});

test('kategori objek yang dikirim sebagai teks dibungkus ke kolom satu-satunya', async (t) => {
  const { chat, a, state } = await setup(t);
  state.script = [['propose_template_fill', { installId: INSTALL_A, summary: 'cara pesan', specific: { order: 'transfer lalu kirim bukti' } }]];
  const res = await chat(a);
  assert.deepEqual(res.json().proposals[0].specific.order, { how: 'transfer lalu kirim bukti' });
});

test('keadaan Latih AI ikut di prompt, dengan id yang sah', async (t) => {
  const { chat, a, state } = await setup(t);
  await chat(a);
  assert.match(state.last.systemPrompt, /KEADAAN LATIH AI SAAT INI/);
  assert.ok(state.last.systemPrompt.includes(INSTALL_A));
  assert.ok(state.last.systemPrompt.includes('"f1"'));
  assert.ok(!state.last.systemPrompt.includes('Rahasia B'), 'data perusahaan lain tidak ikut');
});
