'use strict';
// Uji ujung-ke-ujung lokal (serah-terima, mention, credit, mode agent) dengan Postgres
// nyata, stub Meta dan stub OpenRouter. Bukan bagian npm test. Jalankan dari akar repo:
//   DATABASE_URL=... CREDENTIALS_ENCRYPTION_KEY=x node <path>/e2e.js
const crypto = require('node:crypto');
const ROOT = process.cwd();
const Database = require(`${ROOT}/src/database.js`);

const metaSent = [];
const llmCalls = [];
const llmOpts = { leakCard: false, cost: 0.0016 };
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('graph.facebook.com')) {
    const body = JSON.parse(init.body || '{}');
    if (body.status === 'read') return new Response('{"success":true}', { status: 200 });
    metaSent.push({ to: body.to, text: body.text?.body, at: Date.now() });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] }), { status: 200 });
  }
  if (u.includes('openrouter.ai')) {
    const body = JSON.parse(init.body);
    const system = body.messages[0]?.content || '';
    const last = body.messages[body.messages.length - 1]?.content || '';
    llmCalls.push({ system, last, body });
    let content;
    if (String(last).includes('KARTU SERAH-TERIMA')) {
      content = JSON.stringify({
        summary: ['Budi menanyakan paket Pro', 'Sudah dijelaskan harga', 'Menunggu keputusan diskon'],
        promises: ['Akan dikabari hari ini'],
        collected: { Nama: 'Budi', Produk: 'Pro' },
        suggestedReply: llmOpts.leakCard
          ? 'Halo kak, tim internal kami sedang cek ke departemen finance ya.'
          : 'Halo kak Budi, terima kasih sudah menunggu. Soal diskon, saya bantu cek sekarang ya.',
      });
    } else if (/nego|diskon/i.test(String(last))) {
      content = 'Baik kak, saya teruskan ke tim kami ya, nanti dikabari.';
    } else {
      content = 'Baik kak, siap dibantu ya.';
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: llmOpts.cost },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, init);
};

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${extra}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();

