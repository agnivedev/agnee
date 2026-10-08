'use strict';

/**
 * Perekat antara rute impor dan src/chat-import.js: pemetaan deps, penyimpanan,
 * penempelan nomor, kunci satu-impor, dan lanjutan yang melewati yang sudah
 * terimpor. Modul intinya diuji sendiri di chat-import.test.js; yang diuji di
 * sini adalah apakah semuanya tersambung benar ke klien WhatsApp dan database.
 *
 * Klien WhatsApp palsu dipasang lewat prototipe WhatsappManager (manager dibuat
 * di dalam buildApp dan tidak bisa disuntik), lalu dikembalikan sesudah tes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../src/server');
const { WhatsappManager } = require('../src/whatsapp-manager');

const SUPERVISOR = {
  id: 'supervisor-1', userId: 'supervisor-1', companyId: 'company-1',
  email: 'owner@example.com', displayName: 'Supervisor', role: 'supervisor', status: 'active',
};
const NOW = Math.floor(Date.now() / 1000);
const KONEKSI = { id: 'conn-1', companyId: 'company-1', connectionKey: 'whatsapp-main', label: 'WhatsApp utama' };
const KONEKSI_2 = { id: 'conn-2', companyId: 'company-1', connectionKey: 'whatsapp-2', label: 'WhatsApp kedua' };
const PRODUK = [
  { id: 'p-cgi', name: 'Nila CGI', active: true },
  { id: 'p-exp', name: 'Shinta Express', active: true },
];

function pesan(teks, fromMe, timestamp) {
  return { id: { _serialized: `m-${timestamp}-${fromMe}` }, body: teks, fromMe, timestamp, type: 'chat', hasMedia: false, hasQuotedMsg: false, ack: 0, _data: {} };
}

/** Satu chat WhatsApp palsu: lastMessage dibuat supaya lolos isConversationForUi. */
function chatPalsu(id, nama, riwayat, { isGroup = false, timestamp = NOW } = {}) {
  const terakhir = riwayat[riwayat.length - 1];
  return {
    id: { _serialized: id, user: id.split('@')[0] },
    name: nama, isGroup, timestamp, unreadCount: 0, pinned: false, archived: false,
    lastMessage: terakhir || null,
    async fetchMessages() { return riwayat; },
  };
}

function klienPalsu(chats, { labels = [] } = {}) {
  return {
    async getChats() { return chats; },
    async getChatById(id) { const chat = chats.find((c) => c.id._serialized === id); if (!chat) throw new Error('tidak ada'); return chat; },
    async getLabels() { return labels; },
  };
}

function fakeDatabase({ koneksi = [KONEKSI] } = {}) {
  const catatan = { imported: new Map(), names: [], assigned: [], products: new Map(), setProduct: [] };
  return {
    catatan, enabled: true, connected: true,
    async connect() {}, async close() {},
    status() { return { driver: 'postgresql', connected: true }; },
    async authenticateUser(email, password) { return email === SUPERVISOR.email && password === 'password-123' ? SUPERVISOR : null; },
    async getActiveSessionUser(userId) { return userId === SUPERVISOR.id ? SUPERVISOR : null; },
    async setPresence() {},
    async listTeamMembers() { return [SUPERVISOR]; },
    async getCompanyConfig() { return { whatsappProvider: 'whatsapp_web' }; },
    async listWhatsappConnections() { return koneksi; },
    async listPlaybookProducts() { return PRODUK; },
    async recordAuditLog(entry) { return entry; },
    async upsertImportedContacts(companyId, rows) { for (const row of rows) catatan.imported.set(row.chatId, { ...row, companyId }); return rows.length; },
    async listImportedChatIds() { return [...catatan.imported.keys()]; },
    async listChatIdsKnownToHaveChatted() { return []; },
    async countImportedContacts() {
      const semua = [...catatan.imported.values()];
      return { replied: semua.filter((r) => r.relation === 'replied').length, unproven: semua.filter((r) => r.relation === 'unproven').length };
    },
    async upsertContactName(companyId, chatId, name) { catatan.names.push({ companyId, chatId, name }); return true; },
    async assignWhatsappChatNumber(companyId, chatId, connectionId) { catatan.assigned.push({ companyId, chatId, connectionId }); return { connectionId }; },
    async getChatProduct(chatId) { return catatan.products.get(chatId) || null; },
    async setChatProduct({ chatId, productId, source }) { catatan.setProduct.push({ chatId, productId, source }); catatan.products.set(chatId, { productId, source }); return { productId }; },
  };
}

/**
 * Memasang klien palsu pada WhatsappManager, dan mengembalikannya sesudah tes.
 * `klien` boleh satu klien (untuk koneksi utama) atau peta id koneksi -> klien.
 */
function pasangKlien(t, klien, fase = 'ready') {
  const peta = klien && typeof klien.getChats === 'function' ? { [KONEKSI.id]: klien } : klien;
  const asliGetClient = WhatsappManager.prototype.getClient;
  const asliGetState = WhatsappManager.prototype.getState;
  WhatsappManager.prototype.getClient = function getClient(id) { return peta[id] || asliGetClient.call(this, id); };
  WhatsappManager.prototype.getState = function getState(id) { return peta[id] ? { phase: fase } : asliGetState.call(this, id); };
  t.after(() => { WhatsappManager.prototype.getClient = asliGetClient; WhatsappManager.prototype.getState = asliGetState; });
}

