'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const Database = require('../src/database.js');

const DB_URL = process.env.DATABASE_URL;
const skip = !DB_URL && 'DATABASE_URL tidak diset';
const CUSTOMER_CHAT = '6281200000077@c.us';
const GROUP = '120363000000000001@g.us';

const RULE_ANSWER = 'Gratis ongkir untuk order di atas Rp 500.000 area Jabodetabek.';

/**
 * Jawaban departemen jadi usulan knowledge: Postgres asli untuk departemen,
 * pertanyaan, usulan, Fakta, dan notifikasi; WhatsApp dan model dipalsukan.
 * `state.assess` menentukan penilaian model per kasus.
 */
async function setup(t) {
  const real = new Database({ connectionString: DB_URL, logger: { info() {}, warn() {} } });
  await real.connect();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const company = (await real.pool.query("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Uji') RETURNING id", [`dl-a-${stamp}`])).rows[0].id;
  const other = (await real.pool.query("INSERT INTO companies (slug, name) VALUES ($1, 'Toko Lain') RETURNING id", [`dl-b-${stamp}`])).rows[0].id;
  const mkUser = async (label, companyId, role) => {
    const email = `${label}-${stamp}@pelanggan.test`;
    const { rows: [u] } = await real.pool.query('INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id', [email, label]);
    await real.pool.query('INSERT INTO company_members (company_id, user_id, role, whatsapp_number) VALUES ($1, $2, $3, $4)',
      [companyId, u.id, role, role === 'agent' ? null : '08123456789']);
    return { id: u.id, userId: u.id, companyId, email, displayName: label, role, status: 'active', isPlatformAdmin: false };
  };
  const SUP = await mkUser('sup', company, 'owner');
  const AGENT = await mkUser('agen', company, 'agent');
  const SUP_B = await mkUser('supb', other, 'owner');
  const users = [SUP, AGENT, SUP_B];
  // Staf Management yang menjawab dari web (anggota departemen).
  const STAFF = await mkUser('rina', company, 'agent');
  users.push(STAFF);
  const dept = async (name, groupId) => (await real.pool.query(
    'INSERT INTO departments (company_id, name, whatsapp_group_id) VALUES ($1, $2, $3) RETURNING id', [company, `${name}-${stamp}`, groupId],
  )).rows[0].id;
  const MGMT = await dept('Management', GROUP);
  const FIN = await dept('Finance', '120363000000000002@g.us');
  await real.pool.query('INSERT INTO department_members (department_id, user_id, company_id) VALUES ($1, $2, $3)', [MGMT, STAFF.id, company]);
  await real.pool.query('INSERT INTO department_members (department_id, user_id, company_id) VALUES ($1, $2, $3)', [MGMT, AGENT.id, company]);

  const state = { prompts: [], assess: null, assessCalls: 0 };
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, password) { return users.find((u) => u.email === email && password === 'password-123') || null; },
    async getActiveSessionUser(userId) { return users.find((u) => u.id === userId) || null; },
    async setPresence() {},
    async getAiSettings() { return { enabled: true, modelChain: [], identity: 'team_member' }; },
    async getCompanyConfig() { return { planStatus: 'active', status: 'active', knowledgeClient: 'agnee', aiIdentity: 'team_member' }; },
  };
  const delegated = /Knowledge|Department|PlaybookFacts|PlaybookContext|listCreditRecipients|recordAuditLog|findMemberByWhatsapp|recordOutboundReply|upsertPlaybookFact/;
  const db = new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      if (typeof prop === 'string' && delegated.test(prop) && typeof real[prop] === 'function') return real[prop].bind(real);
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });

  const llm = {
    enabled: true,
    model: 'tiruan',
    async generateReply(message, options) {
      state.prompts.push({ purpose: options.purpose, systemPrompt: options.systemPrompt || '', message });
      if (options.purpose === 'knowledge_check') {
        if (/JAWABAN STAF:/.test(message)) {
          state.assessCalls += 1;
          const verdict = typeof state.assess === 'function' ? state.assess(message) : state.assess;
          return { text: JSON.stringify(verdict), model: 'tiruan' };
        }
        if (/USULAN:/.test(message)) return { text: '{"status":"new","note":""}', model: 'tiruan' };
        return { text: '{"variants":["ada gratis ongkir gak","free ongkir syaratnya apa"]}', model: 'tiruan' };
      }
      if (options.purpose === 'judge') {
        return { text: JSON.stringify({ scores: { accuracy: 5, helpfulness: 5, funnel: 4, tone: 5 }, verdict: 'pass', strengths: [], issues: [], suggestedReply: '', missingInfo: [] }), model: 'tiruan' };
      }
      if (options.purpose === 'simulate') {
        // Hanya tahu aturannya bila ada di prompt (dari Fakta atau blok usulan).
        const knows = (options.systemPrompt || '').includes('di atas Rp 500.000');
        return { text: knows ? 'Gratis ongkir kak untuk order di atas Rp 500.000 area Jabodetabek.' : 'Aku cek dulu ke tim ya kak.', model: 'tiruan', usage: {} };
      }
      // auto_reply (meneruskan jawaban ke customer)
      return { text: 'Kabar baik kak, ada gratis ongkir untuk order tertentu ya.', model: 'tiruan', usage: {} };
    },
  };
  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: true, sessionSecret: 'dl-routes', database: db, llmService: llm,
  });
  t.after(async () => {
    await app.close();
    await real.pool.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [[company, other]]);
    await real.pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users.map((u) => u.id)]);
    await real.pool.end();
  });
  const login = async (user) => {
    const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: user.email, password: 'password-123' } });
    assert.equal(res.statusCode, 200);
    return { cookie: res.headers['set-cookie'].split(';')[0] };
  };
  const call = (who, method, url, payload) => app.inject({ method, url, headers: { cookie: who.cookie }, payload });
  const ctx = {
    app, real, state, call, company, other, MGMT, FIN, ids: { SUP, AGENT, STAFF },
    sup: await login(SUP), agent: await login(AGENT), supB: await login(SUP_B), staff: await login(STAFF),
  };
  ctx.enable = async () => assert.equal((await call(ctx.sup, 'PUT', '/v1/knowledge/settings', { enabled: true })).statusCode, 200);
  /** Pertanyaan AI ke departemen yang menunggu jawaban (dengan id pesan grup untuk reply). */
  ctx.ask = async ({ dept = MGMT, question = 'Apakah ada gratis ongkir untuk order besar?', customer = 'kak gratis ongkir gak?', stanza = `ST${Math.random().toString(36).slice(2, 10)}` } = {}) => {
    const row = (await real.pool.query(`
      INSERT INTO department_questions (company_id, department_id, chat_id, customer_text, question, group_message_ids)
      VALUES ($1, $2, $3, $4, $5, ARRAY[$6]) RETURNING id`, [company, dept, CUSTOMER_CHAT, customer, question, stanza])).rows[0];
    return { id: row.id, stanza };
  };
  /** Staf membalas di grup dengan reply ke pemberitahuan AI. */
  ctx.groupAnswer = async (q, body, group = GROUP) => {
    await app.handleInboundMessage(company, {
      from: group, body, type: 'chat', hasMedia: false, timestamp: Math.floor(Date.now() / 1000),
      id: { _serialized: `true_${group}_${q.stanza}A` }, author: '08123456789@c.us', _data: { quotedStanzaID: q.stanza },
      async reply() {},
    });
    await app.learningIdle();
  };
  ctx.proposals = async () => (await real.pool.query(
    "SELECT * FROM knowledge_proposals WHERE company_id = $1 AND origin = 'department' ORDER BY created_at", [company],
  )).rows;
  return ctx;
}