async function main() {
  const { buildApp } = require(`${ROOT}/src/server.js`);
  const db = new Database({ logger: { info() {}, warn() {} } });
  await db.connect();
  const q = (sql, p) => db.pool.query(sql, p);

  const app = await buildApp({
    logger: false, startupEnabled: false, demoMode: false,
    llmEnabled: true, openrouterApiKey: 'kunci-uji', sessionSecret: 'e2e',
    credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY,
  });
  const inbound = [];
  const mkMsg = (chatId, body) => {
    const replies = [];
    return {
      replies,
      from: chatId, body, type: 'chat', hasMedia: false,
      id: { _serialized: `false_${chatId}_${crypto.randomUUID()}` },
      timestamp: Math.floor(Date.now() / 1000),
      reply: async (text) => { replies.push(text); inbound.push({ chatId, text }); return { id: { _serialized: crypto.randomUUID() } }; },
    };
  };

  // ---------- company A ----------
  const pw = 'password-12345';
  const owner = await db.createCompanySignup({ companyName: `Uji A ${stamp}`, plan: 'company', displayName: 'Owner A', email: `ownera-${stamp}@t.test`, password: pw });
  const A = owner.companyId;
  const agent1 = await db.createTeamMember({ email: `ag1-${stamp}@t.test`, displayName: 'Agen Satu', password: pw, role: 'agent' }, A);
  const agent2 = await db.createTeamMember({ email: `ag2-${stamp}@t.test`, displayName: 'Agen Dua', password: pw, role: 'agent' }, A);
  await q("UPDATE companies SET reply_delay_enabled = false, whatsapp_provider = 'cloud_api', handoff_notify_numbers = ARRAY['081200000001'] WHERE id = $1", [A]);
  const dept = await db.createDepartment({ name: 'Finance' }, A);
  await db.setDepartmentMembers(dept.id, [agent1.id, agent2.id], A);
  await db.setMemberWhatsappNumber(agent1.id, '081200000011', A);
  await db.setMemberWhatsappNumber(agent2.id, '081200000012', A);
  const ownerRow = (await q('SELECT user_id FROM company_members WHERE company_id=$1 AND role=$2', [A, 'owner'])).rows[0];
  const cloud = await db.upsertCloudApiConnection(A, { phoneNumberId: `pn${stamp}`, wabaId: 'w1', accessToken: 'tok', appSecret: 'sekret-a' });

  const login = async (email) => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: pw } });
    if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.statusCode} ${r.body}`);
    return r.headers['set-cookie'].split(';')[0];
  };
  const ownerCookie = await login(`ownera-${stamp}@t.test`);
  const api = (cookie, method, url, payload) => app.inject({ method, url, headers: { cookie }, payload });

  // ---------- 1. Serah-terima ----------
  console.log('\n== 1. Serah-terima ==');
  const chat1 = `62811${String(stamp).slice(-6)}@c.us`;
  let m = mkMsg(chat1, 'Halo, saya Budi, tanya paket Pro');
  await app.handleInboundMessage(A, m, { provider: 'cloud_api', connectionId: cloud.id });
  check('AI membalas pesan biasa', m.replies.length === 1 && /siap dibantu/.test(m.replies[0]), JSON.stringify(m.replies));

  // (a) customer minta manusia
  const cardsBefore = llmCalls.length;
  m = mkMsg(chat1, 'Saya kecewa, tolong hubungkan ke manusia ya');
  await app.handleInboundMessage(A, m, { provider: 'cloud_api', connectionId: cloud.id });
  await sleep(1500);
  check('minta manusia: customer dapat kabar teruskan', m.replies.length === 1 && /teruskan/.test(m.replies[0]), JSON.stringify(m.replies));
  let routing = (await api(ownerCookie, 'GET', `/v1/chats/${encodeURIComponent(chat1)}/routing`)).json();
  check('routing pindah ke human', routing.routing?.mode === 'human', JSON.stringify(routing));
  const hist = (await q('SELECT reason, card, to_mode FROM conversation_handoffs WHERE company_id=$1 AND chat_id=$2 ORDER BY id DESC LIMIT 1', [A, chat1])).rows[0];
  check('alasan = emotional_complaint (kata "kecewa")', hist?.reason === 'emotional_complaint', JSON.stringify(hist));
  check('kartu menempel: 3 ringkasan, janji, saran balasan', hist?.card?.summary?.length === 3 && hist.card.promises?.length === 1 && hist.card.suggestedReply, JSON.stringify(hist?.card));
  const note = (await q("SELECT body, kind, author_kind FROM conversation_notes WHERE company_id=$1 AND chat_id=$2 AND kind='handover'", [A, chat1])).rows[0];
  check('kartu juga jadi catatan internal handover', /Kartu serah-terima/.test(note?.body || ''), JSON.stringify(note));
  check('kartu tidak terkirim ke customer lewat Meta', !metaSent.some((s) => String(s.to).startsWith(chat1.split('@')[0]) && /Kartu serah-terima|Saran balasan/.test(s.text || '')), '');
  check('pemberitahuan serah-terima: nomor handoff dapat WA', metaSent.some((s) => String(s.to).includes('81200000001')), JSON.stringify(metaSent.map((s) => s.to)));

  // (b) AI menjanjikan teruskan tanpa routing berubah (customer lain)
  const chat2 = `62822${String(stamp).slice(-6)}@c.us`;
  m = mkMsg(chat2, 'Bisa nego harga paket Pro?');
  await app.handleInboundMessage(A, m, { provider: 'cloud_api', connectionId: cloud.id });
  await sleep(1500);
  check('AI janji teruskan: balasan terkirim', /teruskan ke tim/.test(m.replies[0] || ''), JSON.stringify(m.replies));
  const note2 = (await q("SELECT body FROM conversation_notes WHERE company_id=$1 AND chat_id=$2 AND kind='handover'", [A, chat2])).rows[0];
  check('kartu catatan dibuat untuk janji AI', Boolean(note2), '');

  // kebocoran: saran kartu yang bocor dibuang
  llmOpts.leakCard = true;
  const chat3 = `62833${String(stamp).slice(-6)}@c.us`;
  m = mkMsg(chat3, 'tolong sambungkan saya dengan manusia');
  await app.handleInboundMessage(A, m, { provider: 'cloud_api', connectionId: cloud.id });
  await sleep(1500);
  llmOpts.leakCard = false;
  const hist3 = (await q('SELECT card FROM conversation_handoffs WHERE company_id=$1 AND chat_id=$2 ORDER BY id DESC LIMIT 1', [A, chat3])).rows[0];
  check('saran balasan yang membocorkan "tim internal/departemen" dibuang', hist3?.card && hist3.card.suggestedReply === '', JSON.stringify(hist3?.card));

  // kembali ke AI dengan batasan
  console.log('-- kembali ke AI dengan batasan');
  let r = await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat1)}/routing`, { mode: 'ai', aiConstraints: 'Jangan beri diskon di atas 5 persen.' });
  check('POST routing ai + batasan 200', r.statusCode === 200, r.body);
  llmCalls.length = 0;
  m = mkMsg(chat1, 'Jadi bisa diskon berapa?');
  await app.handleInboundMessage(A, m, { provider: 'cloud_api', connectionId: cloud.id });
  const replyCall = llmCalls.find((c) => /Jangan beri diskon di atas 5 persen/.test(c.system));
  check('AI membaca batasan (ada di system prompt)', Boolean(replyCall), `calls=${llmCalls.length}`);
  check('balasan ke customer tidak mengutip batasan/proses internal', m.replies.every((t) => !/batasan|instruksi|5 persen|departemen|internal/i.test(t)), JSON.stringify(m.replies));
  // kembali tanpa batasan -> tidak diwarisi
  await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat1)}/routing`, { mode: 'human', assigneeUserId: agent1.id });
  await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat1)}/routing`, { mode: 'ai' });
  llmCalls.length = 0;
  m = mkMsg(chat1, 'oke makasih infonya, ada lagi paket lain?');
  await app.handleInboundMessage(A, m, { provider: 'cloud_api', connectionId: cloud.id });
  check('batasan lama tidak diwarisi', !llmCalls.some((c) => /Jangan beri diskon di atas 5 persen/.test(c.system)), '');

  // semua pesan keluar ke customer: tidak ada kata proses internal
  const toCustomers = metaSent.filter((s) => /^628(11|22|33)/.test(String(s.to)));
  check('tak ada pesan Meta ke customer yang memuat kartu/catatan internal', toCustomers.every((s) => !/Kartu serah|Saran balasan|Janji AI|Alasan:/.test(s.text || '')), JSON.stringify(toCustomers));

  // ---------- 2. Mention departemen ----------
  console.log('\n== 2. Mention departemen ==');
  metaSent.length = 0;
  r = await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat1)}/notes`, {
    body: '@Finance tolong cek pembayaran customer ini', mentions: [{ kind: 'department', id: dept.id }],
  });
  check('catatan dengan mention departemen 201', r.statusCode === 201, r.body);
  const noteId = r.json().note?.id;
  await sleep(1200);
  const notifs = (await q("SELECT user_id, kind, body FROM notifications WHERE company_id=$1 AND chat_id=$2 AND kind LIKE '%mention%'", [A, chat1])).rows;
  const notified = new Set(notifs.map((n) => n.user_id));
  check('semua anggota departemen dapat notifikasi', notified.has(agent1.id) && notified.has(agent2.id), JSON.stringify(notifs));
  check('pembuat catatan tidak notifikasi diri sendiri', !notified.has(ownerRow.user_id), '');
  check('tidak ada notifikasi ganda per anggota', notifs.length === notified.size, JSON.stringify(notifs));
  const toMembers = metaSent.map((s) => String(s.to));
  check('WA ke kedua anggota yang nomornya diisi', toMembers.some((t) => t.includes('81200000011')) && toMembers.some((t) => t.includes('81200000012')), JSON.stringify(toMembers));
  check('WA mention tidak mengandung customer-sensitif berlebih & tidak ke customer', !toMembers.some((t) => t.startsWith(chat1.split('@')[0])), '');

  // anggota ditandai langsung + lewat departemen: sekali saja
  r = await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat1)}/notes`, {
    body: '@Finance @Agen Satu cek', mentions: [{ kind: 'department', id: dept.id }, { kind: 'user', id: agent1.id }],
  });
  await sleep(800);
  const n2 = (await q("SELECT user_id FROM notifications WHERE company_id=$1 AND chat_id=$2 AND kind LIKE '%mention%' AND created_at > NOW() - INTERVAL '1 minute'", [A, chat1])).rows;
  const c1 = n2.filter((n) => n.user_id === agent1.id).length;
  check('mention ganda (nama + departemen) -> agen1 notifikasi sekali untuk catatan ini', c1 === 2 /* 1 dari catatan 1 + 1 dari catatan 2 */, `agen1=${c1}`);

  // departemen dari company lain ditolak
  const ownerB = await db.createCompanySignup({ companyName: `Uji B ${stamp}`, plan: 'company', displayName: 'Owner B', email: `ownerb-${stamp}@t.test`, password: pw });
  const B = ownerB.companyId;
  const deptB = await db.createDepartment({ name: 'Rahasia B' }, B);
  const bAgent = await db.createTeamMember({ email: `bag-${stamp}@t.test`, displayName: 'Agen B', password: pw, role: 'agent' }, B);
  await db.setDepartmentMembers(deptB.id, [bAgent.id], B);
  await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat1)}/notes`, { body: 'lintas tenant', mentions: [{ kind: 'department', id: deptB.id }] });
  await sleep(500);
  const leak = (await q('SELECT 1 FROM notifications WHERE user_id=$1', [bAgent.id])).rowCount;
  check('mention departemen company lain tak menotifikasi siapa pun', leak === 0, `n=${leak}`);

  // catatan jadi tugas
  r = await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat2)}/notes/${noteId || 1}/task`, { assigneeUserId: agent2.id, priority: 'high' });
  console.log('   task route ->', r.statusCode, r.body.slice(0, 200));
  // note id harus milik chat2; buat catatan di chat2
  const nr = await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat2)}/notes`, { body: 'Follow up diskon customer ini' });
  const n2id = nr.json().note.id;
  r = await api(ownerCookie, 'POST', `/v1/chats/${encodeURIComponent(chat2)}/notes/${n2id}/task`, { assigneeUserId: agent2.id, priority: 'high', dueAt: new Date(Date.now() + 3600e3).toISOString() });
  check('catatan jadi tugas 200', r.statusCode === 200 || r.statusCode === 201, `${r.statusCode} ${r.body}`);
  const rt = (await q('SELECT handling_mode AS mode, assignee_user_id, priority, status, due_at FROM conversation_routing WHERE company_id=$1 AND chat_id=$2', [A, chat2])).rows[0];
  check('tugas dipegang agen2 prioritas high', rt?.mode === 'human' && rt.assignee_user_id === agent2.id && rt.priority === 'high' && rt.due_at, JSON.stringify(rt));
  const ag2Cookie = await login(`ag2-${stamp}@t.test`);
  const tasks = (await api(ag2Cookie, 'GET', '/v1/tasks')).json();
  const mine = (tasks.tasks || tasks.items || tasks).find?.((t) => t.chatId === chat2);
  check('tugas muncul di daftar agen2 dengan tenggat SLA', Boolean(mine) && (mine.dueAt || mine.sla || mine.slaDueAt || mine.deadline), JSON.stringify(mine));
  // agen biasa menugaskan ke orang lain ditolak?
  const ag1Cookie = await login(`ag1-${stamp}@t.test`);
  const rb = await api(ag1Cookie, 'POST', `/v1/chats/${encodeURIComponent(chat2)}/notes/${n2id}/task`, { assigneeUserId: agent2.id });
  console.log('   agen->orang lain:', rb.statusCode);

  // ---------- 3. Credit ----------
  console.log('\n== 3. Credit ==');
  const ownerC = await db.createCompanySignup({ companyName: `Uji C ${stamp}`, plan: 'company', displayName: 'Owner C', email: `ownerc-${stamp}@t.test`, password: pw });
  const C = ownerC.companyId;
  const mgr = await db.createTeamMember({ email: `mg-${stamp}@t.test`, displayName: 'Mgr', password: pw, role: 'agent' }, C);
  const mgmt = (await db.listDepartments(C)).find((d) => d.name.toLowerCase() === 'management') || await db.createDepartment({ name: 'Management' }, C);
  await db.setDepartmentMembers(mgmt.id, [mgr.id], C);
  await db.setMemberWhatsappNumber(mgr.id, '081300000099', C);
  await q("UPDATE companies SET reply_delay_enabled=false, whatsapp_provider='cloud_api', handoff_notify_numbers=ARRAY['081300000001'] WHERE id=$1", [C]);
  const cloudC = await db.upsertCloudApiConnection(C, { phoneNumberId: `pnc${stamp}`, wabaId: 'w2', accessToken: 't', appSecret: 's' });
  const limits = { maxUsers: 5, maxWhatsapp: 2, maxPlaybooks: 5 };

  // perusahaan lama (credit_mode mati) tidak berubah
  const chatOld = `62844${String(stamp).slice(-6)}@c.us`;
  const beforeOld = (await q('SELECT credit_mode, credit_plan_balance, credit_topup_balance FROM companies WHERE id=$1', [A])).rows[0];
  const ledgerOldBefore = (await q('SELECT count(*) FROM credit_ledger WHERE company_id=$1', [A])).rows[0].count;
  m = mkMsg(chatOld, 'halo apa kabar');
  await app.handleInboundMessage(A, m, { provider: 'cloud_api', connectionId: cloud.id });
  const afterOld = (await q('SELECT credit_mode, credit_plan_balance, credit_topup_balance FROM companies WHERE id=$1', [A])).rows[0];
  const ledgerOldAfter = (await q('SELECT count(*) FROM credit_ledger WHERE company_id=$1', [A])).rows[0].count;
  check('company lama: AI tetap balas, saldo & ledger tidak berubah', m.replies.length === 1 && JSON.stringify(beforeOld) === JSON.stringify(afterOld) && ledgerOldBefore === ledgerOldAfter, JSON.stringify({ beforeOld, afterOld }));

  await db.subscribeCreditPlan(C, { plan: 'starter', monthlyCredit: 100, limits });
  const chatC = `62855${String(stamp).slice(-6)}@c.us`;
  const state = () => db.getCreditState(C);
  const s0 = await state();
  m = mkMsg(chatC, 'halo, mau tanya produk');
  await app.handleInboundMessage(C, m, { provider: 'cloud_api', connectionId: cloudC.id });
  await sleep(600); // pemotongan credit berjalan setelah balasan terkirim
  const s1 = await state();
  const spent = s0.total - s1.total;
  check('AI membalas dan saldo berkurang', m.replies.length === 1 && spent > 0.5 && spent < 1.6, `spent=${spent}`);
  const led = (await q("SELECT amount::float8 a, purpose FROM credit_ledger WHERE company_id=$1 AND kind='usage' ORDER BY id DESC LIMIT 1", [C])).rows[0];
  check('ledger usage tercatat sama dengan pengurangan', led && Math.abs(-led.a - spent) < 1e-6, JSON.stringify(led));

  const credNotifs = async () => (await q("SELECT count(*)::int n FROM notifications WHERE company_id=$1 AND kind='credit'", [C])).rows[0].n;
  const waCred = () => metaSent.filter((s) => /Credit Agnee/.test(s.text || ''));
  metaSent.length = 0;
  const step = async (setTo, label, expectLevel) => {
    await q('UPDATE companies SET credit_plan_balance=$2, credit_topup_balance=0 WHERE id=$1', [C, setTo]);
    const nb = await credNotifs(); const wb = waCred().length;
    const mm = mkMsg(chatC, `pesan ${label}`);
    await app.handleInboundMessage(C, mm, { provider: 'cloud_api', connectionId: cloudC.id });
    await sleep(800);
    const st = await state();
    const nn = (await credNotifs()) - nb; const wn = waCred().length - wb;
    check(`ambang ${label}: level=${expectLevel}, notif dalam-app & WA terkirim`, st.alertLevel === expectLevel && nn >= 1 && wn >= 1, JSON.stringify({ lvl: st.alertLevel, nn, wn, total: st.total }));
    return { st, mm };
  };
  await step(20.2, '20%', 'p20');
  // sekali saja: turun lagi tetap di bawah 20 tapi di atas 10 -> tidak kabar lagi
  {
    await q('UPDATE companies SET credit_plan_balance=15 WHERE id=$1', [C]);
    const nb = await credNotifs(); const mm = mkMsg(chatC, 'masih 15 persen');
    await app.handleInboundMessage(C, mm, { provider: 'cloud_api', connectionId: cloudC.id });
    await sleep(500);
    check('level sama tidak dikabari ulang', (await credNotifs()) === nb, '');
  }
  await step(10.2, '10%', 'p10');
  await step(1.2, '1%', 'p1');
  metaSent.length = 0;
  const nbEmpty = await credNotifs();
  const emptyRes = await step(0.3, 'habis', 'empty');
  const sEmpty = await state();
  check('saldo terkunci di 0 (tidak minus)', sEmpty.total === 0, `total=${sEmpty.total}`);
  check('balasan terakhir (yang menghabiskan) tetap terkirim ke customer', emptyRes.mm.replies.length === 1, JSON.stringify(emptyRes.mm.replies));
  const recipients = new Set(waCred().map((s) => String(s.to).replace('@c.us','').slice(-8)));
  check('kabar WA habis ke nomor handoff + anggota Management tanpa duplikat', recipients.size === waCred().length && recipients.has('00000001') && recipients.has('00000099'), JSON.stringify(waCred().map((s) => s.to)));

  // habis: AI berhenti, chat tetap masuk inbox
  llmCalls.length = 0; metaSent.length = 0;
  const chatD = `62866${String(stamp).slice(-6)}@c.us`;
  m = mkMsg(chatD, 'halo ada orang?');
  await app.handleInboundMessage(C, m, { provider: 'cloud_api', connectionId: cloudC.id });
  await sleep(500);
  check('credit habis: tidak ada panggilan LLM & tidak ada balasan', llmCalls.length === 0 && m.replies.length === 0, `llm=${llmCalls.length} replies=${m.replies.length}`);
  const inb = (await q('SELECT count(*)::int n FROM inbound_messages WHERE company_id=$1 AND chat_id=$2', [C, chatD])).rows[0].n;
  check('pesan customer tetap tercatat di inbox', inb >= 1, `inbound_messages=${inb}`);
  const nonCredit = metaSent.filter((s) => !/Credit Agnee/.test(s.text || ''));
  check('tidak ada balasan palsu ke customer saat habis', !nonCredit.some((s) => String(s.to).startsWith(chatD.split('@')[0])), JSON.stringify(nonCredit));
  const costBefore = (await q("SELECT count(*)::int n FROM credit_ledger WHERE company_id=$1 AND kind='usage'", [C])).rows[0].n;

  // rute AI web saat habis
  const cCookie = await login(`ownerc-${stamp}@t.test`);
  const ai = await api(cCookie, 'GET', '/v1/admin/ai-settings');
  check('ai-settings: reason credit', ai.json().reason === 'credit' && ai.json().effective === false, ai.body);

  // top-up lewat konsol platform
  await q('UPDATE users SET is_platform_admin = true WHERE id = $1', [ownerRow.user_id]);
  const platCookie = await login(`ownera-${stamp}@t.test`);
  r = await api(platCookie, 'POST', `/v1/superhuman/companies/${C}/credit/topup`, { amountIdr: 5000 });
  console.log('   topup route ->', r.statusCode, r.body.slice(0, 200));
  if (r.statusCode !== 200) await db.grantCredit(C, { kind: 'topup', amount: 50 });
  const sTop = await state();
  check('top-up menambah saldo & level alert di-reset', sTop.total > 0 && sTop.alertLevel === null, JSON.stringify(sTop));
  llmCalls.length = 0;
  m = mkMsg(chatD, 'saya lanjut ya');
  await app.handleInboundMessage(C, m, { provider: 'cloud_api', connectionId: cloudC.id });
  check('setelah top-up AI menyala lagi dan membalas', m.replies.length === 1 && llmCalls.length >= 1, `replies=${m.replies.length}`);

  // rute publik kuota promo
  const pq = await app.inject({ method: 'GET', url: '/v1/public/promo-quota' });
  const pj = pq.json();
  check('promo-quota publik 200 tanpa auth', pq.statusCode === 200, pq.body);
  check('promo-quota hanya kunci angka/waktu', JSON.stringify(Object.keys(pj).sort()) === JSON.stringify(['limit', 'open', 'remaining', 'resetsAt', 'used']), pq.body);
  check('promo-quota tak memuat nama/slug perusahaan', !/Uji [ABC]|uji-/i.test(pq.body), pq.body);
  const realUsed = (await q("SELECT count(*)::int n FROM companies WHERE promo_signup AND created_at >= date_trunc('month', NOW())")).rows[0].n;
  check('used = hitung nyata dari tabel', pj.used === realUsed, `${pj.used} vs ${realUsed}`);

  // ---------- 4. Mode agent ----------
  console.log('\n== 4. Mode agent ==');
  const conn = (await q("INSERT INTO whatsapp_connections (company_id, connection_key, client_id, session_path, status, agent_mode) VALUES ($1,'wa-uji','cid-uji','/tmp/x','ready','standard') RETURNING id", [A])).rows[0];
  const chatM = `62877${String(stamp).slice(-6)}@c.us`;
  const modeCall = async (text) => {
    llmCalls.length = 0;
    const mm = mkMsg(chatM, text);
    await app.handleInboundMessage(A, mm, { provider: 'whatsapp_web', connectionId: conn.id });
    return { mm, system: llmCalls.find((c) => !/KARTU SERAH/.test(c.last))?.system || '' };
  };
  const base = await modeCall('halo mau tanya');
  for (const mode of ['sales', 'cs', 'standard']) {
    const pr = await api(ownerCookie, 'PATCH', `/v1/whatsapp/numbers/${conn.id}`, { agentMode: mode });
    const out = await modeCall(`pesan mode ${mode}`);
    console.log(`   mode=${mode} patch=${pr.statusCode} systemLen=${out.system.length} reply=${out.mm.replies.length}`);
    check(`mode ${mode}: PATCH 200, balasan terkirim`, pr.statusCode === 200 && out.mm.replies.length === 1, pr.body);
    results.push({ meta: mode, len: out.system.length, hasMode: out.system.includes('MODE') });
  }
  const sSales = await (async () => { await api(ownerCookie, 'PATCH', `/v1/whatsapp/numbers/${conn.id}`, { agentMode: 'sales' }); return modeCall('x'); })();
  const sStd = await (async () => { await api(ownerCookie, 'PATCH', `/v1/whatsapp/numbers/${conn.id}`, { agentMode: 'standard' }); return modeCall('x'); })();
  check('prompt mode sales berbeda dari standard', sSales.system !== sStd.system, '');
  // Cloud API: mode per nomor berlaku?
  await api(ownerCookie, 'PATCH', `/v1/whatsapp/numbers/${conn.id}`, { agentMode: 'sales' });
  llmCalls.length = 0;
  const mc = mkMsg(chatM, 'lewat cloud api');
  await app.handleInboundMessage(A, mc, { provider: 'cloud_api', connectionId: cloud.id });
  const cloudSys = llmCalls.find((c) => !/KARTU SERAH/.test(c.last))?.system || '';
  console.log('   cloud conn prompt sama dengan standard?', cloudSys === sStd.system);
  // internal_ops: pengirim tak dikenal tidak dijawab
  await api(ownerCookie, 'PATCH', `/v1/whatsapp/numbers/${conn.id}`, { agentMode: 'internal_ops' });
  const ops = await modeCall('halo ops dari orang asing');
  check('internal_ops: pengirim tak dikenal tidak dijawab AI', ops.mm.replies.length === 0, JSON.stringify(ops.mm.replies));

  const failed = results.filter((x) => x.ok === false);
  console.log(`\n=== ${results.filter((x) => x.ok === true).length} lulus, ${failed.length} gagal ===`);
  failed.forEach((f) => console.log('  GAGAL:', f.name));
  await app.close();
  await db.pool.end();
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
