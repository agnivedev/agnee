'use strict';
// Simulasi Agnes ESBEJE lewat jalur pesan masuk WhatsApp yang sama dengan produksi
// (handleInboundMessage -> generateAutoReply, allowOrders + departemen).
// Model AI asli (OpenRouter), data ESBEJE asli (salinan baca-saja esbeje.json).
// Tiruan: WhatsApp (client), DealPOS tulis dokumen (Estimate/Invoice), tarif & order Lalamove.
// Pakai: node --env-file=<agnee>/.env sim.js <worktree> <outdir> [kasus...]

const path = require('node:path');
const fs = require('node:fs');
const WT = process.argv[2];
const OUT = process.argv[3];
const ONLY = process.argv.slice(4);

const { WhatsappManager } = require(path.join(WT, 'src/whatsapp-manager.js'));
const { buildApp } = require(path.join(WT, 'src/server.js'));
const LlmService = require(path.join(WT, 'src/llm-service.js'));
const D = require('./esbeje.json');
const LALA_KEYS = require('./lala-sandbox.json');
const CASES = require('./cases.js');

const COMPANY = D.companyConfig && 'fdf4441c-6a15-42d9-84ed-65c85debb660';
const SUP = { id: '11111111-1111-4111-8111-111111111111', userId: '11111111-1111-4111-8111-111111111111', companyId: COMPANY, email: 'sup@esbeje.test', displayName: 'Supervisor', role: 'owner', status: 'active' };
const CONN_ID = '33333333-3333-4333-8333-333333333333';
const FIN_NOTIFY = '6281100000001'; // nomor notifikasi serah-terima ANDAIAN (produksi: kosong)

// ---------------- WhatsApp tiruan ----------------
const chats = new Map(); // chatId -> [{id, body, fromMe, timestamp, type, hasMedia, ...}]
let seq = 0;
const logOf = (chatId) => { if (!chats.has(chatId)) chats.set(chatId, []); return chats.get(chatId); };
function pushMsg(chatId, m) {
  seq += 1;
  const row = { id: { _serialized: `m${seq}` }, timestamp: Math.floor(Date.now() / 1000), type: 'chat', hasMedia: false, fromMe: false, from: chatId, ...m };
  logOf(chatId).push(row);
  return row;
}
const fakeClient = {
  info: { wid: { _serialized: '6281200000000@c.us' } },
  async getChatById(chatId) {
    return { id: { _serialized: chatId }, isGroup: chatId.endsWith('@g.us'), async fetchMessages({ limit }) { return logOf(chatId).slice(-limit); } };
  },
  pupPage: {
    async evaluate(_fn, chatId, content) {
      const row = pushMsg(chatId, { body: content, fromMe: true });
      return { messageId: row.id._serialized, timestamp: row.timestamp };
    },
  },
  async sendMessage(chatId, content) { const row = pushMsg(chatId, { body: content, fromMe: true }); return row; },
};
WhatsappManager.prototype.getClient = function getClient() { return fakeClient; };
WhatsappManager.prototype.getState = function getState() { return { phase: 'ready', syncPercent: 100 }; };

