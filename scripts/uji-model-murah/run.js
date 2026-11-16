'use strict';
/**
 * Uji model murah — pelaksana (jalan DI DALAM container app, baca-saja terhadap produksi).
 *
 * Contoh (di server, dari /opt/agnee; /uji berisi berkas ini + kasus.json):
 *   docker compose run --no-deps -T \
 *     -e MODELS=anthropic/claude-haiku-5.5,google/gemini-2.5-flash,openai/gpt-5.4-mini -e RUNS=2 \
 *     -e LLM_MAX_TOKENS=2000 -e AI_ESCALATION_CHAIN= \
 *     -v /opt/agnee/src:/app/src:ro -v /root/uji:/uji app node /uji/run.js
 *
 * Aman: setiap metode DB yang bukan pembacaan dijadikan no-op (dicatat), pool.query non-SELECT
 * dibuang, login memakai supervisor ESBEJE lewat pembungkus (tanpa mengubah kata sandi), tanpa WhatsApp.
 * Biaya dijumlahkan dari usage.cost SETIAP respons OpenRouter (pembungkus fetch).
 * BLOCK_LLM=1 memblokir panggilan OpenRouter (uji kabel tanpa biaya).
 */
process.chdir('/app');
const fs = require('fs');
const { buildApp } = require('/app/src/server.js');
const Database = require('/app/src/database.js');

const COMPANY = 'fdf4441c-6a15-42d9-84ed-65c85debb660';
const MODELS = (process.env.MODELS || '').split(',').filter(Boolean);
const RUNS = Number(process.env.RUNS || 2);
const OUT = process.env.OUT || '/uji/out';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const KASUS = JSON.parse(fs.readFileSync(process.env.KASUS || '/uji/kasus.json', 'utf8')).kasus;
const MAX_BUDGET = Number(process.env.MAX_BUDGET_USD || 3);

// ── pelacak biaya: tee semua respons chat/completions OpenRouter ──────────────
let current = null; // { model, kasus, run }
const calls = [];
const realFetch = globalThis.fetch;
let spent = 0;
globalThis.fetch = async (url, opts) => {
  const isOr = typeof url === 'string' && url.includes('openrouter.ai/api/v1/chat/completions');
  if (isOr && process.env.BLOCK_LLM === '1') throw new Error('BLOCK_LLM: panggilan OpenRouter diblokir');
  if (isOr && spent >= MAX_BUDGET) throw new Error(`MAX_BUDGET_USD ${MAX_BUDGET} tercapai`);
  const label = current;
  const res = await realFetch(url, opts);
  if (isOr) {
    res.clone().json().then((j) => {
      const cost = Number(j?.usage?.cost || 0);
      spent += cost;
      let requested = null; try { requested = JSON.parse(opts.body).model; } catch { /* abaikan */ }
      calls.push({ ...(label || {}), requested, served: j?.model || null, cost,
        usage: j?.usage ? { p: j.usage.prompt_tokens, c: j.usage.completion_tokens, r: j.usage.completion_tokens_details?.reasoning_tokens } : null,
        finish: j?.choices?.[0]?.finish_reason || null, error: j?.error?.message || null });
    }).catch(() => {});
  }
  return res;
};

const READ = /^(get|list|find|search|count|has|is|load|fetch|read|check|resolve|match|query|can|lookup|select|peek|verify|connect|ensure|top|recent)/i;
const blocked = new Map();
const bump = (key) => blocked.set(key, (blocked.get(key) || 0) + 1);

