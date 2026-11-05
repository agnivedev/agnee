'use strict';
// Simulasi customer ESBEJE lewat /v1/coach/simulate (tanpa chatId: tidak menulis chat, tidak membangunkan departemen).
process.chdir('/app');
const { buildApp } = require('/app/src/server.js');
const Database = require('/app/src/database.js');
const COMPANY = 'fdf4441c-6a15-42d9-84ed-65c85debb660';
const CONVOS = require('/sim/convos.json');
const MODELS = (process.env.MODELS || '').split(',').filter(Boolean);
let currentModel = null;

(async () => {
  const real = new Database({ connectionString: '', logger: console, credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY });
  await real.connect();
  const sup = (await real.pool.query(
    `select u.id,u.email,u.display_name as "displayName",cm.company_id as "companyId",cm.role from users u join company_members cm on cm.user_id=u.id where cm.company_id=$1 and cm.role in ('owner','supervisor','admin') and cm.status='active' limit 1`, [COMPANY])).rows[0];
  if (!sup) throw new Error('tidak ada supervisor ESBEJE');
  const database = new Proxy(real, {
    get(target, prop) {
      if (prop === 'authenticateUser') return async (email, pw) => (email === sup.email && pw === 'simulasi' ? sup : null);
      if (prop === 'setPresence') return async () => {};
      if (prop === 'getAiSettings') return async (id) => { const r = await target.getAiSettings(id); return currentModel ? { ...r, modelChain: [currentModel] } : r; };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, database });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: sup.email, password: 'simulasi' } });
  if (login.statusCode !== 200) throw new Error('login simulasi gagal ' + login.statusCode);
  const cookie = login.headers['set-cookie'].split(';')[0];
  for (const model of (MODELS.length ? MODELS : [null])) {
    currentModel = model;
    console.log(`\n######## MODEL: ${model || '(bawaan produksi)'} ########`);
    for (const convo of CONVOS) {
      console.log(`\n${'='.repeat(70)}\n${convo.title}\n${'='.repeat(70)}`);
      const transcript = [];
      for (const text of convo.turns) {
        const t0 = Date.now();
        const res = await app.inject({ method: 'POST', url: '/v1/coach/simulate', headers: { cookie }, payload: { mode: 'ai', customerMessage: text, transcript, grade: false } });
        let body; try { body = JSON.parse(res.body); } catch { body = { raw: res.body }; }
        console.log(`\n👤 ${text}`);
        if (res.statusCode !== 200) { console.log(`   [HTTP ${res.statusCode}] ${JSON.stringify(body).slice(0, 300)}`); break; }
        const reply = body.reply || body.aiReply || '';
        console.log(`🤖 ${reply}`);
        const extra = [`${Date.now() - t0}ms`];
        if (body.usage) extra.push('usage: ' + JSON.stringify(body.usage).slice(0, 160));
        if (body.toolCalls?.length) extra.push('alat: ' + body.toolCalls.map((c) => c.name).join(','));
        if (body.uncertainty) extra.push('tidak-yakin: ' + JSON.stringify(body.uncertainty).slice(0, 120));
        console.log('   · ' + extra.join(' | '));
        transcript.push({ role: 'customer', text }, { role: 'agent', text: reply || '-' });
      }
    }
  }
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('GAGAL', e); process.exit(1); });