// ---------------- Database tiruan dari data ESBEJE ----------------
function makeDb(state) {
  const depts = D.departments.map((d, i) => ({
    ...d,
    members: d.members.map((m, j) => ({ ...m, whatsappNumber: `62811000${i}${j}99` })),
  }));
  const known = {
    enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async ping() { return { driver: 'postgresql', connected: true, enabled: true }; },
    async authenticateUser(email, pw) { return pw === 'pass-12345' && email === SUP.email ? SUP : null; },
    async getActiveSessionUser(id) { return id === SUP.id ? { ...SUP, isPlatformAdmin: false } : null; },
    async setPresence() {}, async setLastCompany() {},
    async listCompaniesForUser() { return [{ id: COMPANY }]; },
    async recordAuditLog() { return { id: 1 }; },
    async getAiSettings() { return D.aiSettings; },
    async getCompanyConfig() { return { ...D.companyConfig, replyDelayEnabled: false }; },
    async listPlaybookProducts() { return []; },
    async getPlaybookContext() { return fs.readFileSync(path.join(WT, 'playbooks/esbeje/umum.md'), 'utf8'); },
    async listCatalogForAi() { return D.catalog; },
    async listDealposProducts() { return D.dealpos; },
    // ANDAIAN: saklar pesanan AI hidup + setelan dokumen terisi (produksi: mati, kosong).
    async getDealposConnection() {
      return { ...D.dealposConn, clientSecret: 'sim', aiOrdersEnabled: true, orderOutlet: 'Cisauk Store', orderTag: 'WA-AI', orderTaxType: 'Inclusive', shippingVariantCode: '' };
    },
    // ANDAIAN: Lalamove production (produksi: sandbox). vehicle_mode = management seperti produksi.
    async getLalamoveConnection() {
      // Kunci sandbox ASLI; di sini ditandai production hanya supaya jalur chat nyata memakainya (host diarahkan ke sandbox di bawah).
      return { ...D.lalamove, environment: 'production', apiKey: LALA_KEYS.apiKey, apiSecret: LALA_KEYS.apiSecret, vehicleMode: 'ai', pickupContactName: 'Admin Cisauk', pickupContactPhone: '081100000002' };
    },
    // ANDAIAN: kontak penanggung jawab toko terisi (produksi: kosong, invoice + kurir gagal tanpanya).
    async listCompanyLocations() { return D.locations.map((l) => ({ ...l, contactName: 'Admin Cisauk', contactPhone: '081100000002' })); },
    async listPaymentAccounts() { return D.accounts; },
    async listPromoRules() { return D.promos; },
    async listThirdParties() { return []; },
    async listDepartments() { return depts.map((d) => ({ ...d })); },
    async getHandoffNotifyNumbers() { return [FIN_NOTIFY]; },
    async listWhatsappConnections() { return [{ id: CONN_ID, connectionKey: 'whatsapp-main', label: 'ESBEJE', phoneNumber: '6281200000000', agentMode: 'standard', status: 'active', enabled: true }]; },
    async getWhatsappChatNumber() { return { id: CONN_ID, connectionKey: 'whatsapp-main', agentMode: 'standard' }; },
    // departemen
    async createDepartmentQuestion(q) {
      const dept = depts.find((d) => d.id === q.departmentId);
      const row = { id: `a1b2c3d4-0000-4000-8000-${String(state.questions.length + 1).padStart(12, '0')}`, ...q, status: 'open', department: dept?.name };
      state.questions.push(row);
      state.events.push({ kind: 'tanya_departemen', department: dept?.name, question: q.question, jenis: q.kind });
      return { id: row.id, department: dept?.name, whatsappGroupId: dept?.whatsappGroupId || null, members: dept?.members || [] };
    },
    async listDepartmentQuestions(_c, { status } = {}) {
      return state.questions.filter((q) => !status || q.status === status).map((q) => ({ id: q.id, chatId: q.chatId, customerText: q.customerText, question: q.question, departmentId: q.departmentId, department: q.department, kind: q.kind, payload: q.payload }));
    },
    async latestVehicleQuestion(_c, chatId) {
      const rows = state.questions.filter((q) => q.kind === 'lalamove_vehicle' && q.chatId === chatId);
      const q = rows[rows.length - 1];
      return q ? { id: q.id, status: q.status, answer: q.answer, payload: q.payload } : null;
    },
    async answerDepartmentQuestion(id, { answer }) {
      const q = state.questions.find((x) => x.id === id && x.status === 'open');
      if (!q) return null;
      q.status = 'answered'; q.answer = answer;
      return { id: q.id, chatId: q.chatId, customerText: q.customerText, question: q.question, answer, kind: q.kind, payload: q.payload };
    },
    async reopenDepartmentQuestion(id) { const q = state.questions.find((x) => x.id === id); if (q) { q.status = 'open'; q.answer = null; } return true; },
    async setDepartmentQuestionPayload(id, payload) { const q = state.questions.find((x) => x.id === id); if (q) q.payload = payload; return true; },
    async addDepartmentQuestionGroupMessage() {},
    // pesanan AI
    async findDealposCustomerByPhone() { return null; },
    async createAiSalesDocument(_c, doc) { const row = { id: String(state.docs.length + 1), status: 'open', ...doc }; state.docs.push(row); return row; },
    async latestAiSalesDocument(_c, chatId, kind, status) { return [...state.docs].reverse().find((d) => d.chatId === chatId && d.kind === kind && (!status || d.status === status)) || null; },
    async createLalamoveOrder(_c, order) { state.events.push({ kind: 'lalamove_order', order }); return order; },
    // bukti transfer
    async recordPaymentProof(_c, p) { const row = { id: String(state.proofs.length + 1), ...p, createdAt: new Date().toISOString() }; state.proofs.push(row); return row; },
    async findDuplicatePaymentProof() { return null; },
    // lain-lain
    async incrementAiMessageCount() { return { exceeded: false, count: 1, limit: 0 }; },
    async recordOutboundReply() { return true; },
    async recordInboundMessage() { return true; },
    async getFollowUpSettings() { return { enabled: false }; },
    async getReplyDelaySettings() { return { replyDelayEnabled: false }; },
    async markFollowUpReplied() {}, async stopFollowUpSequence() {}, async upsertContactName() {},
  };
  return new Proxy(known, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'then') return undefined;
      return async () => (String(prop).startsWith('list') ? [] : null);
    },
  });
}