const GENERAL = (over = {}) => ({
  scope: 'general', reusable: true, question: 'Apakah ada gratis ongkir untuk order besar?', answer: RULE_ANSWER,
  category: 'pricing', reason: 'aturan promo', ...over,
});
const TRANSACTION = { scope: 'transaction', reusable: false, question: '', answer: '', category: 'faq', reason: 'urusan satu transaksi' };

test('saklar mati: jawaban grup tetap diteruskan, tidak ada penilaian model dan tidak ada usulan', { skip }, async (t) => {
  const x = await setup(t);
  x.state.assess = GENERAL();
  const q = await x.ask();
  await x.groupAnswer(q, RULE_ANSWER);
  const row = (await x.real.pool.query('SELECT status, answer FROM department_questions WHERE id = $1', [q.id])).rows[0];
  assert.equal(row.status, 'answered');
  assert.equal(x.state.assessCalls, 0);
  assert.equal((await x.proposals()).length, 0);
});

test('jawaban grup yang berupa aturan umum jadi usulan submitted dengan kasus lengkap dan supervisor dikabari', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = GENERAL();
  const q = await x.ask({ customer: 'kak gratis ongkir gak? wa saya 081234567890' });
  await x.groupAnswer(q, `#${q.id.replace(/-/g, '').slice(0, 6)} ${RULE_ANSWER}`);
  const [p] = await x.proposals();
  assert.ok(p, 'usulan terbentuk');
  assert.equal(p.status, 'submitted');
  assert.equal(p.origin, 'department');
  assert.equal(p.department_question_id, q.id);
  assert.match(p.department_name, /^Management/);
  assert.equal(p.chat_id, CUSTOMER_CHAT);
  assert.equal(p.answer_channel, 'group');
  assert.equal(p.answer_group_id, GROUP);
  assert.equal(p.asked_question, 'Apakah ada gratis ongkir untuk order besar?');
  assert.equal(p.raw_answer, RULE_ANSWER, 'jawaban persis, tanpa kode #');
  assert.doesNotMatch(p.customer_message, /081234567890/, 'nomor customer dibersihkan');
  assert.equal(p.proposed_by, null);
  assert.equal(p.conflict_status, 'new');
  assert.ok(p.answered_at);
  // Lonceng ke supervisor (pemegang peran istimewa), bukan ke agent.
  const bells = (await x.real.pool.query("SELECT user_id, body FROM notifications WHERE company_id = $1 AND kind = 'knowledge'", [x.company])).rows;
  assert.ok(bells.some((b) => b.user_id === x.ids.SUP.id && /Management/.test(b.body)));
  assert.ok(!bells.some((b) => b.user_id === x.ids.AGENT.id));
  // Playbook tidak tersentuh.
  assert.equal((await x.real.pool.query('SELECT count(*)::int AS n FROM playbook_facts WHERE company_id = $1', [x.company])).rows[0].n, 0);
});