async function mulai(t, database) {
  const app = await buildApp({ logger: false, startupEnabled: false, demoMode: false, database, sessionSecret: 'import-secret' });
  t.after(() => app.close());
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: SUPERVISOR.email, password: 'password-123' } });
  assert.equal(login.statusCode, 200);
  return { app, cookie: login.headers['set-cookie'].split(';')[0] };
}

async function tungguSelesai(app, cookie, { batas = 8000 } = {}) {
  const sampai = Date.now() + batas;
  for (;;) {
    const res = await app.inject({ method: 'GET', url: '/v1/contacts/import', headers: { cookie } });
    const { run } = res.json();
    if (run && (run.phase === 'done' || run.phase === 'error')) return run;
    if (Date.now() > sampai) assert.fail(`impor tidak selesai dalam ${batas} ms; keadaan terakhir: ${JSON.stringify(run)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const post = (app, cookie, payload = {}) => app.inject({ method: 'POST', url: '/v1/contacts/import', headers: { cookie }, payload });

test('impor membaca chat perorangan, menyimpan hubungan, label, nama, nomor, dan produk', async (t) => {
  const chats = [
    chatPalsu('62811@c.us', 'Budi', [pesan('halo kak saya mau Nila CGI', false, NOW - 60), pesan('siap kak', true, NOW - 30)]),
    chatPalsu('62812@c.us', 'Sari', [pesan('promo ya kak', true, NOW - 90 * 86400)], { timestamp: NOW - 90 * 86400 }),
    chatPalsu('120363@g.us', 'Grup Reseller', [pesan('rame', false, NOW - 10)], { isGroup: true }),
    chatPalsu('98765@lid', 'Dewi', [pesan('tanya harga', false, NOW - 3600)], { timestamp: NOW - 3600 }),
  ];
  const database = fakeDatabase();
  pasangKlien(t, klienPalsu(chats, { labels: [{ name: 'Pelanggan baru', getChats: async () => [chats[0]] }] }));
  const { app, cookie } = await mulai(t, database);

  const res = await post(app, cookie);
  assert.equal(res.statusCode, 202);
  const hasil = await tungguSelesai(app, cookie);

  assert.equal(hasil.phase, 'done');
  assert.equal(hasil.error, null);
  assert.equal(hasil.eligible, 3, 'grup tidak ikut');
  assert.equal(hasil.done, 3);
  assert.equal(hasil.replied, 2);
  assert.equal(hasil.unproven, 1);
  assert.equal(hasil.labelsAvailable, true);

  const per = Object.fromEntries([...database.catatan.imported.entries()]);
  assert.ok(!per['120363@g.us'], 'grup tidak boleh tersimpan');
  assert.equal(per['62811@c.us'].relation, 'replied');
  assert.deepEqual(per['62811@c.us'].waLabels, ['Pelanggan baru']);
  assert.equal(per['62812@c.us'].relation, 'unproven', 'hanya kita yang kirim = belum terlihat membalas');
  assert.equal(per['62812@c.us'].lastInboundAt, null);
  assert.equal(per['62812@c.us'].companyId, 'company-1');

  assert.deepEqual(database.catatan.names.map((n) => n.name).sort(), ['Budi', 'Dewi', 'Sari']);
  assert.deepEqual(
    database.catatan.assigned.map((a) => [a.chatId, a.connectionId]).sort(),
    [['62811@c.us', 'conn-1'], ['62812@c.us', 'conn-1'], ['98765@lid', 'conn-1']],
    'tiap chat menempel pada nomor tempat ia dibaca',
  );
  // Budi menyebut "Nila CGI" utuh, jadi produk terpasang tanpa memanggil model.
  assert.deepEqual(database.catatan.setProduct, [{ chatId: '62811@c.us', productId: 'p-cgi', source: 'auto' }]);
  assert.equal(hasil.productsAssigned, 1);
});

test('impor kedua melewati yang sudah terimpor, jadi bisa dilanjutkan', async (t) => {
  const chats = [
    chatPalsu('62821@c.us', 'A', [pesan('halo', false, NOW - 10)]),
    chatPalsu('62822@c.us', 'B', [pesan('halo', false, NOW - 20)]),
  ];
  const database = fakeDatabase();
  pasangKlien(t, klienPalsu(chats));
  const { app, cookie } = await mulai(t, database);

  await post(app, cookie, { classifyProducts: false });
  const pertama = await tungguSelesai(app, cookie);
  assert.equal(pertama.done, 2);

  await post(app, cookie, { classifyProducts: false });
  const kedua = await tungguSelesai(app, cookie);
  assert.equal(kedua.alreadyImported, 2);
  assert.equal(kedua.done, 0);
});

test('klien tanpa label (WhatsApp biasa) tidak menggagalkan impor', async (t) => {
  const klien = klienPalsu([chatPalsu('62831@c.us', 'A', [pesan('halo', false, NOW - 10)])]);
  klien.getLabels = async () => { throw new Error('bukan akun Business'); };
  pasangKlien(t, klien);
  const { app, cookie } = await mulai(t, fakeDatabase());
  await post(app, cookie, { classifyProducts: false });
  const hasil = await tungguSelesai(app, cookie);
  assert.equal(hasil.phase, 'done');
  assert.equal(hasil.labelsAvailable, false);
  assert.equal(hasil.done, 1);
});

test('tanpa menebak produk, model tidak disentuh dan tidak ada produk terpasang', async (t) => {
  const database = fakeDatabase();
  pasangKlien(t, klienPalsu([chatPalsu('62841@c.us', 'A', [pesan('saya mau Nila CGI', false, NOW - 10)])]));
  const { app, cookie } = await mulai(t, database);
  await post(app, cookie, { classifyProducts: false });
  await tungguSelesai(app, cookie);
  assert.deepEqual(database.catatan.setProduct, []);
});

test('impor yang sedang berjalan menolak impor kedua', async (t) => {
  const riwayat = Array.from({ length: 6 }, (_, i) => chatPalsu(`6285${i}@c.us`, `N${i}`, [pesan('halo', false, NOW - i)]));
  pasangKlien(t, klienPalsu(riwayat));
  const { app, cookie } = await mulai(t, fakeDatabase());
  assert.equal((await post(app, cookie, { classifyProducts: false })).statusCode, 202);
  const kedua = await post(app, cookie, { classifyProducts: false });
  assert.equal(kedua.statusCode, 409);
  assert.match(kedua.json().error, /sedang berjalan/);
  await tungguSelesai(app, cookie);
});

test('impor bisa dibatalkan di tengah jalan dan alasannya tercatat', async (t) => {
  const chats = Array.from({ length: 12 }, (_, i) => chatPalsu(`6286${i}@c.us`, `N${i}`, [pesan('halo', false, NOW - i)]));
  const database = fakeDatabase();
  pasangKlien(t, klienPalsu(chats));
  const { app, cookie } = await mulai(t, database);
  await post(app, cookie, { classifyProducts: false });
  const batal = await app.inject({ method: 'DELETE', url: '/v1/contacts/import', headers: { cookie } });
  assert.equal(batal.statusCode, 200);
  const hasil = await tungguSelesai(app, cookie);
  assert.equal(hasil.stoppedBecause, 'cancelled');
  assert.ok(database.catatan.imported.size < chats.length, 'tidak semua chat boleh terbaca setelah dibatalkan');
});

test('nomor yang belum tersambung ditolak dengan petunjuk, bukan diam', async (t) => {
  pasangKlien(t, klienPalsu([]), 'disconnected');
  const { app, cookie } = await mulai(t, fakeDatabase());
  const res = await post(app, cookie);
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /belum tersambung/);
});

test('dua nomor: hasil dijumlahkan, dan "done" baru muncul setelah SEMUA nomor selesai', async (t) => {
  const database = fakeDatabase({ koneksi: [KONEKSI, KONEKSI_2] });
  // Nomor kedua lambat membaca daftar chat. Tanpa jeda ini jendela antara
  // "nomor pertama selesai" dan "nomor kedua mulai" cuma beberapa milidetik, dan
  // polling tidak pernah menangkapnya: tesnya lolos walau bug-nya ada.
  const kedua = klienPalsu([chatPalsu('62863@c.us', 'C', [pesan('halo', false, NOW - 30)])]);
  const asliGetChats = kedua.getChats;
  kedua.getChats = async () => { await new Promise((resolve) => setTimeout(resolve, 500)); return asliGetChats(); };
  pasangKlien(t, {
    [KONEKSI.id]: klienPalsu([chatPalsu('62861@c.us', 'A', [pesan('halo', false, NOW - 10)]), chatPalsu('62862@c.us', 'B', [pesan('halo', false, NOW - 20)])]),
    [KONEKSI_2.id]: kedua,
  });
  const { app, cookie } = await mulai(t, database);
  await post(app, cookie, { classifyProducts: false });

  const fase = [];
  const sampai = Date.now() + 8000;
  let run;
  for (;;) {
    run = (await app.inject({ method: 'GET', url: '/v1/contacts/import', headers: { cookie } })).json().run;
    fase.push(run.phase);
    if (run.phase === 'done' || run.phase === 'error') break;
    if (Date.now() > sampai) assert.fail(`tidak selesai: ${JSON.stringify(run)}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.equal(run.done, 3, 'jumlah dari kedua nomor');
  assert.equal(run.connections, 2);
  assert.equal(fase.filter((f) => f === 'done').length, 1, `'done' hanya boleh muncul sekali, di akhir: ${fase.join(',')}`);
  // Tiap chat menempel pada nomor tempat ia dibaca.
  const per = Object.fromEntries(database.catatan.assigned.map((a) => [a.chatId, a.connectionId]));
  assert.deepEqual(per, { '62861@c.us': 'conn-1', '62862@c.us': 'conn-1', '62863@c.us': 'conn-2' });
});