// ---------------- fetch tiruan: Lalamove + DealPOS tulis ----------------
const hav = (a, b) => {
  const R = 6371; const r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat); const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Tarif tiruan per km (dikalibrasi ke kutipan sandbox ESBEJE 28 Okt: motor 14,4 km = Rp 26.500, MPV = Rp 49.300).
const TARIF = { MOTORCYCLE: [10000, 1150], SEDAN: [25000, 1700], MPV: [25000, 1700], VAN: [55000, 2800], PICK_UP_TRUCK: [70000, 3400], TRUCK175: [70000, 3400], TRUCK330: [90000, 4000], ENGKELBOX: [150000, 5500], ENGKELBAK: [150000, 5500], CDDBOX: [300000, 8000], CDDBAK: [300000, 8000] };
let currentState = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const st = currentState;
  if (u.includes('rest.lalamove.com')) {
    // Panggilan SUNGGUHAN ke sandbox Lalamove (bukan tarif tiruan).
    const sandboxUrl = u.replace('rest.lalamove.com', 'rest.sandbox.lalamove.com');
    const res = await realFetch(sandboxUrl, init);
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
    if (u.includes('/v3/quotations') && init.method === 'POST') {
      const data = JSON.parse(init.body).data;
      st?.events.push({ kind: 'lalamove_quote', serviceType: data.serviceType, total: Number(json?.data?.priceBreakdown?.total), km: Math.round(Number(json?.data?.distance?.value || 0) / 100) / 10, status: res.status, sandbox: true, error: json?.errors?.[0]?.message });
    }
    if (u.includes('/v3/orders') && init.method === 'POST') st?.events.push({ kind: 'lalamove_place', status: res.status, orderId: json?.data?.orderId, error: json?.errors?.[0]?.message });
    return new Response(text, { status: res.status, headers: res.headers });
  }
  if (u.includes('dealpos.co.id')) {
    if (u.includes('/Token/OAuth2')) return new Response(JSON.stringify({ access_token: 't-sim', expires_in: 3600 }), { status: 200 });
    if (u.includes('/Estimate')) { st?.events.push({ kind: 'dealpos_estimate', body: JSON.parse(init.body) }); return new Response(JSON.stringify({ ID: 'est-sim' }), { status: 200 }); }
    if (u.includes('/Invoice')) { const body = JSON.parse(init.body); st?.events.push({ kind: 'dealpos_invoice', body }); return new Response(JSON.stringify({ ID: 'inv-sim', Number: body.Number }), { status: 200 }); }
    throw new Error(`dealpos tiruan tidak kenal ${u}`);
  }
  return realFetch(url, init);
};