test('urusan satu transaksi diabaikan: "transfer sudah masuk" dan stok saat ini', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = TRANSACTION;
  const q = await x.ask({ dept: x.FIN, question: 'Apakah transfer customer ini sudah masuk?' });
  // Finance tak punya grup di simulasi ini: jawab lewat web.
  const answered = await x.call(x.staff, 'POST', `/v1/department-questions/${q.id}/answer`, { answer: 'Sudah masuk jam 10.15 Rp 1.250.000 atas nama Budi' });
  assert.equal(answered.statusCode, 404, 'staf Management bukan anggota Finance');
  const q2 = await x.ask({ question: 'Stok semen 40 sak ready?' });
  await x.groupAnswer(q2, 'Ready 120 sak hari ini');
  assert.equal(x.state.assessCalls, 1);
  assert.equal((await x.proposals()).length, 0);
});

test('model keliru menilai cek transfer sebagai umum: kode menahannya', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = GENERAL({ question: 'Apakah transfer customer sudah masuk?', answer: 'Transfer sudah masuk dengan nominal Rp 1.250.000.' });
  const q = await x.ask({ question: 'Tolong cek transfer customer, sudah masuk belum?', customer: 'sudah transfer ya kak' });
  await x.groupAnswer(q, 'Sudah masuk Rp 1.250.000 jam 10.15 ya');
  assert.equal((await x.proposals()).length, 0);
});

test('pertanyaan kendaraan Lalamove tidak pernah dipelajari', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = GENERAL({ question: 'Kendaraan apa untuk 40 sak semen?', answer: 'Pakai van, ongkir Rp 150.000 untuk 40 sak.' });
  const q = await x.ask({ question: 'Kendaraan Lalamove apa yang cocok untuk 40 sak semen?' });
  await x.groupAnswer(q, 'Pakai van saja, ongkir Rp 150.000');
  assert.equal(x.state.assessCalls, 0, 'dihentikan sebelum memanggil model');
  assert.equal((await x.proposals()).length, 0);
});