(async () => {
  const real = new Database({ connectionString: '', logger: console, credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY });
  await real.connect();
  // Setiap query lewat pool: hanya SELECT/WITH/SHOW/EXPLAIN yang lolos; sisanya dibuang dan dicatat.
  const origQuery = real.pool.query.bind(real.pool);
  real.pool.query = (sql, ...rest) => {
    const text = String(typeof sql === 'string' ? sql : sql?.text || '').trim();
    if (!/^(select|with|show|explain)\b/i.test(text)) { bump(`pool.query: ${text.slice(0, 60)}`); return Promise.resolve({ rows: [], rowCount: 0 }); }
    return origQuery(sql, ...rest);
  };
  const sup = (await real.pool.query(
    `select u.id,u.email,u.display_name as "displayName",cm.company_id as "companyId",cm.role from users u join company_members cm on cm.user_id=u.id where cm.company_id=$1 and cm.role in ('owner','supervisor','admin') and cm.status='active' limit 1`, [COMPANY])).rows[0];
  if (!sup) throw new Error('tidak ada supervisor ESBEJE');
  const prodChain = (await real.getAiSettings(COMPANY)).modelChain;
  console.log('rantai model produksi ESBEJE (hanya dibaca):', JSON.stringify(prodChain));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/_rantai-produksi.json`, JSON.stringify(prodChain));
  let currentModel = null;
  const database = new Proxy(real, {
    get(target, prop) {
      if (prop === 'authenticateUser') return async (email, pw) => (email === sup.email && pw === 'uji-model' ? sup : null);
      if (prop === 'getAiSettings') return async (id) => { const r = await target.getAiSettings(id); return currentModel ? { ...r, modelChain: [currentModel] } : r; };
      const v = target[prop];
      if (typeof v !== 'function') return v;
      if (typeof prop === 'string' && !READ.test(prop) && prop !== 'status') {
        return async () => { bump(prop); return null; };
      }
      return v.bind(target);
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, database });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: sup.email, password: 'uji-model' } });
  if (login.statusCode !== 200) throw new Error(`login uji gagal ${login.statusCode}`);
  const cookie = login.headers['set-cookie'].split(';')[0];

  const cases = KASUS.filter((k) => !ONLY.length || ONLY.includes(k.id));
  const jobs = [];
  for (let run = 1; run <= RUNS; run++) for (const model of MODELS) for (const k of cases) jobs.push({ run, model, k });
  console.log(`${jobs.length} percakapan, ${jobs.reduce((a, j) => a + j.k.giliran.length, 0)} giliran`);

  async function oneConvo({ run, model, k }) {
    const file = `${OUT}/${model.replace(/\//g, '__')}.run${run}.${k.id}.json`;
    if (fs.existsSync(file)) return; // lanjutkan bila terputus
    const transcript = []; const turns = [];
    for (let g = 0; g < k.giliran.length; g++) {
      const text = k.giliran[g];
      const t0 = Date.now();
      const res = await app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage: text, transcript, grade: false } });
      const ms = Date.now() - t0;
      let body; try { body = JSON.parse(res.body); } catch { body = { raw: res.body }; }
      const reply = res.statusCode === 200 ? (body.reply || '') : '';
      turns.push({ giliran: g + 1, customer: text, http: res.statusCode, reply,
        error: res.statusCode === 200 ? null : String(body.error || body.raw || '').slice(0, 300),
        ms, model: body.model || null, usage: body.usage || null, uncertainty: body.uncertainty || null,
        departmentQuestions: body.departmentQuestions || [], escalation: body.escalation || null, product: body.product || null });
      transcript.push({ role: 'customer', text }, { role: 'agent', text: reply || '-' });
    }
    fs.writeFileSync(file, JSON.stringify({ model, run, kasus: k.id, turns }, null, 1));
  }

  // Model dipaksa lewat getAiSettings (global), jadi percakapan berjalan satu per satu.
  let done = 0;
  for (const job of jobs) {
    current = { model: job.model, kasus: job.k.id, run: job.run };
    currentModel = job.model;
    try { await oneConvo(job); } catch (e) { console.error('GAGAL', job.model, job.k.id, e.message); }
    done += 1;
    process.stdout.write(`\r${done}/${jobs.length} dibelanjakan $${spent.toFixed(4)}   `);
  }
  await new Promise((r) => setTimeout(r, 1500)); // beri waktu pelacak biaya menulis panggilan terakhir
  fs.writeFileSync(`${OUT}/_calls.json`, JSON.stringify(calls, null, 1));
  fs.writeFileSync(`${OUT}/_blocked-writes.json`, JSON.stringify([...blocked], null, 1));
  console.log(`\nselesai. biaya total $${spent.toFixed(4)}; penulisan DB yang dibuang:`, JSON.stringify([...blocked]));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('GAGAL', e); process.exit(1); });