// ---------------- customer (model persona) ----------------
async function customerTurn(c, transcript) {
  const convo = transcript.map((t) => `${t.from === 'customer' ? 'KAMU' : 'AGNES'}: ${t.text}`).join('\n');
  const res = await realFetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash', temperature: 0.3, max_tokens: 300,
      messages: [
        { role: 'system', content: `${c.persona}\nKamu CUSTOMER (pembeli) yang chat WhatsApp ke toko bahan bangunan ESBEJE; AGNES adalah admin toko. Kamu TIDAK PERNAH menyebut harga, ongkir, atau total sendiri, dan tidak pernah menawarkan barang; itu tugas AGNES. Balas pesan terakhir AGNES dengan SATU pesan WA pendek dan santai (maks 25 kata), bahasa Indonesia sehari-hari. Jangan menulis label nama. Kalau AGNES sudah memberi nomor invoice dan nomor rekening, balas persis: KIRIM_BUKTI. Kalau AGNES menyuruh menunggu kabar, balas singkat "oke kak ditunggu".` },
        { role: 'user', content: `Percakapan sejauh ini:\n${convo}\n\nPesanmu berikutnya:` },
      ],
    }),
  });
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content || '').trim().replace(/^KAMU:\s*/i, '').replace(/^"|"$/g, '');
}