test('duplikat: pertanyaan kembar digabung, pernah ditolak tak muncul lagi, Fakta yang sama diabaikan', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = GENERAL();
  await x.groupAnswer(await x.ask(), RULE_ANSWER);
  assert.equal((await x.proposals()).length, 1);
  // Pertanyaan kedua yang sama maknanya: tidak menambah antrean.
  x.state.assess = GENERAL({ question: 'Gratis ongkir untuk order besar ada tidak?' });
  await x.groupAnswer(await x.ask({ question: 'Gratis ongkir order besar ada?' }), RULE_ANSWER);
  assert.equal((await x.proposals()).length, 1, 'digabung');
  // Tolak yang pertama: kali ini sidik yang sama sudah ditolak.
  const [first] = await x.proposals();
  assert.equal((await x.call(x.sup, 'POST', `/v1/knowledge-proposals/${first.id}/reject`, { reason: 'belum pasti' })).statusCode, 200);
  x.state.assess = GENERAL();
  await x.groupAnswer(await x.ask(), RULE_ANSWER);
  assert.equal((await x.proposals()).length, 1, 'yang ditolak tidak diusulkan lagi');
  // Fakta yang sudah menjawab hal sama dengan isi sama.
  await x.real.pool.query(
    "INSERT INTO playbook_facts (company_id, category, question, answer, priority, source) VALUES ($1, 'faq', $2, $3, 2, 'manual')",
    [x.company, 'Gratis ongkir untuk pembelian berapa?', RULE_ANSWER],
  );
  x.state.assess = GENERAL({ question: 'Gratis ongkir untuk pembelian berapa?', answer: RULE_ANSWER });
  await x.groupAnswer(await x.ask({ question: 'Gratis ongkir pembelian berapa?' }), RULE_ANSWER);
  assert.equal((await x.proposals()).length, 1);
});

test('banjir dibatasi: paling banyak MAX_PER_HOUR usulan departemen per jam', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  const topics = ['jam buka Minggu', 'garansi keramik', 'retur cat', 'diskon semen', 'jadwal kirim Bekasi', 'syarat COD', 'kuota promo'];
  const results = [];
  for (const [i, topic] of topics.entries()) {
    x.state.assess = GENERAL({ question: `Bagaimana aturan ${topic} toko ${i}?`, answer: `Aturan ${topic} berlaku setiap hari dengan syarat ${i + 1} hari kerja.` });
    await x.groupAnswer(await x.ask({ question: `Aturan ${topic} nomor ${i}` }), `Aturan ${topic} berlaku setiap hari dengan syarat ${i + 1} hari kerja.`);
    results.push((await x.proposals()).length);
  }
  assert.equal(results[results.length - 1], require('../src/department-learning').MAX_PER_HOUR);
});

test('jawaban lewat web (anggota departemen) juga dipelajari, dengan nama penjawab', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = GENERAL();
  const q = await x.ask();
  const res = await x.call(x.staff, 'POST', `/v1/department-questions/${q.id}/answer`, { answer: RULE_ANSWER });
  assert.equal(res.statusCode, 200);
  await x.app.learningIdle();
  const [p] = await x.proposals();
  assert.ok(p);
  assert.equal(p.answer_channel, 'web');
  assert.equal(p.answer_group_id, null);
  assert.equal(p.answered_by_name, 'rina');
});

test('antrean: asal dan kasus tampil untuk supervisor, tersembunyi dari agent dan company lain', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = GENERAL();
  await x.groupAnswer(await x.ask(), RULE_ANSWER);
  const list = (await x.call(x.sup, 'GET', '/v1/knowledge-proposals?status=submitted')).json();
  assert.equal(list.pending, 1);
  const p = list.proposals[0];
  assert.equal(p.origin, 'department');
  assert.match(p.departmentName, /^Management/);
  assert.equal(p.askedQuestion, 'Apakah ada gratis ongkir untuk order besar?');
  assert.equal(p.rawAnswer, RULE_ANSWER);
  assert.equal(p.answerGroupId, GROUP);
  assert.equal(p.chatId, CUSTOMER_CHAT);
  assert.equal((await x.call(x.agent, 'GET', '/v1/knowledge-proposals')).json().proposals.length, 0);
  assert.equal((await x.call(x.agent, 'GET', `/v1/knowledge-proposals/${p.id}`)).statusCode, 403);
  assert.equal((await x.call(x.supB, 'GET', `/v1/knowledge-proposals/${p.id}`)).statusCode, 404);
  assert.equal((await x.call(x.supB, 'GET', '/v1/knowledge-proposals')).json().proposals.length, 0);
});

