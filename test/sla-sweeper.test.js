'use strict';

/**
 * Putaran penjadwal SLA: siapa yang diberi tahu, sekali atau berulang.
 *
 * Yang dijaga di sini bukan hitungan waktunya (itu di sla.test.js) melainkan
 * perilakunya terhadap orang: peringatan yang datang dua kali untuk penantian
 * yang sama akan membuat orang mematikan loncengnya, dan eskalasi yang tidak
 * pernah datang membuat tugas terlantar tidak pernah sampai ke orang yang bisa
 * memindahkannya.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { putaranSla } = require('../src/sla');

const JKT = 'Asia/Jakarta';
const COMPANY = 'company-1';
// 2026-09-21 Senin, Asia/Jakarta = UTC+7.
const senin = (jam, menit = 0) => new Date(Date.UTC(2026, 8, 21, jam - 7, menit));

function fakeDatabase(tugas, anggota = []) {
  const notifikasi = [];
  const tanda = [];
  return {
    notifikasi,
    tanda,
    async listTasksAwaitingReply() { return tugas; },
    async listTeamMembers() { return anggota; },
    async createTaskNotification(payload, companyId) {
      notifikasi.push({ ...payload, companyId });
      return [payload.userId];
    },
    async markTaskSla(payload, companyId) {
      tanda.push({ ...payload, companyId });
      return true;
    },
  };
}

const tugasDasar = {
  companyId: COMPANY,
  chatId: '628123@c.us',
  assigneeUserId: 'agent-1',
  priority: 'normal', // ambang 120 menit kerja
  timezone: JKT,
  slaWarnedAt: null,
  slaEscalatedAt: null,
  menungguSejak: senin(9),
};

test('tugas yang lewat ambang memberi tahu pemegangnya, sekali', async () => {
  const db = fakeDatabase([{ ...tugasDasar }]);
  const hasil = await putaranSla({ database: db, sekarangMs: senin(11, 5).getTime() });

  assert.equal(hasil.diperingatkan, 1);
  assert.equal(hasil.dieskalasi, 0);
  assert.equal(db.notifikasi.length, 1);
  assert.equal(db.notifikasi[0].userId, 'agent-1');
  assert.equal(db.notifikasi[0].kind, 'sla');
  assert.match(db.notifikasi[0].body, /menunggu 2 jam/);
  // Stempelnya memakai waktu pesan yang ditunggu, bukan waktu sekarang.
  assert.deepEqual(db.tanda[0].menungguSejak, tugasDasar.menungguSejak);
  assert.equal(db.tanda[0].warned, true);
});

test('penantian yang sudah diperingatkan tidak diperingatkan lagi', async () => {
  const db = fakeDatabase([{ ...tugasDasar, slaWarnedAt: senin(11, 5) }]);
  const hasil = await putaranSla({ database: db, sekarangMs: senin(11, 30).getTime() });

  assert.equal(hasil.diperingatkan, 0);
  assert.equal(db.notifikasi.length, 0);
});

test('pesan customer BARU memasang ulang SLA walau sudah pernah diperingatkan', async () => {
  // Diperingatkan pukul 11:05 untuk pesan pukul 09:00; customer mengirim lagi
  // pukul 11:10 dan menunggu dari titik itu.
  const db = fakeDatabase([{
    ...tugasDasar,
    slaWarnedAt: senin(11, 5),
    menungguSejak: senin(11, 10),
  }]);
  const hasil = await putaranSla({ database: db, sekarangMs: senin(13, 15).getTime() });

  assert.equal(hasil.diperingatkan, 1);
  assert.equal(db.notifikasi[0].userId, 'agent-1');
});

test('lewat dua kali ambang ikut memberi tahu supervisor, bukan agent saja', async () => {
  const anggota = [
    { id: 'agent-1', role: 'agent', status: 'active' },
    { id: 'sup-1', role: 'owner', status: 'active' },
    { id: 'sup-2', role: 'supervisor', status: 'active' },
    { id: 'sup-nonaktif', role: 'supervisor', status: 'invited' },
  ];
  const db = fakeDatabase([{ ...tugasDasar, slaWarnedAt: senin(11, 5) }], anggota);
  const hasil = await putaranSla({ database: db, sekarangMs: senin(13, 5).getTime() });

  assert.equal(hasil.dieskalasi, 1);
  const penerima = db.notifikasi.map((n) => n.userId).sort();
  assert.deepEqual(penerima, ['sup-1', 'sup-2']);
  // Anggota yang belum aktif tidak ikut dikirimi.
  assert.equal(penerima.includes('sup-nonaktif'), false);
  assert.equal(db.tanda[0].escalated, true);
});

test('supervisor yang memegang tugasnya sendiri tidak dikirimi dua kali', async () => {
  const anggota = [{ id: 'sup-1', role: 'owner', status: 'active' }];
  const db = fakeDatabase([{ ...tugasDasar, assigneeUserId: 'sup-1' }], anggota);
  await putaranSla({ database: db, sekarangMs: senin(13, 5).getTime() });

  const untukSup = db.notifikasi.filter((n) => n.userId === 'sup-1');
  assert.equal(untukSup.length, 1);
});

test('tugas yang belum lewat ambang tidak menghasilkan apa pun', async () => {
  const db = fakeDatabase([{ ...tugasDasar }]);
  const hasil = await putaranSla({ database: db, sekarangMs: senin(10, 30).getTime() });

  assert.equal(hasil.diperingatkan, 0);
  assert.equal(db.notifikasi.length, 0);
  assert.equal(db.tanda.length, 0);
});

test('satu tugas yang datanya rusak tidak menghentikan sisanya', async () => {
  const db = fakeDatabase([
    { ...tugasDasar, chatId: 'rusak', menungguSejak: 'bukan tanggal' },
    { ...tugasDasar, chatId: 'sehat' },
  ]);
  const hasil = await putaranSla({
    database: db, sekarangMs: senin(11, 5).getTime(), log: { warn() {} },
  });

  assert.equal(hasil.diperingatkan, 1);
  assert.equal(db.notifikasi[0].chatId, 'sehat');
});

test('lonceng penerima didorong lewat SSE, tanpa membawa isi notifikasinya', async () => {
  const db = fakeDatabase([{ ...tugasDasar }]);
  const dorongan = [];
  await putaranSla({
    database: db,
    sekarangMs: senin(11, 5).getTime(),
    onNotifikasi: (payload) => dorongan.push(payload),
  });

  assert.equal(dorongan.length, 1);
  assert.equal(dorongan[0].companyId, COMPANY);
  assert.deepEqual(dorongan[0].userIds, ['agent-1']);
  assert.equal('body' in dorongan[0], false);
});