// ---------------- jalankan satu kasus ----------------
async function runCase(name, c) {
  const state = { questions: [], docs: [], proofs: [], events: [], tools: [] };
  currentState = state;
  const chatId = c.chatId;
  const real = new LlmService({ apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash', maxTokens: Number(process.env.LLM_MAX_TOKENS || 512), enabled: true });
  const llm = new Proxy(real, {
    get(target, prop) {
      if (prop === 'generateReply') {
        return async (message, options = {}) => {
          const tools = (options.tools || []).map((tool) => ({
            ...tool,
            run: async (args) => {
              const out = await tool.run(args);
              state.tools.push({ name: tool.name, args, out });
              state.events.push({ kind: 'alat', name: tool.name, args, out });
              return out;
            },
          }));
          if (options.purpose !== 'payment_proof') state.events.push({ kind: 'alat_tersedia', names: (options.tools || []).map((t) => t.name) });
          const out = await target.generateReply(message, { ...options, tools });
          if (options.purpose !== 'payment_proof') state.events.push({ kind: 'raw_model', text: typeof out === 'string' ? out : out?.text });
          return out;
        };
      }
      if (prop === 'describeImage') {
        return async (opts) => { const out = await target.describeImage(opts); state.events.push({ kind: 'baca_gambar', purpose: opts.purpose, out }); return out; };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: false, database: makeDb(state), llmService: llm, llmEnabled: true, openrouterApiKey: process.env.OPENROUTER_API_KEY, sessionSecret: `sim-${name}-session-secret-xx` });
  const cookie = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUP.email, password: 'pass-12345' } })).headers['set-cookie'].split(';')[0];

  const timeline = []; // {from, text, image?, events[]}
  const seen = new Set();
  const collectOutbound = (events) => {
    for (const m of logOf(chatId)) {
      if (!m.fromMe || seen.has(m.id._serialized)) continue;
      seen.add(m.id._serialized);
      timeline.push({ from: 'agnes', text: m.body, events: events.splice(0) });
    }
  };
  const groupMsgs = () => [...chats.entries()].filter(([id]) => id !== chatId).flatMap(([id, rows]) => rows.filter((r) => r.fromMe).map((r) => ({ to: id, text: r.body })));
  let groupSeen = 0;
  const newGroupMsgs = () => { const all = groupMsgs(); const fresh = all.slice(groupSeen); groupSeen = all.length; return fresh; };

  let text = c.opening;
  let image = null;
  for (let turn = 1; turn <= (c.maxTurns || 12); turn += 1) {
    const eventsStart = state.events.length;
    let msg;
    if (image) {
      const row = pushMsg(chatId, { body: '', type: 'image', hasMedia: true, mimetype: 'image/png' });
      msg = { ...row, _data: { notifyName: c.nama }, async downloadMedia() { return { mimetype: 'image/png', data: image.base64 }; }, async reply(t) { return fakeClient.sendMessage(chatId, t); } };
      timeline.push({ from: 'customer', text: '', image: image.file });
    } else {
      const row = pushMsg(chatId, { body: text });
      msg = { ...row, _data: { notifyName: c.nama }, async reply(t) { return fakeClient.sendMessage(chatId, t); } };
      timeline.push({ from: 'customer', text });
    }
    process.stdout.write(`[${name}] ${turn} customer: ${image ? '(foto bukti transfer)' : text}\n`);
    await app.handleInboundMessage(COMPANY, msg, { connectionId: CONN_ID });
    await app.learningIdle?.();
    const evs = state.events.slice(eventsStart);
    const internal = newGroupMsgs();
    for (const g of internal) evs.push({ kind: 'pesan_internal', to: g.to, text: g.text });
    collectOutbound(evs);
    if (evs.length) timeline.push({ from: 'system', events: evs });

    // Departemen menjawab (Management lewat rute yang sama dengan jawaban grup)
    for (const q of state.questions.filter((x) => x.status === 'open')) {
      const answer = q.kind === 'lalamove_vehicle' ? c.management.kendaraan : (q.department === 'Finance' ? c.management.finance : (/ongkir/i.test(q.question) ? 'Ongkir ikut hitungan Lalamove ya, pakai yang muat saja.' : c.management.umum));
      const before = state.events.length;
      const res = await app.inject({ method: 'POST', url: `/v1/department-questions/${q.id}/answer`, headers: { cookie }, payload: { answer } });
      const evs2 = [{ kind: 'jawaban_departemen', department: q.department, answer, hasil: res.json() }, ...state.events.slice(before)];
      for (const g of newGroupMsgs()) evs2.push({ kind: 'pesan_internal', to: g.to, text: g.text });
      timeline.push({ from: 'system', events: evs2 });
      collectOutbound([]);
    }
    if (image) break; // bukti transfer = langkah terakhir
    const transcript = timeline.filter((t) => t.from !== 'system').map((t) => ({ from: t.from, text: t.text || '[foto]' }));
    const next = await customerTurn(c, transcript);
    if (!next) break;
    if (/KIRIM_BUKTI/.test(next)) {
      const inv = [...state.docs].reverse().find((d) => d.kind === 'invoice');
      // Customer mentransfer angka yang terakhir diberikan Agnes (invoice, atau grand total di chat bila tak ada invoice).
      const said = timeline.filter((t) => t.from === 'agnes').map((t) => t.text).join('\n');
      const m = [...said.matchAll(/(?:GRAND TOTAL|[Tt]otal(?: tagihan| pembayaran)?)[^\n]*?Rp\s?([\d.]+)/g)].pop();
      const base = inv ? Number(inv.total) : (m ? Number(m[1].replace(/\./g, '')) : 0);
      const amount = base + (c.buktiSelisih || 0);
      image = await c.makeProof(amount, path.join(OUT, `${name}-bukti.png`));
      continue;
    }
    text = next;
  }
  await app.close();
  const result = { name, title: c.title, chatId, nama: c.nama, timeline, docs: state.docs, proofs: state.proofs, questions: state.questions };
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(result, null, 2));
  return result;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const names = ONLY.length ? ONLY : Object.keys(CASES);
  for (const n of names) {
    try { await runCase(n, CASES[n]); } catch (e) { console.error(`[${n}] ERROR`, e); }
  }
  process.exit(0);
})();