test('Terapkan wajib bersimulasi; sesudahnya Fakta berasal "chat" dan simulator-sebagai-customer memakainya', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = GENERAL();
  await x.groupAnswer(await x.ask(), RULE_ANSWER);
  const [p] = await x.proposals();

  // Sebelum diterapkan, customer mendapat jawaban "tanya tim dulu".
  const before = await x.call(x.sup, 'POST', '/v1/coach/simulate', { mode: 'ai', customerMessage: 'kak ada gratis ongkir gak?', grade: false });
  assert.equal(before.statusCode, 200);
  assert.doesNotMatch(before.json().aiReply || before.json().reply?.text || JSON.stringify(before.json()), /500\.000/);

  const early = await x.call(x.sup, 'POST', `/v1/knowledge-proposals/${p.id}/apply`);
  assert.equal(early.statusCode, 400);
  assert.equal(early.json().needsSimulation, true);
  assert.equal((await x.real.pool.query('SELECT count(*)::int AS n FROM playbook_facts WHERE company_id = $1', [x.company])).rows[0].n, 0);

  const sim = await x.call(x.sup, 'POST', `/v1/knowledge-proposals/${p.id}/simulate`);
  assert.equal(sim.statusCode, 200);
  const rows = sim.json().proposal.simulation.rows;
  assert.equal(rows[0].question, 'kak gratis ongkir gak?', 'pertanyaan uji pertama = kalimat asli customer');
  assert.match(rows[0].after, /500\.000/);
  assert.doesNotMatch(rows[0].before, /500\.000/);

  const applied = await x.call(x.sup, 'POST', `/v1/knowledge-proposals/${p.id}/apply`);
  assert.equal(applied.statusCode, 200);
  assert.equal(applied.json().fact.source, 'chat');
  assert.equal(applied.json().proposal.status, 'applied');
  // Tidak ada notifikasi ke "pengusul": departemen bukan pengguna.
  const after = await x.call(x.sup, 'POST', '/v1/coach/simulate', { mode: 'ai', customerMessage: 'kak ada gratis ongkir gak?', grade: false });
  assert.equal(after.statusCode, 200);
  assert.match(JSON.stringify(after.json()), /500\.000/, 'jalur simulator = jalur balasan nyata, kini tahu aturannya');
});

test('menyunting usulan departemen menghapus simulasinya; tolak mencatat alasan', { skip }, async (t) => {
  const x = await setup(t);
  await x.enable();
  x.state.assess = GENERAL();
  await x.groupAnswer(await x.ask(), RULE_ANSWER);
  const [p] = await x.proposals();
  await x.call(x.sup, 'POST', `/v1/knowledge-proposals/${p.id}/simulate`);
  const edit = await x.call(x.sup, 'PATCH', `/v1/knowledge-proposals/${p.id}`, { answer: 'Gratis ongkir untuk order di atas Rp 600.000 area Jabodetabek.' });
  assert.equal(edit.statusCode, 200);
  assert.equal(edit.json().proposal.simulation, null);
  assert.equal(edit.json().proposal.rawAnswer, RULE_ANSWER, 'jawaban staf asli tidak berubah oleh suntingan');
  const rejected = await x.call(x.sup, 'POST', `/v1/knowledge-proposals/${p.id}/reject`, { reason: 'belum final' });
  assert.equal(rejected.json().proposal.status, 'rejected');
});

test('database: getDepartmentQuestionForLearning membaca kind, dan satu usulan per pertanyaan', { skip }, async (t) => {
  const x = await setup(t);
  const q = await x.ask();
  await x.real.pool.query("UPDATE department_questions SET status = 'answered', answer = 'jawab', answered_at = NOW() WHERE id = $1", [q.id]);
  const row = await x.real.getDepartmentQuestionForLearning(q.id, x.company);
  assert.equal(row.kind, 'general'); // kolom kind sudah ada (migrasi 100), bawaan 'general'
  assert.match(row.department, /^Management/);
  assert.equal(await x.real.getDepartmentQuestionForLearning(q.id, x.other), null, 'isolasi tenant');
  const base = { chatId: CUSTOMER_CHAT, question: 'Apakah ada gratis ongkir untuk order besar?', answer: RULE_ANSWER, fingerprint: 'fp-dl', origin: 'department', status: 'submitted', department: { questionId: q.id, name: 'Management' } };
  assert.ok(await x.real.createKnowledgeProposal(base, x.company));
  assert.equal(await x.real.createKnowledgeProposal({ ...base, fingerprint: 'fp-dl2' }, x.company), null, 'pertanyaan yang sama tak punya dua usulan');
});
